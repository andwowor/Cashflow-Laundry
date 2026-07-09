"use strict";

const path = require("path");
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
 * Jumlahkan SISA SALDO deposit pelanggan per OUTLET dari sheet DEPOSIT
 * (BIAYA & KAS LAUNDRY). Struktur kolom: A=nama, B=tanggal, C=OUTLET,
 * D=nominal transaksi deposit (masuk + / keluar −). Data mulai baris 3
 * (baris 2 = total seluruh outlet, diabaikan). Sisa saldo per outlet =
 * jumlah kolom D untuk outlet tersebut.
 */
async function loadDepositTotals(spreadsheetId, sheetTitle) {
  const rows = await readRange(spreadsheetId, `'${sheetTitle}'!A3:D`, "UNFORMATTED_VALUE");
  const totals = { MAUMBI: 0, PERKAMIL: 0 };
  const counts = { MAUMBI: 0, PERKAMIL: 0 };
  for (const r of rows) {
    if (!r) continue;
    const outlet = String(r[2] == null ? "" : r[2]).trim().toUpperCase();
    const key = outlet.includes("MAUMBI") ? "MAUMBI" : outlet.includes("PERKAMIL") ? "PERKAMIL" : null;
    if (!key) continue;
    const n = Number(r[3]);
    if (!Number.isFinite(n)) continue;
    totals[key] += n;
    counts[key] += 1;
  }
  return { totals, counts };
}

// State lokal agar penambahan deposit ke B4/B5 INPUT LAPORAN HARIAN bersifat
// idempoten: menyimpan nilai yang TERAKHIR kita tulis + deposit yang ditambahkan,
// per outlet, untuk tanggal berjalan. Dengan ini, menekan "Update Harian"
// berkali-kali tidak menambah deposit dua kali, dan nilai hasil upload (Input Kas)
// tidak pernah hilang.
const DEPOSIT_STATE_FILE = path.join(cfg.DATA_DIR, "kas_aplikasi_deposit_state.json");
function loadDepositState() {
  const d = cfg.readJsonFile(DEPOSIT_STATE_FILE, {});
  const w = d.written || {};
  const dep = d.deposit || {};
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    date: d.date || "",
    written: { MAUMBI: num(w.MAUMBI), PERKAMIL: num(w.PERKAMIL) },
    deposit: { MAUMBI: num(dep.MAUMBI) ?? 0, PERKAMIL: num(dep.PERKAMIL) ?? 0 },
  };
}
function saveDepositState(s) {
  cfg.writeJsonFile(DEPOSIT_STATE_FILE, s);
}

/**
 * Eksekusi tombol "Update Harian" — seluruh rangkaian perintah dalam satu klik.
 */
async function runDailySync(opts = {}) {
  const steps = [];
  const { day, month, year } = cfg.nowInBusinessTz();
  const monthName = cfg.MONTH_NAMES_ID[month - 1];
  const tanggal = cfg.todaySheetDate();
  const biayaKasId = cfg.BIAYA_KAS_SPREADSHEET_ID;
  // Deposit per outlet hanya ditambahkan bila user mengonfirmasi sudah disetor ke
  // kas bank (lihat tombol Update di tab Monitoring). Default: TIDAK ditambahkan.
  const addDepMaumbi = !!opts.depositMaumbi;
  const addDepPerkamil = !!opts.depositPerkamil;

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

  // 2b) Sisa saldo deposit pelanggan per outlet (sheet DEPOSIT). Dipakai untuk
  //     menambah B4/B5 INPUT LAPORAN HARIAN. Toleran: bila gagal/ tak ada,
  //     B4/B5 tidak disentuh sama sekali (nilai hasil upload tetap utuh).
  let depositOk = false;
  const depositTotals = { MAUMBI: 0, PERKAMIL: 0 };
  const depositCounts = { MAUMBI: 0, PERKAMIL: 0 };
  const depositSheet =
    meta.sheets.find((t) => t.trim().toUpperCase() === "DEPOSIT") ||
    meta.sheets.find((t) => t.trim().toUpperCase().startsWith("DEPOSIT"));
  if (!depositSheet) {
    steps.push("⚠ Sheet DEPOSIT tidak ditemukan — B4/B5 INPUT LAPORAN HARIAN tidak ditambah deposit (nilai lama dibiarkan).");
  } else {
    try {
      const dep = await loadDepositTotals(biayaKasId, depositSheet);
      depositTotals.MAUMBI = dep.totals.MAUMBI;
      depositTotals.PERKAMIL = dep.totals.PERKAMIL;
      depositCounts.MAUMBI = dep.counts.MAUMBI;
      depositCounts.PERKAMIL = dep.counts.PERKAMIL;
      depositOk = true;
      steps.push(
        `Sisa saldo deposit (sheet ${depositSheet}): MAUMBI Rp${depositTotals.MAUMBI.toLocaleString("id-ID")} (${depositCounts.MAUMBI} transaksi), ` +
          `PERKAMIL Rp${depositTotals.PERKAMIL.toLocaleString("id-ID")} (${depositCounts.PERKAMIL} transaksi).`
      );
    } catch (err) {
      steps.push(`⚠ Gagal membaca sheet DEPOSIT: ${err.message}. B4/B5 tidak ditambah deposit (nilai lama dibiarkan).`);
    }
  }

  // Deposit efektif yang ditambahkan = hanya bila user konfirmasi "sudah disetor
  // ke kas bank" untuk outlet tsb. Bila belum dikonfirmasi → 0 (deposit tidak ditambah).
  const effDep = {
    MAUMBI: addDepMaumbi ? depositTotals.MAUMBI : 0,
    PERKAMIL: addDepPerkamil ? depositTotals.PERKAMIL : 0,
  };
  if (depositOk) {
    if (!addDepMaumbi) steps.push("Deposit MAUMBI TIDAK ditambahkan (belum dikonfirmasi setor ke kas bank).");
    if (!addDepPerkamil) steps.push("Deposit PERKAMIL TIDAK ditambahkan (belum dikonfirmasi setor ke kas bank).");
  }

  // 2c) Hitung nilai Kas Aplikasi Outlet + deposit. Nilai ini dipakai untuk DUA
  //     tujuan agar konsisten: (a) B4/B5 INPUT LAPORAN HARIAN, dan (b) baris
  //     "KAS TUNAI APLIKASI" di REKAP. Dasar = nilai hasil upload di B4/B5;
  //     dipulihkan dari state lokal supaya tombol bisa ditekan berulang tanpa
  //     menambah deposit dua kali, dan nilai hasil upload tidak pernah dihapus.
  let b4Final = null;
  let b5Final = null;
  if (depositOk) {
    const cur = await readRange(cashflow.id, `'${ILH_SHEET}'!B4:B5`, "UNFORMATTED_VALUE");
    const curB4 = numOrNull(cur, 0);
    const curB5 = numOrNull(cur, 1);
    const st = loadDepositState();
    const sameDay = st.date === tanggal;
    const baseOf = (curVal, outlet) => {
      if (curVal === null) return null;
      const wrote = sameDay ? st.written[outlet] : null;
      if (wrote !== null && Math.abs(curVal - wrote) < 0.5) return curVal - (st.deposit[outlet] || 0);
      return curVal; // nilai baru (hasil upload terbaru / hari baru)
    };
    const baseB4 = baseOf(curB4, "MAUMBI");
    const baseB5 = baseOf(curB5, "PERKAMIL");
    if (baseB4 !== null) b4Final = baseB4 + effDep.MAUMBI;
    else steps.push("B4 INPUT LAPORAN HARIAN kosong — upload Kas Aplikasi Outlet MAUMBI dulu (deposit belum ditambahkan).");
    if (baseB5 !== null) b5Final = baseB5 + effDep.PERKAMIL;
    else steps.push("B5 INPUT LAPORAN HARIAN kosong — upload Kas Aplikasi Outlet PERKAMIL dulu (deposit belum ditambahkan).");
    saveDepositState({
      date: tanggal,
      written: {
        MAUMBI: b4Final !== null ? b4Final : sameDay ? st.written.MAUMBI : null,
        PERKAMIL: b5Final !== null ? b5Final : sameDay ? st.written.PERKAMIL : null,
      },
      deposit: {
        MAUMBI: b4Final !== null ? effDep.MAUMBI : sameDay ? st.deposit.MAUMBI : 0,
        PERKAMIL: b5Final !== null ? effDep.PERKAMIL : sameDay ? st.deposit.PERKAMIL : 0,
      },
    });
  }

  // 3) Tulis ke sheet KAS (inti): nominal kas tunai outlet (B2/B3) + tanggal
  //    (C2/C3) + tanggal kas bank (C6:C9).
  await batchWrite(biayaKasId, [
    { range: `'${KAS_SHEET}'!B2:C3`, values: [[maumbi.laporNominal, tanggal], [perkamil.laporNominal, tanggal]] },
    { range: `'${KAS_SHEET}'!C6:C9`, values: [[tanggal], [tanggal], [tanggal], [tanggal]] },
  ]);
  steps.push(`Sheet KAS: B2=Rp${maumbi.laporNominal.toLocaleString("id-ID")}, B3=Rp${perkamil.laporNominal.toLocaleString("id-ID")}, C2:C3 & C6:C9 = ${tanggal}.`);
  steps.push(`Kas bank: ${bankLabels.map((b, i) => `${b}=Rp${bankNominals[i].toLocaleString("id-ID")}`).join(", ")}.`);
  // Catatan: KAS!C4:C5 (tanggal kas aplikasi) TIDAK ditulis program — sel itu
  // memakai formula IMPORTRANGE dari INPUT LAPORAN HARIAN C4:C5 (yang sudah diisi
  // tanggal hari ini di langkah 4). Menulis ke C4:C5 akan menimpa formula tsb.

  // 3a) Tulis nilai kas aplikasi + deposit LANGSUNG ke KAS!B4/B5 (sheet KAS) supaya
  //     langsung terupdate tanpa menunggu IMPORTRANGE. Ini mengganti formula
  //     IMPORTRANGE di KAS!B4/B5 dengan angka. Ditulis TERPISAH & toleran: bila
  //     gagal (mis. diproteksi), sinkronisasi lain tetap berhasil.
  const kasAplWrites = [];
  if (b4Final !== null) kasAplWrites.push({ range: `'${KAS_SHEET}'!B4`, values: [[b4Final]] });
  if (b5Final !== null) kasAplWrites.push({ range: `'${KAS_SHEET}'!B5`, values: [[b5Final]] });
  if (kasAplWrites.length) {
    try {
      await batchWrite(biayaKasId, kasAplWrites);
      steps.push(
        "Sheet KAS B4/B5 (kas aplikasi + deposit) ditulis langsung: " +
          [b4Final !== null ? `B4=Rp${b4Final.toLocaleString("id-ID")}` : "", b5Final !== null ? `B5=Rp${b5Final.toLocaleString("id-ID")}` : ""]
            .filter(Boolean)
            .join(", ") +
          "."
      );
    } catch (err) {
      const isProtected = /protected/i.test(err.message || "");
      steps.push(
        "⚠ Gagal menulis KAS!B4/B5" +
          (isProtected ? " — sel DIPROTEKSI di sheet KAS. Izinkan service account mengeditnya, lalu jalankan lagi." : `: ${err.message}`)
      );
    }
  }

  // 3b) Baris "KAS TUNAI APLIKASI" di REKAP (kolom hari ini) = nilai yang SAMA
  //     dengan B4/B5 INPUT LAPORAN HARIAN (kas aplikasi + deposit), dihitung di
  //     2c. Ini menghindari ketergantungan pada KAS!B4/B5 (yang formulanya telat
  //     ter-update). Bila B4/B5 belum diisi, pakai KAS!B4/B5 apa adanya.
  const rekapMaumbiVal = b4Final !== null ? b4Final : apliMaumbi;
  const rekapPerkamilVal = b5Final !== null ? b5Final : apliPerkamil;
  const rekapWrites = [];
  if (rekapMaumbiVal !== null) rekapWrites.push({ range: `'${rekapMaumbi}'!${maumbi.apliCell}`, values: [[rekapMaumbiVal]] });
  else steps.push("Kas aplikasi MAUMBI kosong/tidak valid — penulisan ke REKAP MAUMBI dilewati.");
  if (rekapPerkamilVal !== null) rekapWrites.push({ range: `'${rekapPerkamil}'!${perkamil.apliCell}`, values: [[rekapPerkamilVal]] });
  else steps.push("Kas aplikasi PERKAMIL kosong/tidak valid — penulisan ke REKAP PERKAMIL dilewati.");

  if (rekapWrites.length) {
    try {
      await batchWrite(biayaKasId, rekapWrites);
      if (rekapMaumbiVal !== null) steps.push(`KAS TUNAI APLIKASI MAUMBI → REKAP ${maumbi.apliCell} = Rp${rekapMaumbiVal.toLocaleString("id-ID")} (kas aplikasi + deposit, sama dgn B4 INPUT LAPORAN HARIAN).`);
      if (rekapPerkamilVal !== null) steps.push(`KAS TUNAI APLIKASI PERKAMIL → REKAP ${perkamil.apliCell} = Rp${rekapPerkamilVal.toLocaleString("id-ID")} (kas aplikasi + deposit, sama dgn B5 INPUT LAPORAN HARIAN).`);
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
  const ilhWrites = [
    { range: `'${ILH_SHEET}'!B2:C3`, values: [[maumbi.laporNominal, tanggal], [perkamil.laporNominal, tanggal]] },
    { range: `'${ILH_SHEET}'!C4:C5`, values: colC(2) },
    { range: `'${ILH_SHEET}'!B6:C9`, values: bankNominals.map((n) => [n, tanggal]) },
    { range: `'${ILH_SHEET}'!C10:C15`, values: colC(6) },
    { range: `'${ILH_SHEET}'!C16:C25`, values: colC(10) },
  ];

  // 4b) B4/B5 INPUT LAPORAN HARIAN = kas aplikasi upload + deposit (b4Final/b5Final
  //     dihitung di 2c). Nilai yang sama juga ditulis ke baris KAS TUNAI APLIKASI REKAP.
  if (b4Final !== null) ilhWrites.push({ range: `'${ILH_SHEET}'!B4`, values: [[b4Final]] });
  if (b5Final !== null) ilhWrites.push({ range: `'${ILH_SHEET}'!B5`, values: [[b5Final]] });

  await batchWrite(cashflow.id, ilhWrites);
  steps.push(
    `CASHFLOW ${ILH_SHEET}: B2:B3 & B6:B9 nominal, C2:C25 = ${tanggal}.` +
      (b4Final !== null ? ` B4=Rp${b4Final.toLocaleString("id-ID")} (upload+deposit ${effDep.MAUMBI.toLocaleString("id-ID")}).` : "") +
      (b5Final !== null ? ` B5=Rp${b5Final.toLocaleString("id-ID")} (upload+deposit ${effDep.PERKAMIL.toLocaleString("id-ID")}).` : "")
  );

  cfg.recordLastSync(); // catat waktu update harian terakhir (sinkronisasi inti sukses)

  return {
    ok: true,
    tanggal,
    bulan: `${monthName} ${year}`,
    maumbi: maumbi.laporNominal,
    perkamil: perkamil.laporNominal,
    kasAplikasi: { MAUMBI: apliMaumbi, PERKAMIL: apliPerkamil },
    deposit: depositOk ? { ...depositTotals } : null,
    kasAplikasiPlusDeposit: { MAUMBI: b4Final, PERKAMIL: b5Final },
    bank: Object.fromEntries(bankLabels.map((b, i) => [b, bankNominals[i]])),
    steps,
  };
}

/**
 * Diagnostik: untuk kedua sheet REKAP, temukan setiap blok bulan (baris dengan
 * nama bulan di kolom A) beserta rentang baris blok dan baris label pentingnya
 * (KAS TUNAI APLIKASI, KAS TUNAI LAPOR, SETORAN KAS, SELISIH). Berguna untuk
 * mengetahui "bulan X ada di baris berapa sampai berapa".
 */
async function inspectRekapBlocks() {
  const id = cfg.BIAYA_KAS_SPREADSHEET_ID;
  const meta = await getSheetTitles(id);
  const wanted = [];
  const m1 = meta.sheets.find((t) => t.startsWith("REKAP KAS DAN TRANSAKSI MAUMBI"));
  const m2 = meta.sheets.find((t) => t.startsWith("REKAP KAS DAN TRANSAKSI PERKAMI"));
  if (m1) wanted.push(m1);
  if (m2) wanted.push(m2);

  const MONTHS = new Set(cfg.MONTH_NAMES_ID); // sudah huruf besar
  const LABELS = ["KAS TUNAI APLIKASI", "KAS TUNAI LAPOR", "SETORAN KAS", "SELISIH"];
  const cellA = (rows, r) => (rows[r - 1] && rows[r - 1][0] != null ? String(rows[r - 1][0]) : "").trim().toUpperCase();

  const rekap = [];
  for (const sheet of wanted) {
    const colA = await readRange(id, `'${sheet}'!A1:A1030`, "FORMATTED_VALUE");
    const headers = [];
    for (let i = 0; i < colA.length; i++) {
      const a = (colA[i] && colA[i][0] != null ? String(colA[i][0]) : "").trim().toUpperCase();
      if (MONTHS.has(a)) headers.push({ month: a, row: i + 1 });
    }
    const sorted = headers.slice().sort((a, b) => a.row - b.row);
    const blocks = sorted.map((h, idx) => {
      const end = idx + 1 < sorted.length ? sorted[idx + 1].row - 1 : colA.length;
      const labels = {};
      for (let r = h.row + 1; r <= end; r++) {
        const a = cellA(colA, r);
        for (const L of LABELS) if (a === L && !(L in labels)) labels[L] = r;
      }
      return { month: h.month, blockStart: h.row, blockEnd: end, labels };
    });
    rekap.push({ sheet, blocks });
  }
  return { ok: true, rekap };
}

module.exports = { runDailySync, readRekapKasTunaiLapor, loadRekapDaily, findRekapTargetCell, inspectRekapBlocks };
