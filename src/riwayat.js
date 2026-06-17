"use strict";

const cfg = require("./config");
const { readRange, getSheetTitles, resolveCashflowSpreadsheetId, findSpreadsheetIdByTitle } = require("./sheets");

// Riwayat biaya per bulan: lihat seluruh baris sheet INPUT PENGGUNAAN BIAYA pada
// spreadsheet CASHFLOW bulan yang dipilih, lengkap dengan opsi filter (SUBJEK
// BIAYA & KETERANGAN) dan total nominal.

// Spreadsheet bulanan yang sudah diketahui IDnya (di luar bulan berjalan).
// Kunci = "YYYY-MM".
const KNOWN_SHEETS = {
  "2025-11": "10JNIBDMsaDFA384aPl_lS8sd_TEHXboHXYbVn-OQyKA",
  "2025-12": "1k_tCqx-evCqDiW0DiIoxuwaAnlyyOQXUeKBXsSeDnr8",
  "2026-01": "1RPQo6Eb80WZSAOzpH-AfgsjdcTb-15Zy0HrZNEMrYl8",
  "2026-02": "1jn4zj4Nusl4ppNOp93A2Ejxr4BWiC3Vxcr9C9QpBHss",
  "2026-03": "1bE82mtuBGJOhTgMi029J5pXrmQqtliXfJx5PeXGRtSE",
  "2026-04": "14ZnLOjzqvVSrJTxLhhfPxL4gT0ZYFLqMdbdPhZdjRow",
  "2026-05": "1hAIRMmU1IH4QxnYn7MZ0B12sH3NcfvQsIbPVbFfmJzA",
};

// Kolom A..H pada sheet INPUT PENGGUNAAN BIAYA.
const COL = {
  subjek: 0, keterangan: 1, nominal: 2, tanggal: 3,
  outlet: 4, status: 5, sumberDana: 6, kode: 7,
};
const HEADERS = [
  "SUBJEK BIAYA", "KETERANGAN", "NOMINAL", "TANGGAL",
  "OUTLET", "STATUS LAPOR APLIKASI SMARTLINK", "SUMBER DANA", "KODE TRANSAKSI",
];

function norm(v) {
  return String(v == null ? "" : v).trim();
}

/** Tentukan spreadsheet untuk (tahun, bulan): daftar dikenal → bulan berjalan → cari Drive. */
async function resolveMonthSpreadsheet(year, month) {
  const key = `${year}-${String(month).padStart(2, "0")}`;
  if (KNOWN_SHEETS[key]) return { id: KNOWN_SHEETS[key], source: "daftar" };

  const now = cfg.nowInBusinessTz();
  if (year === now.year && month === now.month) {
    const cf = await resolveCashflowSpreadsheetId();
    return { id: cf.id, source: cf.source };
  }

  const title = `CASHFLOW DAN BIAYA ${cfg.MONTH_NAMES_ID[month - 1]} ${year}`;
  const id = await findSpreadsheetIdByTitle(title);
  if (!id) {
    const err = new Error(
      `Spreadsheet "${title}" tidak ditemukan. Pastikan file bulan itu sudah dibagikan ke service account.`
    );
    err.code = "MONTH_NOT_FOUND";
    throw err;
  }
  return { id, source: "drive" };
}

/** Temukan judul sheet "INPUT PENGGUNAAN BIAYA" (toleran variasi penamaan). */
async function resolveInputSheet(spreadsheetId) {
  const meta = await getSheetTitles(spreadsheetId);
  const sheet =
    meta.sheets.find((t) => t.trim().toUpperCase().replace(/\s+/g, " ") === "INPUT PENGGUNAAN BIAYA") ||
    meta.sheets.find((t) => /INPUT.*PENGGUNAAN BIAYA/i.test(t)) ||
    "INPUT PENGGUNAAN BIAYA";
  return { sheet, title: meta.title };
}

/**
 * Daftar biaya untuk (tahun, bulan): baris sheet INPUT PENGGUNAAN BIAYA +
 * opsi filter (SUBJEK BIAYA & KETERANGAN unik) + total nominal.
 */
async function list(year, month) {
  const { id, source } = await resolveMonthSpreadsheet(year, month);
  const { sheet, title } = await resolveInputSheet(id);

  const [fmt, raw] = await Promise.all([
    readRange(id, `'${sheet}'!A1:H`, "FORMATTED_VALUE"),
    readRange(id, `'${sheet}'!A1:H`, "UNFORMATTED_VALUE"),
  ]);

  const rows = [];
  const subjekSet = new Set();
  const ketSet = new Set();
  let total = 0;
  for (let i = 1; i < fmt.length; i++) {
    const fr = fmt[i] || [];
    const rr = raw[i] || [];
    const keterangan = norm(fr[COL.keterangan]);
    if (!keterangan) continue; // baris kosong
    const subjek = norm(fr[COL.subjek]);
    const rawNom = rr[COL.nominal];
    const nominal =
      typeof rawNom === "number" ? rawNom : Number(String(rawNom).replace(/[^\d.-]/g, "")) || 0;
    rows.push({
      cells: HEADERS.map((_, c) => (fr[c] == null ? "" : String(fr[c]))),
      subjek,
      keterangan,
      nominal,
    });
    if (subjek) subjekSet.add(subjek);
    ketSet.add(keterangan);
    total += nominal;
  }

  const collator = new Intl.Collator("id");
  return {
    rows,
    headers: HEADERS,
    subjekOptions: Array.from(subjekSet).sort((a, b) => collator.compare(a, b)),
    keteranganOptions: Array.from(ketSet).sort((a, b) => collator.compare(a, b)),
    total,
    monthLabel: `${cfg.MONTH_NAMES_ID[month - 1]} ${year}`,
    spreadsheetTitle: title,
    source,
  };
}

module.exports = { list, KNOWN_SHEETS };
