"use strict";

const { sheetsClient, driveClient } = require("./google");
const cfg = require("./config");

/** Baca satu range. render: "FORMATTED_VALUE" | "UNFORMATTED_VALUE" */
async function readRange(spreadsheetId, range, render = "FORMATTED_VALUE") {
  const sheets = sheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: render,
  });
  return res.data.values || [];
}

/** Tulis banyak range sekaligus (USER_ENTERED agar tanggal/angka diparse Sheets). */
async function batchWrite(spreadsheetId, data) {
  const sheets = sheetsClient();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: data.map((d) => ({ range: d.range, values: d.values })),
    },
  });
}

/** Daftar judul sheet dalam sebuah spreadsheet. */
async function getSheetTitles(spreadsheetId) {
  const sheets = sheetsClient();
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "properties.title,sheets.properties.title",
  });
  return {
    title: res.data.properties.title,
    sheets: res.data.sheets.map((s) => s.properties.title),
  };
}

/** sheetId numerik (gid) untuk satu judul sheet. Null bila tak ada. */
async function getSheetId(spreadsheetId, title) {
  const sheets = sheetsClient();
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(sheetId,title)",
  });
  const found = (res.data.sheets || []).find((s) => s.properties.title === title);
  return found ? found.properties.sheetId : null;
}

/** Jalankan permintaan batchUpdate (mis. copyPaste formula). */
async function batchUpdateRequests(spreadsheetId, requests) {
  const sheets = sheetsClient();
  await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
}

/** Cari ID spreadsheet berdasarkan judul persis (di Drive, termasuk shared drive). */
async function findSpreadsheetIdByTitle(title) {
  const drive = driveClient();
  const res = await drive.files.list({
    q: `name = '${String(title).replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
    fields: "files(id, name)",
    pageSize: 5,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return ((res.data.files || [])[0] || {}).id || null;
}

/**
 * Resolusi spreadsheet CASHFLOW bulan berjalan.
 * Urutan: env CASHFLOW_SPREADSHEET_ID → override manual (berlaku untuk bulan
 * yang sama) → hasil auto-discovery tersimpan → pencarian Drive berdasarkan
 * judul "CASHFLOW DAN BIAYA <BULAN> <TAHUN>".
 */
async function resolveCashflowSpreadsheetId() {
  if (process.env.CASHFLOW_SPREADSHEET_ID) {
    return { id: process.env.CASHFLOW_SPREADSHEET_ID, source: "env" };
  }
  const monthKey = cfg.currentMonthKey();
  const stored = cfg.getStoredConfig();

  if (stored.cashflowOverride && stored.cashflowOverride.monthKey === monthKey) {
    return { id: stored.cashflowOverride.id, source: "manual", monthKey };
  }
  if (stored.cashflowAuto && stored.cashflowAuto.monthKey === monthKey) {
    return { id: stored.cashflowAuto.id, source: "auto-cache", monthKey };
  }

  const expectedTitle = `CASHFLOW DAN BIAYA ${monthKey}`;
  const foundId = await findSpreadsheetIdByTitle(expectedTitle);
  if (!foundId) {
    const err = new Error(
      `Spreadsheet "${expectedTitle}" tidak ditemukan. Pastikan file sudah dibagikan ke service account, ` +
        `atau masukkan link spreadsheet bulan ini lewat menu Pengaturan.`
    );
    err.code = "CASHFLOW_NOT_FOUND";
    throw err;
  }
  stored.cashflowAuto = { id: foundId, monthKey, title: expectedTitle };
  cfg.saveStoredConfig(stored);
  return { id: foundId, source: "auto-discovery", monthKey, title: expectedTitle };
}

/** Simpan override manual link CASHFLOW untuk bulan berjalan. */
function setCashflowOverride(spreadsheetId) {
  const stored = cfg.getStoredConfig();
  stored.cashflowOverride = { id: spreadsheetId, monthKey: cfg.currentMonthKey() };
  cfg.saveStoredConfig(stored);
}

module.exports = {
  readRange,
  batchWrite,
  getSheetTitles,
  getSheetId,
  batchUpdateRequests,
  resolveCashflowSpreadsheetId,
  setCashflowOverride,
  findSpreadsheetIdByTitle,
};
