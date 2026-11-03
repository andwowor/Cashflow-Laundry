"use strict";

const path = require("path");
const cfg = require("./config");
const {
  readRange, batchWrite, resolveCashflowSpreadsheetId,
  getDataValidation, getSheetId, batchUpdateRequests,
} = require("./sheets");
const receipt = require("./receipt");

const BIAYA_SHEET = "BIAYA";
const INPUT_SHEET = "INPUT PENGGUNAAN BIAYA";
const ANALISA_SHEET = "TRANSAKSI"; // sheet di spreadsheet ANALISA KEUANGAN

// Catatan baris yang sudah di-export (hilang dari daftar). Kunci = NOMOR (kolom A).
const EXPORTED_FILE = path.join(cfg.DATA_DIR, "monbiaya_exported.json");
const SEED_VERSION = 2; // v2: baris yang SUDAH VERIFIKASI OWNER dianggap historis
function loadExported() {
  const d = cfg.readJsonFile(EXPORTED_FILE, { seeded: false, seedVersion: 0, keys: [] });
  return {
    seeded: !!d.seeded,
    seedVersion: Number(d.seedVersion) || (d.seeded ? 1 : 0),
    keys: new Set(d.keys || []),
  };
}
function saveExported(state) {
  cfg.writeJsonFile(EXPORTED_FILE, {
    seeded: state.seeded,
    seedVersion: state.seedVersion || 0,
    keys: Array.from(state.keys),
  });
}

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

/**
 * Rapikan teks keterangan: jadikan daftar dipisah ", " yang rapi.
 * - "+" diperlakukan sebagai pemisah → koma.
 * - Setiap item di-trim, spasi ganda diciutkan, item kosong dibuang.
 * Contoh: "Super pel+handsoap+persembahan bocil" -> "Super pel, handsoap, persembahan bocil";
 *         "Telur, ubi,kacang ijo+buah" -> "Telur, ubi, kacang ijo, buah".
 */
function tidyKeterangan(text) {
  const parts = String(text == null ? "" : text)
    .replace(/\+/g, ",")
    .split(",")
    .map((p) => p.trim().replace(/\s+/g, " "))
    .filter((p) => p.length > 0);
  return parts.join(", ");
}

/** Kunci unik baris BIAYA = NOMOR (kolom A). */
function rowKey(r) {
  return norm(r[COL.nomor]);
}

function serialToISO(serial) {
  // Ambil bagian TANGGAL saja (floor), JANGAN dibulatkan: serial dengan komponen
  // waktu (mis. 46189,5 = 16 Juni siang) tidak boleh naik ke hari berikutnya.
  const ms = Math.floor(serial + 1e-9) * 86400000 + Date.UTC(1899, 11, 30);
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
function isoToDDMMYYYY(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/**
 * Tanggal sel BIAYA -> "yyyy-mm-dd" (dipakai mencocokkan nama file receipt).
 * raw = nilai mentah (serial bila sel tanggal), fmt = tampilan ("18 Februari 2026"
 * atau "18/02/2026"). "" bila tak terbaca.
 */
function rowDateISO(raw, fmt) {
  if (typeof raw === "number" && Number.isFinite(raw)) return serialToISO(raw);
  const t = norm(fmt);
  const dmy = t.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (dmy) {
    let [, d, mo, y] = dmy;
    if (y.length === 2) y = "20" + y;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  const teks = t.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (teks) {
    const idx = cfg.MONTH_NAMES_ID.indexOf(teks[2].toUpperCase());
    if (idx >= 0) return `${teks[3]}-${String(idx + 1).padStart(2, "0")}-${String(teks[1]).padStart(2, "0")}`;
  }
  return "";
}

/** Pastikan semua baris sudah "centang hijau" di STATUS LAPOR APLIKASI & VERIFIKASI OWNER. */
function assertGreenReady(rowsArr) {
  const notReady = [];
  for (const r of rowsArr) {
    const ok = norm(r[COL.status]) === "SUDAH INPUT" && norm(r[COL.verifikasi]) === "SUDAH VERIFIKASI OWNER";
    if (!ok) notReady.push(norm(r[COL.nomor]) || "?");
  }
  if (notReady.length) {
    const err = new Error(
      `Export dibatalkan: ${notReady.length} baris belum bercentang hijau pada STATUS LAPOR APLIKASI dan VERIFIKASI OWNER ` +
        `(NOMOR: ${notReady.join(", ")}). Ubah kedua statusnya menjadi centang hijau dulu sebelum export.`
    );
    err.code = "NOT_READY";
    throw err;
  }
}

/**
 * Daftar biaya untuk di-copy ke INPUT PENGGUNAAN BIAYA.
 * Baris HILANG dari daftar HANYA setelah di-export (lihat exportRows). Perubahan
 * kolom STATUS LAPOR APLIKASI / VERIFIKASI OWNER tidak menyembunyikan baris.
 * Sekali (saat pertama dipakai), biaya yang sudah "SUDAH INPUT" DAN "SUDAH
 * VERIFIKASI OWNER" dianggap historis/sudah-ditangani agar daftar awal ringkas.
 */
async function list() {
  const id = cfg.BIAYA_KAS_SPREADSHEET_ID;
  // Nilai terformat dipakai untuk tampilan; nilai mentah (tanggal serial &
  // nominal numerik) dipakai agar pencocokan receipt akurat. Indeks receipt
  // Drive dimuat paralel & toleran — bila gagal, daftar tetap tampil tanpa foto.
  const [rows, raws, rcIndex] = await Promise.all([
    readRange(id, `'${BIAYA_SHEET}'!A1:N`, "FORMATTED_VALUE"),
    readRange(id, `'${BIAYA_SHEET}'!A1:N`, "UNFORMATTED_VALUE"),
    receipt.loadIndex(),
  ]);
  const state = loadExported();

  // Baseline historis (sekali per versi): baris yang SUDAH VERIFIKASI OWNER dianggap
  // "sudah ditangani" (termasuk Setoran Owner lama yang status lapornya kosong).
  if ((state.seedVersion || 0) < SEED_VERSION) {
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i] || [];
      if (!norm(r[COL.keterangan])) continue;
      if (norm(r[COL.verifikasi]) === "SUDAH VERIFIKASI OWNER") {
        const k = rowKey(r);
        if (k) state.keys.add(k);
      }
    }
    state.seeded = true;
    state.seedVersion = SEED_VERSION;
    saveExported(state);
  }

  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (!norm(r[COL.keterangan])) continue; // baris kosong
    // Baris hanya boleh disembunyikan bila SUDAH "hijau penuh" (SUDAH INPUT DAN
    // SUDAH VERIFIKASI OWNER). Baris yang belum input / belum verifikasi SELALU
    // tampil — walau NOMOR-nya kebetulan sama dengan baris lama yang historis/
    // ter-export (NOMOR kolom A tidak unik & bisa berulang antar bulan).
    const hijauPenuh =
      norm(r[COL.status]) === "SUDAH INPUT" && norm(r[COL.verifikasi]) === "SUDAH VERIFIKASI OWNER";
    const k = rowKey(r);
    if (hijauPenuh && k && state.keys.has(k)) continue; // sudah di-export / historis -> sembunyikan

    // Receipt (foto bukti) di Drive: dicocokkan lewat OUTLET + TANGGAL + KETERANGAN + NOMINAL.
    const rr = raws[i] || [];
    const rawNom = rr[COL.nominal];
    const nominal = typeof rawNom === "number" ? rawNom : receipt.parseNominal(r[COL.nominal]);
    const rc = receipt.findIn(rcIndex, {
      outlet: norm(r[COL.outlet]),
      iso: rowDateISO(rr[COL.tanggal], r[COL.tanggal]),
      keterangan: norm(r[COL.keterangan]),
      nominal,
    });

    out.push({
      row: i + 1, // nomor baris di sheet
      cells: HEADERS.map((_, c) => (r[c] == null ? "" : String(r[c]))),
      status: norm(r[COL.status]),
      verifikasi: norm(r[COL.verifikasi]),
      kode: norm(r[COL.kode]),
      receipt: rc ? { id: rc.id, name: rc.name } : null,
    });
  }
  return {
    rows: out,
    headers: HEADERS,
    statusOptions: STATUS_OPTIONS,
    verifOptions: VERIF_OPTIONS,
    receiptCount: out.filter((r) => r.receipt).length,
    receiptTotal: rcIndex.count,
    receiptError: rcIndex.error,
  };
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

  const selected = [];
  for (const rn of rowNumbers) {
    const r = raw[Number(rn) - 1]; // 0-based
    if (!r || !norm(r[COL.keterangan])) continue;
    selected.push(r);
  }
  if (selected.length === 0) throw new Error("Tidak ada baris valid untuk diexport.");
  assertGreenReady(selected); // hanya baris bercentang hijau dua-duanya yang boleh diexport

  const values = selected.map((r) => {
    const tgl = r[COL.tanggal];
    const tglStr = typeof tgl === "number" ? isoToDDMMYYYY(serialToISO(tgl)) : norm(tgl);
    const nominal = r[COL.nominal];
    const kode = r[COL.kode];
    return [
      norm(r[COL.keterangan]), // B KETERANGAN
      typeof nominal === "number" ? nominal : Number(nominal) || norm(nominal), // C NOMINAL
      tglStr, // D TANGGAL
      norm(r[COL.outlet]), // E OUTLET
      norm(r[COL.status]), // F STATUS LAPOR APLIKASI SMARTLINK
      norm(r[COL.sumberDana]), // G SUMBER DANA
      kode == null || kode === "" ? "" : kode, // H KODE TRANSAKSI
    ];
  });

  const cashflow = await resolveCashflowSpreadsheetId();
  // Lokasi append: baris kosong terbawah (dicek live; aman thd pengisian manual).
  const colB = await readRange(cashflow.id, `'${INPUT_SHEET}'!B2:B`);
  let appendRow = 2;
  for (let i = 0; i < colB.length; i++) {
    if (colB[i] && colB[i][0]) appendRow = i + 3;
  }
  const endRow = appendRow + values.length - 1;
  await batchWrite(cashflow.id, [{ range: `'${INPUT_SHEET}'!B${appendRow}:H${endRow}`, values }]);

  // Tandai baris yang di-export agar hilang permanen dari daftar (apa pun status/verifikasinya).
  const state = loadExported();
  state.seeded = true;
  for (const r of selected) {
    const k = rowKey(r);
    if (k) state.keys.add(k);
  }
  saveExported(state);

  return { ok: true, sheet: INPUT_SHEET, barisAwal: appendRow, barisAkhir: endRow, jumlah: values.length };
}

/**
 * Tulis KETERANGAN KOREKSI (kolom N) sebagai alasan penolakan. Bila teks terisi,
 * VERIFIKASI OWNER (kolom M) otomatis di-set "SALAH INPUT".
 */
async function setKoreksi(row, text) {
  if (!Number.isInteger(row) || row < 2) throw new Error("Baris tidak valid.");
  const teks = text == null ? "" : String(text);
  const data = [{ range: `'${BIAYA_SHEET}'!N${row}`, values: [[teks]] }];
  let verifikasi = null;
  if (teks.trim()) {
    data.push({ range: `'${BIAYA_SHEET}'!M${row}`, values: [["SALAH INPUT"]] });
    verifikasi = "SALAH INPUT";
  }
  await batchWrite(cfg.BIAYA_KAS_SPREADSHEET_ID, data);
  return { ok: true, row, text: teks, verifikasi };
}

// ===================== KATEGORI BIAYA (sheet TRANSAKSI, ANALISA KEUANGAN) =====================
// Kolom K sheet TRANSAKSI berisi dropdown KATEGORI BIAYA. Pilihan dropdown dibaca
// LANGSUNG dari aturan validasi kolom itu (bukan disalin ke kode), sehingga bila
// user menambah/mengubah kategori di sheet, dashboard otomatis ikut.
const KATEGORI_COL = "K";
const KATEGORI_RULE_CELL = `'${ANALISA_SHEET}'!${KATEGORI_COL}2`; // sel pemilik aturan dropdown

function colToIndex(col) {
  let n = 0;
  for (const ch of String(col).toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1; // 0-based
}
function indexToCol(i) {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
/** "='KATEGORI BIAYA'!$A$2:$A" -> { sheet, col, row }. null bila tak dikenali. */
function parseRangeRef(ref) {
  const m = String(ref || "")
    .trim()
    .replace(/^=/, "")
    .replace(/\$/g, "")
    .match(/^(?:'((?:[^']|'')+)'|([^!']+))!([A-Z]+)(\d+)?(?::[A-Z]+\d*)?$/i);
  if (!m) return null;
  return { sheet: (m[1] || m[2]).replace(/''/g, "'"), col: m[3].toUpperCase(), row: Number(m[4] || 1) };
}
/** Kunci pencocokan keterangan: huruf kecil, spasi dirapatkan. */
function ketKey(s) {
  return norm(s).toLowerCase().replace(/\s+/g, " ");
}

/**
 * Pilihan dropdown KATEGORI BIAYA + aturan validasinya (untuk dipasang ke sel baru).
 * Mendukung dropdown dari rentang (ONE_OF_RANGE, mis. sheet KATEGORI BIAYA) maupun
 * daftar tetap (ONE_OF_LIST). Untuk rentang, kolom di sebelahnya (CAKUPAN) ikut
 * dibaca sebagai petunjuk.
 */
async function loadKategori() {
  const id = cfg.ANALISA_SPREADSHEET_ID;
  const rule = await getDataValidation(id, KATEGORI_RULE_CELL);
  if (!rule || !rule.condition) {
    throw new Error(`Kolom KATEGORI BIAYA (${KATEGORI_COL}) di sheet ${ANALISA_SHEET} belum memiliki dropdown.`);
  }
  const cond = rule.condition;
  let options = [];
  if (cond.type === "ONE_OF_LIST") {
    options = (cond.values || []).map((v) => ({ value: norm(v.userEnteredValue), hint: "" }));
  } else if (cond.type === "ONE_OF_RANGE") {
    const ref = parseRangeRef(cond.values && cond.values[0] && cond.values[0].userEnteredValue);
    if (!ref) throw new Error("Sumber dropdown KATEGORI BIAYA tidak dikenali.");
    const hintCol = indexToCol(colToIndex(ref.col) + 1);
    const rows = await readRange(id, `'${ref.sheet}'!${ref.col}${ref.row}:${hintCol}`);
    options = rows.map((r) => ({ value: norm(r && r[0]), hint: norm(r && r[1]) }));
  } else {
    throw new Error(`Jenis dropdown KATEGORI BIAYA (${cond.type}) belum didukung.`);
  }
  const seen = new Set();
  options = options.filter((o) => {
    if (!o.value || seen.has(o.value)) return false;
    seen.add(o.value);
    return true;
  });
  if (!options.length) throw new Error("Dropdown KATEGORI BIAYA tidak berisi pilihan.");
  return { options, rule };
}

/**
 * Saran kategori dari riwayat sheet TRANSAKSI: kategori yang paling sering dipakai
 * untuk KETERANGAN (kolom B) yang sama persis. Toleran: bila gagal, tanpa saran.
 */
async function kategoriSuggester(validValues) {
  const freq = new Map(); // ketKey -> Map(kategori -> jumlah)
  try {
    const kIdx = colToIndex(KATEGORI_COL) - 1; // rentang mulai kolom B
    const rows = await readRange(cfg.ANALISA_SPREADSHEET_ID, `'${ANALISA_SHEET}'!B2:${KATEGORI_COL}`);
    for (const r of rows) {
      const k = ketKey(r && r[0]);
      const kat = norm(r && r[kIdx]);
      if (!k || !kat || !validValues.has(kat)) continue;
      if (!freq.has(k)) freq.set(k, new Map());
      const m = freq.get(k);
      m.set(kat, (m.get(kat) || 0) + 1);
    }
  } catch {
    /* riwayat tak terbaca -> tanpa saran */
  }
  return (keterangan) => {
    const m = freq.get(ketKey(keterangan));
    if (!m) return "";
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
  };
}

/**
 * Pastikan sel KATEGORI BIAYA pada baris tujuan memakai dropdown yang sama dengan
 * aturan aslinya. Bila sudah ada (umumnya), tidak mengubah apa pun. Bila belum
 * (mis. sheet diperpanjang), aturan asli disalin ke sel tersebut.
 */
async function ensureKategoriDropdown(id, startRow, endRow, rule) {
  const cell = (r) => `'${ANALISA_SHEET}'!${KATEGORI_COL}${r}`;
  const sama = (x) => !!(x && x.condition && JSON.stringify(x.condition) === JSON.stringify(rule.condition));
  const awal = await getDataValidation(id, cell(startRow));
  const akhir = endRow === startRow ? awal : await getDataValidation(id, cell(endRow));
  if (sama(awal) && sama(akhir)) return false;

  const sheetId = await getSheetId(id, ANALISA_SHEET);
  const c = colToIndex(KATEGORI_COL);
  const range = { sheetId, startRowIndex: startRow - 1, endRowIndex: endRow, startColumnIndex: c, endColumnIndex: c + 1 };
  try {
    await batchUpdateRequests(id, [{ setDataValidation: { range, rule } }]);
  } catch {
    // Cadangan: setelan tampilan tertentu (mis. customUiMode) bisa ditolak saat
    // ditulis — pasang ulang dengan isi pokok aturannya saja.
    const { condition, inputMessage, strict, showCustomUi } = rule;
    await batchUpdateRequests(id, [{ setDataValidation: { range, rule: { condition, inputMessage, strict, showCustomUi } } }]);
  }
  return true;
}

/** Baris Setoran Owner terpilih (tervalidasi & hijau penuh) + jumlah baris non-Setoran yang dilewati. */
async function pickSetoranRows(rowNumbers) {
  if (!Array.isArray(rowNumbers) || rowNumbers.length === 0) throw new Error("Centang minimal satu baris untuk diexport.");
  const raw = await readRange(cfg.BIAYA_KAS_SPREADSHEET_ID, `'${BIAYA_SHEET}'!A1:N`, "UNFORMATTED_VALUE");
  const picked = [];
  let skipped = 0;
  for (const rn of rowNumbers) {
    const r = raw[Number(rn) - 1];
    if (!r || !norm(r[COL.keterangan])) continue;
    if (norm(r[COL.keterangan]).toLowerCase() !== "setoran owner") {
      skipped++;
      continue;
    }
    picked.push({ rowNum: Number(rn), r });
  }
  if (picked.length === 0) {
    throw new Error(
      "Tidak ada baris 'Setoran Owner' yang dicentang." + (skipped ? ` (${skipped} baris non-Setoran Owner dilewati)` : "")
    );
  }
  assertGreenReady(picked.map((p) => p.r)); // hanya baris bercentang hijau dua-duanya yang boleh diexport
  return { picked, skipped };
}

function setoranTanggal(r) {
  const tgl = r[COL.tanggal];
  return typeof tgl === "number" ? isoToDDMMYYYY(serialToISO(tgl)) : norm(tgl);
}
function setoranNominal(r) {
  const nominal = r[COL.nominal];
  return typeof nominal === "number" ? nominal : Number(nominal) || norm(nominal);
}

/**
 * Pratinjau export Setoran Owner: baris yang akan diexport + pilihan dropdown
 * KATEGORI BIAYA + saran kategori per baris (dari riwayat TRANSAKSI).
 */
async function setoranPreview(rowNumbers) {
  const { picked, skipped } = await pickSetoranRows(rowNumbers);
  const { options } = await loadKategori();
  const suggest = await kategoriSuggester(new Set(options.map((o) => o.value)));
  return {
    ok: true,
    options,
    skipped,
    rows: picked.map(({ rowNum, r }) => {
      const keterangan = tidyKeterangan(r[COL.ketPenggunaan]);
      return {
        row: rowNum,
        nomor: norm(r[COL.nomor]),
        keterangan,
        nominal: setoranNominal(r),
        tanggal: setoranTanggal(r),
        saran: suggest(keterangan),
      };
    }),
  };
}

/**
 * Export baris "Setoran Owner" terpilih ke sheet TRANSAKSI (ANALISA KEUANGAN).
 * Pemetaan: POS BIAYA="DAILY DRIVER", KETERANGAN PENGGUNAAN(H)→KETERANGAN(B),
 *   NOMINAL(D)→NOMINAL(C), TANGGAL(E)→TANGGAL(D), SUMBER DANA="PENDAPATAN USAHA";
 *   BIAYA BULAN/BUDGET BULAN=nama bulan saat export, TAHUN BIAYA/TAHUN BUDGET=tahun saat export.
 * Kolom J (Rekening) tidak disentuh. kategoriByRow = { <baris sheet BIAYA>: <KATEGORI BIAYA> }
 * (opsional per baris) ditulis ke kolom K sebagai PILIHAN DROPDOWN: nilainya wajib persis
 * salah satu pilihan dropdown, dan aturan dropdown dipasang ke sel tujuan.
 */
async function exportSetoranOwner(rowNumbers, kategoriByRow) {
  const { picked, skipped } = await pickSetoranRows(rowNumbers);
  const { year, month } = cfg.nowInBusinessTz();
  const monthName = cfg.MONTH_NAMES_ID[month - 1];

  // Kategori dipilih per baris; diperiksa SEBELUM menulis apa pun.
  const pilihan = kategoriByRow && typeof kategoriByRow === "object" ? kategoriByRow : {};
  const kategori = picked.map(({ rowNum }) => norm(pilihan[rowNum]));
  const adaKategori = kategori.some(Boolean);
  let kat = null;
  if (adaKategori) {
    kat = await loadKategori();
    const valid = new Set(kat.options.map((o) => o.value));
    const salah = kategori.filter((k) => k && !valid.has(k));
    if (salah.length) {
      throw new Error(
        `Kategori tidak ada di dropdown KATEGORI BIAYA: ${[...new Set(salah)].join(", ")}. ` +
          "Pilih ulang dari daftar (mungkin dropdown di sheet baru saja diubah)."
      );
    }
  }

  const values = picked.map(({ r }) => [
    "DAILY DRIVER", // A POS BIAYA
    tidyKeterangan(r[COL.ketPenggunaan]), // B KETERANGAN (dari KETERANGAN PENGGUNAAN, dirapikan)
    setoranNominal(r), // C NOMINAL
    setoranTanggal(r), // D TANGGAL
    monthName, // E BIAYA BULAN
    year, // F TAHUN BIAYA
    "PENDAPATAN USAHA", // G SUMBER DANA
    monthName, // H BUDGET BULAN
    year, // I TAHUN BUDGET
  ]);

  const analisaId = cfg.ANALISA_SPREADSHEET_ID;
  const colA = await readRange(analisaId, `'${ANALISA_SHEET}'!A2:A`);
  let appendRow = 2;
  for (let i = 0; i < colA.length; i++) {
    if (colA[i] && colA[i][0]) appendRow = i + 3;
  }
  const endRow = appendRow + values.length - 1;

  // Kategori ditulis sebagai PILIHAN DROPDOWN: dropdown dipastikan ada di sel tujuan
  // SEBELUM menulis apa pun (bila gagal, tidak ada yang tertulis), lalu nilainya —
  // yang persis sama dengan salah satu pilihan — ikut ditulis.
  let dropdownDipasang = false;
  if (adaKategori) dropdownDipasang = await ensureKategoriDropdown(analisaId, appendRow, endRow, kat.rule);

  // A:I dan K dalam SATU permintaan: masuk semua, atau tidak sama sekali.
  // Kolom J (Rekening) tidak disentuh.
  const data = [{ range: `'${ANALISA_SHEET}'!A${appendRow}:I${endRow}`, values }];
  if (adaKategori) {
    data.push({
      range: `'${ANALISA_SHEET}'!${KATEGORI_COL}${appendRow}:${KATEGORI_COL}${endRow}`,
      values: kategori.map((k) => [k]),
    });
  }
  await batchWrite(analisaId, data);
  const kategoriDiisi = kategori.filter(Boolean).length;

  // Catatan: baris TIDAK disembunyikan setelah export ini (berbeda dari export ke
  // INPUT PENGGUNAAN BIAYA) — sesuai permintaan, aturan sembunyi hanya untuk export tsb.
  return {
    ok: true, sheet: ANALISA_SHEET, barisAwal: appendRow, barisAkhir: endRow,
    jumlah: values.length, skipped, kategoriDiisi, dropdownDipasang,
  };
}

/** Sembunyikan baris (berdasarkan NOMOR) dengan menambahkannya ke daftar ter-export. */
function hide(nomors) {
  const state = loadExported();
  state.seeded = true;
  const want = (nomors || []).map((n) => String(n).trim()).filter(Boolean);
  let added = 0;
  for (const k of want) {
    if (!state.keys.has(k)) added++;
    state.keys.add(k);
  }
  saveExported(state);
  return { ok: true, hidden: added, nomors: want };
}

/** Munculkan kembali baris (berdasarkan NOMOR) dengan menghapusnya dari daftar ter-export. */
function restore(nomors) {
  const state = loadExported();
  const want = new Set((nomors || []).map((n) => String(n).trim()).filter(Boolean));
  let removed = 0;
  for (const k of Array.from(state.keys)) {
    if (want.has(k)) {
      state.keys.delete(k);
      removed++;
    }
  }
  saveExported(state);
  return { ok: true, removed, nomors: Array.from(want) };
}

module.exports = { list, setStatus, setKoreksi, exportRows, exportSetoranOwner, setoranPreview, loadKategori, hide, restore };
