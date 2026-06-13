"use strict";

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");

const MONTH_NAMES_ID = [
  "JANUARI", "FEBRUARI", "MARET", "APRIL", "MEI", "JUNI",
  "JULI", "AGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DESEMBER",
];

const TIMEZONE = process.env.TZ_NAME || "Asia/Makassar"; // WITA — Manado

const BIAYA_KAS_SPREADSHEET_ID =
  process.env.BIAYA_KAS_SPREADSHEET_ID ||
  "17FSDZKdYnn3yl08lWDfTZaQZ-x2AhXn493HhVnfAZlY";

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJsonFile(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonFile(file, obj) {
  ensureDataDir();
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

function getStoredConfig() {
  return readJsonFile(CONFIG_FILE, {});
}

function saveStoredConfig(cfg) {
  writeJsonFile(CONFIG_FILE, cfg);
}

/** Tanggal "sekarang" pada zona waktu bisnis (default WITA). */
function nowInBusinessTz() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month), // 1-12
    day: Number(parts.day),
  };
}

/** Kunci bulan berjalan, mis. "JUNI 2026". */
function currentMonthKey() {
  const { year, month } = nowInBusinessTz();
  return `${MONTH_NAMES_ID[month - 1]} ${year}`;
}

/** Format tanggal untuk ditulis ke sheet (locale Indonesia): dd/mm/yyyy. */
function todaySheetDate() {
  const { year, month, day } = nowInBusinessTz();
  const dd = String(day).padStart(2, "0");
  const mm = String(month).padStart(2, "0");
  return `${dd}/${mm}/${year}`;
}

/** Ekstrak spreadsheet ID dari link Google Sheets atau terima ID mentah. */
function parseSpreadsheetId(input) {
  if (!input) return null;
  const m = String(input).match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(input.trim())) return input.trim();
  return null;
}

module.exports = {
  MONTH_NAMES_ID,
  TIMEZONE,
  BIAYA_KAS_SPREADSHEET_ID,
  CONFIG_FILE,
  DATA_DIR,
  getStoredConfig,
  saveStoredConfig,
  readJsonFile,
  writeJsonFile,
  nowInBusinessTz,
  currentMonthKey,
  todaySheetDate,
  parseSpreadsheetId,
};
