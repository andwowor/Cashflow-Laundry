"use strict";

const cfg = require("./config");
const { readRange, getSheetTitles, getSheetId, batchUpdateRequests, batchWrite } = require("./sheets");

// Menu Aliran Kas per outlet — sumber: sheet REKAP KAS DAN TRANSAKSI MAUMBI /
// PERKAMIL (BIAYA & KAS LAUNDRY). Tiap bulan = satu blok; baris header blok berisi
// nama bulan di kolom A + angka tanggal 1..31 di kolom C..AG. Baris-baris metrik
// ada di kolom A; nilai harian ada di kolom tanggal yang sesuai.

const DAY_COL_START = 2; // kolom C (index 2) = tanggal 1
const PENYEBAB_LABEL = "PENYEBAB SELISIH DAN KONKLUSI"; // baris catatan manual (dibuat bila belum ada)
const ANCHOR_LABEL = "SELISIH REAL"; // baris PENYEBAB disisipkan tepat di bawah ini

function norm(v) {
  return String(v == null ? "" : v).trim();
}
function up(v) {
  return norm(v).toUpperCase();
}
function colLetter(idx0) {
  let n = idx0 + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
function num(v) {
  if (typeof v === "number") return v;
  const s = norm(v);
  if (s === "") return null;
  const n = Number(s.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

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

async function resolveRekapSheet(outlet) {
  const o = up(outlet);
  const prefix = o.includes("PERKAMI") ? "REKAP KAS DAN TRANSAKSI PERKAMI" : "REKAP KAS DAN TRANSAKSI MAUMBI";
  const meta = await getSheetTitles(cfg.BIAYA_KAS_SPREADSHEET_ID);
  const sheet = meta.sheets.find((t) => t.startsWith(prefix));
  if (!sheet) throw new Error(`Sheet "${prefix}…" tidak ditemukan di BIAYA & KAS LAUNDRY.`);
  return sheet;
}

function findLabelRow(rows, start, end, label) {
  for (let r = start; r <= end && r < rows.length; r++) {
    if (up((rows[r] || [])[0]) === label) return r;
  }
  return -1;
}

/** Muat blok bulan: rows, index header, akhir blok, peta tanggal→kolom. */
async function loadBlock(outlet, year, month) {
  if (!OUTLETS.includes(up(outlet))) throw new Error("Outlet harus MAUMBI atau PERKAMIL.");
  if (year < MIN_YEAR || (year === MIN_YEAR && month < MIN_MONTH)) {
    throw new Error("Menu ini hanya untuk Maret 2026 dan seterusnya.");
  }
  const monthName = cfg.MONTH_NAMES_ID[month - 1];
  const sheet = await resolveRekapSheet(outlet);
  const id = cfg.BIAYA_KAS_SPREADSHEET_ID;
  const rows = await readRange(id, `'${sheet}'!A1:AG1030`, "UNFORMATTED_VALUE");

  const monthHeaderRows = [];
  for (let i = 0; i < rows.length; i++) {
    const a = up((rows[i] || [])[0]);
    if (cfg.MONTH_NAMES_ID.includes(a)) monthHeaderRows.push({ month: a, idx: i });
  }
  const target = [...monthHeaderRows].reverse().find((h) => h.month === monthName);
  if (!target) throw new Error(`Blok bulan ${monthName} belum ada di sheet "${sheet}".`);
  const after = monthHeaderRows.filter((h) => h.idx > target.idx).map((h) => h.idx);
  const blockEnd = after.length ? Math.min(...after) - 1 : rows.length - 1;

  const headerRow = rows[target.idx] || [];
  const dayCol = {};
  for (let c = DAY_COL_START; c < headerRow.length; c++) {
    const d = Number(headerRow[c]);
    if (Number.isInteger(d) && d >= 1 && d <= 31 && !(d in dayCol)) dayCol[d] = c;
  }
  return { id, sheet, rows, headerIdx: target.idx, blockEnd, dayCol, monthName };
}

function realizedDays(dayCol, year, month) {
  const now = cfg.nowInBusinessTz();
  let maxDay;
  if (year < now.year || (year === now.year && month < now.month)) maxDay = 31;
  else if (year === now.year && month === now.month) maxDay = now.day;
  else maxDay = 0;
  return Object.keys(dayCol)
    .map(Number)
    .filter((d) => d <= maxDay)
    .sort((a, b) => a - b);
}

/** Aliran kas satu outlet untuk (tahun, bulan) + catatan "Penyebab Selisih & Konklusi". */
async function list(outlet, year, month) {
  const blk = await loadBlock(outlet, year, month);
  const { rows, headerIdx, blockEnd, dayCol } = blk;

  // Cocokkan metrik secara berurutan (forward pass) di dalam blok.
  let cursor = headerIdx;
  const metrics = METRICS.map((m) => {
    let found = findLabelRow(rows, cursor + 1, blockEnd, m.match);
    if (found >= 0) cursor = found;
    return { metric: m, row: found };
  });

  const days = realizedDays(dayCol, year, month);

  const outMetrics = metrics.map(({ metric: m, row: r }) => ({
    key: m.key,
    label: m.label,
    highlight: !!m.highlight,
    found: r >= 0,
    values: days.map((d) => (r >= 0 ? num((rows[r] || [])[dayCol[d]]) : null)),
  }));

  // Baris "PENYEBAB SELISIH DAN KONKLUSI" (bila sudah ada di sheet).
  const penyRow = findLabelRow(rows, headerIdx + 1, blockEnd, PENYEBAB_LABEL);
  const notes = {};
  if (penyRow >= 0) {
    for (const d of days) {
      const t = norm((rows[penyRow] || [])[dayCol[d]]);
      if (t) notes[d] = t;
    }
  }

  return {
    ok: true,
    sheet: blk.sheet,
    outlet: up(outlet),
    monthLabel: `${blk.monthName} ${year}`,
    year,
    month,
    days,
    metrics: outMetrics,
    notes,
  };
}

/**
 * Tulis catatan "Penyebab Selisih & Konklusi" untuk satu tanggal ke sheet REKAP.
 * Bila baris PENYEBAB belum ada di blok, baris dibuat tepat di bawah "SELISIH REAL".
 */
async function setNote(outlet, year, month, day, text) {
  const blk = await loadBlock(outlet, year, month);
  const { id, sheet, rows, headerIdx, blockEnd, dayCol } = blk;
  const d = Number(day);
  if (!(d in dayCol)) throw new Error(`Tanggal ${day} tidak ada pada blok ${blk.monthName}.`);
  const colL = colLetter(dayCol[d]);
  const t = String(text == null ? "" : text);

  let penyRow = findLabelRow(rows, headerIdx + 1, blockEnd, PENYEBAB_LABEL); // 0-based
  if (penyRow < 0) {
    if (t.trim() === "") return { ok: true, created: false, row: null }; // tak ada yang perlu ditulis
    const selReal = findLabelRow(rows, headerIdx + 1, blockEnd, ANCHOR_LABEL);
    if (selReal < 0) throw new Error(`Baris "${ANCHOR_LABEL}" tidak ditemukan; baris PENYEBAB tidak bisa dibuat.`);
    const sheetId = await getSheetId(id, sheet);
    if (sheetId == null) throw new Error(`Tidak bisa menemukan ID sheet "${sheet}".`);
    const insertAt0 = selReal + 1; // sisipkan tepat di bawah SELISIH REAL
    await batchUpdateRequests(id, [
      {
        insertDimension: {
          range: { sheetId, dimension: "ROWS", startIndex: insertAt0, endIndex: insertAt0 + 1 },
          inheritFromBefore: false,
        },
      },
    ]);
    const newRow1 = insertAt0 + 1; // nomor baris (1-based) baris baru
    await batchWrite(id, [
      { range: `'${sheet}'!A${newRow1}`, values: [[PENYEBAB_LABEL]] },
      { range: `'${sheet}'!${colL}${newRow1}`, values: [[t]] },
    ]);
    return { ok: true, created: true, row: newRow1 };
  }

  const row1 = penyRow + 1; // 1-based
  await batchWrite(id, [{ range: `'${sheet}'!${colL}${row1}`, values: [[t]] }]);
  return { ok: true, created: false, row: row1 };
}

module.exports = { list, setNote, OUTLETS, MIN_YEAR, MIN_MONTH };
