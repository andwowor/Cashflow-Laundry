"use strict";

require("dotenv").config();

const express = require("express");
const multer = require("multer");
const path = require("path");

const cfg = require("./src/config");
const { readRange, resolveCashflowSpreadsheetId, setCashflowOverride, getSheetTitles } = require("./src/sheets");
const { serviceAccountEmail } = require("./src/google");
const { runDailySync } = require("./src/sync");
const biaya = require("./src/biaya");
const kas = require("./src/kas");
const qris = require("./src/qris");
const qrisbank = require("./src/qrisbank");
const { MODEL } = require("./src/claude");
const auth = require("./src/auth");

const app = express();
app.set("trust proxy", 1); // hormati X-Forwarded-Proto di belakang proxy hosting (Render dsb.)
app.use(express.json({ limit: "2mb" }));

// ---------- Autentikasi (sebelum route lain) ----------

app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));

app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!auth.isConfigured()) {
    return res.status(503).json({
      ok: false,
      error: "Login belum dikonfigurasi. Set DASHBOARD_PASSWORD di environment/.env lalu restart.",
    });
  }
  if (!auth.checkCredentials(username, password)) {
    return res.status(401).json({ ok: false, error: "Username atau password salah." });
  }
  auth.setAuthCookie(req, res);
  res.json({ ok: true });
});

app.post("/api/logout", (req, res) => {
  auth.clearAuthCookie(res);
  res.json({ ok: true });
});

// Semua route di bawah ini wajib login.
app.use(auth.requireAuth);
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 30 },
  fileFilter: (req, file, cb) => {
    const ok = ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.mimetype);
    cb(ok ? null : new Error("Format gambar harus PNG/JPEG/WebP/GIF."), ok);
  },
});

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message || String(err) });
  });

// ---------- Status & pengaturan ----------

app.get("/api/status", wrap(async (req, res) => {
  const email = await serviceAccountEmail();
  let cashflow = null;
  let cashflowError = null;
  try {
    const resolved = await resolveCashflowSpreadsheetId();
    const meta = await getSheetTitles(resolved.id);
    cashflow = { ...resolved, title: meta.title };
  } catch (e) {
    cashflowError = e.message;
  }
  res.json({
    ok: true,
    model: MODEL,
    timezone: cfg.TIMEZONE,
    today: cfg.todaySheetDate(),
    monthKey: cfg.currentMonthKey(),
    serviceAccountEmail: email,
    biayaKasSpreadsheetId: cfg.BIAYA_KAS_SPREADSHEET_ID,
    cashflow,
    cashflowError,
  });
}));

app.post("/api/config/cashflow", wrap(async (req, res) => {
  const id = cfg.parseSpreadsheetId(req.body && req.body.link);
  if (!id) return res.status(400).json({ ok: false, error: "Link/ID spreadsheet tidak valid." });
  const meta = await getSheetTitles(id); // verifikasi akses sebelum disimpan
  setCashflowOverride(id);
  res.json({ ok: true, id, title: meta.title, monthKey: cfg.currentMonthKey() });
}));

// ---------- Monitoring ----------

app.get("/api/dashboard", wrap(async (req, res) => {
  const kasRows = await readRange(cfg.BIAYA_KAS_SPREADSHEET_ID, `'KAS'!A1:D15`);
  let ilhRows = [];
  let cashflowError = null;
  try {
    const cashflow = await resolveCashflowSpreadsheetId();
    ilhRows = await readRange(cashflow.id, `'INPUT LAPORAN HARIAN'!A1:C25`);
  } catch (e) {
    cashflowError = e.message;
  }
  res.json({ ok: true, kas: kasRows, laporanHarian: ilhRows, cashflowError, today: cfg.todaySheetDate() });
}));

// ---------- Tombol update harian ----------

app.post("/api/sync", wrap(async (req, res) => {
  const result = await runDailySync();
  res.json(result);
}));

// ---------- Input biaya ----------

app.get("/api/biaya/options", wrap(async (req, res) => {
  res.json({ ok: true, ...(await biaya.getOptions()) });
}));

app.get("/api/biaya/history", wrap(async (req, res) => {
  res.json({ ok: true, history: await biaya.getHistory(30) });
}));

app.post("/api/biaya/analyze", upload.array("files", 30), wrap(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ ok: false, error: "Upload minimal satu screenshot/bukti transfer." });
  }
  const entries = await biaya.analyze(req.files);
  res.json({ ok: true, entries, fileCount: req.files.length });
}));

app.post("/api/biaya/submit", wrap(async (req, res) => {
  const { rows, aiSuggestions } = req.body || {};
  res.json(await biaya.submit(rows, aiSuggestions));
}));

// ---------- Input kas (bank, aplikasi outlet, bank aplikasi, belum settlement) ----------

app.post("/api/kas/analyze", upload.array("files", 10), wrap(async (req, res) => {
  const jenis = req.body && req.body.jenis;
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ ok: false, error: "Upload minimal satu screenshot." });
  }
  const items = await kas.analyze(jenis, req.files);
  res.json({ ok: true, jenis, items });
}));

app.post("/api/kas/submit", wrap(async (req, res) => {
  const { jenis, items } = req.body || {};
  res.json(await kas.submit(jenis, items));
}));

// ---------- Input pendapatan EDC harian (sheet INPUT QRIS) ----------

app.post("/api/qris/analyze", upload.array("files", 10), wrap(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ ok: false, error: "Upload minimal satu screenshot." });
  }
  res.json({ ok: true, entries: await qris.analyze(req.files) });
}));

app.post("/api/qris/submit", wrap(async (req, res) => {
  res.json(await qris.submit((req.body || {}).rows));
}));

// ---------- Input transfer masuk dana EDC (sheet DATA QRIS) ----------

app.post("/api/qrisbank/analyze", upload.array("files", 10), wrap(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ ok: false, error: "Upload minimal satu screenshot." });
  }
  res.json({ ok: true, ...(await qrisbank.analyze(req.files)) });
}));

app.post("/api/qrisbank/submit", wrap(async (req, res) => {
  res.json(await qrisbank.submit((req.body || {}).entries));
}));

// ---------- Start ----------

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Dashboard Cashflow Laundry berjalan di http://localhost:${PORT}`);
  console.log(`Zona waktu bisnis: ${cfg.TIMEZONE} | Hari ini: ${cfg.todaySheetDate()} | Model AI: ${MODEL}`);
});
