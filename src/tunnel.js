"use strict";

// Membaca URL Cloudflare Quick Tunnel (https://xxx.trycloudflare.com) yang
// sedang aktif dari log pm2 proses "tunnel", dan (bila perlu) menyalakannya.
// Tujuan: satu tombol di dashboard menggantikan langkah manual di terminal
//   pm2 logs tunnel --nostream --lines 100 | grep trycloudflare

const { exec } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const util = require("util");

const execP = util.promisify(exec);

const URL_RE = /https:\/\/[a-z0-9][a-z0-9-]*\.trycloudflare\.com/gi;
const TUNNEL_NAME = process.env.TUNNEL_PM2_NAME || "tunnel";
const APP_PORT = process.env.PORT || 3000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Kutip argumen shell dengan aman (mencegah injeksi lewat nama proses).
function shq(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}

// PATH diperluas supaya pm2/cloudflared (npm global / Homebrew / dsb.) tetap
// ditemukan meski server dijalankan oleh pm2 dengan PATH minim.
function runEnv() {
  const home = os.homedir();
  const extra = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    path.join(home, ".npm-global/bin"),
    path.join(home, ".yarn/bin"),
    path.join(home, "n/bin"),
  ];
  const cur = (process.env.PATH || "").split(":");
  const PATH = Array.from(new Set([...cur, ...extra])).filter(Boolean).join(":");
  return { ...process.env, PATH };
}

async function sh(cmd, timeout = 15000) {
  const { stdout } = await execP(cmd, { env: runEnv(), timeout, maxBuffer: 8 * 1024 * 1024 });
  return stdout || "";
}

// Daftar proses pm2 (JSON). { available:false } bila pm2 tak ada / gagal dipanggil.
async function pm2List() {
  try {
    const out = await sh("pm2 jlist", 12000);
    const arr = JSON.parse(String(out).trim() || "[]");
    return { available: true, list: Array.isArray(arr) ? arr : [] };
  } catch {
    return { available: false, list: [] };
  }
}

function findTunnelProc(list) {
  const byName = list.find((p) => (p.name || "").toLowerCase() === TUNNEL_NAME.toLowerCase());
  if (byName) return byName;
  return (
    list.find((p) => {
      const env = p.pm2_env || {};
      const s = JSON.stringify(env.args || "") + " " + (env.pm_exec_path || "") + " " + (env.name || "");
      return /cloudflared|trycloudflare/i.test(s);
    }) || null
  );
}

// Baca sebagian akhir file (hemat memori untuk log besar).
function readTail(file, maxBytes) {
  const st = fs.statSync(file);
  const start = Math.max(0, st.size - maxBytes);
  const len = st.size - start;
  if (len <= 0) return "";
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, start);
    return buf.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

// Semua URL trycloudflare dari daftar file log (urut kemunculan).
function urlsFromFiles(files) {
  const urls = [];
  for (const f of files) {
    try {
      if (!f || !fs.existsSync(f)) continue;
      const m = readTail(f, 256 * 1024).match(URL_RE);
      if (m) urls.push(...m);
    } catch {
      /* file tak terbaca — abaikan */
    }
  }
  return urls;
}

function defaultLogFiles() {
  const dir = path.join(os.homedir(), ".pm2", "logs");
  return [path.join(dir, `${TUNNEL_NAME}-out.log`), path.join(dir, `${TUNNEL_NAME}-error.log`)];
}

// Status tunnel + URL terkini (URL terakhir yang muncul di log = yang aktif).
async function readStatus() {
  const { available, list } = await pm2List();
  const proc = findTunnelProc(list);
  const files = [];
  if (proc && proc.pm2_env) {
    if (proc.pm2_env.pm_out_log_path) files.push(proc.pm2_env.pm_out_log_path);
    if (proc.pm2_env.pm_err_log_path) files.push(proc.pm2_env.pm_err_log_path);
  }
  for (const f of defaultLogFiles()) if (!files.includes(f)) files.push(f);

  const urls = urlsFromFiles(files);
  const url = urls.length ? urls[urls.length - 1] : null;
  const status = proc && proc.pm2_env ? proc.pm2_env.status : null;

  // running: online menurut pm2; bila pm2 tak tersedia, tebak dari ada/tidaknya URL.
  let running;
  if (available) running = status === "online";
  else running = !!url;

  return { url, running, status, pm2Available: available, hasProc: !!proc, urlCount: urls.length };
}

// Pastikan tunnel menyala & kembalikan URL-nya. Menyalakan/merestart bila perlu.
async function ensureTunnel() {
  const before = await readStatus();
  if (before.running && before.url) return { ...before, started: false };

  if (!before.pm2Available) {
    const err = new Error(
      "pm2 tidak ditemukan di server sehingga tunnel tidak bisa dinyalakan otomatis. Jalankan manual lewat terminal."
    );
    err.code = "NO_PM2";
    throw err;
  }

  // Bersihkan log lama supaya URL yang terbaca dijamin dari run terbaru.
  await sh(`pm2 flush ${shq(TUNNEL_NAME)}`, 10000).catch(() => {});

  if (before.hasProc) {
    await sh(`pm2 restart ${shq(TUNNEL_NAME)}`, 20000);
  } else {
    await sh(
      `pm2 start cloudflared --name ${shq(TUNNEL_NAME)} -- tunnel --url http://localhost:${APP_PORT}`,
      25000
    );
  }
  await sh("pm2 save", 10000).catch(() => {});

  // Tunggu cloudflared mencetak URL (biasanya beberapa detik).
  const deadline = Date.now() + 28000;
  while (Date.now() < deadline) {
    await sleep(1500);
    const cur = await readStatus();
    if (cur.url && cur.running) return { ...cur, started: true };
  }
  const err = new Error("Tunnel dijalankan tapi URL belum muncul (±28 detik). Coba klik lagi sebentar.");
  err.code = "TIMEOUT";
  throw err;
}

module.exports = { readStatus, ensureTunnel, TUNNEL_NAME, APP_PORT };
