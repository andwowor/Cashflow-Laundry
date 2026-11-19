"use strict";

const fs = require("fs");
const path = require("path");
const cfg = require("./config");

// Akun Smartlink untuk login otomatis robot Konfirmasi Biaya.
// Disimpan HANYA di komputer yang menjalankan dashboard (folder data/, tidak
// dilacak git), berizin baca 600. Kata sandi tidak pernah dikirim ke browser
// dashboard maupun ke AI: robot mengetiknya langsung ke kolom login Smartlink.

const FILE = path.join(cfg.DATA_DIR, "smartlink_akun.json");

function load() {
  try {
    const d = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (d && typeof d.email === "string" && typeof d.password === "string" && d.email && d.password) return d;
  } catch {
    /* belum ada */
  }
  return null;
}

function mask(email) {
  const [u, d] = String(email).split("@");
  if (!d) return "***";
  const vis = u.length <= 2 ? u.slice(0, 1) : u.slice(0, 2);
  return `${vis}${"*".repeat(Math.max(2, u.length - vis.length))}@${d}`;
}

function info() {
  const a = load();
  return a ? { tersimpan: true, email: mask(a.email), savedAt: a.savedAt || null } : { tersimpan: false };
}

/** Simpan akun. Kata sandi kosong = pakai kata sandi lama (ubah email saja). */
function save({ email, password }) {
  const e = String(email || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 200) throw new Error("Email Smartlink tidak valid.");
  let p = String(password == null ? "" : password);
  if (!p) {
    const old = load();
    if (!old) throw new Error("Kata sandi Smartlink wajib diisi.");
    p = old.password;
  }
  if (p.length > 200) throw new Error("Kata sandi terlalu panjang.");
  fs.mkdirSync(cfg.DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify({ email: e, password: p, savedAt: new Date().toISOString() }), { mode: 0o600 });
  try {
    fs.chmodSync(FILE, 0o600);
  } catch {
    /* sistem file tanpa izin POSIX */
  }
  return info();
}

function clear() {
  try {
    fs.unlinkSync(FILE);
  } catch {
    /* sudah tidak ada */
  }
  return info();
}

module.exports = { load, info, save, clear, mask };
