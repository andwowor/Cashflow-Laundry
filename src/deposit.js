"use strict";

const cfg = require("./config");
const { readRange, batchWrite, getSheetTitles } = require("./sheets");

// Menu Deposit Pelanggan — sheet DEPOSIT (spreadsheet BIAYA & KAS LAUNDRY).
// Struktur: A=NAMA PELANGGAN, B=TANGGAL, C=OUTLET, D=JUMLAH DEPOSIT (bertanda:
// + penambahan, − pemakaian). Data mulai baris 3 (baris 1 header, baris 2 = total
// saldo seluruh outlet). Saldo per pelanggan = jumlah kolom D untuk nama tsb.

const DATA_START_ROW = 3;

function norm(v) {
  return String(v == null ? "" : v).trim();
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
function isoToDDMMYYYY(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

async function resolveSheetTitle() {
  const meta = await getSheetTitles(cfg.BIAYA_KAS_SPREADSHEET_ID);
  const found =
    meta.sheets.find((t) => t.trim().toUpperCase() === "DEPOSIT") ||
    meta.sheets.find((t) => /^DEPOSIT/i.test(t.trim()));
  if (!found) throw new Error('Sheet "DEPOSIT" tidak ditemukan di spreadsheet BIAYA & KAS LAUNDRY.');
  return found;
}

/** Deteksi kolom dari baris header (fallback A,B,C,D sesuai struktur diketahui). */
function detectColumns(header) {
  const up = (header || []).map((h) => norm(h).toUpperCase());
  const find = (pred, fallback) => {
    const i = up.findIndex(pred);
    return i >= 0 ? i : fallback;
  };
  return {
    nama: find((h) => h.includes("NAMA"), 0),
    tanggal: find((h) => h.includes("TANGGAL") || h.includes("TGL"), 1),
    outlet: find((h) => h.includes("OUTLET"), 2),
    jumlah: find((h) => h.includes("JUMLAH"), 3),
  };
}

function numAt(rawRow, idx) {
  const v = rawRow[idx];
  if (typeof v === "number") return v;
  const n = Number(String(v == null ? "" : v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Ringkasan: saldo per pelanggan (jumlah kolom D), daftar outlet, header, dan
 * baris terbawah terisi.
 */
async function summary() {
  const id = cfg.BIAYA_KAS_SPREADSHEET_ID;
  const sheet = await resolveSheetTitle();
  const [fmt, raw] = await Promise.all([
    readRange(id, `'${sheet}'!A1:Z`, "FORMATTED_VALUE"),
    readRange(id, `'${sheet}'!A1:Z`, "UNFORMATTED_VALUE"),
  ]);
  const cols = detectColumns(fmt[0] || []);
  const headers = {
    nama: norm((fmt[0] || [])[cols.nama]) || "NAMA PELANGGAN",
    tanggal: norm((fmt[0] || [])[cols.tanggal]) || "TANGGAL",
    outlet: norm((fmt[0] || [])[cols.outlet]) || "OUTLET",
    jumlah: norm((fmt[0] || [])[cols.jumlah]) || "JUMLAH DEPOSIT",
  };

  const bal = new Map();
  const cnt = new Map();
  const outletSet = new Set();
  const transactions = []; // {nama, tanggal, outlet, jumlah} dalam urutan sheet (baris 3 ke bawah)
  let lastRow = DATA_START_ROW - 1;
  for (let i = DATA_START_ROW - 1; i < fmt.length; i++) {
    const fr = fmt[i] || [];
    const filled = [cols.nama, cols.tanggal, cols.outlet, cols.jumlah].some((c) => norm(fr[c]) !== "");
    if (!filled) continue;
    lastRow = i + 1; // nomor baris di sheet
    const nama = norm(fr[cols.nama]);
    const outlet = norm(fr[cols.outlet]);
    if (outlet) outletSet.add(outlet);
    const j = numAt(raw[i] || [], cols.jumlah);
    if (nama) {
      bal.set(nama, (bal.get(nama) || 0) + j);
      cnt.set(nama, (cnt.get(nama) || 0) + 1);
      transactions.push({ row: i + 1, nama, tanggal: norm(fr[cols.tanggal]), outlet, jumlah: j });
    }
  }

  const collator = new Intl.Collator("id");
  const customers = Array.from(bal.keys())
    .sort((a, b) => collator.compare(a, b))
    .map((n) => ({ nama: n, saldo: bal.get(n), transaksi: cnt.get(n) }));
  let outlets = Array.from(outletSet).sort((a, b) => collator.compare(a, b));
  if (!outlets.length) outlets = ["MAUMBI", "PERKAMIL"];

  return { sheet, headers, columns: cols, customers, outlets, transactions, lastRow, nextRow: lastRow + 1 };
}

/**
 * Catat perubahan deposit pada baris kosong terbawah.
 * jenis "PEMAKAIAN" → nominal negatif; "PENAMBAHAN" → nominal positif (kolom JUMLAH DEPOSIT).
 */
async function submit(payload) {
  const nama = norm(payload && payload.nama);
  const tanggalIso = norm(payload && payload.tanggal);
  const outlet = norm(payload && payload.outlet);
  const jenis = norm(payload && payload.jenis).toUpperCase();
  const nominalAbs = Math.abs(Number(payload && payload.nominal));

  if (!nama) throw new Error("Nama pelanggan wajib diisi.");
  if (!tanggalIso) throw new Error("Tanggal wajib diisi.");
  if (!outlet) throw new Error("Outlet wajib dipilih.");
  if (jenis !== "PEMAKAIAN" && jenis !== "PENAMBAHAN") {
    throw new Error("Pilih dulu PEMAKAIAN DEPOSIT atau PENAMBAHAN DEPOSIT.");
  }
  if (!Number.isFinite(nominalAbs) || nominalAbs <= 0) throw new Error("Nominal tidak valid.");

  const tanggal = isoToDDMMYYYY(tanggalIso);
  if (!tanggal) throw new Error("Format tanggal tidak valid.");
  const signed = jenis === "PEMAKAIAN" ? -nominalAbs : nominalAbs;

  const id = cfg.BIAYA_KAS_SPREADSHEET_ID;
  const sheet = await resolveSheetTitle();

  // Cek baris terbawah terisi (live) mulai baris 3.
  const fmt = await readRange(id, `'${sheet}'!A1:Z`, "FORMATTED_VALUE");
  const cols = detectColumns(fmt[0] || []);
  let lastRow = DATA_START_ROW - 1;
  for (let i = DATA_START_ROW - 1; i < fmt.length; i++) {
    const fr = fmt[i] || [];
    if ([cols.nama, cols.tanggal, cols.outlet, cols.jumlah].some((c) => norm(fr[c]) !== "")) lastRow = i + 1;
  }
  const newRow = lastRow + 1;

  await batchWrite(id, [
    { range: `'${sheet}'!${colLetter(cols.nama)}${newRow}`, values: [[nama]] },
    { range: `'${sheet}'!${colLetter(cols.tanggal)}${newRow}`, values: [[tanggal]] },
    { range: `'${sheet}'!${colLetter(cols.outlet)}${newRow}`, values: [[outlet]] },
    { range: `'${sheet}'!${colLetter(cols.jumlah)}${newRow}`, values: [[signed]] },
  ]);

  // Saldo terbaru pelanggan ini setelah pencatatan.
  let saldo = null;
  try {
    const after = await summary();
    const c = after.customers.find((x) => x.nama === nama);
    saldo = c ? c.saldo : signed;
  } catch {
    /* abaikan: saldo hanya untuk tampilan */
  }

  return { ok: true, sheet, row: newRow, nama, tanggal, outlet, jenis, nominal: signed, saldo };
}

module.exports = { summary, submit };
