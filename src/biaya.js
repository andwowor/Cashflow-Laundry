"use strict";

const path = require("path");
const cfg = require("./config");
const { readRange, batchWrite, resolveCashflowSpreadsheetId } = require("./sheets");
const { extractBiaya } = require("./claude");

const SHEET = "INPUT PENGGUNAAN BIAYA";
const LEARNING_FILE = path.join(cfg.DATA_DIR, "learning.json");

// Daftar dropdown statis sesuai validasi data pada sheet.
const SUMBER_DANA = [
  "KAS TUNAI MAUMBI", "KAS TUNAI PERKAMIL", "BCA", "BRI", "BNI", "MANDIRI",
  "BCA MEGA", "BRI MEGA", "MANDIRI MEGA", "KAS SEWA GEDUNG",
  "KAS BIAYA DITAHAN TUNAI", "KAS BIAYA DITAHAN BANK",
];
const OUTLETS = ["MAUMBI", "PERKAMIL"];
const STATUS = ["BELUM INPUT", "SUDAH INPUT"];

// Rekomendasi outlet otomatis berdasarkan keterangan (kunci = keterangan huruf
// kecil). Tambah baris baru di sini untuk aturan rekomendasi berikutnya.
const OUTLET_RECOMMENDATIONS = {
  "setoran owner": "MAUMBI",
  "biaya admin": "MAUMBI",
};
function recommendOutlet(keterangan) {
  return OUTLET_RECOMMENDATIONS[String(keterangan || "").trim().toLowerCase()] || "";
}

// Pembelian token listrik PLN: IDPEL langganan menentukan keterangan + outlet.
const IDPEL_MAP = {
  "311900080398": { keterangan: "Setoran Owner", outlet: "MAUMBI" },
  "311200039441": { keterangan: "Token Listrik", outlet: "MAUMBI" },
  "311010618527": { keterangan: "Token Listrik", outlet: "PERKAMIL" },
};

// Transfer ke rekening milik nama-nama ini dianggap "Setoran Owner".
const OWNER_RECIPIENTS = ["betrix mega yohana tombeg"];
function normalizeName(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
}
function isOwnerRecipient(penerima) {
  const n = normalizeName(penerima);
  return n.length > 0 && OWNER_RECIPIENTS.some((name) => n === name || n.includes(name));
}

/** Daftar keterangan (dropdown kolom B) + pemetaan ke subjek biaya (kolom A). */
async function getOptions() {
  const cashflow = await resolveCashflowSpreadsheetId();
  const rows = await readRange(cashflow.id, `'DAFTAR BIAYA'!A2:B500`);
  const daftar = rows
    .filter((r) => r[0])
    .map((r) => ({ keterangan: String(r[0]).trim(), subjek: r[1] ? String(r[1]).trim() : "" }));
  return {
    daftarBiaya: daftar,
    sumberDana: SUMBER_DANA,
    outlets: OUTLETS,
    status: STATUS,
    outletRecommendations: OUTLET_RECOMMENDATIONS,
    cashflow: { id: cashflow.id, source: cashflow.source },
  };
}

/** Riwayat pengisian terakhir dari sheet (untuk few-shot pembelajaran AI). */
async function getHistory(limit = 60) {
  const cashflow = await resolveCashflowSpreadsheetId();
  const rows = await readRange(cashflow.id, `'${SHEET}'!A2:H997`);
  const filled = rows.filter((r) => r[1]); // kolom B (KETERANGAN) terisi
  return filled.slice(-limit).map((r) => ({
    subjek: r[0] || "",
    keterangan: r[1] || "",
    nominal: r[2] || "",
    tanggal: r[3] || "",
    outlet: r[4] || "",
    status: r[5] || "",
    sumberDana: r[6] || "",
    kode: r[7] || "",
  }));
}

function readLearning() {
  return cfg.readJsonFile(LEARNING_FILE, { entries: [] });
}

/** Simpan pasangan (usulan AI vs hasil final user) agar AI makin akurat. */
function recordLearning(aiSuggestions, finalRows) {
  const store = readLearning();
  store.entries.push({
    timestamp: new Date().toISOString(),
    ai: aiSuggestions || null,
    final: finalRows,
  });
  if (store.entries.length > 200) store.entries = store.entries.slice(-200);
  cfg.writeJsonFile(LEARNING_FILE, store);
}

function learningText(maxItems = 25) {
  const { entries } = readLearning();
  const lines = [];
  for (const e of entries.slice(-maxItems)) {
    for (const row of e.final || []) {
      lines.push(
        `- ${row.keterangan} | Rp${row.nominal} | ${row.outlet || "?"} | ${row.sumberDana || "?"}` +
          (row.catatanBukti ? ` | bukti: ${row.catatanBukti}` : "")
      );
    }
  }
  return lines.slice(-40).join("\n");
}

/** Jalankan fn untuk tiap item dengan batas konkurensi. */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Petakan satu entry hasil AI ke baris pratinjau (termasuk aturan bisnis). */
function mapEntry(e, keteranganList, subjekMap, todayIso, sumber, fileIndex) {
  let keterangan = keteranganList.includes(e.keterangan) ? e.keterangan : "";
  // Aturan rekomendasi outlet (mis. "Setoran Owner"/"Biaya Admin" -> MAUMBI). Boleh diubah user.
  let outlet = recommendOutlet(keterangan);

  // Aturan token listrik: IDPEL langganan menentukan keterangan + outlet.
  let idpelNote = "";
  const idpel = String(e.idpel || "").replace(/\D/g, "");
  if (idpel) {
    const rule = IDPEL_MAP[idpel];
    if (rule) {
      if (keteranganList.includes(rule.keterangan)) keterangan = rule.keterangan;
      outlet = rule.outlet || recommendOutlet(keterangan);
      idpelNote = `IDPEL ${idpel} → ${rule.keterangan} / ${rule.outlet}. `;
    } else {
      idpelNote = `IDPEL ${idpel} (tak dikenal — pilih manual). `;
    }
  }

  // Aturan penerima: transfer ke rekening owner -> Setoran Owner (outlet via rekomendasi).
  let penerimaNote = "";
  if (isOwnerRecipient(e.penerima)) {
    if (keteranganList.includes("Setoran Owner")) keterangan = "Setoran Owner";
    outlet = recommendOutlet(keterangan) || outlet;
    penerimaNote = `Penerima ${String(e.penerima).trim()} → Setoran Owner. `;
  }

  return {
    keterangan,
    keteranganMentah: e.keterangan,
    subjek: subjekMap.get(keterangan) || "",
    nominal: e.nominal,
    tanggal: e.tanggal || todayIso,
    outlet,
    status: "BELUM INPUT", // selalu BELUM INPUT
    sumberDana: e.sumber_dana && SUMBER_DANA.includes(e.sumber_dana) ? e.sumber_dana : "",
    catatan: penerimaNote + idpelNote + (e.catatan || ""),
    keyakinan: e.keyakinan,
    idpel: idpel || null,
    sumber, // nama file asal (untuk verifikasi saat pengisian masal)
    fileIndex, // indeks file di urutan upload (untuk pratinjau "lihat bukti")
  };
}

/**
 * Aturan per-bukti: bila sebuah file adalah "Setoran Owner" dan di dalamnya ada
 * "Biaya Admin", biaya admin TIDAK dipisah — nominalnya digabung ke Setoran Owner
 * (satu baris). Hanya berlaku saat kedua jenis ada dalam file yang sama.
 */
function combineAdminIntoSetoran(rows) {
  const isSetoran = (r) => /^setoran owner$/i.test((r.keterangan || "").trim());
  const isAdmin = (r) => /^biaya admin$/i.test((r.keterangan || "").trim());
  const setoran = rows.filter(isSetoran);
  const admins = rows.filter(isAdmin);
  if (!setoran.length || !admins.length) return rows; // tidak ada yang digabung

  const adminTotal = admins.reduce((s, r) => s + (Number(r.nominal) || 0), 0);
  const target = setoran[0];
  target.nominal = (Number(target.nominal) || 0) + adminTotal;
  target.catatan = `Termasuk biaya admin Rp${adminTotal.toLocaleString("id-ID")} (digabung). ` + (target.catatan || "");
  return rows.filter((r) => !isAdmin(r));
}

/**
 * Analisis screenshot/bukti biaya dengan Claude. Mendukung banyak file sekaligus
 * (pengisian masal): tiap file diproses terpisah secara paralel (dibatasi),
 * lalu seluruh entry digabung untuk satu kali pratinjau & submit.
 */
async function analyze(files) {
  const [options, history] = await Promise.all([getOptions(), getHistory(60)]);
  const { year, month, day } = cfg.nowInBusinessTz();
  const todayIso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const historyText = history
    .map((h) => `- ${h.keterangan} → Rp${h.nominal} → ${h.outlet} → ${h.sumberDana}`)
    .join("\n");
  const learn = learningText();
  const keteranganList = options.daftarBiaya.map((d) => d.keterangan);
  const subjekMap = new Map(options.daftarBiaya.map((d) => [d.keterangan, d.subjek]));

  const perFile = await mapLimit(files, 4, async (f, idx) => {
    const images = [{ base64: f.buffer.toString("base64"), mediaType: f.mimetype }];
    const entries = await extractBiaya({
      images,
      keteranganList,
      sumberDanaList: SUMBER_DANA,
      historyText,
      learningText: learn,
      todayIso,
    });
    const rows = entries.map((e) => mapEntry(e, keteranganList, subjekMap, todayIso, f.originalname, idx));
    return combineAdminIntoSetoran(rows); // gabung biaya admin ke setoran owner (per bukti)
  });

  return perFile.flat();
}

function isoToSheetDate(iso) {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return cfg.todaySheetDate();
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/**
 * Tulis baris final ke sheet INPUT PENGGUNAAN BIAYA.
 * Hanya kolom B..G yang diisi; kolom A (SUBJEK BIAYA, formula VLOOKUP) dan
 * kolom H (KODE TRANSAKSI) bersifat otomatis/tampilan saja.
 */
async function submit(rows, aiSuggestions) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("Tidak ada baris untuk disimpan.");
  for (const r of rows) {
    if (!r.keterangan) throw new Error("Setiap baris harus punya KETERANGAN dari dropdown.");
    if (!r.outlet || !OUTLETS.includes(r.outlet)) throw new Error("Pilih OUTLET (MAUMBI/PERKAMIL) untuk setiap baris.");
    if (!Number.isFinite(Number(r.nominal)) || Number(r.nominal) <= 0) throw new Error("NOMINAL tidak valid.");
    if (r.sumberDana && !SUMBER_DANA.includes(r.sumberDana)) throw new Error(`SUMBER DANA tidak dikenal: ${r.sumberDana}`);
  }

  const cashflow = await resolveCashflowSpreadsheetId();
  // Lokasi penulisan: selalu baris kosong tepat di bawah baris TERBAWAH yang
  // sudah terisi. Pengecekan ini SELALU dibaca ulang (live) di sini, tepat
  // sebelum menulis — jadi bila ada pengisian manual langsung di spreadsheet,
  // baris-baris itu ikut terhitung dan data baru tetap menempel di bawahnya.
  // Patokan = kolom B (KETERANGAN), bukan kolom A — karena kolom A (SUBJEK
  // BIAYA) berisi formula VLOOKUP di baris kosong sekalipun. Celah kosong di
  // tengah diabaikan. Rentang terbuka "B2:B" agar tak terbatas berapa jauh pun
  // pengisian manual ke bawah.
  const colB = await readRange(cashflow.id, `'${SHEET}'!B2:B`);
  let appendRow = 2; // default: baris data pertama bila sheet masih kosong
  for (let i = 0; i < colB.length; i++) {
    if (colB[i] && colB[i][0]) appendRow = i + 3; // (baris terisi i+2) + 1
  }

  const values = rows.map((r) => [
    r.keterangan,
    Number(r.nominal),
    isoToSheetDate(r.tanggal),
    r.outlet,
    r.status || "BELUM INPUT",
    r.sumberDana || "",
  ]);
  const endRow = appendRow + rows.length - 1;
  await batchWrite(cashflow.id, [{ range: `'${SHEET}'!B${appendRow}:G${endRow}`, values }]);

  recordLearning(aiSuggestions, rows);

  return {
    ok: true,
    sheet: SHEET,
    barisAwal: appendRow,
    barisAkhir: endRow,
    jumlah: rows.length,
  };
}

module.exports = { getOptions, getHistory, analyze, submit, SUMBER_DANA, OUTLETS, STATUS };
