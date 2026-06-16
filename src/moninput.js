"use strict";

const path = require("path");
const cfg = require("./config");
const { readRange, batchWrite, resolveCashflowSpreadsheetId } = require("./sheets");
const biaya = require("./biaya");

// Menu monitoring biaya BELUM INPUT pada sheet INPUT PENGGUNAAN BIAYA (CASHFLOW
// bulan berjalan). Menampilkan baris yang STATUS LAPOR APLIKASI SMARTLINK-nya
// masih "BELUM INPUT", dengan kemampuan edit terbatas + toggle status + sembunyi.

const SHEET = "INPUT PENGGUNAAN BIAYA";

// Indeks 0-based kolom A..H pada sheet.
const COL = {
  subjek: 0, keterangan: 1, nominal: 2, tanggal: 3,
  outlet: 4, status: 5, sumberDana: 6, kode: 7,
};
const HEADERS = [
  "SUBJEK BIAYA", "KETERANGAN", "NOMINAL", "TANGGAL",
  "OUTLET", "STATUS LAPOR APLIKASI SMARTLINK", "SUMBER DANA", "KODE TRANSAKSI",
];
const STATUS_OPTIONS = ["BELUM INPUT", "SUDAH INPUT"]; // kolom F

// State lokal (data/moninput_state.json). Kunci = nomor baris di sheet (sheet
// ini append-only sehingga nomor baris stabil sebagai identitas).
//  - hidden:      baris yang disembunyikan permanen (lewat centang + konfirmasi).
//  - keepVisible: baris yang statusnya sudah diubah ke SUDAH INPUT tapi sengaja
//                 tetap ditampilkan sampai user menyembunyikannya manual.
const STATE_FILE = path.join(cfg.DATA_DIR, "moninput_state.json");
function loadState() {
  const d = cfg.readJsonFile(STATE_FILE, { hidden: [], keepVisible: [] });
  return {
    hidden: new Set((d.hidden || []).map(Number)),
    keepVisible: new Set((d.keepVisible || []).map(Number)),
  };
}
function saveState(s) {
  cfg.writeJsonFile(STATE_FILE, {
    hidden: Array.from(s.hidden),
    keepVisible: Array.from(s.keepVisible),
  });
}

function norm(v) {
  return String(v == null ? "" : v).trim();
}

function serialToISO(serial) {
  const ms = Math.round(serial) * 86400000 + Date.UTC(1899, 11, 30);
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
// dd/mm/yyyy -> yyyy-mm-dd (untuk input type=date di pratinjau edit).
function ddmmyyyyToISO(s) {
  const m = String(s || "").trim().match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (!m) return "";
  let [, d, mo, y] = m;
  if (y.length === 2) y = "20" + y;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
// yyyy-mm-dd -> dd/mm/yyyy (untuk ditulis balik ke sheet).
function isoToDDMMYYYY(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/**
 * Daftar biaya BELUM INPUT pada sheet INPUT PENGGUNAAN BIAYA.
 * - Baris ditampilkan jika STATUS = BELUM INPUT, ATAU baris itu ada di keepVisible
 *   (sudah diubah ke SUDAH INPUT tapi belum disembunyikan manual).
 * - Baris di daftar hidden tidak pernah ditampilkan.
 * Mengembalikan juga opsi dropdown KETERANGAN (DAFTAR BIAYA) & SUMBER DANA untuk edit.
 */
async function list() {
  const opts = await biaya.getOptions();
  const id = opts.cashflow.id;
  const [fmt, raw] = await Promise.all([
    readRange(id, `'${SHEET}'!A1:H`, "FORMATTED_VALUE"),
    readRange(id, `'${SHEET}'!A1:H`, "UNFORMATTED_VALUE"),
  ]);
  const state = loadState();

  const out = [];
  for (let i = 1; i < fmt.length; i++) {
    const fr = fmt[i] || [];
    const rr = raw[i] || [];
    if (!norm(fr[COL.keterangan])) continue; // baris kosong (patokan kolom B)
    const rowNum = i + 1; // nomor baris di sheet
    if (state.hidden.has(rowNum)) continue; // disembunyikan permanen
    const status = norm(fr[COL.status]);
    if (status !== "BELUM INPUT" && !state.keepVisible.has(rowNum)) continue;

    // Nilai mentah untuk pratinjau edit (nominal numerik & tanggal ISO).
    const rawTgl = rr[COL.tanggal];
    const tanggalIso = typeof rawTgl === "number" ? serialToISO(rawTgl) : ddmmyyyyToISO(fr[COL.tanggal]);
    const rawNom = rr[COL.nominal];
    const nominalNum =
      typeof rawNom === "number" ? rawNom : Number(String(rawNom).replace(/[^\d.-]/g, "")) || "";

    out.push({
      row: rowNum,
      cells: HEADERS.map((_, c) => (fr[c] == null ? "" : String(fr[c]))),
      status,
      edit: {
        keterangan: norm(fr[COL.keterangan]),
        nominal: nominalNum,
        tanggalIso,
        sumberDana: norm(fr[COL.sumberDana]),
      },
    });
  }
  return {
    rows: out,
    headers: HEADERS,
    statusOptions: STATUS_OPTIONS,
    daftarBiaya: opts.daftarBiaya, // [{keterangan, subjek}]
    sumberDana: opts.sumberDana, // array
  };
}

/** Ubah STATUS LAPOR APLIKASI SMARTLINK (kolom F) langsung di sheet. */
async function setStatus(row, value) {
  if (!Number.isInteger(row) || row < 2) throw new Error("Baris tidak valid.");
  if (!STATUS_OPTIONS.includes(value)) throw new Error("Status tidak valid.");
  const cashflow = await resolveCashflowSpreadsheetId();
  await batchWrite(cashflow.id, [{ range: `'${SHEET}'!F${row}`, values: [[value]] }]);

  // Baris yang diubah ke SUDAH INPUT tetap ditampilkan sampai disembunyikan manual.
  const state = loadState();
  if (value === "SUDAH INPUT") state.keepVisible.add(row);
  else state.keepVisible.delete(row);
  saveState(state);
  return { ok: true, row, value };
}

/**
 * Edit terbatas satu baris: KETERANGAN(B), NOMINAL(C), TANGGAL(D), SUMBER DANA(G).
 * Kolom A (SUBJEK, formula VLOOKUP), E (OUTLET), F (STATUS), H (KODE) TIDAK disentuh.
 */
async function saveEdit(row, fields) {
  if (!Number.isInteger(row) || row < 2) throw new Error("Baris tidak valid.");
  const { keterangan, nominal, tanggalIso, sumberDana } = fields || {};
  const opts = await biaya.getOptions();
  const keteranganList = opts.daftarBiaya.map((d) => d.keterangan);

  if (!keterangan || !keteranganList.includes(keterangan)) {
    throw new Error("KETERANGAN harus dipilih dari daftar yang tersedia.");
  }
  const nom = Number(nominal);
  if (!Number.isFinite(nom) || nom <= 0) throw new Error("NOMINAL tidak valid.");
  if (sumberDana && !opts.sumberDana.includes(sumberDana)) {
    throw new Error(`SUMBER DANA tidak dikenal: ${sumberDana}`);
  }
  const tglStr = isoToDDMMYYYY(tanggalIso);
  if (!tglStr) throw new Error("TANGGAL tidak valid.");

  const id = opts.cashflow.id;
  // B,C,D bersebelahan; G terpisah — supaya E (OUTLET) & F (STATUS) tidak tertimpa.
  await batchWrite(id, [
    { range: `'${SHEET}'!B${row}:D${row}`, values: [[keterangan, nom, tglStr]] },
    { range: `'${SHEET}'!G${row}`, values: [[sumberDana || ""]] },
  ]);
  return { ok: true, row };
}

/** Sembunyikan baris dari daftar (centang + konfirmasi). */
function hide(rows) {
  const state = loadState();
  const want = (rows || []).map(Number).filter((n) => Number.isInteger(n) && n >= 2);
  let added = 0;
  for (const n of want) {
    if (!state.hidden.has(n)) added++;
    state.hidden.add(n);
    state.keepVisible.delete(n);
  }
  saveState(state);
  return { ok: true, hidden: added, rows: want };
}

/** Munculkan kembali baris yang sebelumnya disembunyikan. */
function restore(rows) {
  const state = loadState();
  const want = new Set((rows || []).map(Number));
  let removed = 0;
  for (const n of Array.from(state.hidden)) {
    if (want.has(n)) {
      state.hidden.delete(n);
      removed++;
    }
  }
  saveState(state);
  return { ok: true, removed, rows: Array.from(want) };
}

module.exports = { list, setStatus, saveEdit, hide, restore };
