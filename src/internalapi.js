"use strict";

const fs = require("fs");
const path = require("path");
const cfg = require("./config");

// Penghubung ke backend Dashboard Internal Co Clean Laundry
// (https://internal-co-clean-laundry.andwowor.workers.dev → Google Apps Script).
//
// Sub menu "Upload Transaksi Harian" memanggil fungsi backend yang SAMA dengan
// menu di dashboard internal (action "uploadTransaksi" & "getTransaksiInfo"),
// sehingga hasilnya identik: file .xlsx dibaca & ditulis ke sheet TRANSAKSI
// HARIAN oleh kode yang sama, termasuk aturan pembacaan nota yang terus
// diperbarui di sana.
//
// Login memakai akun Owner/Manajer dashboard internal. Yang disimpan hanya
// TOKEN sesi (berlaku 30 hari) di data/internal_sesi.json — kata sandi tidak
// pernah disimpan.

// URL Web App yang sama dengan public/js/config.js milik dashboard internal.
const DEFAULT_API_URL =
  "https://script.google.com/macros/s/AKfycbxa09rkWJ2aG-5TgPVw7DkjX5kGSdhSediltQB7HrmMmnXE3Ps9w6-rX5wIpD0SmFPY/exec";
const SESI_FILE = path.join(cfg.DATA_DIR, "internal_sesi.json");
const TOKEN_TTL_DAYS = 30; // sama dengan TOKEN_TTL_DAYS di backend internal
const ROLE_UPLOAD = ["OWNER", "MANAJER"];

function apiUrl() {
  return (process.env.INTERNAL_API_URL || DEFAULT_API_URL).trim();
}

function loadSesi() {
  try {
    const d = JSON.parse(fs.readFileSync(SESI_FILE, "utf8"));
    if (d && d.token && d.user) return d;
  } catch {
    /* belum login */
  }
  return null;
}

function saveSesi(sesi) {
  fs.mkdirSync(cfg.DATA_DIR, { recursive: true });
  fs.writeFileSync(SESI_FILE, JSON.stringify(sesi), { mode: 0o600 });
  try {
    fs.chmodSync(SESI_FILE, 0o600);
  } catch {
    /* sistem file tanpa izin POSIX */
  }
}

function clearSesi() {
  try {
    fs.unlinkSync(SESI_FILE);
  } catch {
    /* sudah tidak ada */
  }
}

function status() {
  const s = loadSesi();
  if (!s) return { terhubung: false, apiUrl: Boolean(apiUrl()) };
  const kedaluwarsa = s.exp && Date.now() > s.exp;
  if (kedaluwarsa) {
    clearSesi();
    return { terhubung: false, kedaluwarsa: true };
  }
  return {
    terhubung: true,
    user: s.user,
    exp: s.exp || null,
    bolehUpload: ROLE_UPLOAD.includes(String(s.user.role || "").toUpperCase()),
  };
}

function sessionError(msg) {
  const e = new Error(msg);
  e.code = "SESSION_ENDED";
  return e;
}

/**
 * Panggil backend internal dengan format yang sama seperti public/js/api.js:
 * POST text/plain berisi {action, data, token}; Apps Script menjawab lewat
 * pengalihan 302 yang diikuti otomatis.
 */
async function call(action, data, { token, timeoutMs = 60000 } = {}) {
  const url = apiUrl();
  if (!url) throw new Error("Alamat backend dashboard internal belum diatur (INTERNAL_API_URL).");
  const body = { action, data: data || {} };
  if (action === "login") Object.assign(body, data);
  else body.token = token || "";

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      redirect: "follow",
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    if (e && e.name === "AbortError") {
      throw new Error("Dashboard internal tidak menjawab dalam " + Math.round(timeoutMs / 1000) + " detik. Coba lagi.");
    }
    throw new Error("Tidak bisa terhubung ke dashboard internal. Periksa koneksi internet komputer ini.");
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error("Server dashboard internal bermasalah (HTTP " + res.status + "). Coba lagi.");
  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error("Jawaban dashboard internal tidak valid.");
  }
  if (!json.ok) {
    const msg = json.error || "Terjadi kesalahan di dashboard internal.";
    // Pola yang sama dengan api.js internal: sesi habis → minta login ulang.
    if (/sesi tidak valid|login ulang|kontrak.*berakhir|tidak aktif/i.test(msg)) {
      clearSesi();
      throw sessionError(msg);
    }
    throw new Error(msg);
  }
  return json;
}

async function login(nomorPegawai, password) {
  const username = String(nomorPegawai || "").trim();
  const pass = String(password || "");
  if (!username || !pass) throw new Error("Nomor pegawai dan password wajib diisi.");
  const r = await call("login", { username, password: pass });
  const u = r.user || {};
  // Simpan data seperlunya saja (tanpa alamat/telepon).
  const user = {
    nomorPegawai: String(u.nomorPegawai || username),
    nama: String(u.nama || ""),
    role: String(u.role || ""),
    roleLabel: String(u.roleLabel || u.role || ""),
    outlet: String(u.outlet || ""),
  };
  saveSesi({ token: r.token, user, exp: Date.now() + TOKEN_TTL_DAYS * 86400000, savedAt: new Date().toISOString() });
  return status();
}

function requireSesi() {
  const s = loadSesi();
  if (!s || (s.exp && Date.now() > s.exp)) {
    clearSesi();
    throw sessionError("Belum terhubung ke dashboard internal. Silakan login dulu.");
  }
  return s;
}

async function transaksiInfo() {
  const s = requireSesi();
  const r = await call("getTransaksiInfo", {}, { token: s.token });
  return { jumlah: r.jumlah, lastUpload: r.lastUpload || "" };
}

/** Upload & proses file rekap transaksi — fungsi backend yang sama dengan menu di dashboard internal. */
async function uploadTransaksi(buffer, namaFile) {
  const s = requireSesi();
  if (!ROLE_UPLOAD.includes(String(s.user.role || "").toUpperCase())) {
    throw new Error("Halaman ini hanya untuk Manajer atau Owner.");
  }
  if (!buffer || !buffer.length) throw new Error("Pilih file .xlsx dahulu.");
  const r = await call(
    "uploadTransaksi",
    { base64: Buffer.from(buffer).toString("base64"), namaFile: String(namaFile || "transaksi.xlsx") },
    { token: s.token, timeoutMs: 6 * 60000 } // batas eksekusi Apps Script 6 menit
  );
  return {
    message: r.message,
    baru: r.baru,
    perbarui: r.perbarui,
    total: r.total,
    perluDicek: Array.isArray(r.perluDicek) ? r.perluDicek : [],
  };
}

module.exports = { status, login, logout: clearSesi, transaksiInfo, uploadTransaksi, apiUrl };
