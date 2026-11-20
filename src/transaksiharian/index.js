"use strict";

const cfg = require("../config");
const sheets = require("../sheets");
const { sheetsClient, serviceAccountEmail } = require("../google");
const { bacaXlsxSheet } = require("./xlsx");
const { agregasiTransaksi_, KOLOM_KOREKSI_PCS } = require("./kodeinternal");

/*
 * Upload File › Upload Transaksi Harian — padanan apiUploadTransaksi_() dan
 * apiGetTransaksiInfo_() di Dashboard Internal (Kode.gs), tanpa login:
 * dashboard ini menulis langsung ke sheet TRANSAKSI HARIAN di spreadsheet
 * PERFORMA PEGAWAI CO CLEAN LAUNDRY memakai service account-nya sendiri.
 *
 * Aturan pembacaan nota = salinan apa adanya (./kodeinternal.js). Aturan
 * penulisan mengikuti kode aslinya:
 *  - baris ditulis menurut JUDUL kolom sheet (bukan urutan tetap);
 *  - upsert berdasarkan NO NOTA (nota lama diperbarui, nota baru ditambahkan);
 *  - kolom koreksi PCS, kolom tanpa judul, dan kolom asing TIDAK disentuh;
 *  - nilai ditulis seperti setValues Apps Script (USER_ENTERED: teks tanggal
 *    seperti "8 Jul 2026 19:15" menjadi tanggal);
 *  - KONFIG › TRANSAKSI_LAST_UPLOAD diisi waktu sekarang (WITA).
 */

// PERFORMA_SPREADSHEET_ID di Kode.gs Dashboard Internal (file berakses terbatas).
const DEFAULT_SPREADSHEET_ID = "1UIkjAgqWuAdcer3YwxnUhB9dn72DI8uQmz5JBlLIlNs";
const SHEET = "TRANSAKSI HARIAN";
const SHEET_KONFIG = "KONFIG";
const SHEET_PEGAWAI = "PEGAWAI";
const KEY_LAST_UPLOAD = "TRANSAKSI_LAST_UPLOAD";

const spreadsheetId = () => (process.env.INTERNAL_SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID).trim();
const spreadsheetUrl = () => `https://docs.google.com/spreadsheets/d/${spreadsheetId()}/edit`;
const qs = (name) => `'${String(name).replace(/'/g, "''")}'`;

function colLetter(i0) {
  let n = i0 + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Utilities.formatDate(new Date(), 'Asia/Makassar', pola) untuk 'yyyy-MM-dd' & 'yyyy-MM-dd HH:mm:ss'. */
function formatWita(withTime) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: cfg.TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value])
  );
  const tgl = `${p.year}-${p.month}-${p.day}`;
  return withTime ? `${tgl} ${String(Number(p.hour) % 24).padStart(2, "0")}:${p.minute}:${p.second}` : tgl;
}

/** Ubah error Google jadi pesan yang jelas; kurang izin → kode NO_ACCESS. */
async function friendly(err) {
  const status = err && (err.code || (err.response && err.response.status));
  const msg = String((err && err.message) || err);
  if (status === 403 || /permission|caller does not have/i.test(msg)) {
    const email = await serviceAccountEmail().catch(() => null);
    const e = new Error(
      `Dashboard belum punya akses ke spreadsheet "PERFORMA PEGAWAI CO CLEAN LAUNDRY". ` +
        `Bagikan spreadsheet itu ke ${email || "email service account dashboard"} sebagai Editor (sekali saja).`
    );
    e.code = "NO_ACCESS";
    e.serviceAccount = email;
    e.spreadsheetUrl = spreadsheetUrl();
    return e;
  }
  if (status === 404 || /not found|Unable to parse range/i.test(msg)) {
    const e = new Error(`Spreadsheet / sheet ${SHEET} tidak ditemukan di Dashboard Internal.`);
    e.code = "NOT_FOUND";
    return e;
  }
  return err instanceof Error ? err : new Error(msg);
}

// Nomor pegawai owner untuk kolom DIUPLOAD OLEH (yang meng-upload = owner dashboard ini).
let _owner = { at: 0, nomor: null };
async function nomorPegawaiOwner(id) {
  if (_owner.nomor && Date.now() - _owner.at < 10 * 60000) return _owner.nomor;
  let nomor = "OWNER";
  try {
    const head = ((await sheets.readRange(id, `${qs(SHEET_PEGAWAI)}!1:1`, "FORMATTED_VALUE"))[0] || []).map((h) => String(h).trim());
    const iNo = head.indexOf("NOMOR PEGAWAI");
    const iRole = head.indexOf("ROLE");
    const iStatus = head.indexOf("STATUS");
    if (iNo >= 0 && iRole >= 0) {
      const col = async (i) => (i >= 0 ? await sheets.readRange(id, `${qs(SHEET_PEGAWAI)}!${colLetter(i)}2:${colLetter(i)}`, "FORMATTED_VALUE") : []);
      const [nos, roles, stats] = await Promise.all([col(iNo), col(iRole), col(iStatus)]);
      for (let r = 0; r < roles.length; r++) {
        const role = String((roles[r] || [])[0] || "").trim().toUpperCase();
        const st = iStatus >= 0 ? String((stats[r] || [])[0] || "").trim().toUpperCase() : "AKTIF";
        const no = String((nos[r] || [])[0] || "").trim();
        if (role === "OWNER" && st === "AKTIF" && no) {
          nomor = no;
          break;
        }
      }
    }
  } catch {
    /* pakai "OWNER" */
  }
  _owner = { at: Date.now(), nomor };
  return nomor;
}

/** = apiGetTransaksiInfo_: jumlah nota (baris data) & upload terakhir. */
async function info() {
  const id = spreadsheetId();
  try {
    const [kolA, konfig] = await Promise.all([
      sheets.readRange(id, `${qs(SHEET)}!A:A`, "UNFORMATTED_VALUE"),
      sheets.readRange(id, `${qs(SHEET_KONFIG)}!A:B`, "FORMATTED_VALUE"),
    ]);
    const baris = (konfig || []).find((r) => String((r || [])[0]) === KEY_LAST_UPLOAD);
    return {
      jumlah: Math.max(0, (kolA || []).length - 1),
      lastUpload: baris ? String(baris[1] == null ? "" : baris[1]) : "",
    };
  } catch (err) {
    throw await friendly(err);
  }
}

let _sibuk = false;

/** = apiUploadTransaksi_: baca file, agregasi per nota, upsert ke TRANSAKSI HARIAN. */
async function upload(buffer) {
  if (_sibuk) throw new Error("Masih memproses upload sebelumnya. Tunggu sebentar lalu coba lagi.");
  if (!buffer || !buffer.length) throw new Error("File tidak terkirim.");
  _sibuk = true;
  try {
    let list;
    try {
      list = agregasiTransaksi_(bacaXlsxSheet(buffer));
    } catch (err) {
      throw new Error("Gagal memproses file: " + (err && err.message ? err.message : err));
    }
    if (!list.length) throw new Error("Tidak ada transaksi terbaca dari file.");

    const id = spreadsheetId();
    try {
      const judul = ((await sheets.readRange(id, `${qs(SHEET)}!1:1`, "FORMATTED_VALUE"))[0] || []).map((h) => String(h).trim());
      const posisi = {};
      judul.forEach((h, i) => {
        if (h && posisi[h] === undefined) posisi[h] = i;
      });
      if (posisi["NO NOTA"] === undefined) {
        throw new Error(`Sheet ${SHEET} tidak punya kolom "NO NOTA". Jalankan setupSpreadsheet dulu.`);
      }

      // upsert berdasar NO NOTA (akumulasi lintas hari)
      const noCol = colLetter(posisi["NO NOTA"]);
      const kolNota = await sheets.readRange(id, `${qs(SHEET)}!${noCol}2:${noCol}`, "UNFORMATTED_VALUE");
      const existing = {};
      kolNota.forEach((r, i) => {
        const no = String(((r || [])[0]) || "").trim();
        if (no) existing[no] = i + 2;
      });

      const hari = formatWita(false);
      const oleh = await nomorPegawaiOwner(id);
      // Kolom yang diisi dari file: berjudul, dikenal, dan BUKAN kolom koreksi PCS.
      const rowMapOf = (t) => ({
        "NO NOTA": t.nota, "NAMA PELANGGAN": t.customer, OUTLET: t.outlet,
        "TGL TERIMA": t.tglTerima, "TGL SELESAI": t.tglSelesai, "TOTAL TAGIHAN": t.total,
        "JUMLAH PCS": t.pcs, "TOTAL BERAT": Math.round(t.kg * 1000) / 1000,
        "TANGGAL UPLOAD": hari, "DIUPLOAD OLEH": String(oleh),
        SATUAN: t.satuan || "", "PCS SATUAN": t.pcsSatuan || 0, "TOTAL PCS": t.totalPcs,
        "CATATAN PARSE": t.catatan || "",
        "KETERANGAN ASLI": t.keteranganAsli || "",
      });
      const kunciMilik = Object.keys(rowMapOf({ kg: 0 }));
      const milik = judul.map((h, c) => (h && KOLOM_KOREKSI_PCS.indexOf(h) < 0 && kunciMilik.includes(h) ? c : -1)).filter((c) => c >= 0);
      // Segmen kolom bersebelahan (mis. A:N dan T) agar kolom lain tak tertimpa.
      const segmen = [];
      for (const c of milik) {
        const last = segmen[segmen.length - 1];
        if (last && last[1] === c - 1) last[1] = c;
        else segmen.push([c, c]);
      }

      let baru = 0;
      let perbarui = 0;
      const updates = [];
      const appendBuffer = [];
      for (const t of list) {
        const rowMap = rowMapOf(t);
        const barisLama = existing[t.nota];
        if (barisLama) {
          for (const [a, b] of segmen) {
            const vals = [];
            for (let c = a; c <= b; c++) vals.push(rowMap[judul[c]]);
            updates.push({ range: `${qs(SHEET)}!${colLetter(a)}${barisLama}:${colLetter(b)}${barisLama}`, values: [vals] });
          }
          perbarui++;
        } else {
          // Baris baru: kolom selain milik dibiarkan kosong (seperti kode aslinya).
          appendBuffer.push(judul.map((h) => (h && KOLOM_KOREKSI_PCS.indexOf(h) < 0 && h in rowMap ? rowMap[h] : "")));
          baru++;
        }
      }
      for (let i = 0; i < updates.length; i += 400) await sheets.batchWrite(id, updates.slice(i, i + 400));
      if (appendBuffer.length) {
        await sheetsClient().spreadsheets.values.append({
          spreadsheetId: id,
          range: `${qs(SHEET)}!A1`,
          valueInputOption: "USER_ENTERED",
          insertDataOption: "OVERWRITE",
          requestBody: { values: appendBuffer },
        });
      }

      // setKonfigValue_('TRANSAKSI_LAST_UPLOAD', nowIso_())
      const sekarang = formatWita(true);
      const kolKunci = await sheets.readRange(id, `${qs(SHEET_KONFIG)}!A:A`, "UNFORMATTED_VALUE");
      const idx = kolKunci.findIndex((r, i) => i > 0 && String((r || [])[0]) === KEY_LAST_UPLOAD);
      if (idx > 0) {
        await sheets.batchWrite(id, [{ range: `${qs(SHEET_KONFIG)}!B${idx + 1}`, values: [[sekarang]] }]);
      } else {
        await sheetsClient().spreadsheets.values.append({
          spreadsheetId: id,
          range: `${qs(SHEET_KONFIG)}!A1`,
          valueInputOption: "USER_ENTERED",
          insertDataOption: "OVERWRITE",
          requestBody: { values: [[KEY_LAST_UPLOAD, sekarang, ""]] },
        });
      }

      const perluDicek = list.filter((t) => t.catatan).map((t) => ({ nota: t.nota, customer: t.customer, catatan: t.catatan }));
      return {
        message:
          "Berhasil memproses file: " + baru + " nota baru, " + perbarui + " diperbarui." +
          (perluDicek.length ? " ⚠️ " + perluDicek.length + " nota perlu dicek (ada keterangan yang belum terbaca)." : ""),
        baru,
        perbarui,
        total: list.length,
        perluDicek,
      };
    } catch (err) {
      const f = await friendly(err);
      if (f.code) throw f;
      throw new Error("Gagal memproses file: " + f.message);
    }
  } finally {
    _sibuk = false;
  }
}

module.exports = { info, upload, spreadsheetUrl, _colLetter: colLetter };
