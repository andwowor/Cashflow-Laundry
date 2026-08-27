"use strict";

const { driveClient } = require("./google");

// Receipt (foto bukti) biaya tersimpan di Google Drive, dipisah per outlet:
//   <FOLDER RECEIPT>/MAUMBI/2026-08-26-Plastik Bening-Rp100.000-Julian Richard Wowor.jpg
//   <FOLDER RECEIPT>/PERKAMIL/...
// Nama file mengikuti pola: YYYY-MM-DD-<KETERANGAN>-Rp<NOMINAL>-<NAMA>.<ext>
// Dari pola itu tiap foto dicocokkan ke baris sheet BIAYA lewat kombinasi
// OUTLET + TANGGAL + KETERANGAN + NOMINAL.
//
// CATATAN: folder Drive tersebut harus dibagikan ke service account dashboard
// (minimal akses "Viewer"). Bila tidak, fitur ini mati dengan tenang —
// Monitoring Biaya tetap tampil, hanya tanpa tautan receipt.

const FOLDER_ID = process.env.RECEIPT_FOLDER_ID || "1g4_UqA011IEGA5ohWx6Jlai_BiPyaQ3J";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const CACHE_MS = 5 * 60 * 1000; // daftar file Drive di-cache 5 menit

const NAME_RE = /^(\d{4})-(\d{2})-(\d{2})-(.+?)-Rp\s*([\d.,]+)-(.+?)\.(jpe?g|png|webp|heic|pdf)$/i;

let _cache = { at: 0, byFull: new Map(), byLoose: new Map(), byId: new Map(), count: 0, error: null };

/** Samakan teks keterangan agar cocok walau beda huruf besar/kecil & spasi. */
function normKet(s) {
  return String(s == null ? "" : s).trim().replace(/\s+/g, " ").toLowerCase();
}
/** "Rp100.000" / "156.990" -> 156990 (titik/koma = pemisah ribuan). */
function parseNominal(s) {
  const digits = String(s == null ? "" : s).replace(/[^\d]/g, "");
  return digits ? Number(digits) : NaN;
}

/** Pecah nama file receipt. null bila polanya tidak cocok. */
function parseName(name) {
  const m = String(name || "").match(NAME_RE);
  if (!m) return null;
  const [, y, mo, d, keterangan, rp, nama] = m;
  const nominal = parseNominal(rp);
  if (!Number.isFinite(nominal)) return null;
  return { iso: `${y}-${mo}-${d}`, keterangan: keterangan.trim(), nominal, nama: nama.trim() };
}

function keyFull(outlet, iso, keterangan, nominal) {
  return `${String(outlet).toUpperCase()}|${iso}|${normKet(keterangan)}|${nominal}`;
}
function keyLoose(outlet, iso, nominal) {
  return `${String(outlet).toUpperCase()}|${iso}|${nominal}`;
}

/** Semua anak sebuah folder Drive (dengan paginasi). */
async function listChildren(drive, parentId, foldersOnly) {
  const files = [];
  let pageToken;
  do {
    const res = await drive.files.list({
      q: `'${parentId}' in parents and trashed = false` + (foldersOnly ? ` and mimeType = '${FOLDER_MIME}'` : ""),
      fields: "nextPageToken, files(id,name,mimeType)",
      pageSize: 1000,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      pageToken,
    });
    files.push(...(res.data.files || []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return files;
}

/**
 * Indeks receipt dari Drive (di-cache). Tidak pernah melempar error: bila Drive
 * gagal diakses, kembalikan indeks kosong + pesan error agar pemanggil tetap jalan.
 */
async function loadIndex(force = false) {
  if (!force && Date.now() - _cache.at < CACHE_MS) return _cache;

  const byFull = new Map();
  const byLoose = new Map();
  const byId = new Map();
  let error = null;
  try {
    const drive = driveClient();
    const subfolders = await listChildren(drive, FOLDER_ID, true);
    // Folder outlet + folder utama itu sendiri (untuk file yang tak masuk subfolder).
    const buckets = subfolders.map((f) => ({ id: f.id, outlet: String(f.name || "").trim().toUpperCase() }));
    buckets.push({ id: FOLDER_ID, outlet: "" });

    for (const b of buckets) {
      const files = await listChildren(drive, b.id, false);
      for (const f of files) {
        if (f.mimeType === FOLDER_MIME) continue;
        const p = parseName(f.name);
        if (!p) continue;
        const entry = { id: f.id, name: f.name, mimeType: f.mimeType, outlet: b.outlet, ...p };
        byId.set(f.id, entry);
        // Foto pertama untuk sebuah kunci yang dipakai (nama file terurut menurun
        // tidak dijamin, jadi cukup ambil yang pertama ditemukan).
        const kf = keyFull(b.outlet, p.iso, p.keterangan, p.nominal);
        if (!byFull.has(kf)) byFull.set(kf, entry);
        const kl = keyLoose(b.outlet, p.iso, p.nominal);
        if (!byLoose.has(kl)) byLoose.set(kl, entry);
      }
    }
  } catch (err) {
    error = err.message || String(err);
  }

  _cache = { at: Date.now(), byFull, byLoose, byId, count: byId.size, error };
  return _cache;
}

/**
 * Cari receipt untuk satu baris biaya. Cocokkan OUTLET + TANGGAL + NOMINAL,
 * diutamakan yang KETERANGAN-nya juga sama.
 */
function findIn(index, { outlet, iso, keterangan, nominal }) {
  if (!iso || !Number.isFinite(nominal)) return null;
  const out = String(outlet || "").toUpperCase();
  return (
    index.byFull.get(keyFull(out, iso, keterangan, nominal)) ||
    index.byLoose.get(keyLoose(out, iso, nominal)) ||
    null
  );
}

/** Metadata satu receipt berdasarkan fileId — null bila bukan file dalam indeks. */
async function getById(fileId) {
  const index = await loadIndex();
  return index.byId.get(String(fileId)) || null;
}

/** Stream isi file receipt dari Drive (dipakai endpoint gambar). */
async function openStream(fileId) {
  const drive = driveClient();
  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "stream" }
  );
  return res.data;
}

module.exports = { loadIndex, findIn, getById, openStream, parseName, parseNominal, normKet, FOLDER_ID };
