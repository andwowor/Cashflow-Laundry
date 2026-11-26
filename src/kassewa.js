"use strict";

// Menu "Kas Sewa Gedung" — sheet KAS SEWA GEDUNG di spreadsheet CASHFLOW DAN BIAYA bulan
// berjalan (spreadsheet tiap bulan membawa seluruh riwayat sejak Okt 2025).
//
// Struktur sheet (CASHFLOW NOVEMBER 2026):
//   baris 1 = judul: A MAUMBI | B PERKAMIL | C PERIODE | D TOTAL | E KETERANGAN | (F status) | (G)
//   baris 2 = ringkasan: A2 =SUM(A3:A1002), B2 =SUM(B3:B1002), D2 =SUM(D3:D1002) = SALDO kas
//             (diperbaiki 26 Nov 2026; sebelumnya A3:A26, B3:B7, D3:D100), G2 =SUM(G3:G100).
//   baris 3.. = transaksi: nominal bertanda di A (MAUMBI) atau B (PERKAMIL) — positif = masuk
//             (tabungan sewa gedung / pengembalian), negatif = keluar (pemakaian); C tanggal (serial,
//             validasi tanggal); D =IFERROR(A+B;"") sudah terpasang s/d baris 1002; E keterangan;
//             F status bebas ("Sudah dikembalikan"); G =D{n} pada sebagian baris berstatus.
// Saldo di dashboard dihitung dari SEMUA baris (bukan hanya sampai baris 100 seperti D2), dan
// dashboard memberi peringatan bila transaksi sudah melewati rentang rumus D2.
//
// Input transaksi menulis A/B (nominal bertanda), C (serial tanggal), E (keterangan) dengan RAW
// di baris kosong pertama setelah transaksi terakhir — dicari ulang tepat sebelum menulis.

const crypto = require("crypto");
const cfg = require("./config");
const { sheetsClient } = require("./google");
const { resolveCashflowSpreadsheetId, readRange, getSheetTitles, getSheetId, batchUpdateRequests } = require("./sheets");

const SHEET = "KAS SEWA GEDUNG";
const BARIS_AWAL = 3;
const OUTLET = ["MAUMBI", "PERKAMIL"];
const MAX_NOMINAL = 1e11;
const qs = `'${SHEET}'`;
// Format angka kolom A/B di baris lama (akuntansi Rupiah).
const FORMAT_RUPIAH = '_-[$Rp-421]* #,##0_-;_-[$Rp-421]* \\-#,##0_-;_-[$Rp-421]* "-"??_-;_-@';

function httpError(status, message, extra) {
  const e = new Error(message);
  e.status = status;
  Object.assign(e, extra || {});
  return e;
}

const teks = (v) => String(v == null ? "" : v).trim();
function angka(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = teks(v);
  if (!s) return null;
  const n = Number(s.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// Serial tanggal Sheets (hari sejak 30 Des 1899) <-> "yyyy-mm-dd".
const EPOCH = Date.UTC(1899, 11, 30);
function serialKeIso(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "";
  const d = new Date(EPOCH + Math.round(n) * 86400000);
  return d.toISOString().slice(0, 10);
}
function isoKeSerial(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(t);
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
  return Math.round((t - EPOCH) / 86400000);
}
const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
function isoKeTeks(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${+m[3]} ${BULAN[+m[2] - 1]} ${m[1]}` : "";
}
function hariIniIso() {
  const { year, month, day } = cfg.nowInBusinessTz();
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

async function sumber() {
  const { id } = await resolveCashflowSpreadsheetId();
  const meta = await getSheetTitles(id);
  if (!meta.sheets.includes(SHEET)) {
    throw httpError(404, `Sheet "${SHEET}" tidak ditemukan di spreadsheet ${meta.title}.`);
  }
  return { id, title: meta.title };
}

/** Baca & susun seluruh data kas. */
async function load() {
  const { id, title } = await sumber();
  const [nilai, rumus] = await Promise.all([
    readRange(id, `${qs}!A1:G`, "UNFORMATTED_VALUE"),
    readRange(id, `${qs}!A2:G2`, "FORMULA"),
  ]);
  const transaksi = [];
  let barisTerakhir = BARIS_AWAL - 1;
  for (let i = BARIS_AWAL - 1; i < nilai.length; i++) {
    const r = nilai[i] || [];
    const a = angka(r[0]);
    const b = angka(r[1]);
    const ket = teks(r[4]);
    const status = teks(r[5]);
    const adaTanggal = typeof r[2] === "number" || teks(r[2]) !== "";
    if (a == null && b == null && !ket && !adaTanggal && !status) continue;
    barisTerakhir = i + 1;
    const nominal = (a || 0) + (b || 0);
    transaksi.push({
      row: i + 1,
      tanggal: typeof r[2] === "number" ? serialKeIso(r[2]) : "",
      tanggalTeks: typeof r[2] === "number" ? isoKeTeks(serialKeIso(r[2])) : teks(r[2]),
      maumbi: a,
      perkamil: b,
      outlet: a && b ? "MAUMBI + PERKAMIL" : b ? "PERKAMIL" : a != null ? "MAUMBI" : "",
      nominal,
      keterangan: ket,
      status,
    });
  }

  // Saldo berjalan menurut urutan tanggal (baris tanpa tanggal mengikuti baris di atasnya).
  let tglSebelum = "";
  const urut = transaksi.map((t, i) => {
    const kunci = t.tanggal || tglSebelum;
    tglSebelum = kunci;
    return { t, kunci, i };
  });
  urut.sort((x, y) => (x.kunci < y.kunci ? -1 : x.kunci > y.kunci ? 1 : x.i - y.i));
  let saldo = 0;
  let masuk = 0;
  let keluar = 0;
  urut.forEach(({ t }, k) => {
    saldo += t.nominal;
    if (t.nominal > 0) masuk += t.nominal;
    else keluar += t.nominal;
    t.saldoSetelah = saldo;
    t.urut = k;
  });

  const baris2 = nilai[1] || [];
  const rumus2 = rumus[0] || [];
  const mTotal = teks(rumus2[3]).match(/SUM\(\s*D(\d+)\s*:\s*D(\d+)\s*\)/i);
  const akhirRumus = mTotal ? Number(mTotal[2]) : null;
  const saldoSheet = angka(baris2[3]);
  const peringatan = [];
  if (akhirRumus && barisTerakhir > akhirRumus) {
    peringatan.push(
      `Rumus TOTAL di sheet (D2 ${teks(rumus2[3])}) hanya menjumlah sampai baris ${akhirRumus}, padahal transaksi sudah sampai baris ${barisTerakhir}. Saldo di dashboard sudah menghitung semua baris.`
    );
  } else if (saldoSheet != null && Math.abs(saldoSheet - saldo) > 0.5) {
    peringatan.push(`Saldo menurut rumus sheet (D2) ${saldoSheet.toLocaleString("id-ID")} berbeda dengan jumlah semua transaksi.`);
  }

  const saran = [];
  const sudah = new Set();
  for (let i = transaksi.length - 1; i >= 0 && saran.length < 40; i--) {
    const k = transaksi[i].keterangan;
    if (k && !sudah.has(k.toLowerCase())) { sudah.add(k.toLowerCase()); saran.push(k); }
  }

  const terakhir = urut.length ? urut[urut.length - 1].t : null;
  return {
    ok: true,
    spreadsheet: { id, title, url: `https://docs.google.com/spreadsheets/d/${id}/edit` },
    sheet: SHEET,
    saldo,
    saldoSheet,
    masuk,
    keluar,
    jumlah: transaksi.length,
    barisTerakhir,
    akhirRumus,
    peringatan,
    terakhir,
    transaksi: urut.map((x) => x.t).reverse(), // terbaru dulu
    saran,
    hariIni: hariIniIso(),
    dimuat: cfg.formatBusinessDateTime(new Date()),
  };
}

function parseNominal(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  const s = String(v == null ? "" : v).replace(/rp/gi, "").replace(/\s+/g, "");
  if (!s) return NaN;
  if (!/^\d{1,3}(\.\d{3})*(,\d+)?$|^\d+(,\d+)?$/.test(s)) return NaN;
  return Number(s.replace(/\./g, "").replace(",", "."));
}

let antrean = Promise.resolve();
function eksklusif(fn) {
  const run = antrean.then(fn);
  antrean = run.catch(() => {});
  return run;
}

async function tulisRaw(id, data) {
  await sheetsClient().spreadsheets.values.batchUpdate({
    spreadsheetId: id,
    requestBody: { valueInputOption: "RAW", data },
  });
}

/**
 * Tambah transaksi. body: { tanggal "yyyy-mm-dd", jenis "masuk"|"keluar", outlet, nominal, keterangan, token }.
 */
function simpan(body) {
  return eksklusif(async () => {
    const b = body || {};
    const jenis = teks(b.jenis).toLowerCase();
    if (jenis !== "masuk" && jenis !== "keluar") throw httpError(400, "Pilih jenis transaksi: Masuk atau Keluar.");
    const outlet = teks(b.outlet).toUpperCase();
    if (!OUTLET.includes(outlet)) throw httpError(400, "Pilih outlet: MAUMBI atau PERKAMIL.");
    const nominal = parseNominal(b.nominal);
    if (!Number.isFinite(nominal) || nominal <= 0) throw httpError(400, "Nominal harus angka lebih dari 0, mis. 1.500.000");
    if (nominal >= MAX_NOMINAL) throw httpError(400, "Nominal terlalu besar.");
    const serial = isoKeSerial(b.tanggal);
    if (serial == null) throw httpError(400, "Tanggal tidak valid.");
    const ket = teks(b.keterangan).replace(/\s+/g, " ");
    if (!ket) throw httpError(400, "Keterangan wajib diisi.");
    if (ket.length > 200) throw httpError(400, "Keterangan terlalu panjang (maks. 200 huruf).");

    const data = await load();
    if (b.token && b.token !== data.spreadsheet.id) {
      throw httpError(409, "Spreadsheet CASHFLOW bulan ini sudah berganti. Data dimuat ulang — silakan ulangi.", { data });
    }
    const id = data.spreadsheet.id;
    const baris = data.barisTerakhir + 1;

    // Pastikan baris tujuan benar-benar kosong & rumus TOTAL (D) ada.
    const [cek] = await Promise.all([readRange(id, `${qs}!A${baris}:G${baris}`, "FORMULA")]);
    const isi = (cek && cek[0]) || [];
    if ([0, 1, 2, 4, 5].some((c) => teks(isi[c]) !== "")) {
      throw httpError(409, "Baris tujuan di sheet ternyata sudah terisi. Data dimuat ulang — silakan ulangi.", { data });
    }
    const sheetId = await getSheetId(id, SHEET);
    if (sheetId == null) throw httpError(404, `Sheet "${SHEET}" tidak ditemukan.`);
    // Nominal A:B berformat Rupiah seperti baris lama (sel kosong di bawah belum berformat).
    const permintaan = [
      {
        repeatCell: {
          range: { sheetId, startRowIndex: baris - 1, endRowIndex: baris, startColumnIndex: 0, endColumnIndex: 2 },
          cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: FORMAT_RUPIAH } } },
          fields: "userEnteredFormat.numberFormat",
        },
      },
    ];
    if (!/^=/.test(teks(isi[3]))) {
      // Salin rumus D dari baris atasnya (mengikuti locale spreadsheet).
      permintaan.push({
        copyPaste: {
          source: { sheetId, startRowIndex: baris - 2, endRowIndex: baris - 1, startColumnIndex: 3, endColumnIndex: 4 },
          destination: { sheetId, startRowIndex: baris - 1, endRowIndex: baris, startColumnIndex: 3, endColumnIndex: 4 },
          pasteType: "PASTE_FORMULA",
        },
      });
    }
    await batchUpdateRequests(id, permintaan);

    const nilai = jenis === "masuk" ? nominal : -nominal;
    const kolom = outlet === "MAUMBI" ? "A" : "B";
    await tulisRaw(id, [
      { range: `${qs}!${kolom}${baris}`, values: [[nilai]] },
      { range: `${qs}!C${baris}`, values: [[serial]] },
      { range: `${qs}!E${baris}`, values: [[ket]] },
    ]);
    const fresh = await load();
    const t = fresh.transaksi.find((x) => x.row === baris);
    return {
      ok: true,
      tersimpan: {
        row: baris,
        tanggal: serialKeIso(serial),
        tanggalTeks: isoKeTeks(serialKeIso(serial)),
        outlet,
        nominal: nilai,
        keterangan: ket,
        saldoSetelah: fresh.saldo,
        kunci: kunciTransaksi(baris, nilai, serial, ket),
      },
      cocok: !!t && Math.abs(t.nominal - nilai) < 0.5,
      data: fresh,
    };
  });
}

function kunciTransaksi(row, nilai, serial, ket) {
  return crypto.createHash("sha1").update([row, nilai, serial, ket].join("|")).digest("hex").slice(0, 16);
}

/** Batalkan transaksi yang baru dicatat: kosongkan A/B/C/E bila isinya masih persis sama. */
function batalkan(body) {
  return eksklusif(async () => {
    const b = body || {};
    const row = Number(b.row);
    if (!Number.isInteger(row) || row < BARIS_AWAL) throw httpError(400, "Baris tidak valid.");
    const data = await load();
    if (b.token && b.token !== data.spreadsheet.id) throw httpError(409, "Spreadsheet CASHFLOW sudah berganti.", { data });
    const t = data.transaksi.find((x) => x.row === row);
    if (!t) throw httpError(404, "Transaksi itu sudah tidak ada di sheet.", { data });
    const serial = isoKeSerial(t.tanggal);
    if (kunciTransaksi(row, t.nominal, serial, t.keterangan) !== b.kunci || t.status) {
      throw httpError(409, "Isi baris itu sudah berubah di sheet, jadi tidak dibatalkan dari dashboard.", { data });
    }
    await tulisRaw(data.spreadsheet.id, [{ range: `${qs}!A${row}:C${row}`, values: [["", "", ""]] }, { range: `${qs}!E${row}`, values: [[""]] }]);
    return { ok: true, dibatalkan: { row, keterangan: t.keterangan, nominal: t.nominal }, data: await load() };
  });
}

module.exports = { load, simpan, batalkan, parseNominal, isoKeSerial, serialKeIso, SHEET };
