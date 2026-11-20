"use strict";

// Menu Proyeksi Biaya › "Isi dari berkas proyeksi": baca workbook proyeksi laba rugi
// (mis. Proyeksi_LabaRugi_CoCleanLaundry_…xlsx), ambil nominal per komponen biaya pada
// bulan berjalan dari sheet "5. Proyeksi MAUMBI" & "6. Proyeksi PERKAMIL", lalu isikan ke
// kolom bulan berjalan sheet PROYEKSI BIAYA — KECUALI sel yang otomatis (formula).
//
// Susunan berkas (v3, Nov 2026): tiap sheet outlet berisi blok "SKENARIO PESIMIS",
// "SKENARIO REALISTIS" (realisasi Nov-25…Okt-26 lalu PROYEKSI Nov 26…Des 27) dan
// "SKENARIO OPTIMIS"; baris judul "Komponen | Nov 26 | Des 26 | …"; baris komponen
// "  Gaji Karyawan" dst. (25 pos, namanya sama dengan SUBJEK di PROYEKSI BIAYA).
//
// PENTING: sel di berkas itu berupa FORMULA TANPA NILAI TERSIMPAN (dibuat oleh skrip),
// jadi seluruh workbook dihitung ulang dengan HyperFormula. Hasilnya diuji sama dengan
// LibreOffice untuk semua sel sheet 5 & 6. Sel yang tidak bisa dihitung (#NAME? dll.)
// tidak pernah ditulis — ditampilkan sebagai galat di pratinjau.
//
// Bulan yang diambil = bulan spreadsheet CASHFLOW yang sedang aktif (judulnya), jadi
// saat spreadsheet berganti ke DESEMBER 2026 otomatis memakai kolom "Des 26".

const crypto = require("crypto");
const path = require("path");
const XLSX = require("xlsx");
const cfg = require("./config");
const { batchWrite, resolveCashflowSpreadsheetId } = require("./sheets");
const proyeksi = require("./proyeksi");

const BULAN = {
  JAN: 1, JANUARI: 1, JANUARY: 1,
  FEB: 2, PEB: 2, FEBRUARI: 2, FEBRUARY: 2,
  MAR: 3, MARET: 3, MARCH: 3,
  APR: 4, APRIL: 4,
  MEI: 5, MAY: 5,
  JUN: 6, JUNI: 6, JUNE: 6,
  JUL: 7, JULI: 7, JULY: 7,
  AGU: 8, AGS: 8, AGT: 8, AGUSTUS: 8, AUG: 8, AUGUST: 8,
  SEP: 9, SEPT: 9, SEPTEMBER: 9,
  OKT: 10, OKTOBER: 10, OCT: 10, OCTOBER: 10,
  NOV: 11, NOP: 11, NOVEMBER: 11,
  DES: 12, DESEMBER: 12, DEC: 12, DECEMBER: 12,
};
const NAMA_SINGKAT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Ags", "Sep", "Okt", "Nov", "Des"];
const TTL_MS = 30 * 60 * 1000;
const cache = new Map();
// Catatan undo: angka lama tiap sel sebelum ditimpa isi dari berkas. Disimpan per ID
// spreadsheet (CASHFLOW berganti tiap bulan) dan dicocokkan ulang lewat outlet + SUBJEK,
// bukan hanya nomor baris. Bertahan walau aplikasi dijalankan ulang.
const UNDO_FILE = path.join(cfg.DATA_DIR, "proyeksi_undo.json");
const UNDO_MAX = 20;

function httpError(status, message) {
  return proyeksi.httpError(status, message);
}

/** "Komponen biaya" → kunci pembanding (huruf kecil, tanpa spasi/tanda baca). */
function kunci(label) {
  return String(label == null ? "" : label).toLowerCase().replace(/&/g, " dan ").replace(/[^a-z0-9]+/g, "");
}

/** Judul kolom bulan → { m, y }. Terima "Nov 26", "Nov-25", "November 2026", "Des'27", atau tanggal Excel. */
function parseBulan(v) {
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = XLSX.SSF.parse_date_code(v);
    return d ? { m: d.m, y: d.y } : null;
  }
  const s = String(v == null ? "" : v).trim();
  const m = s.match(/^([A-Za-z]+)\.?[\s\-'’\/]*(\d{2}|\d{4})$/);
  if (!m) return null;
  const bln = BULAN[m[1].toUpperCase()];
  if (!bln) return null;
  const y = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  return { m: bln, y };
}

/**
 * Formula xlsx → formula HyperFormula. Hanya bagian di luar teks "…" dan nama sheet '…'
 * yang diubah: hapus awalan _xlfn./_xludf. dan ubah literal TRUE/FALSE menjadi TRUE()/FALSE().
 */
function ubahFormula(f) {
  let out = "";
  let i = 0;
  const luar = (t) =>
    t.replace(/_xl(?:fn|udf|ws)\./gi, "").replace(/(^|[^A-Za-z0-9_.!$])(TRUE|FALSE)(?![A-Za-z0-9_.(!])/gi, "$1$2()");
  while (i < f.length) {
    const ch = f[i];
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < f.length) {
        if (f[j] === ch) {
          if (f[j + 1] === ch) { j += 2; continue; }
          break;
        }
        j++;
      }
      out += f.slice(i, j + 1);
      i = j + 1;
    } else {
      let j = i;
      while (j < f.length && f[j] !== '"' && f[j] !== "'") j++;
      out += luar(f.slice(i, j));
      i = j;
    }
  }
  return "=" + out;
}

/** Baca workbook & hitung ulang seluruh formula. Kembalikan { wb, hf }. */
function hitungWorkbook(buffer) {
  let wb;
  try {
    wb = XLSX.read(buffer, { type: "buffer", cellFormula: true, sheetStubs: true, cellDates: false });
  } catch (e) {
    throw httpError(400, "Berkas tidak bisa dibaca. Pastikan berkasnya Excel .xlsx yang valid.");
  }
  if (!wb.SheetNames || !wb.SheetNames.length) throw httpError(400, "Berkas tidak berisi sheet.");
  let HyperFormula;
  try {
    ({ HyperFormula } = require("hyperformula"));
  } catch (e) {
    throw httpError(500, "Paket penghitung formula (hyperformula) belum terpasang. Jalankan pembaruan aplikasi di tab Pengaturan.");
  }
  const sheets = {};
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const arr = [];
    if (ws && ws["!ref"]) {
      const rg = XLSX.utils.decode_range(ws["!ref"]);
      for (let r = 0; r <= rg.e.r; r++) {
        const row = [];
        for (let c = 0; c <= rg.e.c; c++) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })];
          let v = null;
          if (cell) {
            if (cell.f) v = ubahFormula(cell.f);
            else if (cell.t === "s" || cell.t === "str") v = "'" + cell.v; // tetap teks (jangan diparse jadi angka/tanggal)
            else if (cell.t === "n" || cell.t === "b") v = cell.v;
            else if (cell.t === "e") v = cell.w || "#N/A";
            else if (cell.t === "d") v = cell.v instanceof Date ? cell.v.toISOString().slice(0, 10) : cell.v;
          }
          row.push(v);
        }
        arr.push(row);
      }
    }
    sheets[name] = arr.length ? arr : [[]];
  }
  let hf;
  try {
    hf = HyperFormula.buildFromSheets(sheets, { licenseKey: "gpl-v3", useArrayArithmetic: true });
  } catch (e) {
    throw httpError(400, "Formula di berkas tidak bisa dihitung: " + (e.message || e));
  }
  return { wb, hf };
}

function teks(v) {
  if (v == null) return "";
  if (typeof v === "object") return "";
  return String(v).trim();
}

/**
 * Ambil nominal tiap komponen pada bulan (m, y) dari sheet outlet, untuk SEMUA skenario.
 * Hasil: { sheet, skenario: { NAMA: { kolom, judul, baris: [{ label, kunci, nilai?, galat?, kosong? }] } }, catatan }
 */
function ekstrakOutlet(hf, sheetName, m, y) {
  const sid = hf.getSheetId(sheetName);
  const dim = hf.getSheetDimensions(sid);
  const val = (r, c) => hf.getCellValue({ sheet: sid, row: r, col: c });

  // Blok skenario = baris berawalan "SKENARIO …" di kolom A.
  const blok = [];
  for (let r = 0; r < dim.height; r++) {
    const t = teks(val(r, 0));
    const mm = t.match(/^SKENARIO\s+(.+)$/i);
    if (mm) blok.push({ nama: mm[1].trim().toUpperCase(), mulai: r });
  }
  if (!blok.length) blok.push({ nama: "UTAMA", mulai: 0 });
  blok.forEach((b, i) => (b.akhir = i + 1 < blok.length ? blok[i + 1].mulai - 1 : dim.height - 1));

  const hasil = { sheet: sheetName, skenario: {}, catatan: [] };
  for (const b of blok) {
    // Baris judul: kolom A "Komponen", atau baris pertama yang punya ≥3 judul bulan.
    let hdr = -1;
    for (let r = b.mulai; r <= b.akhir && hdr < 0; r++) {
      if (/^komponen/i.test(teks(val(r, 0)))) hdr = r;
    }
    if (hdr < 0) {
      for (let r = b.mulai; r <= b.akhir && hdr < 0; r++) {
        let n = 0;
        for (let c = 1; c < dim.width; c++) if (parseBulan(val(r, c))) n++;
        if (n >= 3) hdr = r;
      }
    }
    if (hdr < 0) { hasil.catatan.push(`Blok ${b.nama}: baris judul bulan tidak ditemukan.`); continue; }

    const cocok = [];
    for (let c = 1; c < dim.width; c++) {
      const pb = parseBulan(val(hdr, c));
      if (pb && pb.m === m && pb.y === y) cocok.push(c);
    }
    let kol = cocok[0];
    if (cocok.length > 1) {
      // Ada di realisasi & proyeksi? Pilih yang berada di bawah judul kelompok "PROYEKSI".
      const kelompok = (c) => {
        for (let j = c; j >= 1; j--) {
          const t = teks(val(hdr - 1, j));
          if (t) return t;
        }
        return "";
      };
      const pro = cocok.filter((c) => /^PROYEKSI/i.test(kelompok(c)));
      kol = pro.length === 1 ? pro[0] : undefined;
      if (kol === undefined) { hasil.catatan.push(`Blok ${b.nama}: kolom ${NAMA_SINGKAT[m - 1]} ${y} ada lebih dari satu.`); continue; }
    }
    if (kol === undefined) continue; // bulan ini tidak ada di blok tersebut

    const baris = [];
    for (let r = hdr + 1; r <= b.akhir; r++) {
      const label = teks(val(r, 0));
      if (!label) continue;
      const v = val(r, kol);
      const item = { label, kunci: kunci(label), baris: r + 1 };
      if (typeof v === "number") item.nilai = v;
      else if (v && typeof v === "object") item.galat = v.value || "#ERROR!";
      else if (v === null || v === "") item.kosong = true;
      else continue; // teks / judul kelompok
      baris.push(item);
    }
    hasil.skenario[b.nama] = { kolom: XLSX.utils.encode_col(kol), judul: teks(val(hdr, kol)), barisJudul: hdr + 1, baris };
  }
  return hasil;
}

function bulanSheet(data) {
  const mNama = data.monthName;
  const m = cfg.MONTH_NAMES_ID.indexOf(mNama) + 1;
  const ym = String(data.spreadsheet.title || "").match(/\b(20\d{2})\b/);
  const y = ym ? Number(ym[1]) : Number(cfg.currentMonthKey().split(" ")[1]);
  return { m, y, nama: mNama, label: `${mNama} ${y}`, singkat: `${NAMA_SINGKAT[m - 1]} ${String(y).slice(2)}` };
}

function bersihkanCache() {
  const now = Date.now();
  for (const [k, v] of cache) if (now - v.dibuat > TTL_MS) cache.delete(k);
  while (cache.size > 5) cache.delete(cache.keys().next().value);
}

/** Susun pratinjau: apa yang akan ditulis ke tiap sel kolom bulan berjalan. */
function susunPratinjau(entry, skenario, data) {
  const outlets = [];
  const items = [];
  const hr = data.headerRow; // 1-based
  for (const ec of data.editCols) {
    const sumber = entry.outlets[ec.group];
    const sk = sumber && sumber.skenario[skenario];
    const o = {
      outlet: ec.group,
      kolomSheet: ec.letter,
      sheetBerkas: sumber ? sumber.sheet : null,
      kolomBerkas: sk ? sk.kolom : null,
      judulBerkas: sk ? sk.judul : null,
      catatan: sumber ? sumber.catatan.slice() : [],
      ekstra: [],
    };
    if (!sumber) o.catatan.push(`Sheet proyeksi ${ec.group} tidak ditemukan di berkas.`);
    else if (!sk) o.catatan.push(`Kolom ${entry.bulan.singkat} pada skenario ${skenario} tidak ditemukan di sheet "${sumber.sheet}".`);
    outlets.push(o);
    const peta = new Map();
    if (sk) sk.baris.forEach((b) => { if (!peta.has(b.kunci)) peta.set(b.kunci, b); });
    const dipakai = new Set();
    for (let r = hr; r < data.rows.length; r++) {
      const label = String(data.rows[r][0].v || "").trim();
      if (!label || /^TOTAL\b/i.test(label)) continue;
      const cell = data.rows[r][ec.col];
      const f = peta.get(kunci(label));
      if (f) dipakai.add(f.kunci);
      const it = {
        outlet: ec.group,
        row: r + 1,
        col: ec.col + 1,
        a1: `${ec.letter}${r + 1}`,
        label,
        lamaTeks: cell.v || "",
        lama: typeof cell.n === "number" ? cell.n : null,
      };
      if (f && typeof f.nilai === "number") it.berkas = f.nilai;
      if (cell.k === "f" || cell.k === "a") it.status = "formula";
      else if (!sk) it.status = "tidak-ada";
      else if (!f) it.status = "tidak-ada";
      else if (f.galat) { it.status = "galat"; it.galat = f.galat; }
      else if (f.kosong) it.status = "kosong";
      else if (!cell.e) it.status = "tidak-bisa";
      else {
        it.baru = Math.round(f.nilai);
        it.status = it.lama != null && Math.abs(it.lama - it.baru) < 1e-9 ? "sama" : "tulis";
      }
      items.push(it);
    }
    if (sk) {
      // Komponen berkas yang tak ada padanannya di sheet (abaikan total/laba/setoran/rasio).
      o.ekstra = sk.baris
        .filter((b) => typeof b.nilai === "number" && !dipakai.has(b.kunci))
        .filter((b) => !/^(total|laba|setoran|cost ratio|pendapatan|[+\-−]\s)/i.test(b.label))
        .map((b) => b.label);
    }
  }
  const hitung = (s) => items.filter((x) => x.status === s).length;
  return {
    id: entry.id,
    berkas: entry.nama,
    bulan: entry.bulan,
    skenario,
    skenarioList: entry.skenarioList,
    spreadsheet: data.spreadsheet.title,
    token: data.spreadsheet.id,
    outlets,
    items,
    ringkas: { tulis: hitung("tulis"), sama: hitung("sama"), formula: hitung("formula"), lain: items.length - hitung("tulis") - hitung("sama") - hitung("formula") },
  };
}

/** Unggah berkas → hitung → simpan sementara → pratinjau skenario (default REALISTIS). */
async function unggah(buffer, namaBerkas, skenario) {
  if (!buffer || !buffer.length) throw httpError(400, "Pilih berkas .xlsx dahulu.");
  const data = await proyeksi.load();
  if (!data.editCols.length) throw httpError(400, `Kolom ${data.monthName} tidak ditemukan di sheet PROYEKSI BIAYA.`);
  const bulan = bulanSheet(data);
  const { wb, hf } = hitungWorkbook(buffer);
  const outlets = {};
  const skenarioList = [];
  try {
    for (const ec of data.editCols) {
      if (outlets[ec.group]) continue;
      const re = new RegExp(`proyeksi\\s*${ec.group.replace(/[^A-Za-z0-9 ]/g, "")}\\b`, "i");
      const nama = wb.SheetNames.find((n) => re.test(n));
      if (!nama) continue;
      outlets[ec.group] = ekstrakOutlet(hf, nama, bulan.m, bulan.y);
      Object.keys(outlets[ec.group].skenario).forEach((s) => { if (!skenarioList.includes(s)) skenarioList.push(s); });
    }
  } finally {
    hf.destroy();
  }
  if (!Object.keys(outlets).length) {
    throw httpError(
      400,
      `Sheet proyeksi per outlet (mis. "5. Proyeksi MAUMBI" dan "6. Proyeksi PERKAMIL") tidak ditemukan di berkas. Sheet yang ada: ${wb.SheetNames.join(", ")}.`
    );
  }
  if (!skenarioList.length) {
    throw httpError(400, `Kolom bulan ${bulan.singkat} (${bulan.label}) tidak ditemukan di sheet proyeksi berkas ini. Pastikan berkasnya mencakup bulan berjalan.`);
  }
  bersihkanCache();
  const entry = {
    id: crypto.randomBytes(9).toString("hex"),
    dibuat: Date.now(),
    nama: String(namaBerkas || "berkas.xlsx"),
    spreadsheetId: data.spreadsheet.id,
    bulan,
    outlets,
    skenarioList,
  };
  cache.set(entry.id, entry);
  const pilih = pilihSkenario(entry, skenario);
  return { ok: true, ...susunPratinjau(entry, pilih, data) };
}

function pilihSkenario(entry, skenario) {
  const s = String(skenario || "").trim().toUpperCase();
  if (s && entry.skenarioList.includes(s)) return s;
  return entry.skenarioList.includes("REALISTIS") ? "REALISTIS" : entry.skenarioList[0];
}

function ambilEntry(id) {
  bersihkanCache();
  const entry = cache.get(String(id || ""));
  if (!entry) throw httpError(410, "Pratinjau sudah kedaluwarsa. Unggah ulang berkasnya.");
  return entry;
}

async function pratinjau(id, skenario) {
  const entry = ambilEntry(id);
  const data = await proyeksi.load();
  return { ok: true, ...susunPratinjau(entry, pilihSkenario(entry, skenario), data) };
}

/**
 * Tulis semua sel berstatus "tulis". dilihat = [{ a1, lama }] dari pratinjau yang dilihat
 * pengguna: sel yang nilainya sudah berubah sejak itu (atau tak ada di daftar) dilewati.
 */
function terapkan(id, skenario, dilihat) {
  return proyeksi.exclusive(async () => {
    const entry = ambilEntry(id);
    const data = await proyeksi.load();
    if (data.spreadsheet.id !== entry.spreadsheetId) {
      throw httpError(409, "Spreadsheet CASHFLOW bulan ini sudah berganti sejak berkas diunggah. Unggah ulang berkasnya.");
    }
    const sk = pilihSkenario(entry, skenario);
    const p = susunPratinjau(entry, sk, data);
    const lihat = new Map((Array.isArray(dilihat) ? dilihat : []).map((x) => [String(x.a1), x.lama === undefined ? null : x.lama]));
    const tulis = [];
    const dilewati = [];
    for (const it of p.items) {
      if (it.status !== "tulis") continue;
      if (!lihat.has(it.a1)) { dilewati.push({ ...it, alasan: "belum ada di pratinjau" }); continue; }
      const lama = lihat.get(it.a1);
      const sama = (lama == null && it.lama == null) || (lama != null && it.lama != null && Math.abs(Number(lama) - it.lama) < 1e-9);
      if (!sama) { dilewati.push({ ...it, alasan: `nilai di spreadsheet sudah berubah menjadi ${it.lamaTeks || "(kosong)"}` }); continue; }
      tulis.push(it);
    }
    if (tulis.length) {
      await batchWrite(data.spreadsheet.id, tulis.map((it) => ({ range: `'${proyeksi.SHEET}'!${it.a1}`, values: [[it.baru]] })));
      catatUndo({
        id: crypto.randomBytes(9).toString("hex"),
        spreadsheetId: data.spreadsheet.id,
        spreadsheet: data.spreadsheet.title,
        bulan: entry.bulan.label,
        berkas: entry.nama,
        skenario: sk,
        waktu: cfg.formatBusinessDateTime(new Date()),
        dibuat: Date.now(),
        sel: tulis.map((it) => ({ outlet: it.outlet, label: it.label, a1: it.a1, lama: it.lama, lamaTeks: it.lamaTeks, baru: it.baru })),
      });
    }
    const fresh = tulis.length ? await proyeksi.load() : data;
    return {
      ok: true,
      skenario: sk,
      bulan: entry.bulan,
      ditulis: tulis.map((it) => ({ outlet: it.outlet, label: it.label, a1: it.a1, lama: it.lamaTeks, baru: it.baru })),
      dilewati: dilewati.map((it) => ({ outlet: it.outlet, label: it.label, a1: it.a1, alasan: it.alasan })),
      undo: ringkasUndo(undoTerakhir(data.spreadsheet.id)),
      data: fresh,
    };
  });
}

// ---------- Undo isi dari berkas ----------

function bacaUndo() {
  const d = cfg.readJsonFile(UNDO_FILE, null);
  return d && Array.isArray(d.list) ? d.list : [];
}

function simpanUndo(list) {
  cfg.writeJsonFile(UNDO_FILE, { list: list.slice(-UNDO_MAX) });
}

function catatUndo(snap) {
  const list = bacaUndo();
  list.push(snap);
  simpanUndo(list);
}

/** Isi dari berkas terakhir (belum dibatalkan) untuk spreadsheet ini — urutan tumpukan. */
function undoTerakhir(spreadsheetId) {
  const list = bacaUndo();
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].spreadsheetId === spreadsheetId && !list[i].dibatalkan) return list[i];
  }
  return null;
}

function ringkasUndo(u) {
  if (!u) return null;
  return { id: u.id, berkas: u.berkas, skenario: u.skenario, bulan: u.bulan, waktu: u.waktu, jumlah: u.sel.length };
}

/** Status tombol undo untuk spreadsheet CASHFLOW yang aktif. */
async function statusUndo() {
  const { id } = await resolveCashflowSpreadsheetId();
  return { ok: true, undo: ringkasUndo(undoTerakhir(id)) };
}

/**
 * Kembalikan angka lama dari satu kali "isi dari berkas". Hanya sel yang nilainya MASIH sama
 * dengan hasil upload yang dikembalikan — sel yang sudah diubah lagi sesudahnya dibiarkan.
 */
function batalkan(undoId) {
  return proyeksi.exclusive(async () => {
    const list = bacaUndo();
    const u = list.find((x) => x.id === String(undoId || ""));
    if (!u || u.dibatalkan) throw httpError(410, "Tidak ada isi dari berkas yang bisa dibatalkan (mungkin sudah dibatalkan).");
    const data = await proyeksi.load();
    if (data.spreadsheet.id !== u.spreadsheetId) {
      throw httpError(409, `Undo ini untuk spreadsheet ${u.spreadsheet}, sedangkan yang aktif sekarang ${data.spreadsheet.title}.`);
    }
    const akhir = undoTerakhir(u.spreadsheetId);
    if (!akhir || akhir.id !== u.id) throw httpError(409, "Batalkan dulu isi dari berkas yang lebih baru.");

    const tulis = [];
    const dilewati = [];
    const hr = data.headerRow;
    for (const s of u.sel) {
      const ec = data.editCols.find((e) => e.group === s.outlet);
      if (!ec) { dilewati.push({ ...s, alasan: "kolom outlet tidak ditemukan" }); continue; }
      // Baris dicari dari SUBJEK; nomor baris lama dipakai bila SUBJEK-nya masih sama.
      const rowLama = Number(String(s.a1).replace(/^[A-Z]+/, "")) - 1;
      const cocok = [];
      for (let r = hr; r < data.rows.length; r++) if (String(data.rows[r][0].v || "").trim() === s.label) cocok.push(r);
      const r = cocok.includes(rowLama) ? rowLama : cocok.length === 1 ? cocok[0] : -1;
      if (r < 0) { dilewati.push({ ...s, alasan: "baris SUBJEK tidak ditemukan" }); continue; }
      const cell = data.rows[r][ec.col];
      const a1 = `${ec.letter}${r + 1}`;
      if (cell.k || !cell.e) { dilewati.push({ ...s, a1, alasan: "sel sekarang otomatis (formula)" }); continue; }
      const now = typeof cell.n === "number" ? cell.n : null;
      if (now == null || Math.abs(now - s.baru) > 1e-9) {
        dilewati.push({ ...s, a1, alasan: `sudah diubah menjadi ${cell.v || "(kosong)"} setelah upload` });
        continue;
      }
      tulis.push({ ...s, a1 });
    }
    if (tulis.length) {
      await batchWrite(data.spreadsheet.id, tulis.map((s) => ({ range: `'${proyeksi.SHEET}'!${s.a1}`, values: [[s.lama == null ? "" : s.lama]] })));
    }
    const terbaru = bacaUndo();
    const t = terbaru.find((x) => x.id === u.id);
    if (t) { t.dibatalkan = true; t.dibatalkanPada = cfg.formatBusinessDateTime(new Date()); }
    simpanUndo(terbaru);
    const fresh = tulis.length ? await proyeksi.load() : data;
    return {
      ok: true,
      berkas: u.berkas,
      dikembalikan: tulis.map((s) => ({ outlet: s.outlet, label: s.label, a1: s.a1, dari: s.baru, ke: s.lamaTeks })),
      dilewati: dilewati.map((s) => ({ outlet: s.outlet, label: s.label, a1: s.a1, alasan: s.alasan })),
      undo: ringkasUndo(undoTerakhir(u.spreadsheetId)),
      data: fresh,
    };
  });
}

module.exports = { unggah, pratinjau, terapkan, statusUndo, batalkan, parseBulan, ubahFormula, kunci, hitungWorkbook, ekstrakOutlet, UNDO_FILE };
