"use strict";

const cfg = require("./config");
const { readRange, batchWrite, getSheetTitles, resolveCashflowSpreadsheetId } = require("./sheets");

const KAS_SHEET = "KAS";
const ILH_SHEET = "INPUT LAPORAN HARIAN";

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
 * Temukan blok bulan + kolom tanggal pada sheet REKAP.
 *
 * Pola sheet REKAP (per blok bulan, mis. JUNI = baris 198-247):
 *   - Baris header blok: kolom A = nama bulan, kolom C..AG = angka tanggal 1..31.
 *   - Di dalam blok ada baris berlabel, mis. "KAS TUNAI LAPOR" (baris 226 utk JUNI)
 *     dan "KAS TUNAI APLIKASI" (baris 225 utk JUNI).
 * Blok terdeteksi dari nama bulan di kolom A, sehingga otomatis mengikuti bulan
 * berjalan saat baris berganti ke blok bulan baru.
 */
function locateRekapBlock(rows, monthName, day, sheetTitle) {
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i] && rows[i][0];
    if (typeof a === "string" && a.trim().toUpperCase() === monthName) headerIdx = i; // pakai kemunculan terakhir
  }
  if (headerIdx === -1) {
    throw new Error(
      `Blok bulan ${monthName} belum ada di sheet "${sheetTitle}". ` +
        `Buat dulu blok bulan baru mengikuti pola bulan-bulan sebelumnya.`
    );
  }
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
  return { headerIdx, colIdx };
}

/** Cari baris berlabel tertentu di dalam satu blok bulan (maks 50 baris ke bawah). */
function findBlockRow(rows, headerIdx, label, sheetTitle) {
  for (let i = headerIdx + 1; i < Math.min(headerIdx + 51, rows.length); i++) {
    const a = rows[i] && rows[i][0];
    if (typeof a === "string" && a.trim().toUpperCase() === label) return i;
  }
  throw new Error(`Baris "${label}" tidak ditemukan di blok sheet "${sheetTitle}".`);
}

/**
 * Baca data harian satu sheet REKAP sekaligus tentukan sel-sel terkait:
 *   - laporNominal/laporCell : nominal "KAS TUNAI LAPOR" (dibaca, untuk sheet KAS).
 *   - apliCell               : sel "KAS TUNAI APLIKASI" pada kolom hari ini (ditulis).
 */
async function loadRekapDaily(spreadsheetId, sheetTitle, monthName, day) {
  const rows = await readRange(spreadsheetId, `'${sheetTitle}'!A1:AG1030`, "UNFORMATTED_VALUE");
  const { headerIdx, colIdx } = locateRekapBlock(rows, monthName, day, sheetTitle);
  const colL = columnLetter(colIdx);

  const laporRow = findBlockRow(rows, headerIdx, "KAS TUNAI LAPOR", sheetTitle);
  const apliRow = findBlockRow(rows, headerIdx, "KAS TUNAI APLIKASI", sheetTitle);

  const raw = (rows[laporRow] || [])[colIdx];
  const nominal = Number(raw);
  if (raw === undefined || raw === "" || Number.isNaN(nominal)) {
    throw new Error(
      `Nominal KAS TUNAI LAPOR tanggal ${day} di sheet "${sheetTitle}" kosong/tidak valid (nilai: ${raw}).`
    );
  }
  return {
    laporNominal: nominal,
    laporCell: `${colL}${laporRow + 1}`,
    apliCell: `${colL}${apliRow + 1}`,
    colLetter: colL,
  };
}

/** Kompatibilitas: hanya bagian "KAS TUNAI LAPOR". */
async function readRekapKasTunaiLapor(spreadsheetId, sheetTitle, monthName, day) {
  const r = await loadRekapDaily(spreadsheetId, sheetTitle, monthName, day);
  return { nominal: r.laporNominal, cell: r.laporCell };
}

/** Cari alamat sel pada baris berlabel `label` di blok bulan `monthName`, kolom tanggal `day`. */
async function findRekapTargetCell(spreadsheetId, sheetTitle, monthName, day, label) {
  const rows = await readRange(spreadsheetId, `'${sheetTitle}'!A1:AG1030`, "UNFORMATTED_VALUE");
  const { headerIdx, colIdx } = locateRekapBlock(rows, monthName, day, sheetTitle);
  const rowIdx = findBlockRow(rows, headerIdx, label, sheetTitle);
  return { cell: `${columnLetter(colIdx)}${rowIdx + 1}`, row: rowIdx + 1, colLetter: columnLetter(colIdx) };
}

function numOrNull(cellRows, i) {
  const v = cellRows[i] && cellRows[i][0];
  if (v === undefined || v === "" || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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

  // 1) Baca blok bulan berjalan dari kedua sheet REKAP (nominal harian + sel tujuan).
  const maumbi = await loadRekapDaily(biayaKasId, rekapMaumbi, monthName, day);
  const perkamil = await loadRekapDaily(biayaKasId, rekapPerkamil, monthName, day);
  steps.push(`REKAP MAUMBI ${monthName} tgl ${day} — KAS TUNAI LAPOR (${maumbi.laporCell}): Rp${maumbi.laporNominal.toLocaleString("id-ID")}.`);
  steps.push(`REKAP PERKAMIL ${monthName} tgl ${day} — KAS TUNAI LAPOR (${perkamil.laporCell}): Rp${perkamil.laporNominal.toLocaleString("id-ID")}.`);

  // 2) Baca dari sheet KAS: kas aplikasi outlet (B4/B5) + kas bank (B6:B9).
  const kasRows = await readRange(biayaKasId, `'${KAS_SHEET}'!B4:B9`, "UNFORMATTED_VALUE");
  const apliMaumbi = numOrNull(kasRows, 0); // B4 = KAS APLIKASI MAUMBI
  const apliPerkamil = numOrNull(kasRows, 1); // B5 = KAS APLIKASI PERKAMIL
  const bankNominals = [2, 3, 4, 5].map((i) => numOrNull(kasRows, i) ?? 0); // B6:B9
  const bankLabels = ["BCA", "BRI", "BNI", "MANDIRI"];

  // 3) Tulis ke sheet KAS (inti): nominal kas tunai outlet (B2/B3) + tanggal
  //    (C2/C3) + tanggal kas bank (C6:C9).
  await batchWrite(biayaKasId, [
    { range: `'${KAS_SHEET}'!B2:C3`, values: [[maumbi.laporNominal, tanggal], [perkamil.laporNominal, tanggal]] },
    { range: `'${KAS_SHEET}'!C6:C9`, values: [[tanggal], [tanggal], [tanggal], [tanggal]] },
  ]);
  steps.push(`Sheet KAS: B2=Rp${maumbi.laporNominal.toLocaleString("id-ID")}, B3=Rp${perkamil.laporNominal.toLocaleString("id-ID")}, C2:C3 & C6:C9 = ${tanggal}.`);
  steps.push(`Kas bank: ${bankLabels.map((b, i) => `${b}=Rp${bankNominals[i].toLocaleString("id-ID")}`).join(", ")}.`);

  // 3b) Salin kas aplikasi (KAS!B4/B5) ke baris "KAS TUNAI APLIKASI" di REKAP
  //     pada kolom hari ini. Ditulis TERPISAH & toleran: bila sel REKAP
  //     diproteksi, sinkronisasi inti (KAS + CASHFLOW) tetap berhasil.
  const rekapWrites = [];
  if (apliMaumbi !== null) rekapWrites.push({ range: `'${rekapMaumbi}'!${maumbi.apliCell}`, values: [[apliMaumbi]] });
  else steps.push("KAS!B4 (kas aplikasi MAUMBI) kosong/tidak valid — penulisan ke REKAP MAUMBI dilewati.");
  if (apliPerkamil !== null) rekapWrites.push({ range: `'${rekapPerkamil}'!${perkamil.apliCell}`, values: [[apliPerkamil]] });
  else steps.push("KAS!B5 (kas aplikasi PERKAMIL) kosong/tidak valid — penulisan ke REKAP PERKAMIL dilewati.");

  if (rekapWrites.length) {
    try {
      await batchWrite(biayaKasId, rekapWrites);
      if (apliMaumbi !== null) steps.push(`KAS APLIKASI MAUMBI (KAS!B4=Rp${apliMaumbi.toLocaleString("id-ID")}) → REKAP MAUMBI ${maumbi.apliCell}.`);
      if (apliPerkamil !== null) steps.push(`KAS APLIKASI PERKAMIL (KAS!B5=Rp${apliPerkamil.toLocaleString("id-ID")}) → REKAP PERKAMIL ${perkamil.apliCell}.`);
    } catch (err) {
      const isProtected = /protected/i.test(err.message || "");
      steps.push(
        "⚠ Kas aplikasi GAGAL ditulis ke baris KAS TUNAI APLIKASI di REKAP" +
          (isProtected
            ? " — sel tersebut DIPROTEKSI di spreadsheet. Hapus proteksi pada baris KAS TUNAI APLIKASI (atau izinkan service account mengeditnya), lalu jalankan lagi. Sinkronisasi lain tetap berhasil."
            : `: ${err.message}`)
      );
    }
  }

  // 4) Tulis ke CASHFLOW sheet INPUT LAPORAN HARIAN:
  //    - B2:C3  : kas tunai outlet + tanggal (copy dari KAS B2:C3)
  //    - C4:C5  : tanggal kas aplikasi outlet
  //    - B6:C9  : kas bank + tanggal (copy dari KAS B6:C9)
  //    - C10:C15: tanggal kas bank aplikasi + belum settlement
  //    - C16:C25: tanggal baris lainnya
  const colC = (n) => Array.from({ length: n }, () => [tanggal]);
  await batchWrite(cashflow.id, [
    { range: `'${ILH_SHEET}'!B2:C3`, values: [[maumbi.laporNominal, tanggal], [perkamil.laporNominal, tanggal]] },
    { range: `'${ILH_SHEET}'!C4:C5`, values: colC(2) },
    { range: `'${ILH_SHEET}'!B6:C9`, values: bankNominals.map((n) => [n, tanggal]) },
    { range: `'${ILH_SHEET}'!C10:C15`, values: colC(6) },
    { range: `'${ILH_SHEET}'!C16:C25`, values: colC(10) },
  ]);
  steps.push(`CASHFLOW ${ILH_SHEET}: B2:B3 & B6:B9 terisi nominal, C2:C25 = ${tanggal}.`);

  cfg.recordLastSync(); // catat waktu update harian terakhir (sinkronisasi inti sukses)

  return {
    ok: true,
    tanggal,
    bulan: `${monthName} ${year}`,
    maumbi: maumbi.laporNominal,
    perkamil: perkamil.laporNominal,
    kasAplikasi: { MAUMBI: apliMaumbi, PERKAMIL: apliPerkamil },
    bank: Object.fromEntries(bankLabels.map((b, i) => [b, bankNominals[i]])),
    steps,
  };
}

module.exports = { runDailySync, readRekapKasTunaiLapor, loadRekapDaily, findRekapTargetCell };
