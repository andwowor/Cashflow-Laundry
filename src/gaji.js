"use strict";

// Menu "Gaji Bulan Ini" — baca-saja dari spreadsheet CASHFLOW DAN BIAYA bulan berjalan.
//
// Sheet GAJI BULAN INI (CASHFLOW NOVEMBER 2026):
//   baris 1 judul: PEGAWAI | GAJI BANK | AKUN BANK | GAJI POKOK | LEMBUR | UANG MAKAN | THR | BONUS |
//     BONUS REFERAL | TUNJANGAN LAIN | POTONGAN LEMBUR | POTONGAN KETIDAKHADIRAN | POTONGAN KASBON |
//     POTONGAN KERUGIAN | POTONGAN LAIN-LAIN | THP | SISA KASBON | JAM LEMBUR
//   baris 2..(sebelum baris kosong) = pegawai. GAJI POKOK diketik; LEMBUR..THR, TUNJANGAN..POTONGAN
//     KASBON, POTONGAN KERUGIAN..LAIN-LAIN = IMPORTRANGE(LINK!A2; "GAJI BULAN DEPAN!…") dari spreadsheet
//     bulan lalu; THP = D+E+F+G+H+I+J-K-L-M-N-O; SISA KASBON = KASBON!H{n}; JAM LEMBUR = LEMBUR/6250.
//   baris 12..19 "TOTAL TRANSFER PER REKENING": KEBUTUHAN = SUMIF(bank; THP) (MANDIRI + BSI), STATUS =
//     saldo KONTROL KAS, SELISIH = saldo − kebutuhan − 100.000 (BCA juga − 1.350.000 return investasi,
//     diketik langsung di rumus).
// Sheet KONTROL KAS: B2 BCA, B3 BRI, B4 BNI, B5 MANDIRI (='INPUT LAPORAN HARIAN'!B6..B9),
//   B10 KAS TUNAI MAUMBI, B11 KAS TUNAI PERKAMIL.
// Sheet KEBUTUHAN AWAL BULAN: baris "Return Investasi" (kolom MAUMBI & PERKAMIL) = return investasi bulan ini.
//
// Tabel status kas di dashboard (permintaan Andre, 26 Nov 2026): per bank
//   sisa = saldo terkini − 100.000 (saldo minimum) − return investasi (khusus BCA) − kebutuhan gaji;
//   kas tunai: sisa = (kas tunai Maumbi + Perkamil) − kebutuhan gaji tunai.

const cfg = require("./config");
const { resolveCashflowSpreadsheetId, readRange, getSheetTitles } = require("./sheets");

const SALDO_MINIMUM = 100000;
const BANK = ["BCA", "BRI", "BNI", "MANDIRI"];
// Bank pegawai → rekening sumber transfer (BSI dibayar dari MANDIRI, seperti rumus di sheet).
const SUMBER_BANK = { BCA: "BCA", BRI: "BRI", BNI: "BNI", MANDIRI: "MANDIRI", BSI: "MANDIRI", CASH: "TUNAI", TUNAI: "TUNAI", KAS: "TUNAI" };

const KOLOM = [
  ["nama", "PEGAWAI"], ["bank", "GAJI BANK"], ["rekening", "AKUN BANK"],
  ["gajiPokok", "GAJI POKOK"], ["lembur", "LEMBUR"], ["uangMakan", "UANG MAKAN"], ["thr", "THR"], ["bonus", "BONUS"],
  ["bonusReferal", "BONUS REFERAL"], ["tunjanganLain", "TUNJANGAN LAIN"], ["potLembur", "POTONGAN LEMBUR"],
  ["potKetidakhadiran", "POTONGAN KETIDAKHADIRAN"], ["potKasbon", "POTONGAN KASBON"], ["potKerugian", "POTONGAN KERUGIAN"],
  ["potLain", "POTONGAN LAIN-LAIN"], ["thp", "THP"], ["sisaKasbon", "SISA KASBON"], ["jamLembur", "JAM LEMBUR"],
];
const PENDAPATAN = ["gajiPokok", "lembur", "uangMakan", "thr", "bonus", "bonusReferal", "tunjanganLain"];
const POTONGAN = ["potLembur", "potKetidakhadiran", "potKasbon", "potKerugian", "potLain"];

const teks = (v) => String(v == null ? "" : v).trim();
const norm = (v) => teks(v).toUpperCase().replace(/\s+/g, " ");
function angka(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = teks(v);
  if (!s || s === "-") return 0;
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s);
  const n = Number(s.replace(/[^\d,]/g, "").replace(",", "."));
  return Number.isFinite(n) ? (neg ? -n : n) : 0;
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/** Baca tabel pegawai dari GAJI BULAN INI. */
function susunPegawai(nilai, tampil) {
  const judul = (nilai[0] || []).map(norm);
  const ix = {};
  KOLOM.forEach(([k, h]) => (ix[k] = judul.indexOf(h)));
  if (ix.nama < 0 || ix.thp < 0) throw httpError(500, 'Kolom "PEGAWAI"/"THP" tidak ditemukan di baris judul sheet GAJI BULAN INI.');
  const pegawai = [];
  for (let i = 1; i < nilai.length; i++) {
    const r = nilai[i] || [];
    const nama = teks(r[ix.nama]);
    if (!nama) break; // tabel pegawai berakhir di baris kosong pertama
    if (/^TOTAL\b/i.test(nama)) break;
    const p = { baris: i + 1, nama };
    for (const [k] of KOLOM) {
      if (k === "nama" || ix[k] < 0) continue;
      if (k === "bank") p.bank = teks(r[ix.bank]);
      else if (k === "rekening") p.rekening = teks(((tampil[i] || [])[ix.rekening]) != null ? tampil[i][ix.rekening] : r[ix.rekening]);
      else p[k] = angka(r[ix[k]]);
    }
    p.totalPendapatan = PENDAPATAN.reduce((a, k) => a + (p[k] || 0), 0);
    p.totalPotongan = POTONGAN.reduce((a, k) => a + (p[k] || 0), 0);
    p.sumber = SUMBER_BANK[norm(p.bank)] || null;
    p.aktif = p.thp !== 0 || p.gajiPokok !== 0 || p.totalPendapatan !== 0;
    pegawai.push(p);
  }
  return pegawai;
}

/** Baris berlabel di KONTROL KAS (kolom A) → nilai kolom B; cadangan = nomor baris yang diketahui. */
function nilaiKontrol(rows, label, barisCadangan) {
  let i = rows.findIndex((r) => norm((r || [])[0]) === label);
  if (i < 0 && barisCadangan) i = barisCadangan - 1;
  const r = rows[i] || [];
  return { label: teks(r[0]) || label, nilai: angka(r[1]), baris: i + 1, ada: i >= 0 && r.length > 1 && teks(r[1]) !== "" };
}

/** Return investasi dari sheet kebutuhan (baris "Return Investasi", kolom MAUMBI + PERKAMIL). */
function bacaReturnInvestasi(rows) {
  const r = (rows || []).find((x) => norm((x || [])[0]) === "RETURN INVESTASI");
  return r ? { nilai: angka(r[1]) + angka(r[2]), ada: true } : { nilai: 0, ada: false };
}

/**
 * Tabel status kas untuk gaji: per bank sisa = saldo − 100.000 − return investasi (BCA) − THP lewat bank itu;
 * kas tunai: (Maumbi + Perkamil) − THP tunai. kontrol = baris sheet KONTROL KAS (A:B).
 */
function hitungStatusKas(pegawai, kontrol, returnInvestasi) {
  const catatan = [];
  const bankBaris = { BCA: 2, BRI: 3, BNI: 4, MANDIRI: 5 };
  const saldoBank = BANK.map((b) => ({ kode: b, ...nilaiKontrol(kontrol, b, bankBaris[b]) }));
  const tunaiM = nilaiKontrol(kontrol, "KAS TUNAI MAUMBI", 10);
  const tunaiP = nilaiKontrol(kontrol, "KAS TUNAI PERKAMIL", 11);

  const kebutuhanPer = { BCA: 0, BRI: 0, BNI: 0, MANDIRI: 0, TUNAI: 0 };
  const pegawaiPer = { BCA: [], BRI: [], BNI: [], MANDIRI: [], TUNAI: [] };
  const tanpaSumber = [];
  for (const p of pegawai) {
    if (!p.thp) continue;
    if (!p.sumber) { tanpaSumber.push(p); continue; }
    kebutuhanPer[p.sumber] += p.thp;
    pegawaiPer[p.sumber].push(`${p.nama}${norm(p.bank) !== p.sumber && p.sumber !== "TUNAI" ? ` (${p.bank})` : ""}`);
  }
  if (tanpaSumber.length) {
    catatan.push(
      `Bank pegawai berikut tidak dikenali sehingga tidak dihitung ke rekening mana pun: ${tanpaSumber.map((p) => `${p.nama} (${p.bank || "kosong"})`).join(", ")}.`
    );
  }

  const status = saldoBank.map((b) => {
    const ret = b.kode === "BCA" ? returnInvestasi : 0;
    const kebutuhanGaji = kebutuhanPer[b.kode];
    const sisa = b.nilai - SALDO_MINIMUM - ret - kebutuhanGaji;
    return {
      kode: b.kode, nama: b.kode, jenis: "bank", saldo: b.nilai, saldoMinimum: SALDO_MINIMUM, returnInvestasi: ret,
      kebutuhan: kebutuhanGaji, sisa, cukup: sisa >= 0, pegawai: pegawaiPer[b.kode], barisKontrol: b.baris,
    };
  });
  const saldoTunai = tunaiM.nilai + tunaiP.nilai;
  status.push({
    kode: "TUNAI", nama: "KAS TUNAI", jenis: "tunai", saldo: saldoTunai, saldoMinimum: 0, returnInvestasi: 0,
    kebutuhan: kebutuhanPer.TUNAI, sisa: saldoTunai - kebutuhanPer.TUNAI, cukup: saldoTunai - kebutuhanPer.TUNAI >= 0,
    pegawai: pegawaiPer.TUNAI, rincian: [{ nama: "Kas tunai Maumbi", saldo: tunaiM.nilai }, { nama: "Kas tunai Perkamil", saldo: tunaiP.nilai }],
  });
  const jumlah = (k) => status.reduce((a, x) => a + x[k], 0);
  const total = {
    saldo: jumlah("saldo"), saldoMinimum: jumlah("saldoMinimum"), returnInvestasi: jumlah("returnInvestasi"),
    kebutuhan: jumlah("kebutuhan"), sisa: jumlah("sisa"),
  };
  return { status, total, catatan };
}

function ringkasPegawai(pegawai) {
  return {
    jumlahPegawai: pegawai.length,
    dibayar: pegawai.filter((p) => p.thp > 0).length,
    totalThp: pegawai.reduce((a, p) => a + p.thp, 0),
    totalPendapatan: pegawai.reduce((a, p) => a + p.totalPendapatan, 0),
    totalPotongan: pegawai.reduce((a, p) => a + p.totalPotongan, 0),
    totalSisaKasbon: pegawai.reduce((a, p) => a + (p.sisaKasbon || 0), 0),
  };
}

async function load() {
  const { id } = await resolveCashflowSpreadsheetId();
  const meta = await getSheetTitles(id);
  for (const s of ["GAJI BULAN INI", "KONTROL KAS"]) {
    if (!meta.sheets.includes(s)) throw httpError(404, `Sheet "${s}" tidak ditemukan di spreadsheet ${meta.title}.`);
  }
  const adaKebutuhan = meta.sheets.includes("KEBUTUHAN AWAL BULAN");
  const [gaji, gajiTampil, kontrol, kebutuhan] = await Promise.all([
    readRange(id, "'GAJI BULAN INI'!A1:R60", "UNFORMATTED_VALUE"),
    readRange(id, "'GAJI BULAN INI'!A1:R60", "FORMATTED_VALUE"),
    readRange(id, "'KONTROL KAS'!A1:B30", "UNFORMATTED_VALUE"),
    adaKebutuhan ? readRange(id, "'KEBUTUHAN AWAL BULAN'!A1:C60", "UNFORMATTED_VALUE") : Promise.resolve([]),
  ]);

  const pegawai = susunPegawai(gaji, gajiTampil);
  const catatan = [];

  // Return investasi bulan ini (KEBUTUHAN AWAL BULAN › Return Investasi, MAUMBI + PERKAMIL).
  const ret = bacaReturnInvestasi(kebutuhan);
  if (!ret.ada) catatan.push('Baris "Return Investasi" di sheet KEBUTUHAN AWAL BULAN tidak ditemukan — return investasi dianggap 0.');
  const st = hitungStatusKas(pegawai, kontrol, ret.nilai);

  const sync = cfg.getLastSync ? cfg.getLastSync() : null;
  return {
    ok: true,
    spreadsheet: { id, title: meta.title, url: `https://docs.google.com/spreadsheets/d/${id}/edit` },
    pegawai,
    ringkas: ringkasPegawai(pegawai),
    status: st.status,
    total: st.total,
    returnInvestasi: ret.nilai,
    saldoMinimum: SALDO_MINIMUM,
    catatan: catatan.concat(st.catatan),
    updateHarian: sync ? sync.display : null,
    dimuat: cfg.formatBusinessDateTime(new Date()),
  };
}

module.exports = { load, susunPegawai, bacaReturnInvestasi, hitungStatusKas, ringkasPegawai, httpError, angka, norm, SALDO_MINIMUM };
