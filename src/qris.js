"use strict";

const cfg = require("./config");
const { readRange, batchWrite, resolveCashflowSpreadsheetId } = require("./sheets");
const { extractQris } = require("./claude");

const SHEET = "INPUT QRIS";
const OUTLETS = ["MAUMBI", "PERKAMIL"];

function isoToSheetDate(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`; // dd/mm/yyyy
}

/** Analisis screenshot pendapatan EDC harian → baris kandidat untuk INPUT QRIS. */
async function analyze(files) {
  const { year, month, day } = cfg.nowInBusinessTz();
  const todayIso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const images = files.map((f) => ({ base64: f.buffer.toString("base64"), mediaType: f.mimetype }));

  const entries = await extractQris({ images, todayIso });
  return entries.map((e) => {
    const outlet = e.outlet ? String(e.outlet).toUpperCase() : "";
    return {
      tanggal: e.tanggal || "", // kosong bila tak terbaca → user isi
      nominal: e.nominal,
      outlet: OUTLETS.includes(outlet) ? outlet : "", // user pilih bila tak ada di bukti
      catatan: e.catatan,
    };
  });
}

/**
 * Tulis baris final ke sheet INPUT QRIS: A=TANGGAL, B=NOMINAL, C=OUTLET.
 * Lokasi: baris kosong tepat di bawah baris TERBAWAH yang sudah terisi.
 * Pengecekan dibaca live di sini, tepat sebelum menulis — aman terhadap
 * pengisian manual langsung di spreadsheet. Patokan = kolom A (TANGGAL),
 * rentang terbuka "A2:A" agar tak terbatas seberapa jauh pengisian manual.
 */
async function submit(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("Tidak ada baris untuk disimpan.");
  for (const r of rows) {
    if (!isoToSheetDate(r.tanggal)) throw new Error("Setiap baris harus punya TANGGAL yang valid.");
    if (!Number.isFinite(Number(r.nominal)) || Number(r.nominal) <= 0) throw new Error("NOMINAL tidak valid.");
    if (!OUTLETS.includes(r.outlet)) throw new Error("Pilih OUTLET (MAUMBI/PERKAMIL) untuk setiap baris.");
  }

  const cashflow = await resolveCashflowSpreadsheetId();
  const colA = await readRange(cashflow.id, `'${SHEET}'!A2:A`);
  let appendRow = 2; // default: baris data pertama bila sheet masih kosong
  for (let i = 0; i < colA.length; i++) {
    if (colA[i] && colA[i][0]) appendRow = i + 3; // (baris terisi i+2) + 1
  }

  const values = rows.map((r) => [isoToSheetDate(r.tanggal), Number(r.nominal), r.outlet]);
  const endRow = appendRow + rows.length - 1;
  await batchWrite(cashflow.id, [{ range: `'${SHEET}'!A${appendRow}:C${endRow}`, values }]);

  return { ok: true, sheet: SHEET, barisAwal: appendRow, barisAkhir: endRow, jumlah: rows.length };
}

module.exports = { analyze, submit, OUTLETS };
