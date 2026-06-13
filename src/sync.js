"use strict";

const cfg = require("./config");
const { readRange, batchWrite, getSheetTitles, resolveCashflowSpreadsheetId } = require("./sheets");

const KAS_SHEET = "KAS";
const ILH_SHEET = "INPUT LAPORAN HARIAN";

/**
 * Cari nominal "KAS TUNAI LAPOR" pada sheet REKAP untuk tanggal hari ini.
 *
 * Pola sheet REKAP (per blok bulan, mis. JUNI = baris 198-247):
 *   - Baris header blok: kolom A = nama bulan, kolom B = "HARI TERAKHIR BULAN
 *     SEBELUMNYA", kolom C..AG = angka tanggal 1..31.
 *   - Di dalam blok terdapat baris "KAS TUNAI LAPOR" (untuk JUNI = baris 226).
 * Saat bulan berganti, blok baru dibuat di bawahnya — fungsi ini mendeteksi
 * blok berdasarkan nama bulan sehingga otomatis mengikuti bulan berjalan.
 */
async function readRekapKasTunaiLapor(spreadsheetId, sheetTitle, monthName, day) {
  const rows = await readRange(spreadsheetId, `'${sheetTitle}'!A1:AG1030`, "UNFORMATTED_VALUE");

  // Blok bulan: baris dengan kolom A = nama bulan (pakai kemunculan terakhir,
  // untuk berjaga bila nama bulan sama muncul lagi di tahun berikutnya).
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i] && rows[i][0];
    if (typeof a === "string" && a.trim().toUpperCase() === monthName) headerIdx = i;
  }
  if (headerIdx === -1) {
    throw new Error(
      `Blok bulan ${monthName} belum ada di sheet "${sheetTitle}". ` +
        `Buat dulu blok bulan baru mengikuti pola bulan-bulan sebelumnya.`
    );
  }

  // Baris "KAS TUNAI LAPOR" pertama di dalam blok (offset standar = +28).
  let kasRowIdx = -1;
  for (let i = headerIdx + 1; i < Math.min(headerIdx + 51, rows.length); i++) {
    const a = rows[i] && rows[i][0];
    if (typeof a === "string" && a.trim().toUpperCase() === "KAS TUNAI LAPOR") {
      kasRowIdx = i;
      break;
    }
  }
  if (kasRowIdx === -1) {
    throw new Error(`Baris "KAS TUNAI LAPOR" tidak ditemukan di blok ${monthName} sheet "${sheetTitle}".`);
  }

  // Kolom tanggal: header blok berisi 1..31 mulai kolom C (indeks 2).
  const headerRow = rows[headerIdx];
  let colIdx = -1;
  for (let c = 2; c < headerRow.length; c++) {
    if (Number(headerRow[c]) === day) {
      colIdx = c;
      break;
    }
  }
  if (colIdx === -1) {
    throw new Error(`Kolom tanggal ${day} tidak ditemukan pada blok ${monthName} sheet "${sheetTitle}".`);
  }

  const raw = (rows[kasRowIdx] || [])[colIdx];
  const nominal = Number(raw);
  if (raw === undefined || raw === "" || Number.isNaN(nominal)) {
    throw new Error(
      `Nominal KAS TUNAI LAPOR tanggal ${day} di sheet "${sheetTitle}" kosong/tidak valid (nilai: ${raw}).`
    );
  }

  return {
    nominal,
    cell: `${columnLetter(colIdx)}${kasRowIdx + 1}`,
    row: kasRowIdx + 1,
  };
}

function columnLetter(idx0) {
  let n = idx0 + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Eksekusi tombol "Update Harian" — seluruh rangkaian perintah dalam satu klik.
 */
async function runDailySync() {
  const steps = [];
  const { day, month, year } = cfg.nowInBusinessTz();
  const monthName = cfg.MONTH_NAMES_ID[month - 1];
  const tanggal = cfg.todaySheetDate();
  const biayaKasId = cfg.BIAYA_KAS_SPREADSHEET_ID;

  const cashflow = await resolveCashflowSpreadsheetId();
  steps.push(`Spreadsheet CASHFLOW bulan ini: ${cashflow.title || cashflow.id} (sumber: ${cashflow.source}).`);

  // Nama sheet REKAP diambil dari spreadsheet (nama PERKAMIL bisa terpotong).
  const meta = await getSheetTitles(biayaKasId);
  const rekapMaumbi = meta.sheets.find((t) => t.startsWith("REKAP KAS DAN TRANSAKSI MAUMBI"));
  const rekapPerkamil = meta.sheets.find((t) => t.startsWith("REKAP KAS DAN TRANSAKSI PERKAMI"));
  if (!rekapMaumbi || !rekapPerkamil) {
    throw new Error("Sheet REKAP KAS DAN TRANSAKSI MAUMBI/PERKAMIL tidak ditemukan di BIAYA & KAS LAUNDRY.");
  }

  // 1) Ambil nominal KAS TUNAI LAPOR hari ini dari kedua sheet REKAP.
  const maumbi = await readRekapKasTunaiLapor(biayaKasId, rekapMaumbi, monthName, day);
  const perkamil = await readRekapKasTunaiLapor(biayaKasId, rekapPerkamil, monthName, day);
  steps.push(`REKAP MAUMBI ${monthName} tgl ${day} (sel ${maumbi.cell}): Rp${maumbi.nominal.toLocaleString("id-ID")}.`);
  steps.push(`REKAP PERKAMIL ${monthName} tgl ${day} (sel ${perkamil.cell}): Rp${perkamil.nominal.toLocaleString("id-ID")}.`);

  // 2) Tulis ke sheet KAS: nominal kas tunai outlet (B2/B3) + tanggal hari ini
  //    (C2/C3) + tanggal kas bank (C6:C9).
  await batchWrite(biayaKasId, [
    { range: `'${KAS_SHEET}'!B2:C3`, values: [[maumbi.nominal, tanggal], [perkamil.nominal, tanggal]] },
    { range: `'${KAS_SHEET}'!C6:C9`, values: [[tanggal], [tanggal], [tanggal], [tanggal]] },
  ]);
  steps.push(`Sheet KAS: B2=Rp${maumbi.nominal.toLocaleString("id-ID")}, B3=Rp${perkamil.nominal.toLocaleString("id-ID")}, C2:C3 dan C6:C9 = ${tanggal}.`);

  // 3) Baca nominal kas bank (B6:B9) dari sheet KAS untuk disalin ke CASHFLOW.
  const kasRows = await readRange(biayaKasId, `'${KAS_SHEET}'!B6:B9`, "UNFORMATTED_VALUE");
  const bankNominals = [0, 1, 2, 3].map((i) => {
    const v = kasRows[i] && kasRows[i][0];
    return v === undefined || v === "" ? 0 : Number(v);
  });
  const bankLabels = ["BCA", "BRI", "BNI", "MANDIRI"];
  steps.push(
    `Kas bank dari sheet KAS: ${bankLabels.map((b, i) => `${b}=Rp${bankNominals[i].toLocaleString("id-ID")}`).join(", ")}.`
  );

  // 4) Tulis ke CASHFLOW sheet INPUT LAPORAN HARIAN:
  //    - B2:C3  : kas tunai outlet + tanggal (copy dari KAS B2:C3)
  //    - C4:C5  : tanggal kas aplikasi outlet
  //    - B6:C9  : kas bank + tanggal (copy dari KAS B6:C9)
  //    - C10:C15: tanggal kas bank aplikasi + belum settlement
  //    - C16:C25: tanggal baris lainnya
  const colC = (n) => Array.from({ length: n }, () => [tanggal]);
  await batchWrite(cashflow.id, [
    { range: `'${ILH_SHEET}'!B2:C3`, values: [[maumbi.nominal, tanggal], [perkamil.nominal, tanggal]] },
    { range: `'${ILH_SHEET}'!C4:C5`, values: colC(2) },
    { range: `'${ILH_SHEET}'!B6:C9`, values: bankNominals.map((n) => [n, tanggal]) },
    { range: `'${ILH_SHEET}'!C10:C15`, values: colC(6) },
    { range: `'${ILH_SHEET}'!C16:C25`, values: colC(10) },
  ]);
  steps.push(`CASHFLOW ${ILH_SHEET}: B2:B3 & B6:B9 terisi nominal, C2:C25 = ${tanggal}.`);

  return {
    ok: true,
    tanggal,
    bulan: `${monthName} ${year}`,
    maumbi: maumbi.nominal,
    perkamil: perkamil.nominal,
    bank: Object.fromEntries(bankLabels.map((b, i) => [b, bankNominals[i]])),
    steps,
  };
}

module.exports = { runDailySync, readRekapKasTunaiLapor };
