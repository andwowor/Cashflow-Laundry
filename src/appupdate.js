"use strict";

// Pembaruan aplikasi dari dalam dashboard — menggantikan langkah manual di
// terminal (git pull + npm install + pm2 restart). Berjalan di mesin tempat
// dashboard dipasang, di balik login.

const path = require("path");
const { sh, shSafe, shq, runEnv } = require("./shell");
const { spawn } = require("child_process");

const REPO_DIR = process.env.APP_REPO_DIR || path.join(__dirname, ".."); // folder proyek
const PM2_NAME = process.env.APP_PM2_NAME || "laundry";

const git = (args, timeout) => shSafe(`git ${args}`, { cwd: REPO_DIR, timeout: timeout || 20000 });

/** Cabang aktif. "" bila tak terbaca (mis. detached HEAD / bukan repo git). */
async function currentBranch() {
  const r = await git("rev-parse --abbrev-ref HEAD");
  return r.ok ? r.out : "";
}

/**
 * Info versi aplikasi + apakah ada pembaruan di remote.
 * TOLERAN: tidak pernah melempar — bila git tak tersedia, kembalikan error di field.
 */
async function version(opts = {}) {
  const info = {
    ok: true, branch: "", commit: "", date: "", subject: "",
    dirty: false, behind: 0, updateAvailable: false, checked: false, error: null,
  };
  const head = await git("log -1 --format=%h%x1f%cI%x1f%s");
  if (!head.ok) {
    info.ok = false;
    info.error = head.err || "git tidak tersedia / folder ini bukan repositori git.";
    return info;
  }
  const [commit, date, subject] = head.out.split("\u001f");
  info.commit = commit || "";
  info.date = date || "";
  info.subject = subject || "";
  info.branch = await currentBranch();

  const st = await git("status --porcelain");
  info.dirty = st.ok && st.out.length > 0;

  // Cek remote hanya bila diminta (operasi jaringan, beberapa detik).
  if (opts.check && info.branch) {
    const f = await git(`fetch --quiet origin ${shq(info.branch)}`, 45000);
    if (!f.ok) {
      info.error = `Gagal menghubungi GitHub: ${f.err}`;
      return info;
    }
    info.checked = true;
    const b = await git(`rev-list --count HEAD..origin/${shq(info.branch)}`);
    info.behind = b.ok ? Number(b.out) || 0 : 0;
    info.updateAvailable = info.behind > 0;
  }
  return info;
}

/** Penanda versi untuk cache-busting aset (app.js/styles.css). */
let _assetVer = null;
async function assetVersion() {
  if (_assetVer) return _assetVer;
  const r = await git("rev-parse --short HEAD");
  _assetVer = r.ok && r.out ? r.out : String(Date.now());
  return _assetVer;
}

/** Apakah pm2 tersedia & proses aplikasi dikelola olehnya. */
async function pm2Managed() {
  const r = await shSafe("pm2 jlist", { timeout: 12000 });
  if (!r.ok) return { available: false, managed: false };
  try {
    const list = JSON.parse(r.out || "[]");
    return {
      available: true,
      managed: list.some((p) => (p.name || "").toLowerCase() === PM2_NAME.toLowerCase()),
    };
  } catch {
    return { available: true, managed: false };
  }
}

/** Restart aplikasi lewat pm2, DITUNDA & terlepas agar respons HTTP sempat terkirim. */
function scheduleRestart(delayMs = 800) {
  setTimeout(() => {
    try {
      const child = spawn("pm2", ["restart", PM2_NAME, "--update-env"], {
        env: runEnv(),
        detached: true,
        stdio: "ignore",
      });
      child.unref();
    } catch {
      /* diabaikan: bila pm2 tak ada, pemanggil sudah diberi tahu lewat respons */
    }
  }, delayMs);
}

/**
 * Tarik kode terbaru lalu jadwalkan restart.
 * Mengembalikan log langkah-langkahnya; TIDAK melempar untuk kegagalan yang bisa
 * dijelaskan (mis. ada perubahan lokal) agar pesannya bisa ditampilkan ke user.
 */
async function update() {
  const steps = [];
  const branch = await currentBranch();
  if (!branch) return { ok: false, steps, error: "Cabang git tidak terbaca di folder aplikasi." };

  const st = await git("status --porcelain");
  if (st.ok && st.out) {
    return {
      ok: false,
      steps,
      error:
        "Ada perubahan lokal yang belum disimpan di folder aplikasi, jadi pembaruan dihentikan " +
        "supaya tidak menimpa apa pun. File yang berubah:\n" + st.out,
    };
  }

  const before = await git("rev-parse HEAD");
  const pull = await git(`pull --ff-only origin ${shq(branch)}`, 120000);
  if (!pull.ok) {
    return { ok: false, steps, error: `Gagal mengambil pembaruan dari GitHub: ${pull.err || pull.out}` };
  }
  steps.push(`Mengambil kode terbaru dari cabang ${branch}.`);
  const after = await git("rev-parse HEAD");
  const changed = before.ok && after.ok && before.out !== after.out;

  if (!changed) {
    return { ok: true, steps, changed: false, restarted: false, message: "Aplikasi sudah versi terbaru." };
  }

  // Pasang dependensi baru hanya bila daftar paketnya ikut berubah.
  const diff = await git(`diff --name-only ${shq(before.out)} ${shq(after.out)}`);
  if (diff.ok && /(^|\n)(package\.json|package-lock\.json)(\n|$)/.test(diff.out)) {
    const npm = await shSafe("npm install --omit=dev --no-audit --no-fund", { cwd: REPO_DIR, timeout: 300000 });
    steps.push(npm.ok ? "Memasang pembaruan paket (npm install)." : `⚠ npm install gagal: ${npm.err}`);
  }

  const pm2 = await pm2Managed();
  if (pm2.managed) {
    steps.push("Menjalankan ulang aplikasi (pm2 restart) — halaman akan memuat ulang otomatis.");
    scheduleRestart();
  } else {
    steps.push(
      "⚠ Kode terbaru sudah diunduh, tetapi aplikasi TIDAK bisa dijalankan ulang otomatis " +
        `(proses pm2 bernama "${PM2_NAME}" tidak ditemukan). Perubahan baru aktif setelah aplikasi dijalankan ulang.`
    );
  }

  const head = await git("log -1 --format=%h%x1f%s");
  const [commit, subject] = (head.ok ? head.out : "").split("\u001f");
  return { ok: true, steps, changed: true, restarted: !!pm2.managed, commit: commit || "", subject: subject || "" };
}

module.exports = { version, update, assetVersion, pm2Managed, REPO_DIR, PM2_NAME };
