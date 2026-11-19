"use strict";

const path = require("path");
const cfg = require("./config");
const claude = require("./claude");
const browser = require("./smartlinkbrowser");
const monbiaya = require("./monbiaya");
const { readRange } = require("./sheets");
const { systemPrompt } = require("./konfirmasiprompt");
const akun = require("./smartlinkakun");

// =====================================================================
// Konfirmasi Biaya Smartlink — menjalankan skill konfirmasi-biaya-smartlink
// otomatis di latar belakang dari tombol di menu Monitoring Biaya.
//
// Alur: Claude (computer use) membaca & mengeklik Smartlink di browser
// tersembunyi; pencocokan dengan Monitoring Biaya + tanda ✓ VERIFIKASI OWNER
// dikerjakan server (tool cocokkan_biaya) langsung di sheet BIAYA. Progres,
// screenshot terakhir, dan laporan akhir bisa dipantau dari dashboard.
// =====================================================================

const HISTORY_FILE = path.join(cfg.DATA_DIR, "konfirmasi_history.json");
// Baris yang sudah ditandai ✓ oleh robot tetapi belum tercatat disetujui di
// Smartlink (mis. proses terhenti). Dikunci per KODE TRANSAKSI + keterangan +
// nominal — BUKAN nomor baris — supaya aman walau sheet/bulan berganti.
const PENDING_FILE = path.join(cfg.DATA_DIR, "konfirmasi_pending.json");
const BIAYA_SHEET = "BIAYA";

const EFFORT = "medium"; // tugas agen bertahap dengan banyak tool
const MAX_TOKENS = 16000;
const MAX_MINUTES = Number(process.env.KONFIRMASI_MAX_MINUTES) || 60;
const MAX_CALLS = Number(process.env.KONFIRMASI_MAX_CALLS) || 500;
// Konteks percakapan dipangkas dengan memulai sesi AI baru (berbekal catatan
// progres dari server) agar biaya & ukuran permintaan tetap kecil.
const EPISODE_SOFT_TOKENS = 90000; // ganti sesi di batas item
const EPISODE_HARD_TOKENS = 140000; // paksa ganti sesi
const EPISODE_MAX_BYTES = 18 * 1024 * 1024;
const DISPLAY_BETA = "thinking-display-updates-2026-08-18";
// Perkiraan harga Claude Sonnet 5.5 (USD per 1 juta token).
const PRICE = { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 };

const HASIL = ["DISETUJUI", "DILEWATI", "SUDAH_DISETUJUI", "COCOK_CEK_SAJA"];
const ALASAN = {
  TIDAK_ADA_PASANGAN: ["tidak ada pasangan di dashboard", "no matching dashboard row"],
  AMBIGU: ["ambigu — lebih dari satu baris cocok", "ambiguous — more than one row matches"],
  SUMBER_BANK: ["sumber dana bank, bukan kas tunai", "paid from bank, not cash"],
  SUDAH_TERVERIFIKASI: ["baris dashboard sudah terverifikasi", "dashboard row already verified"],
  TANPA_KETERANGAN: ["tanpa keterangan di Smartlink", "no description in Smartlink"],
  TANPA_KODE: ["kode transaksi kosong di dashboard", "transaction code empty in dashboard"],
  GAGAL_VERIFIKASI: ["gagal menandai ✓ di dashboard", "failed to tick the dashboard row"],
  GAGAL_SETUJUI: ["gagal menyetujui di Smartlink", "approval in Smartlink failed"],
  LAINNYA: ["lainnya", "other"],
  "-": ["", ""],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const normKey = (s) => String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]/g, "");
const rp = (n) => (Number.isFinite(Number(n)) ? "Rp" + Number(n).toLocaleString("id-ID") : "Rp?");
function tglLabel(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso || "?";
}

// ---------------- Tool untuk Claude ----------------

const COMPUTER_TOOLSET = { type: "computer_toolset_20260801" };

function customTools(strict) {
  const t = (name, description, properties, required) => {
    const def = {
      name,
      description,
      input_schema: { type: "object", properties, required, additionalProperties: false },
    };
    if (strict) def.strict = true;
    return def;
  };
  const itemProps = {
    keterangan: { type: "string", description: "Teks bagian Keterangan di Smartlink, persis." },
    nominal: { type: "integer", description: "Nominal rupiah, bilangan bulat tanpa titik (mis. 120000)." },
    tanggal: { type: "string", description: "Tanggal Waktu pemakaian, format YYYY-MM-DD ('' bila tak terbaca)." },
    outlet: { type: "string", enum: ["MAUMBI", "PERKAMIL", "TIDAK_TAHU"] },
  };
  return [
    t(
      "baca_menu",
      "Baca label menu/tombol Smartlink yang ada di pohon aksesibilitas (terutama sidebar) beserta koordinat tengahnya, format 'x,y :: label'. Isi area utama (kartu biaya, detail, dialog) TIDAK termasuk — baca lewat screenshot.",
      {},
      []
    ),
    t(
      "cocokkan_biaya",
      "Cocokkan satu biaya Smartlink dengan Monitoring Biaya (sheet BIAYA). Kelima kolom harus sama persis. " +
        "Bila tepat satu baris cocok, sumbernya KAS TUNAI, belum diverifikasi, dan kodenya ada: pada mode JALANKAN " +
        "server menandai VERIFIKASI OWNER ✓ lalu mengembalikan status OK + kode transaksi; pada mode CEK SAJA " +
        "mengembalikan COCOK tanpa mengubah apa pun. Status lain (NO-MATCH, AMBIGU, BUKAN-KAS, SUDAH-VERIF, " +
        "TANPA-KODE, TANPA-KETERANGAN, GAGAL, INPUT-TIDAK-VALID) berarti item itu harus dilewati.",
      {
        keterangan: { type: "string", description: "Teks bagian Keterangan (paling bawah) di halaman Detail Pengeluaran Biaya, PERSIS seperti tertulis di Smartlink." },
        nominal: { type: "integer", description: "Nominal rupiah, bilangan bulat tanpa titik (mis. 120000)." },
        tanggal: { type: "string", description: "Tanggal pada 'Waktu pemakaian' (jam diabaikan), format YYYY-MM-DD." },
        outlet: { type: "string", enum: ["MAUMBI", "PERKAMIL"], description: "Nama outlet pada bagian Sumber dana." },
        sumber_dana: { type: "string", description: "Jenis sumber dana di Smartlink apa adanya, mis. 'Kas Outlet Maumbi'." },
      },
      ["keterangan", "nominal", "tanggal", "outlet", "sumber_dana"]
    ),
    t(
      "catat_hasil",
      "Catat hasil akhir SATU item Smartlink yang sudah diperiksa (wajib sekali per item). DISETUJUI = sudah " +
        "disetujui di Smartlink dan notifikasi berhasil muncul; DILEWATI = tidak disetujui (isi alasan); " +
        "SUDAH_DISETUJUI = halaman detail sudah menunjukkan 'Permintaan Disetujui'; COCOK_CEK_SAJA = mode cek " +
        "saja dan cocokkan_biaya mengembalikan COCOK.",
      {
        ...itemProps,
        hasil: { type: "string", enum: HASIL },
        alasan: { type: "string", enum: Object.keys(ALASAN), description: "Alasan bila DILEWATI; '-' bila tidak relevan." },
        kode: { type: ["string", "null"], description: "Kode transaksi yang dipakai/ditemukan, atau null." },
        catatan: { type: "string", description: "Keterangan singkat (boleh kosong)." },
      },
      ["keterangan", "nominal", "tanggal", "outlet", "hasil", "alasan", "kode", "catatan"]
    ),
    t(
      "progres",
      "Lihat daftar item yang sudah tercatat pada proses ini (untuk menghindari memeriksa item yang sama dua kali).",
      {},
      []
    ),
    t(
      "isi_login",
      "Isi kolom login Smartlink yang SEDANG AKTIF (klik kolomnya dulu) dengan akun yang disimpan Andre di " +
        "dashboard. Server mengetik nilainya langsung; nilainya tidak pernah terlihat olehmu. " +
        "kolom 'email' untuk email/username, 'password' untuk kata sandi.",
      { kolom: { type: "string", enum: ["email", "password"] } },
      ["kolom"]
    ),
    t(
      "butuh_login",
      "Panggil bila Smartlink menampilkan halaman login/masuk (sesi owner habis). Proses dihentikan dan Andre diminta login.",
      { alasan: { type: "string" } },
      ["alasan"]
    ),
    t(
      "laporan_akhir",
      "Panggil SEKALI di akhir, setelah antrean 'Menunggu konfirmasi' habis (selain yang dilewati).",
      {
        sisa_menunggu_smartlink: { type: "integer", description: "Jumlah kartu 'Menunggu konfirmasi' yang masih tersisa di daftar Smartlink." },
        ringkasan_id: { type: "string", description: "Ringkasan singkat hasil dalam bahasa Indonesia." },
        ringkasan_en: { type: "string", description: "Ringkasan yang sama dalam bahasa Inggris." },
      },
      ["sisa_menunggu_smartlink", "ringkasan_id", "ringkasan_en"]
    ),
  ];
}

// ---------------- State proses ----------------

let RUN = null; // proses aktif / terakhir (di memori)

function isActive(run) {
  // "finalizing": fase akhir sudah diketahui tetapi laporan masih disusun.
  return !!run && (run.phase === "starting" || run.phase === "running" || !!run.finalizing);
}

function log(run, text, kind = "info") {
  const t = String(text || "").trim();
  if (!t) return;
  run.log.push({ t: Date.now(), text: t.slice(0, 600), kind });
  if (run.log.length > 400) run.log.splice(0, run.log.length - 400);
  if (kind !== "detail") run.step = t.slice(0, 200);
}

function counts(run) {
  const c = { disetujui: 0, dilewati: 0, sudah: 0, cocok: 0 };
  for (const i of run.items) {
    if (i.hasil === "DISETUJUI") c.disetujui++;
    else if (i.hasil === "DILEWATI") c.dilewati++;
    else if (i.hasil === "SUDAH_DISETUJUI") c.sudah++;
    else if (i.hasil === "COCOK_CEK_SAJA") c.cocok++;
  }
  return c;
}

function publicRun(run) {
  const end = run.finishedAt ? Date.parse(run.finishedAt) : Date.now();
  return {
    id: run.id,
    mode: run.dryRun ? "cek" : "jalankan",
    dryRun: run.dryRun,
    showBrowser: run.showBrowser,
    phase: run.phase,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    elapsedSec: Math.round((end - Date.parse(run.startedAt)) / 1000),
    step: run.step,
    counts: counts(run),
    calls: run.usage.calls,
    episodes: run.episodes,
    costUsd: Math.round(run.costUsd * 1000) / 1000,
    error: run.error,
    errorCode: run.errorCode,
    needLogin: run.needLogin || null,
    report: run.report,
    log: run.log.slice(-150),
  };
}

// ---------------- Riwayat & pending (file lokal) ----------------

function loadHistory() {
  const d = cfg.readJsonFile(HISTORY_FILE, { runs: [] });
  return Array.isArray(d.runs) ? d.runs : [];
}
function saveHistory(entry) {
  const runs = [entry, ...loadHistory().filter((r) => r.id !== entry.id)].slice(0, 10);
  cfg.writeJsonFile(HISTORY_FILE, { runs });
}

function pendingKey(p) {
  return `${String(p.kode || "").trim()}|${normKey(p.keterangan)}|${Number(p.nominal)}`;
}
function loadPending() {
  const d = cfg.readJsonFile(PENDING_FILE, { items: [] });
  const cutoff = Date.now() - 45 * 86400000;
  return (Array.isArray(d.items) ? d.items : []).filter((i) => i && i.at > cutoff);
}
function savePending(items) {
  cfg.writeJsonFile(PENDING_FILE, { items });
}
function addPending(p) {
  const items = loadPending().filter((i) => pendingKey(i) !== pendingKey(p));
  items.push({ ...p, at: Date.now() });
  savePending(items);
}
function removePendingByKode(kode) {
  if (!kode) return;
  savePending(loadPending().filter((i) => String(i.kode) !== String(kode)));
}
function isPending(row) {
  const k = pendingKey({ kode: row.kode, keterangan: row.keterangan, nominal: row.nominalNum });
  return loadPending().some((i) => pendingKey(i) === k);
}

/** Baris yang ✓ oleh robot pada proses ini tetapi belum tercatat disetujui. */
function pendingInRun(run) {
  if (run.dryRun) return [];
  const done = new Set(
    run.items.filter((i) => i.kode && i.hasil !== "COCOK_CEK_SAJA").map((i) => String(i.kode))
  );
  const seen = new Set();
  const out = [];
  for (const m of run.matches) {
    if (m.status !== "OK" || !m.kode || done.has(String(m.kode)) || seen.has(String(m.kode))) continue;
    seen.add(String(m.kode));
    out.push({ keterangan: m.keterangan, nominal: m.nominal, tanggal: m.tanggal, outlet: m.outlet, nomor: m.nomor, kode: m.kode });
  }
  return out;
}

// ---------------- Data Monitoring Biaya ----------------

function toRow(r) {
  const c = r.cells || [];
  return {
    row: r.row,
    nomor: String(c[0] || "").replace(/[^0-9]/g, "") || String(c[0] || ""),
    subjek: c[1] || "",
    keterangan: c[2] || "",
    nominalText: c[3] || "",
    tanggalText: c[4] || "",
    outlet: c[5] || "",
    sumber: c[6] || "",
    kode: r.kode || "",
    verifikasi: r.verifikasi || "",
    tanggalIso: r.tanggalIso || "",
    nominalNum: r.nominalNum,
  };
}

async function dashboardRows() {
  const data = await monbiaya.list({ receipts: false });
  return data.rows.map(toRow);
}

function briefRow(r) {
  return { nomor: r.nomor, keterangan: r.keterangan, nominal: r.nominalNum, tanggal: r.tanggalIso, outlet: r.outlet, sumber_dana: r.sumber, verifikasi: r.verifikasi || "—", kode: r.kode };
}

function isSetoranOwner(r) {
  return /setoran\s*owner/i.test(r.subjek) || /setoran\s*owner/i.test(r.keterangan);
}

/** Baca satu baris BIAYA langsung (memastikan baris belum bergeser / ✓ sudah tersimpan). */
async function readBiayaRow(row) {
  const v = await readRange(cfg.BIAYA_KAS_SPREADSHEET_ID, `'${BIAYA_SHEET}'!A${row}:N${row}`, "FORMATTED_VALUE");
  const r = (v && v[0]) || [];
  return { keterangan: String(r[2] || "").trim(), kode: String(r[11] || "").trim(), verifikasi: String(r[12] || "").trim() };
}

async function matchDashboard(run, q) {
  const rows = await dashboardRows();
  const nk = normKey(q.keterangan);
  const outletOk = (r) => normKey(r.outlet).includes(normKey(q.outlet));
  const cands = rows.filter(
    (r) => normKey(r.keterangan) === nk && r.nominalNum === q.nominal && r.tanggalIso === q.tanggal && outletOk(r)
  );
  if (cands.length === 0) {
    const mirip = rows
      .filter((r) => normKey(r.keterangan) === nk && outletOk(r) && (r.nominalNum === q.nominal || r.tanggalIso === q.tanggal))
      .slice(0, 3)
      .map(briefRow);
    return { status: "NO-MATCH", pesan: "Tidak ada baris dengan kelima kolom sama persis. Lewati item ini.", mirip };
  }
  if (cands.length > 1) {
    return { status: "AMBIGU", jumlah: cands.length, nomor: cands.map((r) => r.nomor), pesan: "Lebih dari satu baris cocok. Lewati item ini." };
  }
  const r = cands[0];
  if (!/^KAS TUNAI/i.test(r.sumber.trim())) {
    return { status: "BUKAN-KAS", nomor: r.nomor, sumber_dana_dashboard: r.sumber, pesan: "Sumber dana di dashboard bukan KAS TUNAI. Lewati item ini." };
  }
  if (r.verifikasi) {
    if (!run.dryRun && r.verifikasi === "SUDAH VERIFIKASI OWNER" && r.kode && isPending(r)) {
      return {
        status: "OK",
        nomor: r.nomor,
        kode: r.kode,
        row: r.row,
        pesan: "Baris ini sudah ✓ oleh robot pada proses sebelumnya tetapi belum disetujui di Smartlink. Setujui dengan kode ini.",
      };
    }
    return { status: "SUDAH-VERIF", nomor: r.nomor, kode: r.kode, verifikasi: r.verifikasi, pesan: "Baris dashboard sudah diverifikasi sebelumnya. Lewati item ini." };
  }
  if (!r.kode) return { status: "TANPA-KODE", nomor: r.nomor, pesan: "Baris cocok tetapi KODE TRANSAKSI di dashboard kosong. Lewati item ini." };
  if (run.dryRun) {
    return { status: "COCOK", nomor: r.nomor, kode: r.kode, pesan: "Cocok. Mode cek saja — tidak ada yang diubah, jangan menyetujui." };
  }

  // Pastikan baris di sheet masih baris yang sama sebelum menulis.
  const before = await readBiayaRow(r.row);
  if (normKey(before.keterangan) !== nk || before.kode !== r.kode || before.verifikasi) {
    return { status: "GAGAL", nomor: r.nomor, pesan: "Baris di sheet BIAYA berubah saat dicocokkan. Lewati item ini." };
  }
  try {
    await monbiaya.setStatus(r.row, "verifikasi", "SUDAH VERIFIKASI OWNER");
  } catch (e) {
    return { status: "GAGAL", nomor: r.nomor, pesan: `Gagal menandai ✓ di sheet BIAYA (${e.message}). Lewati item ini.` };
  }
  // Tunggu sampai ✓ benar-benar terbaca di sheet (setara __mbWait pada skill).
  for (let i = 0; i < 4; i++) {
    const after = await readBiayaRow(r.row).catch(() => null);
    if (after && after.verifikasi === "SUDAH VERIFIKASI OWNER" && normKey(after.keterangan) === nk) {
      addPending({ kode: r.kode, keterangan: r.keterangan, nominal: r.nominalNum, tanggal: r.tanggalIso, outlet: r.outlet, nomor: r.nomor });
      return { status: "OK", nomor: r.nomor, kode: r.kode, row: r.row, pesan: "Dashboard sudah ✓. Setujui di Smartlink dengan kode ini sebagai catatan." };
    }
    await sleep(1500);
  }
  return { status: "GAGAL", nomor: r.nomor, pesan: "Tanda ✓ belum terbaca di sheet BIAYA. Jangan setujui; lewati item ini." };
}

async function cocokkan(run, input) {
  const q = {
    keterangan: String(input.keterangan || "").trim(),
    nominal: Math.round(Number(input.nominal)),
    tanggal: String(input.tanggal || "").trim(),
    outlet: String(input.outlet || "").trim().toUpperCase(),
    sumber_dana: String(input.sumber_dana || "").trim(),
  };
  let res;
  if (!q.keterangan) res = { status: "TANPA-KETERANGAN", pesan: "Biaya tanpa bagian Keterangan tidak akan berpasangan. Lewati item ini." };
  else if (!Number.isFinite(q.nominal) || q.nominal <= 0) res = { status: "INPUT-TIDAK-VALID", pesan: "nominal harus angka rupiah > 0. Baca ulang lalu panggil lagi." };
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(q.tanggal)) res = { status: "INPUT-TIDAK-VALID", pesan: "tanggal harus YYYY-MM-DD. Baca ulang lalu panggil lagi." };
  else if (!["MAUMBI", "PERKAMIL"].includes(q.outlet)) res = { status: "INPUT-TIDAK-VALID", pesan: "outlet harus MAUMBI atau PERKAMIL." };
  else res = await matchDashboard(run, q);

  run.matches.push({ at: Date.now(), ...q, status: res.status, nomor: res.nomor || null, kode: res.kode || null });
  const ok = res.status === "OK" || res.status === "COCOK";
  const extra = res.nomor ? ` (NOMOR ${Array.isArray(res.nomor) ? res.nomor.join(", ") : res.nomor}${res.kode ? `, kode ${res.kode}` : ""})` : "";
  log(run, `🔗 Cocokkan "${q.keterangan || "(tanpa keterangan)"}" ${rp(q.nominal)} · ${tglLabel(q.tanggal)} · ${q.outlet} → ${res.status}${extra}`, ok ? "ok" : "warn");
  const { row, ...forModel } = res;
  return forModel;
}

function catat(run, input) {
  const item = {
    at: Date.now(),
    keterangan: String(input.keterangan || "").trim(),
    nominal: Math.round(Number(input.nominal)) || null,
    tanggal: String(input.tanggal || "").trim(),
    outlet: String(input.outlet || "").trim().toUpperCase(),
    hasil: HASIL.includes(input.hasil) ? input.hasil : "DILEWATI",
    alasan: ALASAN[input.alasan] ? input.alasan : "LAINNYA",
    kode: input.kode ? String(input.kode).trim() : null,
    catatan: String(input.catatan || "").trim(),
  };
  if (item.hasil !== "DILEWATI") item.alasan = "-";
  // Pasangan dashboard dari hasil cocokkan terakhir untuk item yang sama.
  const m = [...run.matches]
    .reverse()
    .find((x) => normKey(x.keterangan) === normKey(item.keterangan) && x.nominal === item.nominal && (!item.tanggal || x.tanggal === item.tanggal));
  item.nomor = m && m.nomor && !Array.isArray(m.nomor) ? m.nomor : null;
  if (!item.kode && m && m.kode) item.kode = m.kode;
  item.statusCocok = m ? m.status : null;
  if (item.hasil === "DISETUJUI") {
    if (!m || m.status !== "OK" || (m.kode && item.kode && String(m.kode) !== String(item.kode))) {
      item.peringatan = "Disetujui tanpa hasil cocokkan_biaya OK yang sesuai — periksa manual.";
    }
    removePendingByKode(item.kode);
  } else if (item.hasil === "SUDAH_DISETUJUI") {
    removePendingByKode(item.kode);
  }
  // Item yang sama dicatat ulang → pakai catatan terbaru.
  const dup = run.items.findIndex(
    (x) => normKey(x.keterangan) === normKey(item.keterangan) && x.nominal === item.nominal && x.tanggal === item.tanggal && x.outlet === item.outlet
  );
  if (dup >= 0) run.items.splice(dup, 1);
  run.items.push(item);

  const label = `"${item.keterangan || "(tanpa keterangan)"}" ${rp(item.nominal)} · ${tglLabel(item.tanggal)} · ${item.outlet}`;
  if (item.hasil === "DISETUJUI") log(run, `✅ Disetujui ${label}${item.kode ? ` — kode ${item.kode}` : ""}`, item.peringatan ? "warn" : "ok");
  else if (item.hasil === "COCOK_CEK_SAJA") log(run, `🟢 Cocok (cek saja) ${label}${item.kode ? ` — kode ${item.kode}` : ""}`, "ok");
  else if (item.hasil === "SUDAH_DISETUJUI") log(run, `☑ Sudah disetujui sebelumnya ${label}`, "info");
  else log(run, `⏭ Dilewati ${label} — ${ALASAN[item.alasan][0]}${item.catatan ? ` (${item.catatan})` : ""}`, "warn");

  const result = { ok: true, tercatat: run.items.length };
  if (item.peringatan) result.peringatan = item.peringatan;
  return result;
}

function progres(run) {
  return {
    diproses: run.items.map((i) => ({
      keterangan: i.keterangan, nominal: i.nominal, tanggal: i.tanggal, outlet: i.outlet, hasil: i.hasil,
      alasan: i.alasan, kode: i.kode,
    })),
    sudah_ok_belum_dicatat: pendingInRun(run),
  };
}

// ---------------- Menjalankan tool ----------------

function imageBlock(b64) {
  return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } };
}

function describeAction(b) {
  const i = b.input || {};
  const c = Array.isArray(i.coordinate) ? ` (${i.coordinate.join(", ")})` : "";
  switch (b.name) {
    case "left_click": return `🖱 Klik${c}`;
    case "double_click": return `🖱 Klik ganda${c}`;
    case "triple_click": return `🖱 Klik tiga kali${c}`;
    case "right_click": return `🖱 Klik kanan${c}`;
    case "type": {
      const t = String(i.text || "");
      return `⌨ Mengetik "${t.length > 40 ? t.slice(0, 40) + "…" : t}"`;
    }
    case "key": return `⌨ Tombol ${i.text}`;
    case "scroll": return `↕ Gulir ${i.scroll_direction || ""}${c}`;
    case "left_click_drag": return "🖱 Seret";
    case "zoom": return "🔎 Zoom";
    case "wait": return `⏳ Menunggu ${i.duration || 1} dtk`;
    default: return null;
  }
}

async function runCustomTool(run, name, input) {
  switch (name) {
    case "baca_menu":
      return { result: { menu: await browser.readMenu() } };
    case "cocokkan_biaya":
      return { result: await cocokkan(run, input) };
    case "catat_hasil":
      return { result: catat(run, input), itemBoundary: true };
    case "progres":
      return { result: progres(run) };
    case "isi_login": {
      const a = akun.load();
      if (!a) {
        return { result: { ok: false, pesan: "Akun Smartlink belum disimpan di dashboard. Panggil butuh_login." } };
      }
      const kolom = input.kolom === "password" ? "password" : "email";
      if (kolom === "password") {
        run.loginTries = (run.loginTries || 0) + 1;
        if (run.loginTries > 2) {
          return { result: { ok: false, pesan: "Sudah 2 kali mencoba login pada proses ini. Jangan coba lagi — panggil butuh_login." } };
        }
      }
      await browser.typeSecret(kolom === "email" ? a.email : a.password);
      log(run, kolom === "email" ? "🔐 Login otomatis: mengisi email Smartlink" : "🔐 Login otomatis: mengisi kata sandi", "info");
      return { result: { ok: true, pesan: kolom === "email" ? "Email sudah diketik." : "Kata sandi sudah diketik (disembunyikan)." } };
    }
    case "butuh_login":
      run.needLogin = String(input.alasan || "Sesi Smartlink habis.");
      log(run, "🔑 Smartlink meminta login: " + run.needLogin, "warn");
      return { result: { ok: true }, stop: true };
    case "laporan_akhir":
      run.final = {
        sisa: Number.isFinite(Number(input.sisa_menunggu_smartlink)) ? Math.max(0, Math.round(Number(input.sisa_menunggu_smartlink))) : null,
        ringkasanId: String(input.ringkasan_id || "").trim(),
        ringkasanEn: String(input.ringkasan_en || "").trim(),
      };
      log(run, "📝 Menyusun laporan akhir…");
      return { result: { ok: true }, stop: true };
    default:
      throw new Error(`Tool tidak dikenal: ${name}`);
  }
}

/**
 * Jalankan semua tool_use satu giliran secara berurutan (aturan "batch action":
 * berhenti pada kegagalan pertama, sisanya dijawab "Not executed").
 */
async function executeTools(run, uses, truncated) {
  const results = [];
  let failed = false;
  let stop = false;
  let itemBoundary = false;
  let lastComputer = -1;
  let screenFresh = true;
  let hadUi = false;

  for (const b of uses) {
    const isComputer = b.toolset_name === "computer";
    const base = { type: "tool_result", tool_use_id: b.id };
    if (isComputer) base.toolset_name = "computer";
    if (truncated) {
      results.push({ ...base, is_error: true, content: "Respons terpotong (max_tokens) — aksi ini tidak dijalankan. Ulangi dengan respons lebih singkat." });
      continue;
    }
    if (failed || stop) {
      results.push({
        ...base,
        is_error: true,
        content: stop ? "Tidak dijalankan: proses sudah diakhiri." : "Not executed: an earlier computer action in this turn failed.",
      });
      continue;
    }
    if (run.cancel) throw cancelError();
    try {
      if (isComputer) {
        // "wait" dijalankan di sini agar bisa dihentikan seketika oleh tombol Hentikan.
        const out = b.name === "wait" ? await cancellableWait(run, b.input) : await browser.perform(b.name, b.input || {});
        const d = describeAction(b);
        if (d && b.name !== "zoom") log(run, d, "detail");
        if (out.image) {
          results.push({ ...base, content: [imageBlock(out.image)] });
          if (b.name === "screenshot") screenFresh = true;
        } else {
          results.push({ ...base, content: out.text || "OK" });
          if (browser.UI_ACTIONS.has(b.name)) {
            hadUi = true;
            screenFresh = false;
          }
        }
        lastComputer = results.length - 1;
      } else {
        const out = await runCustomTool(run, b.name, b.input || {});
        results.push({ ...base, content: JSON.stringify(out.result) });
        if (out.itemBoundary) itemBoundary = true;
        if (out.stop) stop = true;
      }
    } catch (e) {
      if (e.code === "BROWSER_CLOSED" || e.code === "CANCELLED") throw e;
      failed = true;
      results.push({ ...base, is_error: true, content: String(e.message || e) });
      log(run, `⚠ ${b.name}: ${e.message || e}`, "detail");
    }
  }

  // Giliran berisi aksi tetapi tidak diakhiri screenshot → lampirkan screenshot
  // pada hasil aksi komputer terakhir (menghemat satu giliran).
  if (!stop && !truncated && hadUi && !screenFresh && lastComputer >= 0 && !results[lastComputer].is_error) {
    const shot = await browser.screenshot().catch(() => null);
    if (shot) {
      const r = results[lastComputer];
      const text = typeof r.content === "string" ? r.content : "OK";
      r.content = [{ type: "text", text }, imageBlock(shot)];
    }
  }
  return { results, stop, itemBoundary };
}

async function cancellableWait(run, input) {
  const sec = Math.max(0, Math.min(20, Number(input && input.duration) || 1));
  const end = Date.now() + sec * 1000;
  while (Date.now() < end) {
    if (run.cancel) throw cancelError();
    await sleep(Math.min(250, end - Date.now()));
  }
  return { text: "OK" };
}

function cancelError() {
  const e = new Error("Dihentikan oleh pengguna.");
  e.code = "CANCELLED";
  return e;
}

// ---------------- Panggilan Claude ----------------

function buildBody(run, messages, f) {
  const betas = [];
  if (f.display) betas.push(DISPLAY_BETA);
  if (f.fallbacks) betas.push(claude.FALLBACK_BETA);
  const body = {
    model: claude.MODEL,
    max_tokens: MAX_TOKENS,
    system: [{ type: "text", text: systemPrompt({ dryRun: run.dryRun }) }],
    tools: [COMPUTER_TOOLSET, ...customTools(f.strict)],
    messages,
    thinking: f.display ? { type: "adaptive", display: "updates" } : { type: "adaptive" },
    output_config: { effort: EFFORT },
  };
  if (f.cache) body.cache_control = { type: "ephemeral" };
  if (f.fallbacks) body.fallbacks = "default";
  if (betas.length) body.betas = betas;
  return body;
}

function accountUsage(run, usage) {
  if (!usage) return 0;
  const inp = usage.input_tokens || 0;
  const out = usage.output_tokens || 0;
  const cr = usage.cache_read_input_tokens || 0;
  const cw = usage.cache_creation_input_tokens || 0;
  run.usage.input += inp;
  run.usage.output += out;
  run.usage.cacheRead += cr;
  run.usage.cacheWrite += cw;
  run.costUsd += (inp * PRICE.input + out * PRICE.output + cr * PRICE.cacheRead + cw * PRICE.cacheWrite) / 1e6;
  return inp + cr + cw + out; // ukuran konteks percakapan saat ini
}

async function callClaude(run, messages, f) {
  const client = claude.client();
  for (let attempt = 0; ; attempt++) {
    if (run.cancel) throw cancelError();
    const body = buildBody(run, messages, f);
    run.abort = new AbortController();
    try {
      const resp = body.betas
        ? await client.beta.messages.create(body, { signal: run.abort.signal })
        : await client.messages.create(body, { signal: run.abort.signal });
      run.usage.calls++;
      return resp;
    } catch (e) {
      if (run.cancel) throw cancelError();
      const status = e && e.status;
      const msg = String((e && e.message) || e);
      if (status === 400) {
        // Fitur opsional yang ditolak API → matikan lalu ulangi.
        if (f.fallbacks && /fallback/i.test(msg)) { f.fallbacks = false; continue; }
        if (f.display && /display|updates|thinking-display/i.test(msg)) { f.display = false; continue; }
        if (f.strict && /strict/i.test(msg)) { f.strict = false; continue; }
        if (f.cache && /cache_control/i.test(msg)) { f.cache = false; continue; }
        throw new Error("Permintaan ke Claude ditolak: " + msg);
      }
      if (status === 401 || status === 403) throw new Error("API key Anthropic tidak valid / tidak diizinkan. Periksa ANTHROPIC_API_KEY di .env.");
      const transient = !status || status === 408 || status === 409 || status === 429 || status >= 500;
      if (transient && attempt < 3) {
        log(run, `Koneksi ke Claude bermasalah (${status || "jaringan"}), mencoba lagi…`, "detail");
        await sleep([5000, 15000, 30000][attempt]);
        continue;
      }
      throw new Error("Gagal menghubungi Claude: " + msg);
    } finally {
      run.abort = null;
    }
  }
}

// ---------------- Loop agen ----------------

function kickoffText(run) {
  const lines = [
    `MODE: ${run.dryRun ? "CEK SAJA (dry run) — JANGAN menyetujui apa pun" : "JALANKAN — setujui biaya yang cocok di Smartlink"}`,
    `Hari ini: ${cfg.todaySheetDate()} (WITA).`,
    `Monitoring Biaya: ${run.dashAwal ? run.dashAwal.belum : "?"} baris belum diverifikasi owner (—).`,
  ];
  if (run.episodes <= 1) {
    lines.push("Mulai dari Langkah 1. Screenshot layar saat ini terlampir.");
  } else {
    lines.push(
      `Ini lanjutan proses yang sama (bagian ${run.episodes}); percakapan lama dipangkas agar ringan. ` +
        "Browser masih di posisi terakhir — screenshot terbaru terlampir."
    );
    const done = run.items.map(
      (i) => `- ${i.keterangan || "(tanpa keterangan)"} | ${rp(i.nominal)} | ${i.tanggal || "?"} | ${i.outlet} → ${i.hasil}` +
        `${i.alasan && i.alasan !== "-" ? ` (${i.alasan})` : ""}${i.kode ? ` kode ${i.kode}` : ""}`
    );
    lines.push("Item yang SUDAH diproses (jangan diperiksa ulang):", done.length ? done.join("\n") : "(belum ada)");
    const pend = pendingInRun(run);
    if (pend.length) {
      lines.push(
        "PERHATIAN — sudah ✓ di dashboard tetapi belum tercatat disetujui di Smartlink:",
        pend.map((p) => `- ${p.keterangan} | ${rp(p.nominal)} | ${p.tanggal} | ${p.outlet} → kode ${p.kode}`).join("\n"),
        "Periksa layar sekarang: selesaikan persetujuannya dengan kode tersebut, atau catat_hasil bila sudah disetujui / gagal."
      );
    }
  }
  return lines.join("\n");
}

async function agentLoop(run) {
  const f = { fallbacks: true, display: true, strict: true, cache: true };
  const deadline = Date.parse(run.startedAt) + MAX_MINUTES * 60000;
  let messages = null;
  let ctxTokens = 0;
  let bytes = 0;
  let nudges = 0;

  const newEpisode = async () => {
    run.episodes++;
    const shot = await browser.screenshot();
    messages = [{ role: "user", content: [{ type: "text", text: kickoffText(run) }, imageBlock(shot)] }];
    bytes = shot.length;
    ctxTokens = 0;
    if (run.episodes > 1) log(run, `Melanjutkan di sesi AI baru (bagian ${run.episodes}) agar tetap ringan.`, "detail");
  };
  await newEpisode();

  for (;;) {
    if (run.cancel) throw cancelError();
    if (Date.now() > deadline) {
      const e = new Error(`Dihentikan otomatis: melewati batas waktu ${MAX_MINUTES} menit.`);
      e.code = "LIMIT";
      throw e;
    }
    if (run.usage.calls >= MAX_CALLS) {
      const e = new Error(`Dihentikan otomatis: melewati batas ${MAX_CALLS} langkah AI.`);
      e.code = "LIMIT";
      throw e;
    }

    const resp = await callClaude(run, messages, f);
    ctxTokens = accountUsage(run, resp.usage);
    messages.push({ role: "assistant", content: resp.content });

    for (const b of resp.content || []) {
      if (b.type === "thinking" && b.thinking && b.thinking.trim()) log(run, b.thinking.trim(), "ai");
      else if (b.type === "text" && b.text && b.text.trim()) log(run, b.text.trim(), "ai");
    }
    if (resp.stop_reason === "refusal") {
      const e = new Error("Claude menolak melanjutkan proses ini" + (resp.stop_details && resp.stop_details.category ? ` (kategori: ${resp.stop_details.category})` : "") + ".");
      e.code = "REFUSAL";
      throw e;
    }

    const uses = (resp.content || []).filter((b) => b.type === "tool_use");
    if (!uses.length) {
      if (run.final) return;
      if (nudges++ < 2) {
        messages.push({
          role: "user",
          content: [{ type: "text", text: "Lanjutkan prosedurnya tanpa bertanya sampai antrean habis. Bila sudah selesai, panggil laporan_akhir." }],
        });
        continue;
      }
      log(run, "AI berhenti tanpa laporan akhir.", "warn");
      return;
    }
    nudges = 0;

    const truncated = resp.stop_reason === "max_tokens";
    const { results, stop, itemBoundary } = await executeTools(run, uses, truncated);
    if (stop) return;
    messages.push({ role: "user", content: results });
    for (const r of results) {
      if (Array.isArray(r.content)) for (const c of r.content) if (c.type === "image") bytes += c.source.data.length;
    }

    if ((ctxTokens > EPISODE_SOFT_TOKENS && itemBoundary) || ctxTokens > EPISODE_HARD_TOKENS || bytes > EPISODE_MAX_BYTES) {
      await newEpisode();
    }
  }
}

// ---------------- Laporan ----------------

function itemLine(i, en) {
  const parts = [i.keterangan || (en ? "(no description)" : "(tanpa keterangan)"), rp(i.nominal), tglLabel(i.tanggal), i.outlet];
  if (i.nomor) parts.push(`NOMOR ${i.nomor}`);
  if (i.kode) parts.push((en ? "code " : "kode ") + i.kode);
  return parts.join(" · ");
}

function buildText(rep) {
  const dash = rep.dashboard || {};
  const L = [];
  const head = (title, arr, fn) => {
    L.push(`${title}: ${arr.length}`);
    arr.forEach((x, n) => L.push(`  ${n + 1}. ${fn(x)}`));
  };
  const statusId = { done: "Selesai", cancelled: "Dihentikan", error: "Berhenti karena error", need_login: "Perlu login Smartlink" }[rep.phase] || rep.phase;
  const statusEn = { done: "Finished", cancelled: "Stopped", error: "Stopped on error", need_login: "Smartlink login required" }[rep.phase] || rep.phase;

  L.push(`LAPORAN KONFIRMASI BIAYA SMARTLINK — ${rep.waktu}`);
  L.push(`Mode: ${rep.dryRun ? "Cek saja (tanpa menyetujui)" : "Jalankan"} · Status: ${statusId}`);
  if (rep.error) L.push(`Catatan: ${rep.error}`);
  if (rep.dryRun) head("Cocok (akan disetujui bila dijalankan)", rep.cocok, (i) => itemLine(i));
  else head("Disetujui", rep.disetujui, (i) => itemLine(i) + (i.peringatan ? ` ⚠ ${i.peringatan}` : ""));
  head("Dilewati", rep.dilewati, (i) => `${itemLine(i)} — ${ALASAN[i.alasan] ? ALASAN[i.alasan][0] : i.alasan}${i.catatan ? ` (${i.catatan})` : ""}`);
  if (rep.sudah.length) head("Sudah disetujui sebelumnya", rep.sudah, (i) => itemLine(i));
  if (rep.perluCek.length) head("⚠ Sudah ✓ di dashboard tapi belum disetujui di Smartlink", rep.perluCek, (i) => itemLine(i));
  L.push(`Sisa "Menunggu konfirmasi" di Smartlink: ${rep.sisaMenungguSmartlink == null ? "tidak diketahui" : rep.sisaMenungguSmartlink}`);
  if (dash.error) L.push(`Sisa baris "—" di dashboard: gagal dibaca (${dash.error})`);
  else {
    L.push(`Sisa baris "—" di dashboard: ${dash.belumAkhir}${dash.belumAwal != null ? ` (awal: ${dash.belumAwal})` : ""} · terverifikasi ✓: ${dash.terverifikasi}`);
    (dash.sisa || []).forEach((r) => L.push(`  ${r.nomor} | ${r.keterangan} | ${rp(r.nominal)} | ${tglLabel(r.tanggal)} | ${r.outlet}`));
    if ((dash.setoranOwner || []).length) {
      L.push(`Setoran Owner (bukan pengeluaran, tidak muncul di Biaya Outlet): ${dash.setoranOwner.length}`);
      dash.setoranOwner.forEach((r) => L.push(`  ${r.nomor} | ${r.keterangan} | ${rp(r.nominal)} | ${tglLabel(r.tanggal)} | ${r.outlet}`));
    }
  }
  if (rep.ringkasanId) L.push(`Ringkasan: ${rep.ringkasanId}`);

  L.push("", "— English —");
  L.push(`SMARTLINK EXPENSE CONFIRMATION REPORT — ${rep.waktu}`);
  L.push(`Mode: ${rep.dryRun ? "Check only (no approvals)" : "Run"} · Status: ${statusEn}`);
  if (rep.dryRun) L.push(`Matched (would be approved): ${rep.cocok.length}`);
  else {
    L.push(`Approved: ${rep.disetujui.length}`);
    rep.disetujui.forEach((i, n) => L.push(`  ${n + 1}. ${itemLine(i, true)}`));
  }
  L.push(`Skipped: ${rep.dilewati.length}`);
  rep.dilewati.forEach((i, n) => L.push(`  ${n + 1}. ${itemLine(i, true)} — ${ALASAN[i.alasan] ? ALASAN[i.alasan][1] : i.alasan}`));
  if (rep.sudah.length) L.push(`Already approved earlier: ${rep.sudah.length}`);
  if (rep.perluCek.length) L.push(`⚠ Ticked in the dashboard but not approved in Smartlink: ${rep.perluCek.length}`);
  L.push(`Remaining "Awaiting confirmation" in Smartlink: ${rep.sisaMenungguSmartlink == null ? "unknown" : rep.sisaMenungguSmartlink}`);
  if (!dash.error) L.push(`Remaining "—" rows in the dashboard: ${dash.belumAkhir}`);
  if (rep.ringkasanEn) L.push(`Summary: ${rep.ringkasanEn}`);
  return L.join("\n");
}

async function buildReport(run) {
  let dashboard;
  try {
    const rows = await dashboardRows();
    const belum = rows.filter((r) => !r.verifikasi);
    dashboard = {
      belumAwal: run.dashAwal ? run.dashAwal.belum : null,
      belumAkhir: belum.length,
      terverifikasi: rows.filter((r) => r.verifikasi === "SUDAH VERIFIKASI OWNER").length,
      sisa: belum.filter((r) => !isSetoranOwner(r)).map(briefRow),
      setoranOwner: belum.filter(isSetoranOwner).map(briefRow),
    };
  } catch (e) {
    dashboard = { error: e.message };
  }
  const pick = (h) => run.items.filter((i) => i.hasil === h);
  const rep = {
    phase: run.phase,
    dryRun: run.dryRun,
    waktu: cfg.formatBusinessDateTime(new Date()) + " " + cfg.tzLabel(),
    error: run.error,
    disetujui: pick("DISETUJUI"),
    cocok: pick("COCOK_CEK_SAJA"),
    sudah: pick("SUDAH_DISETUJUI"),
    dilewati: pick("DILEWATI").map((i) => ({ ...i, alasanLabel: ALASAN[i.alasan] ? ALASAN[i.alasan][0] : i.alasan })),
    perluCek: pendingInRun(run),
    sisaMenungguSmartlink: run.final ? run.final.sisa : null,
    ringkasanId: run.final ? run.final.ringkasanId : "",
    ringkasanEn: run.final ? run.final.ringkasanEn : "",
    dashboard,
    biayaAi: { usd: Math.round(run.costUsd * 1000) / 1000, langkah: run.usage.calls, sesi: run.episodes },
  };
  rep.teks = buildText(rep);
  return rep;
}

// ---------------- Proses utama ----------------

async function runAgent(run) {
  try {
    log(run, "Membaca Monitoring Biaya…");
    const rows = await dashboardRows();
    run.dashAwal = { belum: rows.filter((r) => !r.verifikasi).length, total: rows.length };
    log(run, `Monitoring Biaya: ${run.dashAwal.belum} baris belum diverifikasi.`, "detail");

    log(run, `Membuka Smartlink di browser ${run.showBrowser ? "yang terlihat" : "tersembunyi"}…`);
    browser.clearLastShot();
    await browser.open({ headless: !run.showBrowser });
    if (run.cancel) throw cancelError();
    await browser.gotoSmartlink();
    run.phase = "running";
    log(run, "Smartlink terbuka. Claude mulai bekerja…");
    await agentLoop(run);
    run.finalizing = true;
    run.phase = run.needLogin ? "need_login" : "done";
  } catch (e) {
    run.finalizing = true;
    if (e.code === "CANCELLED" || run.cancel) {
      run.phase = "cancelled";
      log(run, "■ Proses dihentikan.", "warn");
    } else {
      run.phase = "error";
      run.error = e.message || String(e);
      run.errorCode = e.code || null;
      log(run, "✘ " + run.error, "err");
    }
  } finally {
    run.finishedAt = new Date().toISOString();
    await browser.close().catch(() => {});
    try {
      run.report = await buildReport(run);
    } catch (e) {
      run.report = null;
      log(run, "Gagal menyusun laporan: " + e.message, "err");
    }
    if (run.phase === "done") {
      const c = counts(run);
      log(run, run.dryRun
        ? `✔ Selesai (cek saja): ${c.cocok} cocok, ${c.dilewati} dilewati.`
        : `✔ Selesai: ${c.disetujui} disetujui, ${c.dilewati} dilewati.`, "ok");
    } else if (run.phase === "need_login") {
      log(run, "Login Smartlink diperlukan — klik “Login Smartlink”, masuk, lalu jalankan lagi.", "warn");
    }
    try {
      saveHistory(publicRun(run));
    } catch {
      /* riwayat opsional */
    }
    run.finalizing = false;
  }
}

function start({ dryRun = false, showBrowser = false } = {}) {
  if (RUN && isActive(RUN)) {
    const e = new Error("Konfirmasi biaya sedang berjalan. Tunggu sampai selesai atau hentikan dulu.");
    e.code = "BUSY";
    throw e;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY belum diisi di .env — fitur ini memakai Claude.");
  }
  const run = {
    id: Date.now().toString(36),
    dryRun: !!dryRun,
    showBrowser: !!showBrowser,
    phase: "starting",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    step: "Menyiapkan…",
    log: [],
    items: [],
    matches: [],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0 },
    episodes: 0,
    costUsd: 0,
    report: null,
    error: null,
    errorCode: null,
    needLogin: null,
    final: null,
    dashAwal: null,
    cancel: false,
    abort: null,
  };
  RUN = run;
  log(run, run.dryRun ? "▶ Mulai CEK SAJA (tanpa menyetujui)." : "▶ Mulai konfirmasi biaya Smartlink.");
  runAgent(run).catch(() => {});
  return publicRun(run);
}

function stop() {
  if (!RUN || !isActive(RUN)) return { ok: true, running: false };
  RUN.cancel = true;
  log(RUN, "Menghentikan…", "warn");
  if (RUN.abort) RUN.abort.abort();
  return { ok: true, running: true };
}

function status() {
  const history = loadHistory();
  const active = !!(RUN && isActive(RUN));
  const shot = browser.lastShot();
  return {
    active,
    run: RUN ? publicRun(RUN) : history[0] || null,
    history: history.map((h) => ({
      id: h.id, mode: h.mode, phase: h.phase, startedAt: h.startedAt, finishedAt: h.finishedAt,
      counts: h.counts, costUsd: h.costUsd, error: h.error,
    })),
    login: { open: !active && browser.isOpen() && browser.isHeadless() === false },
    akun: akun.info(),
    screenAt: shot ? shot.at : null,
    apiKey: !!process.env.ANTHROPIC_API_KEY,
  };
}

function historyRun(id) {
  return loadHistory().find((h) => h.id === id) || null;
}

async function openLogin() {
  if (RUN && isActive(RUN)) throw new Error("Tunggu proses konfirmasi selesai sebelum membuka jendela login.");
  if (browser.isOpen() && browser.isHeadless() !== false) await browser.close();
  await browser.open({ headless: false });
  await browser.gotoSmartlink();
  return { ok: true };
}

async function closeLogin() {
  if (RUN && isActive(RUN)) throw new Error("Proses konfirmasi sedang memakai browser.");
  await browser.close();
  return { ok: true };
}

module.exports = {
  start,
  stop,
  status,
  historyRun,
  openLogin,
  closeLogin,
  screen: () => browser.lastShot(),
  // untuk uji
  _internals: { matchDashboard, cocokkan, catat, executeTools, buildReport, buildText, kickoffText, customTools, loadPending },
};
