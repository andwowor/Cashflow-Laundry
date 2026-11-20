"use strict";

// Menu "Proyeksi Biaya": tampilkan seluruh isi sheet PROYEKSI BIAYA pada
// spreadsheet CASHFLOW DAN BIAYA bulan berjalan, dan izinkan mengedit angka di
// kolom bulan berjalan (mis. NOVEMBER) — KECUALI sel yang otomatis (formula atau
// hasil luapan rumus array). Perubahan ditulis langsung ke spreadsheet.
//
// Struktur sheet (CASHFLOW NOVEMBER 2026):
//   baris 1 = judul "BIAYA"; baris 2 = kelompok outlet (MAUMBI B:G, PERKAMIL H:M,
//   sel digabung); baris 3 = sub-judul OKTOBER | NOVEMBER | AKUMULASI NOVEMBER |
//   START DESEMBER | LOKASI | KET; baris 4.. = SUBJEK biaya; baris TOTAL = SUM.
//   OKTOBER = IMPORTRANGE dari spreadsheet bulan lalu, AKUMULASI = SUMIFS dari
//   INPUT PENGGUNAAN BIAYA, sebagian NOVEMBER/START DESEMBER merujuk sheet
//   KEBUTUHAN AWAL BULAN / GAJI BULAN DEPAN / MONITORING PENDAPATAN.
//
// Spreadsheet berganti tiap bulan, jadi TIDAK ada nomor baris/kolom yang
// dikunci: kolom yang boleh diedit dicari ulang setiap kali (judul = nama bulan
// spreadsheet), dan setiap penyimpanan memvalidasi ulang sel di spreadsheet
// (ID spreadsheet, SUBJEK baris, bukan formula, nilai lama belum berubah).

const cfg = require("./config");
const { sheetsClient } = require("./google");
const { resolveCashflowSpreadsheetId, batchWrite } = require("./sheets");

const SHEET = "PROYEKSI BIAYA";
const MAX_ABS = 1e12;

function colLetter(idx) {
  let s = "";
  let n = idx + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function norm(v) {
  return String(v == null ? "" : v).replace(/\s+/g, " ").trim().toUpperCase();
}

/** Nama bulan spreadsheet: dari judulnya ("CASHFLOW DAN BIAYA NOVEMBER 2026"), cadangan = bulan berjalan. */
function monthNameOf(title) {
  const t = norm(title);
  const found = cfg.MONTH_NAMES_ID.find((m) => new RegExp(`(^|\\W)${m}(\\W|$)`).test(t));
  return found || cfg.currentMonthKey().split(" ")[0];
}

function cellKind(c) {
  if (!c) return "";
  const uev = c.userEnteredValue;
  if (uev && uev.formulaValue != null) return "formula";
  // Tak ada isian tapi ada nilai efektif → luapan rumus array (mis. IMPORTRANGE).
  if (!uev && c.effectiveValue) return "auto";
  return "";
}

/** Baca sheet lengkap dan susun model tabel untuk dashboard. */
async function load() {
  const resolved = await resolveCashflowSpreadsheetId();
  const spreadsheetId = resolved.id;
  const sheets = sheetsClient();
  let res;
  try {
    res = await sheets.spreadsheets.get({
      spreadsheetId,
      ranges: [`'${SHEET}'`],
      includeGridData: true,
      fields: [
        "properties.title",
        "sheets.properties.sheetId",
        "sheets.properties.title",
        "sheets.properties.gridProperties",
        "sheets.merges",
        "sheets.data.startRow",
        "sheets.data.startColumn",
        "sheets.data.rowData.values.userEnteredValue",
        "sheets.data.rowData.values.effectiveValue",
        "sheets.data.rowData.values.formattedValue",
      ].join(","),
    });
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (/Unable to parse range/i.test(msg)) {
      const err = new Error(`Sheet "${SHEET}" tidak ditemukan di spreadsheet CASHFLOW bulan ini.`);
      err.code = "NO_SHEET";
      throw err;
    }
    throw e;
  }
  const title = (res.data.properties && res.data.properties.title) || "";
  const sh = (res.data.sheets || [])[0];
  if (!sh) throw new Error(`Sheet "${SHEET}" tidak ditemukan di ${title || "spreadsheet CASHFLOW"}.`);
  const props = sh.properties || {};
  const data = (sh.data || [])[0] || {};
  const r0 = data.startRow || 0;
  const c0 = data.startColumn || 0;

  // Grid mentah (indeks 0 = baris/kolom pertama sheet).
  const raw = [];
  (data.rowData || []).forEach((rd, i) => {
    raw[r0 + i] = [];
    (rd.values || []).forEach((v, j) => (raw[r0 + i][c0 + j] = v));
  });

  // Rentang terpakai: baris/kolom terakhir yang berisi sesuatu (atau tercakup sel gabungan).
  let lastRow = -1;
  let lastCol = -1;
  raw.forEach((row, r) => {
    (row || []).forEach((c, k) => {
      if (!c) return;
      if ((c.formattedValue != null && c.formattedValue !== "") || c.userEnteredValue) {
        if (r > lastRow) lastRow = r;
        if (k > lastCol) lastCol = k;
      }
    });
  });
  const merges = (sh.merges || [])
    .map((m) => ({
      r: m.startRowIndex || 0,
      c: m.startColumnIndex || 0,
      rs: (m.endRowIndex || 0) - (m.startRowIndex || 0),
      cs: (m.endColumnIndex || 0) - (m.startColumnIndex || 0),
    }))
    .filter((m) => m.rs > 0 && m.cs > 0 && m.r <= lastRow && m.c <= lastCol)
    .map((m) => ({ ...m, rs: Math.min(m.rs, lastRow - m.r + 1), cs: Math.min(m.cs, lastCol - m.c + 1) }));

  // Baris judul kolom = baris (di 10 baris teratas) yang memuat nama bulan persis.
  const monthName = monthNameOf(title);
  let headerRow = -1;
  for (let r = 0; r <= Math.min(lastRow, 9) && headerRow < 0; r++) {
    if ((raw[r] || []).some((c) => c && norm(c.formattedValue) === monthName)) headerRow = r;
  }

  // Nama kelompok (outlet) untuk kolom k: sel gabungan / sel terisi terdekat di kiri pada baris di atas judul.
  function groupOf(k) {
    if (headerRow < 1) return "";
    const gr = headerRow - 1;
    const m = merges.find((x) => x.r <= gr && gr < x.r + x.rs && x.c <= k && k < x.c + x.cs);
    if (m) return String(((raw[m.r] || [])[m.c] || {}).formattedValue || "").trim();
    for (let j = k; j >= 1; j--) {
      const v = String(((raw[gr] || [])[j] || {}).formattedValue || "").trim();
      if (v) return v;
    }
    return "";
  }

  const editCols = [];
  if (headerRow >= 0) {
    for (let k = 0; k <= lastCol; k++) {
      const h = ((raw[headerRow] || [])[k] || {}).formattedValue;
      if (norm(h) === monthName) editCols.push({ col: k, letter: colLetter(k), group: groupOf(k), header: String(h).trim() });
    }
  }
  const editSet = new Set(editCols.map((e) => e.col));

  const rows = [];
  for (let r = 0; r <= lastRow; r++) {
    const out = [];
    const label = String(((raw[r] || [])[0] || {}).formattedValue || "").trim();
    for (let k = 0; k <= lastCol; k++) {
      const c = (raw[r] || [])[k];
      const cell = { v: (c && c.formattedValue) || "" };
      const kind = cellKind(c);
      const ev = c && c.effectiveValue;
      if (ev && typeof ev.numberValue === "number") cell.n = ev.numberValue;
      if (kind === "formula") {
        cell.k = "f";
        cell.fx = c.userEnteredValue.formulaValue;
      } else if (kind === "auto") cell.k = "a";
      if (ev && ev.errorValue) cell.err = ev.errorValue.message || ev.errorValue.type || "error";
      if (editSet.has(k) && r > headerRow && label && !kind) {
        // Hanya angka atau sel kosong yang boleh diedit (teks dibiarkan).
        const uev = c && c.userEnteredValue;
        if (!uev || uev.numberValue != null) cell.e = 1;
      }
      out.push(cell);
    }
    rows.push(out);
  }

  return {
    spreadsheet: { id: spreadsheetId, title, url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${props.sheetId}` },
    sheet: props.title || SHEET,
    monthName,
    headerRow: headerRow + 1, // 1-based (0 = tidak ditemukan)
    frozenRows: (props.gridProperties || {}).frozenRowCount || 0,
    frozenCols: (props.gridProperties || {}).frozenColumnCount || 0,
    lastRow: lastRow + 1,
    lastCol: lastCol + 1,
    merges,
    editCols,
    rows,
    loadedAt: cfg.formatBusinessDateTime(new Date()),
  };
}

/** "1.250.000", "Rp 1.250.000", "1250000", "-50.000", "12,5" → angka. "" → null (kosongkan sel). */
function parseNominal(v) {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  let s = String(v).replace(/rp/gi, "").replace(/\s+/g, "");
  if (s === "") return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.startsWith("-")) { neg = !neg; s = s.slice(1); }
  if (!/^\d{1,3}(\.\d{3})*(,\d+)?$|^\d+(,\d+)?$/.test(s)) return NaN;
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return neg ? -n : n;
}

function httpError(status, message, extra) {
  const err = new Error(message);
  err.status = status;
  Object.assign(err, extra || {});
  return err;
}

let queue = Promise.resolve();

/**
 * Simpan satu sel. body: { row, col (1-based), nilai, lama, label, token }.
 * lama = nilai angka yang terlihat di dashboard (null bila kosong); bila nilai di
 * spreadsheet sudah berubah sejak dimuat, penyimpanan ditolak (409) agar tidak menimpa.
 */
function save(body) {
  const run = queue.then(() => doSave(body || {}));
  queue = run.catch(() => {});
  return run;
}

async function doSave(body) {
  const row = Number(body.row);
  const col = Number(body.col);
  if (!Number.isInteger(row) || !Number.isInteger(col) || row < 1 || col < 1) {
    throw httpError(400, "Posisi sel tidak valid.");
  }
  const nilai = parseNominal(body.nilai);
  if (Number.isNaN(nilai)) throw httpError(400, "Nominal tidak valid. Tulis angka saja, mis. 1.250.000");
  if (nilai != null && Math.abs(nilai) >= MAX_ABS) throw httpError(400, "Nominal terlalu besar.");

  const data = await load();
  if (body.token && body.token !== data.spreadsheet.id) {
    throw httpError(409, "Spreadsheet CASHFLOW bulan ini sudah berganti. Tabel dimuat ulang — silakan ulangi.", { data });
  }
  const ec = data.editCols.find((e) => e.col === col - 1);
  if (!ec) throw httpError(400, `Hanya kolom ${data.monthName} yang bisa diedit.`, { data });
  const cells = data.rows[row - 1];
  const cell = cells && cells[col - 1];
  const label = cells ? String(cells[0].v || "").trim() : "";
  if (!cell || row <= data.headerRow || !label) throw httpError(400, "Sel ini tidak bisa diedit.", { data });
  if (body.label != null && String(body.label).trim() !== label) {
    throw httpError(409, "Susunan baris di spreadsheet berubah. Tabel dimuat ulang — silakan ulangi.", { data });
  }
  if (cell.k === "f" || cell.k === "a") {
    throw httpError(400, "Sel ini otomatis dari formula, tidak bisa diedit.", { data });
  }
  if (!cell.e) throw httpError(400, "Sel ini tidak bisa diedit.", { data });

  const now = typeof cell.n === "number" ? cell.n : null;
  if (body.lama !== undefined) {
    const lama = body.lama === null || body.lama === "" ? null : Number(body.lama);
    const same = (now == null && lama == null) || (now != null && lama != null && Math.abs(now - lama) < 1e-9);
    if (!same) {
      throw httpError(
        409,
        `Nilai di spreadsheet sudah berubah menjadi ${cell.v || "(kosong)"} sejak tabel dimuat. Tabel dimuat ulang — silakan cek lalu ulangi.`,
        { data }
      );
    }
  }

  const a1 = `${colLetter(col - 1)}${row}`;
  const unchanged = (now == null && nilai == null) || (now != null && nilai != null && Math.abs(now - nilai) < 1e-9);
  if (!unchanged) {
    await batchWrite(data.spreadsheet.id, [{ range: `'${SHEET}'!${a1}`, values: [[nilai == null ? "" : nilai]] }]);
  }
  const fresh = unchanged ? data : await load();
  const after = fresh.rows[row - 1] && fresh.rows[row - 1][col - 1];
  return {
    ok: true,
    saved: { row, col, a1, label, group: ec.group, header: ec.header, lama: cell.v || "", baru: (after && after.v) || "", unchanged },
    data: fresh,
  };
}

module.exports = { load, save, parseNominal, colLetter, monthNameOf, SHEET };
