"use strict";

require("dotenv").config();

const express = require("express");
const multer = require("multer");
const path = require("path");

const cfg = require("./src/config");
const { readRange, resolveCashflowSpreadsheetId, setCashflowOverride, getSheetTitles } = require("./src/sheets");
const { serviceAccountEmail } = require("./src/google");
const { runDailySync, inspectRekapBlocks } = require("./src/sync");
const biaya = require("./src/biaya");
const kas = require("./src/kas");
const qris = require("./src/qris");
const qrisbank = require("./src/qrisbank");
const monbiaya = require("./src/monbiaya");
const moninput = require("./src/moninput");
const riwayat = require("./src/riwayat");
const daftarbiaya = require("./src/daftarbiaya");
const deposit = require("./src/deposit");
const aliran = require("./src/aliran");
const setoran = require("./src/setoran");
const transaksi = require("./src/transaksi");
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

// Logo bisa diakses tanpa login (dipakai di halaman login & dashboard).
// Salin file logo ke public/logo.jpeg. Bila belum ada → 404 (tampilan jatuh ke ikon ◍).
app.get("/logo.jpeg", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "logo.jpeg"), (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

// Aset PWA (installable lewat Chrome) — dapat diakses tanpa login.
const sendPublic = (file, type) => (req, res) => {
  if (type) res.type(type);
  res.sendFile(path.join(__dirname, "public", file), (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
};
app.get("/manifest.webmanifest", sendPublic("manifest.webmanifest", "application/manifest+json"));
app.get("/sw.js", sendPublic("sw.js", "application/javascript"));
app.get("/icon.svg", sendPublic("icon.svg", "image/svg+xml"));
app.get("/icon-maskable.svg", sendPublic("icon-maskable.svg", "image/svg+xml"));

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

// Upload dokumen (xlsx/xls/csv) untuk import data transaksi.
const uploadDoc = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
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
  let pendapatanRows = [];
  let kontrolRows = [];
  let cashflowError = null;
  try {
    const cashflow = await resolveCashflowSpreadsheetId();
    ilhRows = await readRange(cashflow.id, `'INPUT LAPORAN HARIAN'!A1:C25`);
    pendapatanRows = await readRange(cashflow.id, `'MONITORING PENDAPATAN'!A1:C9`);
    kontrolRows = await readRange(cashflow.id, `'KONTROL KAS'!A1:B33`);
  } catch (e) {
    cashflowError = e.message;
  }
  res.json({
    ok: true,
    kas: kasRows,
    laporanHarian: ilhRows,
    pendapatan: pendapatanRows,
    kontrolKas: kontrolRows,
    cashflowError,
    today: cfg.todaySheetDate(),
    lastSync: cfg.getLastSync(),
  });
}));

// ---------- Tombol update harian ----------

app.post("/api/sync", wrap(async (req, res) => {
  const result = await runDailySync();
  res.json(result);
}));

// ---------- Diagnostik baris blok bulan pada sheet REKAP ----------

app.get("/api/rekap/blocks", wrap(async (req, res) => {
  res.json(await inspectRekapBlocks());
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

// ---------- Monitoring biaya (sheet BIAYA) ----------

app.get("/api/monbiaya/list", wrap(async (req, res) => {
  res.json({ ok: true, ...(await monbiaya.list()) });
}));

app.post("/api/monbiaya/status", wrap(async (req, res) => {
  const { row, field, value } = req.body || {};
  res.json(await monbiaya.setStatus(Number(row), field, value));
}));

app.post("/api/monbiaya/export", wrap(async (req, res) => {
  res.json(await monbiaya.exportRows((req.body || {}).rows || []));
}));

app.post("/api/monbiaya/unhide", wrap(async (req, res) => {
  res.json(monbiaya.restore((req.body || {}).nomors || []));
}));

app.post("/api/monbiaya/hide", wrap(async (req, res) => {
  res.json(monbiaya.hide((req.body || {}).nomors || []));
}));

// ---------- Monitoring biaya BELUM INPUT (sheet INPUT PENGGUNAAN BIAYA, CASHFLOW) ----------

app.get("/api/moninput/list", wrap(async (req, res) => {
  res.json({ ok: true, ...(await moninput.list()) });
}));

app.post("/api/moninput/status", wrap(async (req, res) => {
  const { row, value } = req.body || {};
  res.json(await moninput.setStatus(Number(row), value));
}));

app.post("/api/moninput/edit", wrap(async (req, res) => {
  const { row, keterangan, nominal, tanggalIso, sumberDana } = req.body || {};
  res.json(await moninput.saveEdit(Number(row), { keterangan, nominal, tanggalIso, sumberDana }));
}));

app.post("/api/moninput/hide", wrap(async (req, res) => {
  res.json(moninput.hide((req.body || {}).rows || []));
}));

app.post("/api/moninput/unhide", wrap(async (req, res) => {
  res.json(moninput.restore((req.body || {}).rows || []));
}));

// ---------- Riwayat biaya per bulan (sheet INPUT PENGGUNAAN BIAYA) ----------

app.get("/api/riwayat-biaya", wrap(async (req, res) => {
  const year = Number(req.query.year);
  const month = Number(req.query.month);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return res.status(400).json({ ok: false, error: "Bulan/tahun tidak valid." });
  }
  res.json({ ok: true, ...(await riwayat.list(year, month)) });
}));

// ---------- Input subjek biaya baru (sheet DAFTAR BIAYA, BIAYA & KAS) ----------

app.get("/api/daftarbiaya/options", wrap(async (req, res) => {
  res.json({ ok: true, ...(await daftarbiaya.options()) });
}));

app.post("/api/daftarbiaya/submit", wrap(async (req, res) => {
  res.json(await daftarbiaya.submit(req.body || {}));
}));

// ---------- Aliran kas per outlet (sheet REKAP KAS DAN TRANSAKSI) ----------

app.get("/api/aliran", wrap(async (req, res) => {
  const outlet = String(req.query.outlet || "");
  const year = Number(req.query.year);
  const month = Number(req.query.month);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return res.status(400).json({ ok: false, error: "Bulan/tahun tidak valid." });
  }
  res.json(await aliran.list(outlet, year, month));
}));

// ---------- Deposit pelanggan (sheet DEPOSIT, BIAYA & KAS) ----------

app.get("/api/deposit/summary", wrap(async (req, res) => {
  res.json({ ok: true, ...(await deposit.summary()) });
}));

app.post("/api/deposit/submit", wrap(async (req, res) => {
  res.json(await deposit.submit(req.body || {}));
}));

// ---------- Input setoran kas (sheet REKAP, baris SETORAN KAS) ----------

app.post("/api/setoran/submit", wrap(async (req, res) => {
  res.json(await setoran.submit(req.body || {}));
}));

// ---------- Upload data transaksi (sheet DAFTAR PELUNASAN bulan berjalan) ----------

app.post("/api/transaksi/analyze", uploadDoc.single("file"), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: "Upload file ekspor transaksi (.xlsx)." });
  res.json({ ok: true, ...(await transaksi.analyze(req.file.buffer)) });
}));

app.post("/api/transaksi/submit", uploadDoc.single("file"), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: "Upload file ekspor transaksi (.xlsx)." });
  res.json(await transaksi.submit(req.file.buffer, (req.body || {}).sheet || ""));
}));

app.post("/api/monbiaya/koreksi", wrap(async (req, res) => {
  const { row, text } = req.body || {};
  res.json(await monbiaya.setKoreksi(Number(row), text));
}));

app.post("/api/monbiaya/export-setoran", wrap(async (req, res) => {
  res.json(await monbiaya.exportSetoranOwner((req.body || {}).rows || []));
}));

// ---------- Start ----------

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Dashboard Cashflow Laundry berjalan di http://localhost:${PORT}`);
  console.log(`Zona waktu bisnis: ${cfg.TIMEZONE} | Hari ini: ${cfg.todaySheetDate()} | Model AI: ${MODEL}`);
});
