"use strict";

const path = require("path");
const cfg = require("./config");
const { readRange, getSheetTitles } = require("./sheets");

// Menu Aliran Kas per outlet — sumber: sheet REKAP KAS DAN TRANSAKSI MAUMBI /
// PERKAMIL (BIAYA & KAS LAUNDRY). Tiap bulan = satu blok; baris header blok berisi
// nama bulan di kolom A + angka tanggal 1..31 di kolom C..AG. Baris-baris metrik
// ada di kolom A; nilai harian ada di kolom tanggal yang sesuai.

const DAY_COL_START = 2; // kolom C (index 2) = tanggal 1

function norm(v) {
  return String(v == null ? "" : v).trim();
}
function up(v) {
  return norm(v).toUpperCase();
}

// Urutan metrik yang ditampilkan + label tampilan + teks pencocokan di kolom A.
// Catatan: 6 baris "SELISIH DENGAN APLIKASI LAPOR"/"SELISIH DENGAN REAL" berulang
// di tiap seksi (TUNAI/QRIS/TRANSFER); dicocokkan secara berurutan (forward pass)
// agar masing-masing jatuh ke seksi yang benar.
const METRICS = [
  { key: "tunai_buku", label: "Transaksi Tunai Catatan Buku", match: "TRANSAKSI TUNAI CATATAN BUKU" },
  { key: "tunai_real", label: "Transaksi Tunai Real", match: "TRANSAKSI TUNAI REAL" },
  { key: "tunai_apl", label: "Transaksi Tunai Aplikasi", match: "TRANSAKSI TUNAI APLIKASI" },
  { key: "tunai_sel_apl", label: "Selisih Tunai: Catatan Buku vs Aplikasi", match: "SELISIH DENGAN APLIKASI LAPOR" },
  { key: "tunai_sel_real", label: "Selisih Tunai: Catatan Buku vs Real", match: "SELISIH DENGAN REAL" },
  { key: "qris_buku", label: "Transaksi QRIS Catatan Buku", match: "TRANSAKSI QRIS CATATAN BUKU" },
  { key: "qris_real", label: "Transaksi QRIS Real", match: "TRANSAKSI QRIS REAL" },
  { key: "qris_apl", label: "Transaksi QRIS Aplikasi", match: "TRANSAKSI QRIS APLIKASI" },
  { key: "qris_sel_apl", label: "Selisih QRIS: Catatan Buku vs Aplikasi", match: "SELISIH DENGAN APLIKASI LAPOR" },
  { key: "qris_sel_real", label: "Selisih QRIS: Catatan Buku vs Real", match: "SELISIH DENGAN REAL" },
  { key: "trf_buku", label: "Transaksi Transfer Catatan Buku", match: "TRANSAKSI TRANSFER CATATAN BUKU" },
  { key: "trf_real", label: "Transaksi Transfer Real", match: "TRANSAKSI TRANSFER REAL" },
  { key: "trf_apl", label: "Transaksi Transfer Aplikasi", match: "TRANSAKSI TRANSFER APLIKASI" },
  { key: "trf_sel_apl", label: "Selisih Transfer: Catatan Buku vs Aplikasi", match: "SELISIH DENGAN APLIKASI LAPOR" },
  { key: "trf_sel_real", label: "Selisih Transfer: Catatan Buku vs Real", match: "SELISIH DENGAN REAL" },
  { key: "aj_tunai", label: "Pendapatan Antar Jemput Tunai", match: "PENDAPATAN ANTAR JEMPUT TUNAI" },
  { key: "aj_qris", label: "Pendapatan Antar Jemput QRIS", match: "PENDAPATAN ANTAR JEMPUT QRIS" },
  { key: "aj_trf", label: "Pendapatan Antar Jemput Transfer", match: "PENDAPATAN ANTAR JEMPUT TRANSFER" },
  { key: "kas_apl", label: "Kas Tunai Aplikasi", match: "KAS TUNAI APLIKASI" },
  { key: "kas_lapor", label: "Kas Tunai Lapor", match: "KAS TUNAI LAPOR" },
  { key: "setoran", label: "Setoran Kas", match: "SETORAN KAS" },
  { key: "selisih", label: "Selisih", match: "SELISIH" },
  { key: "biaya", label: "Biaya", match: "BIAYA" },
  { key: "kas_prev", label: "Kas Tunai Hari Sebelumnya", match: "KAS TUNAI HARI SEBELUMNYA" },
  { key: "kas_harus", label: "Kas Tunai Seharusnya", match: "KAS TUNAI SEHARUSNYA" },
  { key: "sel_apl", label: "Selisih Aplikasi", match: "SELISIH APLIKASI" },
  { key: "sel_real", label: "Selisih Real", match: "SELISIH REAL", highlight: true },
];

const OUTLETS = ["MAUMBI", "PERKAMIL"];
const MIN_YEAR = 2026;
const MIN_MONTH = 3; // Maret 2026

// "Penyebab Selisih & Konklusi" — catatan manual per outlet/bulan/tanggal.
// Disimpan lokal (tidak menulis ke sheet REKAP agar strukturnya tidak bergeser).
const NOTES_FILE = path.join(cfg.DATA_DIR, "aliran_notes.json");
function loadNotes() {
  return cfg.readJsonFile(NOTES_FILE, {});
}
function notesKey(outlet, year, month) {
  return `${up(outlet)}|${year}-${String(month).padStart(2, "0")}`;
}
function getNotes(outlet, year, month) {
  const all = loadNotes();
  return all[notesKey(outlet, year, month)] || {}; // { [day]: text }
}
function setNote(outlet, year, month, day, text) {
  if (!OUTLETS.includes(up(outlet))) throw new Error("Outlet harus MAUMBI atau PERKAMIL.");
  const d = Number(day);
  if (!Number.isInteger(d) || d < 1 || d > 31) throw new Error("Tanggal tidak valid.");
  const all = loadNotes();
  const k = notesKey(outlet, year, month);
  all[k] = all[k] || {};
  const t = String(text == null ? "" : text);
  if (t.trim() === "") delete all[k][String(d)];
  else all[k][String(d)] = t;
  if (Object.keys(all[k]).length === 0) delete all[k];
  cfg.writeJsonFile(NOTES_FILE, all);
  return { ok: true, outlet: up(outlet), year, month, day: d, text: t };
}

async function resolveRekapSheet(outlet) {
  const o = up(outlet);
  const prefix = o.includes("PERKAMI") ? "REKAP KAS DAN TRANSAKSI PERKAMI" : "REKAP KAS DAN TRANSAKSI MAUMBI";
  const meta = await getSheetTitles(cfg.BIAYA_KAS_SPREADSHEET_ID);
  const sheet = meta.sheets.find((t) => t.startsWith(prefix));
  if (!sheet) throw new Error(`Sheet "${prefix}…" tidak ditemukan di BIAYA & KAS LAUNDRY.`);
  return sheet;
}

function num(v) {
  if (typeof v === "number") return v;
  const s = norm(v);
  if (s === "") return null;
  const n = Number(s.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Ambil aliran kas satu outlet untuk (tahun, bulan). Mengembalikan daftar hari
 * (yang sudah terealisasi) + nilai tiap metrik per hari.
 */
async function list(outlet, year, month) {
  if (!OUTLETS.includes(up(outlet))) throw new Error("Outlet harus MAUMBI atau PERKAMIL.");
  if (year < MIN_YEAR || (year === MIN_YEAR && month < MIN_MONTH)) {
    throw new Error("Menu ini hanya untuk Maret 2026 dan seterusnya.");
  }
  const monthName = cfg.MONTH_NAMES_ID[month - 1]; // huruf besar
  const sheet = await resolveRekapSheet(outlet);
  const rows = await readRange(cfg.BIAYA_KAS_SPREADSHEET_ID, `'${sheet}'!A1:AG1030`, "UNFORMATTED_VALUE");

  // Temukan baris header blok bulan (kolom A = nama bulan). Pakai kemunculan
  // terakhir (sesuai logika sinkronisasi harian).
  const monthHeaderRows = [];
  for (let i = 0; i < rows.length; i++) {
    const a = up((rows[i] || [])[0]);
    if (cfg.MONTH_NAMES_ID.includes(a)) monthHeaderRows.push({ month: a, idx: i });
  }
  const target = [...monthHeaderRows].reverse().find((h) => h.month === monthName);
  if (!target) {
    throw new Error(`Blok bulan ${monthName} belum ada di sheet "${sheet}".`);
  }
  // Akhir blok = header bulan berikutnya - 1 (atau akhir data).
  const after = monthHeaderRows.filter((h) => h.idx > target.idx).map((h) => h.idx);
  const blockEnd = after.length ? Math.min(...after) - 1 : rows.length - 1;
  const headerRow = rows[target.idx] || [];

  // Peta tanggal -> index kolom (kolom C ke kanan berisi angka 1..31).
  const dayCol = {};
  for (let c = DAY_COL_START; c < headerRow.length; c++) {
    const d = Number(headerRow[c]);
    if (Number.isInteger(d) && d >= 1 && d <= 31 && !(d in dayCol)) dayCol[d] = c;
  }

  // Cocokkan tiap metrik secara berurutan (forward pass) di dalam blok.
  let cursor = target.idx;
  const metricRow = {};
  for (const m of METRICS) {
    let found = -1;
    for (let r = cursor + 1; r <= blockEnd; r++) {
      if (up((rows[r] || [])[0]) === m.match) {
        found = r;
        break;
      }
    }
    if (found >= 0) {
      metricRow[m.key] = found;
      cursor = found;
    } else {
      metricRow[m.key] = -1; // tidak ditemukan
    }
  }

  // Hari yang ditampilkan: hanya yang sudah terealisasi.
  const now = cfg.nowInBusinessTz();
  let maxDay;
  if (year < now.year || (year === now.year && month < now.month)) maxDay = 31; // bulan lampau: semua
  else if (year === now.year && month === now.month) maxDay = now.day; // bulan berjalan: s/d hari ini
  else maxDay = 0; // bulan depan: belum ada
  const days = Object.keys(dayCol)
    .map(Number)
    .filter((d) => d <= maxDay)
    .sort((a, b) => a - b);

  const metrics = METRICS.map((m) => {
    const r = metricRow[m.key];
    const values = days.map((d) => (r >= 0 ? num((rows[r] || [])[dayCol[d]]) : null));
    return { key: m.key, label: m.label, highlight: !!m.highlight, found: r >= 0, values };
  });

  return {
    ok: true,
    sheet,
    outlet: up(outlet),
    monthLabel: `${monthName} ${year}`,
    year,
    month,
    days,
    metrics,
    notes: getNotes(outlet, year, month), // { [day]: text } untuk baris "Penyebab Selisih & Konklusi"
  };
}

module.exports = { list, setNote, OUTLETS, MIN_YEAR, MIN_MONTH };
