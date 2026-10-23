"use strict";

// Util menjalankan perintah shell untuk fitur yang memanggil pm2/git/cloudflared.
// PATH diperluas supaya perintah yang dipasang lewat npm global / Homebrew tetap
// ditemukan meski server dijalankan oleh pm2 dengan PATH minim.

const { exec } = require("child_process");
const os = require("os");
const path = require("path");
const util = require("util");

const execP = util.promisify(exec);

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

/** Jalankan perintah; kembalikan stdout. Melempar bila gagal. */
async function sh(cmd, opts = {}) {
  const { stdout } = await execP(cmd, {
    env: runEnv(),
    timeout: opts.timeout || 15000,
    maxBuffer: 8 * 1024 * 1024,
    cwd: opts.cwd,
  });
  return stdout || "";
}

/** Seperti sh(), tapi tidak pernah melempar: kembalikan {ok, out, err}. */
async function shSafe(cmd, opts = {}) {
  try {
    return { ok: true, out: (await sh(cmd, opts)).trim(), err: null };
  } catch (err) {
    return { ok: false, out: (err.stdout || "").trim(), err: (err.stderr || err.message || "").trim() };
  }
}

/** Kutip argumen shell dengan aman. */
function shq(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}

module.exports = { runEnv, sh, shSafe, shq };
