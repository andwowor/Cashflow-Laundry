"use strict";

const fs = require("fs");
const path = require("path");
const cfg = require("./config");

// Browser otomatis untuk Smartlink (dipakai fitur "Konfirmasi Biaya Smartlink").
//
// - Memakai Google Chrome yang terpasang di komputer (playwright-core, tanpa
//   unduhan browser) dengan PROFIL TERSENDIRI di data/smartlink-chrome, jadi login
//   Smartlink cukup sekali dan tidak mengganggu Chrome harian user.
// - Mode tersembunyi (headless) untuk berjalan di latar belakang; mode terlihat
//   untuk login pertama kali / bila user ingin menonton.
// - Menjalankan aksi "computer use" (klik, ketik, scroll, screenshot …) pada SATU
//   tab berukuran tetap 1280×800 — koordinat = piksel screenshot.

const SMARTLINK_URL = process.env.SMARTLINK_URL || "https://dashboard.smartlink.id/";
const PROFILE_DIR = process.env.SMARTLINK_PROFILE_DIR || path.join(cfg.DATA_DIR, "smartlink-chrome");
const VIEW = { width: 1280, height: 800 };
// Halaman dirender 2× agar teks di kanvas Flutter tajam; screenshot penuh tetap
// diperkecil ke 1280×800 (skala CSS), zoom memakai resolusi asli.
const DPR = 2;

let _ctx = null; // BrowserContext (persisten)
let _page = null;
let _headless = null;
let _opening = null;
let _lastShot = null; // { buf, at }
let _cursor = [Math.round(VIEW.width / 2), Math.round(VIEW.height / 2)];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadPlaywright() {
  try {
    return require("playwright-core");
  } catch {
    const e = new Error(
      "Komponen browser otomatis belum terpasang. Perbarui aplikasi lewat tab Pengaturan → Versi & Pembaruan Aplikasi, lalu coba lagi."
    );
    e.code = "NO_PLAYWRIGHT";
    throw e;
  }
}

function friendlyLaunchError(err) {
  const msg = String((err && err.message) || err);
  if (/is not found at|distribution 'chrome' is not found|Executable doesn't exist|ENOENT/i.test(msg)) {
    const e = new Error(
      "Google Chrome tidak ditemukan di komputer yang menjalankan dashboard. Pasang Google Chrome, lalu coba lagi."
    );
    e.code = "NO_CHROME";
    return e;
  }
  if (/ProcessSingleton|SingletonLock|profile.*(in use|locked)|user data directory is already in use/i.test(msg)) {
    const e = new Error(
      "Profil browser Smartlink sedang dipakai jendela Chrome lain. Tutup jendela Chrome Smartlink yang masih terbuka, lalu coba lagi."
    );
    e.code = "PROFILE_BUSY";
    return e;
  }
  const e = new Error("Gagal membuka browser untuk Smartlink: " + msg.split("\n")[0]);
  e.code = "LAUNCH_FAILED";
  return e;
}

function wirePage(p) {
  p.on("dialog", (d) => d.dismiss().catch(() => {}));
}

/**
 * Buka (atau pakai ulang) browser. headless=true → tersembunyi.
 * Bila sudah ada jendela TERLIHAT (mis. jendela login), jendela itu dipakai ulang.
 */
async function open({ headless }) {
  if (_opening) await _opening.catch(() => {});
  if (_ctx) {
    if (_headless === headless || _headless === false) return _page;
    await close();
  }
  _opening = (async () => {
    const { chromium } = loadPlaywright();
    fs.mkdirSync(PROFILE_DIR, { recursive: true });
    const opts = {
      headless,
      viewport: VIEW,
      deviceScaleFactor: DPR,
      locale: "id-ID",
      timezoneId: cfg.TIMEZONE,
      args: [
        "--no-first-run",
        "--no-default-browser-check",
        `--window-size=${VIEW.width + 40},${VIEW.height + 160}`,
      ],
    };
    if (process.env.SMARTLINK_CHROME_PATH) opts.executablePath = process.env.SMARTLINK_CHROME_PATH;
    else opts.channel = process.env.SMARTLINK_CHROME_CHANNEL || "chrome";

    let ctx;
    try {
      ctx = await chromium.launchPersistentContext(PROFILE_DIR, opts);
    } catch (err) {
      throw friendlyLaunchError(err);
    }
    ctx.on("close", () => {
      if (_ctx === ctx) {
        _ctx = null;
        _page = null;
        _headless = null;
      }
    });
    ctx.on("page", (p) => {
      wirePage(p);
      _page = p; // Smartlink membuka tab baru → ikuti tab terbaru
      p.on("close", () => {
        if (_page === p && _ctx) _page = _ctx.pages().slice(-1)[0] || null;
      });
    });
    _ctx = ctx;
    _headless = headless;
    _page = ctx.pages()[0] || (await ctx.newPage());
    wirePage(_page);
    return _page;
  })();
  try {
    return await _opening;
  } finally {
    _opening = null;
  }
}

async function close() {
  const ctx = _ctx;
  _ctx = null;
  _page = null;
  _headless = null;
  if (ctx) await ctx.close().catch(() => {});
}

function isOpen() {
  return !!_ctx;
}
function isHeadless() {
  return _headless;
}

function page() {
  if (!_ctx || !_page || _page.isClosed()) {
    const e = new Error("Jendela browser Smartlink sudah tertutup.");
    e.code = "BROWSER_CLOSED";
    throw e;
  }
  return _page;
}

/** Aktifkan pohon aksesibilitas Flutter (agar label menu terbaca sebagai teks). */
async function enableSemantics() {
  await page()
    .evaluate(() => {
      const ph = document.querySelector("flt-semantics-placeholder");
      if (ph) ph.click();
    })
    .catch(() => {});
}

/** Buka Smartlink dan tunggu aplikasi Flutter-nya siap. */
async function gotoSmartlink() {
  const p = page();
  await p.goto(SMARTLINK_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await p.waitForSelector("flutter-view, flt-glass-pane", { timeout: 30000 }).catch(() => {});
  await sleep(4000);
  await enableSemantics();
  await sleep(800);
}

/** Label menu/tombol yang ada di pohon aksesibilitas Flutter + koordinat tengahnya. */
async function readMenu() {
  const run = () =>
    page().evaluate(() =>
      Array.from(document.querySelectorAll("flt-semantics"))
        .filter((n) => n.querySelectorAll("flt-semantics").length === 0)
        .map((n) => {
          const r = n.getBoundingClientRect();
          const label = (n.getAttribute("aria-label") || n.innerText || "").trim().replace(/\s+/g, " ");
          return `${Math.round(r.x + r.width / 2)},${Math.round(r.y + r.height / 2)} :: ${label}`;
        })
        .filter((s) => s.split(":: ")[1])
        .join("\n")
    );
  let text = await run();
  if (!text) {
    await enableSemantics();
    await sleep(700);
    text = await run();
  }
  return text ? text.slice(0, 6000) : "(pohon aksesibilitas kosong — baca lewat screenshot)";
}

// ---------------- Screenshot ----------------

async function screenshot() {
  const buf = await page().screenshot({ type: "jpeg", quality: 75, scale: "css", timeout: 20000 });
  _lastShot = { buf, at: Date.now() };
  return buf.toString("base64");
}

/** Screenshot terakhir (untuk tampilan "sedang berjalan" di dashboard). */
function lastShot() {
  return _lastShot;
}
function clearLastShot() {
  _lastShot = null;
}

async function zoom(region) {
  if (!Array.isArray(region) || region.length !== 4 || !region.every((v) => Number.isFinite(Number(v)))) {
    throw new Error("region harus [x0, y0, x1, y1].");
  }
  let [x0, y0, x1, y1] = region.map(Number);
  if (x1 < x0) [x0, x1] = [x1, x0];
  if (y1 < y0) [y0, y1] = [y1, y0];
  x0 = Math.max(0, Math.min(VIEW.width - 1, x0));
  y0 = Math.max(0, Math.min(VIEW.height - 1, y0));
  x1 = Math.max(x0 + 1, Math.min(VIEW.width, x1));
  y1 = Math.max(y0 + 1, Math.min(VIEW.height, y1));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 4 || h < 4) throw new Error("Area zoom terlalu kecil.");
  // Resolusi asli (2×) bila masih muat di 1280×800; selain itu skala CSS.
  const scale = w * DPR <= VIEW.width && h * DPR <= VIEW.height ? "device" : "css";
  const buf = await page().screenshot({
    type: "jpeg",
    quality: 85,
    scale,
    clip: { x: x0, y: y0, width: w, height: h },
    timeout: 20000,
  });
  return buf.toString("base64");
}

// ---------------- Aksi komputer ----------------

const KEYMAP = {
  return: "Enter", enter: "Enter", kp_enter: "Enter",
  escape: "Escape", esc: "Escape",
  backspace: "Backspace", tab: "Tab", delete: "Delete", del: "Delete",
  space: "Space", insert: "Insert",
  page_down: "PageDown", pagedown: "PageDown", next: "PageDown",
  page_up: "PageUp", pageup: "PageUp", prior: "PageUp",
  home: "Home", end: "End",
  up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight",
  arrowup: "ArrowUp", arrowdown: "ArrowDown", arrowleft: "ArrowLeft", arrowright: "ArrowRight",
  ctrl: "ControlOrMeta", control: "ControlOrMeta", control_l: "ControlOrMeta", control_r: "ControlOrMeta",
  shift: "Shift", shift_l: "Shift", shift_r: "Shift",
  alt: "Alt", alt_l: "Alt", alt_r: "Alt", option: "Alt",
  super: "Meta", super_l: "Meta", cmd: "Meta", command: "Meta", meta: "Meta", win: "Meta",
  plus: "+", minus: "-",
};

function mapKey(part) {
  const p = String(part).trim();
  const k = KEYMAP[p.toLowerCase()];
  if (k) return k;
  if (/^f([1-9]|1[0-2])$/i.test(p)) return p.toUpperCase();
  return p;
}

/** "ctrl+shift+a" → "ControlOrMeta+Shift+a". Kombinasi reload/tutup tab ditolak. */
function mapCombo(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("Tombol kosong.");
  const parts = raw === "+" ? ["+"] : raw.split("+").filter((x) => x !== "");
  const keys = parts.map(mapKey);
  const mods = keys.filter((k) => ["ControlOrMeta", "Meta", "Shift", "Alt"].includes(k));
  const main = keys.filter((k) => !mods.includes(k)).map((k) => k.toLowerCase());
  const withCmd = mods.includes("ControlOrMeta") || mods.includes("Meta");
  if (main.includes("f5") || (withCmd && main.some((k) => ["r", "w", "q", "t", "n", "l"].includes(k)))) {
    throw new Error("Kombinasi tombol ini diblokir: reload / menutup tab / membuka tab baru tidak diizinkan.");
  }
  return keys.join("+");
}

function modifierList(text) {
  if (!text) return [];
  return String(text)
    .split("+")
    .map((m) => mapKey(m))
    .filter((m) => ["ControlOrMeta", "Meta", "Shift", "Alt"].includes(m));
}

function xy(coord, label = "coordinate") {
  if (!Array.isArray(coord) || coord.length !== 2) throw new Error(`${label} harus [x, y].`);
  const [x, y] = coord.map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`${label} tidak valid.`);
  if (x < 0 || y < 0 || x >= VIEW.width || y >= VIEW.height) {
    throw new Error(`${label} [${x}, ${y}] di luar layar ${VIEW.width}×${VIEW.height}.`);
  }
  return [Math.round(x), Math.round(y)];
}

async function withModifiers(text, fn) {
  const p = page();
  const mods = modifierList(text);
  for (const m of mods) await p.keyboard.down(m);
  try {
    return await fn();
  } finally {
    for (const m of mods.reverse()) await p.keyboard.up(m).catch(() => {});
  }
}

async function clickAt(input, opts) {
  const p = page();
  const pos = input.coordinate != null ? xy(input.coordinate) : _cursor;
  await withModifiers(input.text, () => p.mouse.click(pos[0], pos[1], opts));
  _cursor = pos;
}

/** Aksi yang mengubah layar (setelahnya layar diberi jeda singkat agar stabil). */
const UI_ACTIONS = new Set([
  "left_click", "right_click", "middle_click", "double_click", "triple_click",
  "left_click_drag", "mouse_move", "left_mouse_down", "left_mouse_up",
  "scroll", "type", "key", "hold_key",
]);

/**
 * Jalankan satu aksi anggota toolset komputer.
 * Mengembalikan { text } atau { image } (base64 JPEG).
 */
async function perform(name, input = {}) {
  const p = page();
  switch (name) {
    case "screenshot":
      return { image: await screenshot() };
    case "zoom":
      return { image: await zoom(input.region) };
    case "left_click":
      await clickAt(input, {});
      break;
    case "right_click":
      await clickAt(input, { button: "right" });
      break;
    case "middle_click":
      await clickAt(input, { button: "middle" });
      break;
    case "double_click":
      await clickAt(input, { clickCount: 2 });
      break;
    case "triple_click":
      await clickAt(input, { clickCount: 3 });
      break;
    case "left_click_drag": {
      const a = xy(input.start_coordinate, "start_coordinate");
      const b = xy(input.coordinate);
      await withModifiers(input.text, async () => {
        await p.mouse.move(a[0], a[1]);
        await p.mouse.down();
        await p.mouse.move(b[0], b[1], { steps: 12 });
        await p.mouse.up();
      });
      _cursor = b;
      break;
    }
    case "mouse_move": {
      const a = xy(input.coordinate);
      await p.mouse.move(a[0], a[1], { steps: 4 });
      _cursor = a;
      break;
    }
    case "left_mouse_down":
      await p.mouse.down();
      break;
    case "left_mouse_up":
      await p.mouse.up();
      break;
    case "cursor_position":
      return { text: `[${_cursor[0]}, ${_cursor[1]}]` };
    case "scroll": {
      const pos = input.coordinate != null ? xy(input.coordinate) : _cursor;
      const amount = Math.max(1, Math.min(30, Math.round(Number(input.scroll_amount) || 3)));
      const dir = String(input.scroll_direction || "down");
      const step = 100 * amount;
      const dx = dir === "left" ? -step : dir === "right" ? step : 0;
      const dy = dir === "up" ? -step : dir === "down" ? step : 0;
      if (!dx && !dy) throw new Error("scroll_direction harus up/down/left/right.");
      await p.mouse.move(pos[0], pos[1]);
      _cursor = pos;
      await withModifiers(input.text, () => p.mouse.wheel(dx, dy));
      break;
    }
    case "type": {
      const text = String(input.text == null ? "" : input.text);
      if (text.length > 2000) throw new Error("Teks terlalu panjang.");
      await p.keyboard.type(text, { delay: 35 });
      break;
    }
    case "key": {
      const combo = mapCombo(input.text);
      const repeat = Math.max(1, Math.min(100, Math.round(Number(input.repeat) || 1)));
      for (let i = 0; i < repeat; i++) await p.keyboard.press(combo);
      break;
    }
    case "hold_key": {
      const combo = mapCombo(input.text);
      const keys = combo.split("+");
      const ms = Math.max(0, Math.min(10, Number(input.duration) || 1)) * 1000;
      for (const k of keys) await p.keyboard.down(k);
      await sleep(ms);
      for (const k of keys.reverse()) await p.keyboard.up(k).catch(() => {});
      break;
    }
    case "wait": {
      const s = Math.max(0, Math.min(20, Number(input.duration) || 1));
      await sleep(s * 1000);
      return { text: "OK" };
    }
    default:
      throw new Error(`Aksi komputer tidak dikenal: ${name}`);
  }
  if (UI_ACTIONS.has(name)) await sleep(350);
  return { text: "OK" };
}

/**
 * Ketik nilai rahasia (email/kata sandi login) ke kolom yang sedang aktif.
 * Isi kolom dibersihkan dulu. Nilainya TIDAK dicatat di log mana pun.
 */
async function typeSecret(value) {
  const p = page();
  await p.keyboard.press("ControlOrMeta+a");
  await p.keyboard.press("Backspace");
  await p.keyboard.type(String(value), { delay: 40 });
  await sleep(300);
}

module.exports = {
  SMARTLINK_URL,
  typeSecret,
  PROFILE_DIR,
  VIEW,
  UI_ACTIONS,
  open,
  close,
  isOpen,
  isHeadless,
  gotoSmartlink,
  enableSemantics,
  readMenu,
  screenshot,
  lastShot,
  clearLastShot,
  perform,
  // untuk uji
  _mapCombo: mapCombo,
};
