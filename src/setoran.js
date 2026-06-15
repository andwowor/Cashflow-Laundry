"use strict";

const cfg = require("./config");
const { batchWrite, getSheetTitles } = require("./sheets");
const { findRekapTargetCell } = require("./sync");

const OUTLETS = ["MAUMBI", "PERKAMIL"];
const LABEL = "SETORAN KAS"; // baris 227 pada blok bulan di sheet REKAP

function parseDate(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/**
 * Tulis nominal setoran ke baris "SETORAN KAS" pada sheet REKAP sesuai outlet,
 * di kolom yang sesuai tanggal (tgl 1 → kolom C, tgl 2 → D, dst). Blok bulan
 * ditentukan dari bulan tanggal yang dipilih, sehingga otomatis mengikuti bulan.
 */
async function submit({ nominal, tanggal, outlet }) {
  const nom = Number(nominal);
  if (!Number.isFinite(nom) || nom <= 0) throw new Error("Nominal setoran tidak valid.");
  const d = parseDate(tanggal);
  if (!d) throw new Error("Tanggal tidak valid.");
  if (!OUTLETS.includes(outlet)) throw new Error("Pilih outlet (MAUMBI/PERKAMIL).");

  const biayaKasId = cfg.BIAYA_KAS_SPREADSHEET_ID;
  const meta = await getSheetTitles(biayaKasId);
  const prefix = outlet === "MAUMBI" ? "REKAP KAS DAN TRANSAKSI MAUMBI" : "REKAP KAS DAN TRANSAKSI PERKAMI";
  const sheetTitle = meta.sheets.find((t) => t.startsWith(prefix));
  if (!sheetTitle) throw new Error(`Sheet REKAP untuk outlet ${outlet} tidak ditemukan.`);

  const monthName = cfg.MONTH_NAMES_ID[d.month - 1];
  const target = await findRekapTargetCell(biayaKasId, sheetTitle, monthName, d.day, LABEL);
  await batchWrite(biayaKasId, [{ range: `'${sheetTitle}'!${target.cell}`, values: [[nom]] }]);

  return {
    ok: true,
    outlet,
    sheet: sheetTitle,
    cell: target.cell,
    nominal: nom,
    tanggal: `${String(d.day).padStart(2, "0")}/${String(d.month).padStart(2, "0")}/${d.year}`,
    bulan: `${monthName} ${d.year}`,
  };
}

module.exports = { submit, OUTLETS };
