"use strict";

/*
 * Klarifikasi keterangan nota (Upload Transaksi Harian › "nota perlu dicek").
 *
 * Owner menuliskan arti sebenarnya dari keterangan yang belum terbaca, mis.
 *   "1 hndk"  → "hndk = handuk"      (salah ketik nama barang → berlaku untuk SEMUA nota berikutnya)
 *   kiloan tanpa pcs → "10 pcs"      (khusus nota itu saja)
 * Aturan pembacaan nota (./kodeinternal.js) TIDAK diubah — file itu salinan apa adanya dari
 * Dashboard Internal. Klarifikasi dipasang sebagai lapisan SEBELUM agregasiTransaksi_:
 *   ALIAS   : kata diganti kata yang sudah dikenali parser ("hndk" → "handuk", "pvs" → "pcs");
 *   HITUNG  : barang baru yang belum dikenal parser, dihitung sebagai pcs seperti satuan baju
 *             (ditambahkan sementara ke SATUAN_BAJU selama agregasi);
 *   ABAIKAN : kata yang bukan jumlah barang ("35 cm") → diganti "satuan" (dikenali, tidak dihitung);
 *   NOTA    : teks tambahan untuk satu nota (ditempel ke keterangan baris kiloannya).
 * Aturan disimpan di sheet KLARIFIKASI KETERANGAN (spreadsheet PERFORMA PEGAWAI) supaya terlihat
 * owner, bisa dinonaktifkan (kolom AKTIF = TIDAK), dan bisa dipindahkan ke Kode.gs nantinya.
 * Kolom KETERANGAN ASLI di TRANSAKSI HARIAN tetap berisi teks asli kasir.
 */

const path = require("path");
const cfg = require("../config");
const sheets = require("../sheets");
const { sheetsClient } = require("../google");
const K = require("./kodeinternal");

const SHEET_K = "KLARIFIKASI KETERANGAN";
const JUDUL_K = ["WAKTU", "NO NOTA", "PELANGGAN", "KETERANGAN ASLI", "CATATAN SISTEM", "KLARIFIKASI", "JENIS", "KATA", "ARTI", "AKTIF"];
const FILE_PERLU = path.join(cfg.DATA_DIR, "transaksi_perlu_dicek.json");
const KATA_ABAIKAN = /^(abaikan|diabaikan|tidak\s+dihitung|tdk\s+dihitung|jangan\s+dihitung|bukan\s+barang|bukan\s+jumlah|bukan\s+cucian|lewati|skip)$/i;
const PENGISI = /^(?:maksudnya|maksud|artinya|arti|yaitu|adalah|itu|=|:)\s+/i;

const qs = (name) => `'${String(name).replace(/'/g, "''")}'`;
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/** Kata persis dikenali parser (sama dengan penyaring "satuan belum dikenali"). */
function kenalPersis(s) {
  return new RegExp("^" + K.kataSudahDikenal_() + "\\.?$", "i").test(String(s || "").trim());
}

/** Rapikan kata: huruf kecil, buang angka/tanda baca di depan/belakang, maks. 2 kata. */
function rapikanKata(s, maks = 2) {
  const t = String(s || "")
    .toLowerCase()
    .replace(/[“”"'’`]/g, "")
    .replace(/^[\s\d.,:;\-+x×]+/, "")
    .replace(/[\s.,:;!?]+$/, "")
    .trim();
  if (!/^[a-z]+(?:\s+[a-z]+)*$/.test(t)) return "";
  return t.split(/\s+/).slice(0, maks).join(" ");
}

/** Arti → kata yang dipakai: dua kata bila itu nama gabungan yang dikenal ("sarung bantal"), selain itu kata pertama. */
function pilihArti(teks) {
  const w = rapikanKata(teks, 3).split(" ").filter(Boolean);
  if (!w.length) return "";
  if (w.length >= 2 && kenalPersis(w[0] + " " + w[1])) return w[0] + " " + w[1];
  if (kenalPersis(w[0])) return w[0];
  return w.slice(0, 2).join(" ");
}

function jenisDari(arti, artiMentah) {
  if (KATA_ABAIKAN.test(String(artiMentah || "").trim())) return "ABAIKAN";
  return kenalPersis(arti) ? "ALIAS" : "HITUNG";
}

/**
 * Tafsirkan isian owner untuk satu nota → daftar aturan { jenis, kata, arti }.
 * data: { nota, catatan, keterangan, klarifikasi }
 */
function tafsir(data) {
  const teks = String(data.klarifikasi || "").trim();
  if (!teks) throw httpError(400, "Tulis klarifikasinya dahulu.");
  if (teks.length > 300) throw httpError(400, "Klarifikasi terlalu panjang (maks. 300 huruf).");
  const tak = K.frasaTakDikenal_(data.keterangan || ""); // ["1 hndk", ...]
  const katanya = (f) => f.split(" ").slice(1).join(" ");
  const aturan = [];

  const tambah = (kataMentah, artiMentah) => {
    const kata = rapikanKata(kataMentah);
    let artiBersih = String(artiMentah || "").trim().replace(PENGISI, "");
    const abaikan = KATA_ABAIKAN.test(artiBersih);
    const arti = abaikan ? "" : pilihArti(artiBersih);
    if (!kata) throw httpError(400, `Kata "${String(kataMentah).trim()}" tidak bisa dipakai — tulis kata yang ada di keterangan, mis. "hndk = handuk".`);
    if (kenalPersis(kata)) throw httpError(400, `Kata "${kata}" sudah dikenali sistem, jadi tidak perlu diklarifikasi.`);
    if (!abaikan && !arti) throw httpError(400, `Arti untuk "${kata}" belum jelas — tulis nama barangnya, mis. "${kata} = handuk", atau "${kata} = abaikan".`);
    aturan.push({ jenis: jenisDari(arti, artiBersih), kata, arti });
  };

  // 1) Bentuk eksplisit: "hndk = handuk", "pvs: pcs", "hoddie artinya hoodie", "35 cm = abaikan" (boleh beberapa baris).
  //    Kata di kiri harus memang ada di keterangan nota ini dan belum dikenali sistem — supaya
  //    kalimat biasa ("catatan: 10 pcs") tidak berubah menjadi aturan yang salah.
  const ketKecil = " " + String(data.keterangan || "").toLowerCase() + " ";
  const adaDiKet = (k) => new RegExp("(^|[^a-z])" + k.split(/\s+/).map(escRe).join("\\s*") + "(?![a-z])").test(ketKecil);
  const bagian = teks.split(/\n|;/).map((s) => s.trim()).filter(Boolean);
  for (const b of bagian) {
    const m = b.match(/^(.+?)\s*(?:=>|->|→|=|:|\bartinya\b|\bmaksudnya\b|\byaitu\b|\badalah\b|\bitu\b)\s*(.+)$/i);
    const k = m ? rapikanKata(m[1]) : "";
    if (k && !kenalPersis(k) && adaDiKet(k)) tambah(m[1], m[2]);
  }

  // 2) Tanpa tanda "=": cocokkan dengan frasa yang belum dikenali pada nota ini.
  if (!aturan.length && tak.length) {
    const bersih = teks.replace(PENGISI, "").trim();
    const mAngka = bersih.match(/^(\d+)\s*(.+)$/);
    if (mAngka) {
      const sama = tak.filter((f) => f.split(" ")[0] === mAngka[1]);
      const f = sama.length === 1 ? sama[0] : tak.length === 1 ? tak[0] : null;
      if (f) tambah(katanya(f), mAngka[2]);
    } else if (tak.length === 1 && /^[a-zA-Z][a-zA-Z\s]*$/.test(bersih) && bersih.split(/\s+/).length <= 3) {
      tambah(katanya(tak[0]), bersih);
    }
  }

  // 3) Jumlah pcs untuk nota ini saja ("10 pcs" / "10").
  if (!aturan.length && /\d/.test(teks)) {
    const isi = /^\d+$/.test(teks) ? teks + " pcs" : teks;
    if (!data.nota) throw httpError(400, "Nomor nota tidak diketahui.");
    aturan.push({ jenis: "NOTA", kata: String(data.nota), arti: isi.slice(0, 120) });
  }

  if (!aturan.length) {
    const contoh = tak.length ? `"${katanya(tak[0])} = nama barang yang benar"` : `"10 pcs"`;
    throw httpError(400, `Klarifikasi belum bisa dipahami. Contoh: ${contoh}.`);
  }
  return aturan;
}

/** Kalimat penjelasan aturan untuk owner. */
function jelaskan(a) {
  if (a.jenis === "NOTA") return `Nota ${a.kata}: ditambah keterangan "${a.arti}"`;
  if (a.jenis === "ABAIKAN") return `"${a.kata}" diabaikan (bukan jumlah barang)`;
  if (a.jenis === "HITUNG") return `"${a.kata}" dibaca sebagai barang "${a.arti}" dan dihitung sebagai pcs`;
  if (/^(?:pcs|pc|potong|ptg|lembar|lbr|helai|item)$/.test(a.arti)) return `"${a.kata}" dibaca sebagai "${a.arti}" (jumlah pcs)`;
  const baju = K.hitungSatuanBaju_("1 " + a.arti);
  const jenisBaju = Object.keys(baju)[0];
  if (jenisBaju) return `"${a.kata}" dibaca sebagai "${a.arti}" (dihitung sebagai ${jenisBaju.toLowerCase()})`;
  if (K.hitungSarungBantal_("1 " + a.arti) > 0) return `"${a.kata}" dibaca sebagai "${a.arti}" (dihitung sebagai sarung bantal)`;
  return `"${a.kata}" dibaca sebagai "${a.arti}" (dikenali; jumlahnya dari layanan satuan di nota, bukan dari keterangan)`;
}

// ---------- Penerapan aturan sebelum agregasi ----------

const notaBaris = (ro) => String((ro.cells && ro.cells[2]) || "").trim();

/** Terapkan ALIAS/HITUNG/ABAIKAN ke kolom keterangan (AB) dan tempelkan teks NOTA. */
function terapkanAturan(rows, aturan) {
  const kata = aturan
    .filter((a) => a.jenis !== "NOTA" && a.kata)
    .sort((a, b) => b.kata.length - a.kata.length)
    .map((a) => ({
      re: new RegExp("(^|[^a-z])(" + a.kata.split(/\s+/).map(escRe).join("\\s*") + ")(?![a-z])", "gi"),
      ganti: a.jenis === "ABAIKAN" ? "satuan" : a.arti,
    }));
  const perNota = {};
  aturan.filter((a) => a.jenis === "NOTA").forEach((a) => (perNota[a.kata] = (perNota[a.kata] || []).concat(a.arti)));
  // Teks NOTA ditempel ke baris kiloan pertama nota itu (atau baris pertamanya).
  const target = {};
  for (const ro of rows) {
    const no = notaBaris(ro);
    if (!perNota[no]) continue;
    const w = String(ro.cells[23] || "");
    const kiloan = !/^\s*(satuan|biaya)/i.test(w);
    if (!target[no] || (kiloan && !target[no].kiloan)) target[no] = { ro, kiloan };
  }
  const berubah = new Set();
  const out = rows.map((ro) => {
    const no = notaBaris(ro);
    const ab = ro.cells && ro.cells[28] != null ? String(ro.cells[28]) : "";
    let baru = ab;
    if (kata.length && baru) for (const k of kata) baru = baru.replace(k.re, (m, pre) => pre + k.ganti);
    if (target[no] && target[no].ro === ro) baru = (baru ? baru + "\n" : "") + perNota[no].join("\n");
    if (baru === ab) return ro;
    berubah.add(no);
    return { r: ro.r, cells: Object.assign({}, ro.cells, { 28: baru }) };
  });
  return { rows: out, berubah };
}

/** Jalankan fn dengan barang HITUNG ditambahkan sementara ke SATUAN_BAJU parser. */
function denganBarangTambahan(aturan, fn) {
  const n = K.SATUAN_BAJU.length;
  const sudah = new Set();
  for (const a of aturan) {
    if (a.jenis !== "HITUNG" || sudah.has(a.arti)) continue;
    sudah.add(a.arti);
    K.SATUAN_BAJU.push({
      jenis: a.arti.charAt(0).toUpperCase() + a.arti.slice(1),
      pola: a.arti.split(/\s+/).map(escRe).join("\\s*"),
    });
  }
  try {
    return fn();
  } finally {
    K.SATUAN_BAJU.length = n;
  }
}

/** = agregasiTransaksi_ dengan aturan klarifikasi; tanpa aturan hasilnya identik dengan aslinya. */
function agregasi(rows, aturan) {
  const aktif = (aturan || []).filter((a) => a.aktif !== false);
  if (!aktif.length) return K.agregasiTransaksi_(rows);
  const { rows: olahan, berubah } = terapkanAturan(rows, aktif);
  const list = denganBarangTambahan(aktif, () => K.agregasiTransaksi_(olahan));
  if (berubah.size) {
    // KETERANGAN ASLI tetap teks kasir, bukan teks yang sudah diklarifikasi.
    const asli = K.agregasiTransaksi_(rows.filter((ro) => { const no = notaBaris(ro); return !no || berubah.has(no) || no.toUpperCase() === "NO NOTA"; }));
    const peta = new Map(asli.map((t) => [t.nota, t.keteranganAsli]));
    list.forEach((t) => { if (peta.has(t.nota)) t.keteranganAsli = peta.get(t.nota); });
  }
  return list;
}

// ---------- Penyimpanan aturan (sheet KLARIFIKASI KETERANGAN) ----------

let _cache = { at: 0, id: null, list: null };

/** Semua aturan (aktif & nonaktif) dari sheet; [] bila sheet belum ada. */
async function bacaAturan(id, segar) {
  if (!segar && _cache.list && _cache.id === id && Date.now() - _cache.at < 60000) return _cache.list;
  let rows;
  try {
    rows = await sheets.readRange(id, `${qs(SHEET_K)}!A1:J`, "FORMATTED_VALUE");
  } catch (err) {
    if (/Unable to parse range|not found/i.test(String((err && err.message) || err))) rows = [];
    else throw err;
  }
  const judul = (rows[0] || []).map((h) => String(h).trim().toUpperCase());
  const ix = (h) => judul.indexOf(h);
  const list = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const v = (h) => (ix(h) >= 0 ? String(r[ix(h)] == null ? "" : r[ix(h)]).trim() : "");
    const jenis = v("JENIS").toUpperCase();
    if (!["ALIAS", "HITUNG", "ABAIKAN", "NOTA"].includes(jenis)) continue;
    const kata = jenis === "NOTA" ? v("KATA") : v("KATA").toLowerCase();
    const arti = jenis === "NOTA" ? v("ARTI") : v("ARTI").toLowerCase();
    if (!kata || (jenis !== "ABAIKAN" && !arti)) continue;
    list.push({
      baris: i + 1, waktu: v("WAKTU"), nota: v("NO NOTA"), pelanggan: v("PELANGGAN"), klarifikasi: v("KLARIFIKASI"),
      jenis, kata, arti, aktif: !/^(tidak|nonaktif|no|false)$/i.test(v("AKTIF")),
    });
  }
  _cache = { at: Date.now(), id, list };
  return list;
}

async function aturanAktif(id) {
  return (await bacaAturan(id)).filter((a) => a.aktif);
}

async function pastikanSheet(id) {
  const meta = await sheets.getSheetTitles(id);
  if (!meta.sheets.includes(SHEET_K)) {
    await sheets.batchUpdateRequests(id, [{ addSheet: { properties: { title: SHEET_K, gridProperties: { frozenRowCount: 1 } } } }]);
    await sheets.batchWrite(id, [{ range: `${qs(SHEET_K)}!A1:J1`, values: [JUDUL_K] }]);
  }
}

async function simpanAturan(id, data, aturan) {
  await pastikanSheet(id);
  const waktu = cfg.formatBusinessDateTime(new Date());
  const values = aturan.map((a) => [
    waktu, String(data.nota || ""), String(data.customer || ""), String(data.keterangan || ""), String(data.catatan || ""),
    String(data.klarifikasi || ""), a.jenis, a.kata, a.arti, "YA",
  ]);
  await sheetsClient().spreadsheets.values.append({
    spreadsheetId: id,
    range: `${qs(SHEET_K)}!A1`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });
  _cache = { at: 0, id: null, list: null };
}

async function nonaktifkan(id, baris) {
  const n = Number(baris);
  if (!Number.isInteger(n) || n < 2) throw httpError(400, "Baris aturan tidak valid.");
  const list = await bacaAturan(id, true);
  if (!list.some((a) => a.baris === n)) throw httpError(404, "Aturan tidak ditemukan (mungkin sudah dihapus).");
  const judul = ((await sheets.readRange(id, `${qs(SHEET_K)}!1:1`, "FORMATTED_VALUE"))[0] || []).map((h) => String(h).trim().toUpperCase());
  const c = judul.indexOf("AKTIF");
  if (c < 0) throw httpError(500, "Kolom AKTIF tidak ada di sheet " + SHEET_K + ".");
  const col = String.fromCharCode(65 + c);
  await sheets.batchWrite(id, [{ range: `${qs(SHEET_K)}!${col}${n}`, values: [["TIDAK"]] }]);
  _cache = { at: 0, id: null, list: null };
}

// ---------- Nota "perlu dicek" dari upload terakhir (disimpan lokal) ----------

/** Sidik hasil agregasi satu nota — berubah berarti barisnya di sheet perlu ditulis ulang. */
function sidik(t) {
  return JSON.stringify([t.pcs, Math.round((t.kg || 0) * 1000), t.satuan || "", t.pcsSatuan || 0, t.totalPcs, t.catatan || ""]);
}

/** Simpan baris mentah nota yang perlu dicek (plus baris judul) agar bisa dihitung ulang setelah klarifikasi. */
function simpanPerluDicek(rows, list) {
  const perlu = list.filter((t) => t.catatan);
  const set = new Set(perlu.map((t) => t.nota));
  const judul = rows.filter((ro) => String((ro.cells && ro.cells[2]) || "").trim().toUpperCase() === "NO NOTA").slice(0, 1);
  const nota = {};
  for (const t of perlu) {
    nota[t.nota] = {
      customer: t.customer, catatan: t.catatan, keterangan: t.keteranganAsli || "", totalPcs: t.totalPcs,
      catatanAwal: t.catatan, totalPcsAwal: t.totalPcs, sidik: sidik(t), rows: [],
    };
  }
  for (const ro of rows) {
    const no = notaBaris(ro);
    if (set.has(no)) nota[no].rows.push(ro);
  }
  cfg.writeJsonFile(FILE_PERLU, { waktu: cfg.formatBusinessDateTime(new Date()), judul, urutan: perlu.map((t) => t.nota), nota });
}

function bacaPerluDicek() {
  const d = cfg.readJsonFile(FILE_PERLU, null);
  return d && d.nota && Array.isArray(d.urutan) ? d : null;
}

function tulisPerluDicek(d) {
  cfg.writeJsonFile(FILE_PERLU, d);
}

/** Ringkasan untuk tampilan. */
function daftarPerlu(d) {
  if (!d) return [];
  return d.urutan
    .filter((no) => d.nota[no])
    .map((no) => {
      const x = d.nota[no];
      return {
        nota: no, customer: x.customer, catatan: x.catatanAwal, keterangan: x.keterangan,
        selesai: !x.catatan, catatanSekarang: x.catatan, totalPcs: x.totalPcs, totalPcsAwal: x.totalPcsAwal,
        klarifikasi: x.klarifikasi || "", hasil: x.hasil || "",
      };
    });
}

module.exports = {
  SHEET_K, JUDUL_K, FILE_PERLU,
  tafsir, jelaskan, terapkanAturan, agregasi, kenalPersis,
  bacaAturan, aturanAktif, simpanAturan, nonaktifkan,
  simpanPerluDicek, bacaPerluDicek, tulisPerluDicek, daftarPerlu, sidik, httpError,
};
