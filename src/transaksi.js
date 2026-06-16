"use strict";

const XLSX = require("xlsx");
const { unzipSync, zipSync } = require("fflate");
const cfg = require("./config");
const { readRange, batchWrite, getSheetTitles } = require("./sheets");

// Token nama bulan untuk mencocokkan judul sheet "DAFTAR PELUNASAN <bulan> <yy>".
const MONTH_TOKENS = {
  1: ["JANUARI", "JAN"],
  2: ["FEBRUARI", "FEB"],
  3: ["MARET", "MAR"],
  4: ["APRIL", "APR"],
  5: ["MEI"],
  6: ["JUNI", "JUN"],
  7: ["JULI", "JUL"],
  8: ["AGUSTUS", "AGUST", "AGS", "AGT", "AGU"],
  9: ["SEPTEMBER", "SEPT", "SEP"],
  10: ["OKTOBER", "OKT"],
  11: ["NOVEMBER", "NOV", "NOP"],
  12: ["DESEMBER", "DES"],
};

const SHEET_PREFIX = "DAFTAR PELUNASAN";
const START_ROW = 28; // data file ekspor mulai baris 28
const TARGET_START = 4; // tulis ke sheet tujuan mulai baris 4
const NCOL = 18; // kolom A..R

/** Sheet DAFTAR PELUNASAN bulan berjalan + daftar semua sheet pelunasan. */
async function resolveSheet() {
  const meta = await getSheetTitles(cfg.BIAYA_KAS_SPREADSHEET_ID);
  const sheets = meta.sheets.filter((t) => t.toUpperCase().startsWith(SHEET_PREFIX));
  const { year, month } = cfg.nowInBusinessTz();
  const tokens = MONTH_TOKENS[month] || [];
  const yearTokens = [String(year).slice(-2), String(year)];
  const resolved =
    sheets.find((t) => {
      const up = t.toUpperCase();
      return tokens.some((tok) => up.includes(tok)) && yearTokens.some((y) => up.includes(y));
    }) || null;
  return { sheets, resolved, monthKey: `${cfg.MONTH_NAMES_ID[month - 1]} ${year}` };
}

/**
 * Baca workbook dengan toleran terhadap arsip ZIP64. File .xlsx ekspor yang
 * besar kadang ditulis dalam format ZIP64 yang TIDAK didukung SheetJS 0.18.5
 * (gejalanya: "Unsupported ZIP Compression method NaN" / "Bad compressed size").
 * Bila pembacaan langsung gagal, arsip dibuka ulang dengan fflate (paham ZIP64)
 * lalu dikemas ulang sebagai ZIP standar yang bisa dibaca SheetJS — semua
 * pemrosesan nilai (tanggal serial, persen, angka) tetap lewat SheetJS.
 */
function readWorkbook(buffer) {
  try {
    return XLSX.read(buffer, { type: "buffer" });
  } catch (err) {
    let files;
    try {
      files = unzipSync(new Uint8Array(buffer));
    } catch {
      throw err; // bukan masalah ZIP64 — kembalikan error pembacaan asli
    }
    const rezipped = zipSync(files);
    return XLSX.read(rezipped, { type: "array" });
  }
}

/** Baca file ekspor (xlsx/xls/csv) → array baris (A..R) dari baris 28 s/d data terbawah. */
function parseBuffer(buffer) {
  const wb = readWorkbook(buffer);
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("File tidak berisi sheet yang bisa dibaca.");
  const all = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: true, defval: "" });

  const startIdx = START_ROW - 1; // 0-based
  const isEmpty = (row) =>
    !row || row.slice(0, NCOL).every((v) => v === "" || v === null || v === undefined);

  let lastIdx = -1;
  for (let i = startIdx; i < all.length; i++) if (!isEmpty(all[i])) lastIdx = i;
  if (lastIdx < startIdx) return [];

  const rows = [];
  for (let i = startIdx; i <= lastIdx; i++) {
    const r = all[i] || [];
    const row = [];
    for (let c = 0; c < NCOL; c++) {
      const v = r[c];
      row.push(v === undefined || v === null ? "" : v);
    }
    rows.push(row);
  }
  return rows;
}

/** Pratinjau: jumlah baris, sheet tujuan, daftar sheet, sampel baris pertama/terakhir. */
async function analyze(buffer) {
  const rows = parseBuffer(buffer);
  const info = await resolveSheet();
  return {
    jumlah: rows.length,
    sheets: info.sheets,
    resolved: info.resolved,
    monthKey: info.monthKey,
    preview: { first: rows[0] || [], last: rows[rows.length - 1] || [] },
  };
}

/**
 * Tulis data ke sheet DAFTAR PELUNASAN (kolom A:R mulai baris 4, USER_ENTERED agar
 * tanggal/persen/angka diparse seperti tempel manual), isi kolom S=LEFT(Q,6) tiap baris,
 * dan bersihkan sisa baris lama bila data baru lebih pendek.
 */
async function submit(buffer, sheetName) {
  const rows = parseBuffer(buffer);
  if (!rows.length) throw new Error(`Tidak ada data pada file (mulai baris ${START_ROW}).`);

  const info = await resolveSheet();
  const target = sheetName || info.resolved;
  if (!target || !info.sheets.includes(target)) {
    throw new Error("Sheet DAFTAR PELUNASAN tujuan tidak ditemukan — pilih sheet tujuannya.");
  }

  const id = cfg.BIAYA_KAS_SPREADSHEET_ID;
  const n = rows.length;
  const endRow = TARGET_START + n - 1;

  // Cek extent lama (kolom B = No Nota terisi di tiap baris data, termasuk baris lanjutan).
  const oldB = await readRange(id, `'${target}'!B${TARGET_START}:B`);
  const oldLast = TARGET_START + oldB.length - 1;

  // Pemisah argumen ";" sesuai locale Indonesia pada spreadsheet (bukan ",").
  const sFormulas = [];
  for (let r = TARGET_START; r <= endRow; r++) sFormulas.push([`=LEFT(Q${r};6)`]);

  await batchWrite(id, [
    { range: `'${target}'!A${TARGET_START}:R${endRow}`, values: rows },
    { range: `'${target}'!S${TARGET_START}:S${endRow}`, values: sFormulas },
  ]);

  // Bersihkan sisa baris lama di bawah data baru (A..S).
  let cleared = 0;
  if (oldLast > endRow) {
    const blankRow = new Array(19).fill(""); // A..S
    const blanks = [];
    for (let r = endRow + 1; r <= oldLast; r++) blanks.push(blankRow.slice());
    await batchWrite(id, [{ range: `'${target}'!A${endRow + 1}:S${oldLast}`, values: blanks }]);
    cleared = oldLast - endRow;
  }

  return { ok: true, sheet: target, jumlah: n, barisAwal: TARGET_START, barisAkhir: endRow, dibersihkan: cleared };
}

module.exports = { resolveSheet, analyze, submit };
