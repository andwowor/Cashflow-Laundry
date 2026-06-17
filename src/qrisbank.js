"use strict";

const cfg = require("./config");
const { readRange, batchWrite, resolveCashflowSpreadsheetId } = require("./sheets");
const { extractQrisBank } = require("./claude");

const SHEET = "DATA QRIS";

/** Serial number Google Sheets (hari sejak 1899-12-30) → "YYYY-MM-DD". */
function serialToISO(serial) {
  // Ambil bagian TANGGAL saja (floor), JANGAN dibulatkan: serial dengan komponen
  // waktu (mis. 46189,5 = 16 Juni siang) tidak boleh naik ke hari berikutnya.
  const ms = Math.floor(serial + 1e-9) * 86400000 + Date.UTC(1899, 11, 30);
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isoToDDMMYYYY(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/**
 * Peta tanggal→baris dari kolom A (TANGGAL) sheet DATA QRIS.
 * Hanya blok tanggal kontigu sejak baris 2 sampai sel kosong pertama — ini
 * otomatis MENGECUALIKAN baris SUM/carryover di bawah sel kosong, sehingga
 * formula =SUM(...) tidak pernah tertimpa. Dibaca live tiap pemakaian.
 */
async function loadDateRows() {
  const cashflow = await resolveCashflowSpreadsheetId();
  const colA = await readRange(cashflow.id, `'${SHEET}'!A2:A`, "UNFORMATTED_VALUE");
  const map = {};
  for (let i = 0; i < colA.length; i++) {
    const v = colA[i] && colA[i][0];
    if (v === undefined || v === "" || v === null) break; // berhenti di sel kosong pertama
    const iso = typeof v === "number" ? serialToISO(v) : null;
    if (iso) map[iso] = i + 2; // baris sheet (A2 = baris 2)
  }
  return { cashflowId: cashflow.id, map };
}

/** Analisis screenshot transfer masuk dana EDC. */
async function analyze(files) {
  const { year, month, day } = cfg.nowInBusinessTz();
  const todayIso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const images = files.map((f) => ({ base64: f.buffer.toString("base64"), mediaType: f.mimetype }));

  const [entries, dateInfo] = await Promise.all([extractQrisBank({ images, todayIso }), loadDateRows()]);

  const norm = entries.map((e) => {
    const nominal = Number(e.nominal) || 0;
    return {
      tanggal: e.tanggal || "",
      subjek: e.subjek || "",
      nominal,
      topup: !!e.topup,
      // Aturan: hanya subjek "Bayar/Top-up" dan nominal positif yang dipakai.
      include: !!e.topup && nominal > 0,
    };
  });

  return { entries: norm, dateRows: dateInfo.map };
}

/**
 * Tulis ke kolom B (TOTAL BANK) DATA QRIS pada baris yang tanggalnya cocok.
 * Nominal dijumlahkan; bila lebih dari satu, ditulis sebagai FORMULA (=a+b+..).
 * Kolom C (TOTAL TRANSAKSI) & D (SELISIH) tidak disentuh (formula otomatis).
 */
async function submit(entries) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error("Tidak ada data untuk disimpan.");

  const { cashflowId, map } = await loadDateRows();

  // Kelompokkan nominal positif per tanggal.
  const groups = {};
  for (const e of entries) {
    const iso = e.tanggal;
    const nom = Math.round(Number(e.nominal));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "") || !Number.isFinite(nom) || nom <= 0) continue;
    (groups[iso] = groups[iso] || []).push(nom);
  }

  const data = [];
  const written = [];
  const skipped = [];
  for (const [iso, noms] of Object.entries(groups)) {
    const row = map[iso];
    if (!row) {
      skipped.push({ tanggal: isoToDDMMYYYY(iso), alasan: "tanggal tidak ada di kolom TANGGAL DATA QRIS" });
      continue;
    }
    const total = noms.reduce((a, b) => a + b, 0);
    const formula = noms.length === 1 ? String(noms[0]) : `=${noms.join("+")}`;
    data.push({ range: `'${SHEET}'!B${row}`, values: [[formula]] });
    written.push({ tanggal: isoToDDMMYYYY(iso), row, formula, total, count: noms.length });
  }

  if (data.length === 0) {
    throw new Error(
      "Tidak ada tanggal yang cocok untuk ditulis ke DATA QRIS." +
        (skipped.length ? ` Tanggal tak ditemukan: ${skipped.map((s) => s.tanggal).join(", ")}.` : "")
    );
  }

  await batchWrite(cashflowId, data);
  return { ok: true, sheet: SHEET, written, skipped };
}

module.exports = { analyze, submit };
