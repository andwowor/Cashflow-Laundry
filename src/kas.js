"use strict";

const cfg = require("./config");
const { batchWrite, resolveCashflowSpreadsheetId } = require("./sheets");
const { extractKas } = require("./claude");

const KAS_SHEET = "KAS";
const ILH_SHEET = "INPUT LAPORAN HARIAN";

/**
 * Pemetaan target penulisan per jenis upload.
 *  - bank             → BIAYA & KAS LAUNDRY, sheet KAS B6:B9 (+C tanggal)
 *  - aplikasi-outlet  → CASHFLOW, INPUT LAPORAN HARIAN B4:B5 (+C tanggal)
 *  - bank-aplikasi    → CASHFLOW, INPUT LAPORAN HARIAN B11:B14 (+C tanggal)
 *  - belum-settlement → CASHFLOW, INPUT LAPORAN HARIAN B15 (+C tanggal)
 */
const TARGETS = {
  bank: {
    spreadsheet: "biaya-kas",
    sheet: KAS_SHEET,
    rows: { BCA: 6, BRI: 7, BNI: 8, MANDIRI: 9 },
    label: (k) => `Kas Bank ${k}`,
  },
  "aplikasi-outlet": {
    spreadsheet: "cashflow",
    sheet: ILH_SHEET,
    rows: { MAUMBI: 4, PERKAMIL: 5 },
    label: (k) => `Kas Aplikasi ${k}`,
  },
  "bank-aplikasi": {
    spreadsheet: "cashflow",
    sheet: ILH_SHEET,
    rows: { BCA: 11, BRI: 12, BNI: 13, MANDIRI: 14 },
    label: (k) => `Kas Bank ${k} (Aplikasi)`,
  },
  "belum-settlement": {
    spreadsheet: "cashflow",
    sheet: ILH_SHEET,
    rows: { TOTAL: 15 },
    label: () => "Belum Settlement",
  },
};

function keyOf(jenis, item) {
  if (jenis === "bank" || jenis === "bank-aplikasi") return item.bank;
  if (jenis === "aplikasi-outlet") return item.outlet;
  return "TOTAL";
}

/** Analisis screenshot kas → daftar preview {key, label, nominal, target}. */
async function analyze(jenis, files) {
  const target = TARGETS[jenis];
  if (!target) throw new Error(`Jenis upload tidak dikenal: ${jenis}`);

  const { year, month, day } = cfg.nowInBusinessTz();
  const todayIso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const images = files.map((f) => ({
    base64: f.buffer.toString("base64"),
    mediaType: f.mimetype,
  }));
  const items = await extractKas({ images, jenis, todayIso });

  return items.map((item) => {
    const key = keyOf(jenis, item);
    const row = target.rows[key];
    return {
      key,
      label: target.label(key),
      nominal: item.nominal,
      catatan: item.catatan,
      target: row ? `${target.sheet}!B${row}` : null,
      valid: Boolean(row),
    };
  });
}

/** Tulis hasil konfirmasi user ke sel target + tanggal hari ini. */
async function submit(jenis, items) {
  const target = TARGETS[jenis];
  if (!target) throw new Error(`Jenis upload tidak dikenal: ${jenis}`);
  if (!Array.isArray(items) || items.length === 0) throw new Error("Tidak ada data untuk disimpan.");

  const tanggal = cfg.todaySheetDate();
  const spreadsheetId =
    target.spreadsheet === "biaya-kas"
      ? cfg.BIAYA_KAS_SPREADSHEET_ID
      : (await resolveCashflowSpreadsheetId()).id;

  const data = [];
  const written = [];
  for (const item of items) {
    const row = target.rows[item.key];
    if (!row) throw new Error(`Target tidak dikenal: ${item.key}`);
    const nominal = Number(item.nominal);
    if (!Number.isFinite(nominal)) throw new Error(`Nominal tidak valid untuk ${item.key}.`);
    data.push({ range: `'${target.sheet}'!B${row}:C${row}`, values: [[nominal, tanggal]] });
    written.push({ key: item.key, label: target.label(item.key), cell: `${target.sheet}!B${row}`, nominal, tanggal });
  }

  await batchWrite(spreadsheetId, data);
  return { ok: true, jenis, tanggal, written };
}

module.exports = { analyze, submit, TARGETS };
