"use strict";

const cfg = require("./config");
const { readRange, batchWrite, resolveCashflowSpreadsheetId } = require("./sheets");

const BIAYA_SHEET = "BIAYA";
const INPUT_SHEET = "INPUT PENGGUNAAN BIAYA";

// Opsi dropdown pada sheet BIAYA.
const STATUS_OPTIONS = ["SUDAH INPUT", "BELUM INPUT"]; // kolom K
const VERIF_OPTIONS = ["SUDAH VERIFIKASI OWNER", "SALAH INPUT"]; // kolom M

// Indeks 0-based ke array baris A..N.
const COL = {
  nomor: 0, subjek: 1, keterangan: 2, nominal: 3, tanggal: 4, outlet: 5, sumberDana: 6,
  ketPenggunaan: 7, posAplikasi: 8, itemBiaya: 9, status: 10, kode: 11, verifikasi: 12, koreksi: 13,
};
const HEADERS = [
  "NOMOR", "SUBJEK BIAYA", "KETERANGAN", "NOMINAL", "TANGGAL", "OUTLET", "SUMBER DANA",
  "KETERANGAN PENGGUNAAN", "POS BIAYA APLIKASI", "ITEM BIAYA", "STATUS LAPOR APLIKASI",
  "KODE TRANSAKSI", "VERIFIKASI OWNER", "KETERANGAN KOREKSI",
];

function norm(v) {
  return String(v == null ? "" : v).trim();
}

function serialToISO(serial) {
  const ms = Math.round(serial) * 86400000 + Date.UTC(1899, 11, 30);
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
function isoToDDMMYYYY(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/**
 * Daftar biaya yang BELUM "SUDAH INPUT" (kolom STATUS LAPOR APLIKASI) DAN BELUM
 * "SUDAH VERIFIKASI OWNER" (kolom VERIFIKASI OWNER).
 */
async function list() {
  const id = cfg.BIAYA_KAS_SPREADSHEET_ID;
  const rows = await readRange(id, `'${BIAYA_SHEET}'!A1:N`, "FORMATTED_VALUE");
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (!norm(r[COL.keterangan])) continue; // baris kosong
    const status = norm(r[COL.status]);
    const verif = norm(r[COL.verifikasi]);
    if (status === "SUDAH INPUT") continue; // sudah input -> sembunyikan
    if (verif === "SUDAH VERIFIKASI OWNER") continue; // sudah verifikasi -> sembunyikan
    out.push({
      row: i + 1, // nomor baris di sheet
      cells: HEADERS.map((_, c) => (r[c] == null ? "" : String(r[c]))),
      status,
      verifikasi: verif,
      kode: norm(r[COL.kode]),
    });
  }
  return { rows: out, headers: HEADERS, statusOptions: STATUS_OPTIONS, verifOptions: VERIF_OPTIONS };
}

/** Ubah status (kolom K) atau verifikasi owner (kolom M) langsung di sheet BIAYA. */
async function setStatus(row, field, value) {
  if (!Number.isInteger(row) || row < 2) throw new Error("Baris tidak valid.");
  let colLetter;
  let options;
  if (field === "status") {
    colLetter = "K";
    options = STATUS_OPTIONS;
  } else if (field === "verifikasi") {
    colLetter = "M";
    options = VERIF_OPTIONS;
  } else {
    throw new Error("Field tidak dikenal.");
  }
  if (!options.includes(value)) throw new Error(`Nilai tidak valid untuk ${field}.`);
  await batchWrite(cfg.BIAYA_KAS_SPREADSHEET_ID, [
    { range: `'${BIAYA_SHEET}'!${colLetter}${row}`, values: [[value]] },
  ]);
  return { ok: true, row, field, value };
}

/**
 * Export baris terpilih (berdasarkan nomor baris sheet BIAYA) ke sheet
 * INPUT PENGGUNAAN BIAYA (CASHFLOW), kolom B:H, pada baris kosong terbawah.
 * Pemetaan: KETERANGAN(C)→B, NOMINAL(D)→C, TANGGAL(E)→D, OUTLET(F)→E,
 *           STATUS LAPOR APLIKASI(K)→F, SUMBER DANA(G)→G, KODE TRANSAKSI(L)→H.
 */
async function exportRows(rowNumbers) {
  if (!Array.isArray(rowNumbers) || rowNumbers.length === 0) throw new Error("Centang minimal satu baris untuk diexport.");
  const id = cfg.BIAYA_KAS_SPREADSHEET_ID;
  const raw = await readRange(id, `'${BIAYA_SHEET}'!A1:N`, "UNFORMATTED_VALUE");

  const values = [];
  for (const rn of rowNumbers) {
    const r = raw[Number(rn) - 1]; // 0-based
    if (!r || !norm(r[COL.keterangan])) continue;
    const tgl = r[COL.tanggal];
    const tglStr = typeof tgl === "number" ? isoToDDMMYYYY(serialToISO(tgl)) : norm(tgl);
    const nominal = r[COL.nominal];
    const kode = r[COL.kode];
    values.push([
      norm(r[COL.keterangan]), // B KETERANGAN
      typeof nominal === "number" ? nominal : Number(nominal) || norm(nominal), // C NOMINAL
      tglStr, // D TANGGAL
      norm(r[COL.outlet]), // E OUTLET
      norm(r[COL.status]), // F STATUS LAPOR APLIKASI SMARTLINK
      norm(r[COL.sumberDana]), // G SUMBER DANA
      kode == null || kode === "" ? "" : kode, // H KODE TRANSAKSI
    ]);
  }
  if (values.length === 0) throw new Error("Tidak ada baris valid untuk diexport.");

  const cashflow = await resolveCashflowSpreadsheetId();
  // Lokasi append: baris kosong terbawah (dicek live; aman thd pengisian manual).
  const colB = await readRange(cashflow.id, `'${INPUT_SHEET}'!B2:B`);
  let appendRow = 2;
  for (let i = 0; i < colB.length; i++) {
    if (colB[i] && colB[i][0]) appendRow = i + 3;
  }
  const endRow = appendRow + values.length - 1;
  await batchWrite(cashflow.id, [{ range: `'${INPUT_SHEET}'!B${appendRow}:H${endRow}`, values }]);

  return { ok: true, sheet: INPUT_SHEET, barisAwal: appendRow, barisAkhir: endRow, jumlah: values.length };
}

module.exports = { list, setStatus, exportRows };
