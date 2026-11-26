"use strict";

// Tindak lanjut otomatis saat ada pegawai baru (permintaan Andre 26 Nov 2026), dipakai Gaji & Kasbon:
//
// 1. PROYEKSI BIAYA (CASHFLOW bulan berjalan): kolom START <bulan depan> per outlet menjumlah sel pegawai di
//    GAJI BULAN DEPAN satu per satu, mis. E7 = ('GAJI BULAN DEPAN'!D2+…!D3+…!D8+…!D9)+(…J…)-(…L…)…,
//    E8 = …!G2+…!G3+…!G8+…!G9 (THR), E9 bonus (H & I), E12 lembur (E − K); PERKAMIL di kolom K dengan baris lain.
//    KEBUTUHAN AWAL BULAN DEPAN = ='PROYEKSI BIAYA'!E{n}/K{n}. Pegawai baru → setiap rantai "sel+sel+sel" (kolom
//    sama, baris pegawai) pada rumus di kelompok kolom outletnya diberi suku baris baru. Rentang (F2:F4) tidak disentuh.
// 2. KASBON: baris "Kasbon Gaji <panggilan>" disisipkan setelah baris terakhir, rumus B/C/H/I disalin dari baris
//    atasnya, rentang IMPORTRANGE baris 2 ("KASBON!H2:H11", "KASBON!C2:C11") diperpanjang, dan POTONGAN KASBON
//    pegawai itu di GAJI BULAN DEPAN = =KASBON!C{baris}.
// 3. GAJI BULAN INI spreadsheet yang sama: pegawai baru langsung dicantumkan dengan GAJI POKOK 0 (permintaan Andre
//    26 Nov 2026: gajinya baru dibayar bulan depan, total gaji bulan ini tidak boleh berubah), posisinya sejajar dengan
//    GAJI BULAN DEPAN, kolom IMPORTRANGE (E..O) dibiarkan kosong.
// 4. GAJI BULAN INI spreadsheet bulan berikutnya (salinan bulan ini): kolom E..O diambil dengan IMPORTRANGE(LINK!A2;
//    "GAJI BULAN DEPAN!E2:G10") dst. — urutan baris harus sama dengan GAJI BULAN DEPAN bulan lalu. Saat menu Gaji Bulan
//    Ini dibuka (dan berkala): pegawai yang belum ada ditambahkan (gaji pokok dari GAJI BULAN DEPAN bulan lalu; rumus THP
//    & JAM LEMBUR disalin; SISA KASBON = KASBON!H{baris kasbonnya}); GAJI POKOK yang masih salinan apa adanya dari GAJI
//    BULAN INI bulan lalu (mis. 0 milik pegawai baru, atau gaji pegawai yang sudah berhenti) disamakan dengan GAJI BULAN
//    DEPAN bulan lalu; rentang IMPORTRANGE + SUMIF TOTAL TRANSFER diperpanjang.

const cfg = require("./config");
const { readRange, getSheetTitles, getSheetId, batchWrite, batchUpdateRequests } = require("./sheets");
const { sheetsClient } = require("./google");

const GBD = "GAJI BULAN DEPAN";
const GBI = "GAJI BULAN INI";
const KASBON = "KASBON";
const PROYEKSI = "PROYEKSI BIAYA";

const teks = (v) => String(v == null ? "" : v).trim();
const norm = (v) => teks(v).toUpperCase().replace(/\s+/g, " ");
function colLetter(i) {
  let n = i + 1, s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function kolomIndex(judulBaris, daftar) {
  const j = (judulBaris || []).map(norm);
  for (const h of daftar) { const i = j.indexOf(h); if (i >= 0) return i; }
  return -1;
}
/** Baris terakhir (1-based) tabel yang kolom kuncinya terisi berurutan mulai baris 2. */
function barisAkhir(rows, iKunci) {
  let akhir = 1;
  for (let i = 1; i < rows.length; i++) {
    if (!teks((rows[i] || [])[iKunci])) break;
    akhir = i + 1;
  }
  return akhir;
}
async function tulisRaw(id, data) {
  await sheetsClient().spreadsheets.values.batchUpdate({ spreadsheetId: id, requestBody: { valueInputOption: "RAW", data } });
}
const salinRumus = (sheetId, dariBaris, keBaris, keBarisAkhir, kolom) => ({
  copyPaste: {
    source: { sheetId, startRowIndex: dariBaris - 1, endRowIndex: dariBaris, startColumnIndex: kolom, endColumnIndex: kolom + 1 },
    destination: { sheetId, startRowIndex: keBaris - 1, endRowIndex: keBarisAkhir, startColumnIndex: kolom, endColumnIndex: kolom + 1 },
    pasteType: "PASTE_FORMULA",
  },
});
const sisipBaris = (sheetId, setelahBaris, jumlah = 1) => ({
  insertDimension: { range: { sheetId, dimension: "ROWS", startIndex: setelahBaris, endIndex: setelahBaris + jumlah }, inheritFromBefore: true },
});

// ---------------------------------------------------------------- PROYEKSI BIAYA

const REF_GBD = /'GAJI BULAN DEPAN'!(\$?)([A-Z]{1,3})(\$?)(\d+)/g;

/**
 * Tambah suku 'GAJI BULAN DEPAN'!<kolom><barisBaru> di belakang setiap rantai sel+sel (kolom sama, baris pegawai
 * 2..barisMaks, minimal 2 sel). Sel yang bagian dari rentang (A2:A4) diabaikan.
 */
function sisipkanSuku(f, barisBaru, barisMaks) {
  const refs = [];
  REF_GBD.lastIndex = 0;
  let m;
  while ((m = REF_GBD.exec(f))) {
    const s = m.index, e = s + m[0].length;
    refs.push({ s, e, kol: m[2], baris: +m[4], rentang: f[e] === ":" || f[s - 1] === ":" });
  }
  const grup = [];
  let cur = null;
  for (const r of refs) {
    if (r.rentang || r.baris < 2 || (r.baris > barisMaks && r.baris !== barisBaru)) { cur = null; continue; }
    if (cur && cur.kol === r.kol && /^\s*\+\s*$/.test(f.slice(cur.akhir.e, r.s))) {
      cur.isi.push(r);
      cur.akhir = r;
    } else {
      cur = { kol: r.kol, isi: [r], akhir: r };
      grup.push(cur);
    }
  }
  let out = f;
  let ditambah = 0;
  let tunggal = 0;
  for (const g of grup.slice().reverse()) {
    if (g.isi.some((r) => r.baris === barisBaru)) continue;
    if (g.isi.length < 2) { tunggal++; continue; }
    out = out.slice(0, g.akhir.e) + `+'${GBD}'!${g.kol}${barisBaru}` + out.slice(g.akhir.e);
    ditambah++;
  }
  return { rumus: out, ditambah, tunggal };
}

/** Kelompok kolom per outlet dari baris judul (mis. B2 "MAUMBI", H2 "PERKAMIL"). */
function kelompokOutlet(grid) {
  for (let r = 0; r < Math.min(grid.length, 6); r++) {
    const row = grid[r] || [];
    const pos = [];
    row.forEach((v, c) => { if (["MAUMBI", "PERKAMIL"].includes(norm(v))) pos.push({ outlet: norm(v), c }); });
    if (pos.length) {
      return pos.map((p, i) => ({ outlet: p.outlet, dari: p.c, sampai: i + 1 < pos.length ? pos[i + 1].c - 1 : 60 }));
    }
  }
  return [];
}

/**
 * Masukkan pegawai baru (baris barisBaru di GAJI BULAN DEPAN; pegawai lama di baris 2..barisMaks) ke rumus
 * PROYEKSI BIAYA kolom outletnya. Rumus yang hasilnya galat dikembalikan.
 */
async function tambahKeProyeksi(id, outlet, barisBaru, barisMaks) {
  const o = norm(outlet);
  const hasil = { outlet: o, sel: [], subjek: [], dikembalikan: [], catatan: [] };
  const meta = await getSheetTitles(id);
  if (!meta.sheets.includes(PROYEKSI)) { hasil.catatan.push(`Sheet ${PROYEKSI} tidak ditemukan.`); return hasil; }
  const grid = await readRange(id, `'${PROYEKSI}'!A1:Z80`, "FORMULA");
  const kel = kelompokOutlet(grid).find((k) => k.outlet === o);
  if (!kel) { hasil.catatan.push(`Kolom outlet ${o} tidak ditemukan di baris judul ${PROYEKSI}.`); return hasil; }
  const tulis = [];
  const lama = {};
  let tunggal = 0;
  grid.forEach((row, ri) => (row || []).forEach((f, ci) => {
    if (ci < kel.dari || ci > kel.sampai) return;
    const s = teks(f);
    if (!/^=/.test(s) || !s.includes(`'${GBD}'!`)) return;
    const r = sisipkanSuku(s, barisBaru, barisMaks);
    tunggal += r.tunggal;
    if (!r.ditambah) return;
    const a1 = `${colLetter(ci)}${ri + 1}`;
    lama[a1] = s;
    tulis.push({ range: `'${PROYEKSI}'!${a1}`, values: [[r.rumus]] });
    hasil.sel.push(a1);
    hasil.subjek.push(teks((row || [])[0]) || a1);
  }));
  if (tunggal) hasil.catatan.push(`${tunggal} rumus ${PROYEKSI} merujuk satu sel pegawai saja — tidak diubah, periksa bila perlu.`);
  if (!tulis.length) return hasil;
  await batchWrite(id, tulis);
  // Periksa hasilnya: rumus yang galat dikembalikan ke semula.
  const cek = await readRange(id, `'${PROYEKSI}'!A1:Z80`, "FORMATTED_VALUE");
  const balik = [];
  for (const a1 of hasil.sel) {
    const m = a1.match(/^([A-Z]+)(\d+)$/);
    const c = [...m[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    const v = teks(((cek[+m[2] - 1] || [])[c]));
    if (/^#/.test(v)) balik.push({ range: `'${PROYEKSI}'!${a1}`, values: [[lama[a1]]] });
  }
  if (balik.length) {
    await batchWrite(id, balik);
    hasil.dikembalikan = balik.map((b) => b.range.split("!")[1]);
    const gagal = new Set(hasil.dikembalikan);
    hasil.subjek = hasil.subjek.filter((_, i) => !gagal.has(hasil.sel[i]));
    hasil.sel = hasil.sel.filter((a) => !gagal.has(a));
    hasil.catatan.push(`Rumus ${hasil.dikembalikan.join(", ")} di ${PROYEKSI} galat setelah diubah — dikembalikan seperti semula.`);
  }
  return hasil;
}

// ---------------------------------------------------------------- KASBON

/** Perpanjang rentang "<SHEET>!X2:Y<n>" di dalam rumus (IMPORTRANGE) sampai baris `sampai` bila lebih pendek. */
function perpanjangRentangImport(f, sheet, sampai) {
  const pola = new RegExp(`(${sheet}!\\$?[A-Z]{1,3}\\$?2:\\$?[A-Z]{1,3}\\$?)(\\d+)`, "g");
  return f.replace(pola, (m0, awal, n) => (+n < sampai ? `${awal}${sampai}` : m0));
}

/**
 * Baris KASBON untuk pegawai baru + POTONGAN KASBON-nya di GAJI BULAN DEPAN. Bila SUBJEK yang sama sudah ada,
 * baris itu dipakai (mis. pegawai lama yang kembali).
 */
async function tambahBarisKasbon(id, subjek, barisGbd) {
  const meta = await getSheetTitles(id);
  if (!meta.sheets.includes(KASBON)) throw new Error(`Sheet ${KASBON} tidak ditemukan.`);
  const grid = await readRange(id, `'${KASBON}'!A1:I80`, "FORMULA");
  const akhir = barisAkhir(grid, 0);
  let baris = 0;
  for (let i = 1; i < akhir; i++) if (norm((grid[i] || [])[0]) === norm(subjek)) baris = i + 1;
  const hasil = { subjek, baris, baru: false, rentang: [], potongan: null };
  if (!baris) {
    const sheetId = await getSheetId(id, KASBON);
    baris = akhir + 1;
    const req = [sisipBaris(sheetId, akhir)];
    (grid[akhir - 1] || []).forEach((f, c) => {
      if (c > 0 && /^=/.test(teks(f)) && !/IMPORTRANGE/i.test(teks(f))) req.push(salinRumus(sheetId, akhir, baris, baris, c));
    });
    await batchUpdateRequests(id, req);
    await tulisRaw(id, [{ range: `'${KASBON}'!A${baris}`, values: [[subjek]] }]);
    Object.assign(hasil, { baris, baru: true });
  }
  // Rentang IMPORTRANGE baris 2 (sisa & rencana potong bulan lalu) harus mencakup baris ini.
  const baris2 = (await readRange(id, `'${KASBON}'!A2:I2`, "FORMULA"))[0] || [];
  const ubah = [];
  baris2.forEach((f, c) => {
    const s = teks(f);
    if (!/IMPORTRANGE/i.test(s)) return;
    const b = perpanjangRentangImport(s, KASBON, baris);
    if (b !== s) { ubah.push({ range: `'${KASBON}'!${colLetter(c)}2`, values: [[b]] }); hasil.rentang.push(`${colLetter(c)}2`); }
  });
  if (ubah.length) await batchWrite(id, ubah);
  // POTONGAN KASBON di GAJI BULAN DEPAN (hanya bila masih kosong).
  const judul = ((await readRange(id, `'${GBD}'!A1:R1`, "FORMATTED_VALUE"))[0]) || [];
  const iPot = kolomIndex(judul, ["POTONGAN KASBON"]);
  if (iPot >= 0) {
    const sel = `'${GBD}'!${colLetter(iPot)}${barisGbd}`;
    const isi = teks(((await readRange(id, sel, "FORMULA"))[0] || [])[0]);
    if (!isi) {
      await batchWrite(id, [{ range: sel, values: [[`=KASBON!C${baris}`]] }]);
      hasil.potongan = `${colLetter(iPot)}${barisGbd}`;
    }
  }
  return hasil;
}

// ---------------------------------------------------------------- GAJI BULAN INI

const cacheSinkron = new Map(); // id spreadsheet -> { at, hasil } (hindari baca ulang bulan lalu tiap muat)
const CACHE_MS = 15 * 60 * 1000;

function idDariLink(v) {
  const m = teks(v).match(/\/d\/([A-Za-z0-9_-]{20,})/) || teks(v).match(/^"?([A-Za-z0-9_-]{30,})"?$/);
  return m ? m[1] : null;
}
const kolomGbi = (judul) => ({
  nama: kolomIndex(judul, ["PEGAWAI"]), bank: kolomIndex(judul, ["GAJI BANK", "BANK"]), rek: kolomIndex(judul, ["AKUN BANK", "NOMOR REKENING"]),
  gaji: kolomIndex(judul, ["GAJI POKOK"]), thp: kolomIndex(judul, ["THP"]), sisa: kolomIndex(judul, ["SISA KASBON"]), jam: kolomIndex(judul, ["JAM LEMBUR"]),
  kasbon: kolomIndex(judul, ["POTONGAN KASBON"]),
});
const angkaSel = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * Sisipkan pegawai di akhir tabel GAJI BULAN INI (setelah baris `akhir`): nama, bank, rekening (teks), gaji pokok,
 * rumus THP & JAM LEMBUR disalin dari baris atasnya, SISA KASBON = KASBON!H{k}, SUMIF TOTAL TRANSFER diperpanjang.
 * daftar = [{ nama, bank, rekening, gaji, kasbon (baris KASBON | null) }]. Mengembalikan jumlah rumus diperpanjang.
 */
async function sisipPegawaiGbi(id, akhir, daftar, I, iniRumus) {
  const n = daftar.length;
  const sampai = akhir + n;
  const sheetId = await getSheetId(id, GBI);
  const req = [sisipBaris(sheetId, akhir, n)];
  for (const c of [I.thp, I.jam]) if (c >= 0 && /^=/.test(teks((iniRumus[akhir - 1] || [])[c]))) req.push(salinRumus(sheetId, akhir, akhir + 1, sampai, c));
  await batchUpdateRequests(id, req);
  const raw = [];
  const rumus = [];
  daftar.forEach((p, i) => {
    const r = akhir + 1 + i;
    raw.push({ range: `'${GBI}'!${colLetter(I.nama)}${r}`, values: [[p.nama]] });
    if (I.bank >= 0) raw.push({ range: `'${GBI}'!${colLetter(I.bank)}${r}`, values: [[p.bank || ""]] });
    if (I.rek >= 0) raw.push({ range: `'${GBI}'!${colLetter(I.rek)}${r}`, values: [[p.rekening || ""]] });
    if (I.gaji >= 0) raw.push({ range: `'${GBI}'!${colLetter(I.gaji)}${r}`, values: [[p.gaji]] });
    if (I.sisa >= 0 && p.kasbon) rumus.push({ range: `'${GBI}'!${colLetter(I.sisa)}${r}`, values: [[`=KASBON!H${p.kasbon}`]] });
  });
  await tulisRaw(id, raw);
  if (rumus.length) await batchWrite(id, rumus);
  // SUMIF TOTAL TRANSFER di bawah tabel: x2:x<akhir> → x2:x<sampai>
  const bawah = await readRange(id, `'${GBI}'!A${sampai + 1}:Z${sampai + 40}`, "FORMULA");
  const pola = new RegExp(`(\\$?[A-Z]{1,2}\\$?)2:(\\$?[A-Z]{1,2}\\$?)${akhir}(?!\\d)`, "g");
  const ubah = [];
  bawah.forEach((row, ri) => (row || []).forEach((f, ci) => {
    const s = teks(f);
    if (!/^=/.test(s)) return;
    const b = s.replace(pola, (m0, a, z) => `${a}2:${z}${sampai}`);
    if (b !== s) ubah.push({ range: `'${GBI}'!${colLetter(ci)}${sampai + 1 + ri}`, values: [[b]] });
  }));
  if (ubah.length) await batchWrite(id, ubah);
  return ubah.length;
}

/** Baris KASBON dari rumus POTONGAN KASBON (=KASBON!C{k}, =MIN(KASBON!C{k};…) dst.). */
const barisKasbonDari = (f) => { const m = teks(f).match(/KASBON!\$?C\$?(\d+)/i); return m ? +m[1] : null; };

/**
 * Pegawai baru di GAJI BULAN DEPAN → ikut dicantumkan di GAJI BULAN INI spreadsheet yang SAMA (bulan ini) dengan
 * GAJI POKOK 0: gajinya baru dibayar bulan depan, jadi total gaji bulan ini tidak boleh berubah. Kolom E..O baris baru
 * dibiarkan kosong (rentang IMPORTRANGE TIDAK diperpanjang — bulan lalu ia belum bekerja). Baris GAJI BULAN INI disamakan
 * posisinya dengan GAJI BULAN DEPAN agar spreadsheet bulan depan (salinan bulan ini) langsung selaras.
 */
async function tambahKeGajiBulanIni(id, namaBaru) {
  const meta = await getSheetTitles(id);
  if (!meta.sheets.includes(GBI)) throw new Error(`Sheet ${GBI} tidak ditemukan.`);
  const [gbd, gbdTampil, gbdRumus, ini, iniRumus] = await Promise.all([
    readRange(id, `'${GBD}'!A1:R60`, "UNFORMATTED_VALUE"),
    readRange(id, `'${GBD}'!A1:R60`, "FORMATTED_VALUE"),
    readRange(id, `'${GBD}'!A1:R60`, "FORMULA"),
    readRange(id, `'${GBI}'!A1:R60`, "UNFORMATTED_VALUE"),
    readRange(id, `'${GBI}'!A1:R60`, "FORMULA"),
  ]);
  const D = kolomGbi(gbd[0] || []);
  const I = kolomGbi(ini[0] || []);
  if (D.nama < 0 || I.nama < 0 || I.gaji < 0 || I.thp < 0) throw new Error(`Kolom PEGAWAI/GAJI POKOK/THP tidak ditemukan di sheet ${GBI}.`);
  const akhirGbd = barisAkhir(gbd, D.nama);
  const akhirIni = barisAkhir(ini, I.nama);
  const hasil = { ditambah: [], baris: [], sudahAda: false, totalSebelum: 0, totalSesudah: 0, rentang: 0, catatan: [] };
  const totalThp = (rows, akhir) => { let t = 0; for (let r = 2; r <= akhir; r++) t += angkaSel((rows[r - 1] || [])[I.thp]); return t; };
  hasil.totalSebelum = totalThp(ini, akhirIni);
  const namaIni = new Set();
  for (let r = 2; r <= akhirIni; r++) namaIni.add(norm((ini[r - 1] || [])[I.nama]));
  if (namaIni.has(norm(namaBaru))) {
    hasil.sudahAda = true;
    hasil.totalSesudah = hasil.totalSebelum;
    return hasil;
  }
  for (let r = 2; r <= Math.min(akhirGbd, akhirIni); r++) {
    const a = teks((ini[r - 1] || [])[I.nama]);
    const b = teks((gbd[r - 1] || [])[D.nama]);
    if (norm(a) !== norm(b)) hasil.catatan.push(`Baris ${r}: GAJI BULAN INI berisi "${a}", GAJI BULAN DEPAN berisi "${b}" — urutan kedua sheet sebaiknya sama agar data bulan depan tidak tertukar.`);
  }
  // Semua pegawai GAJI BULAN DEPAN yang posisinya belum ada di GAJI BULAN INI (biasanya hanya pegawai baru).
  let baru = [];
  for (let r = akhirIni + 1; r <= akhirGbd; r++) {
    const nama = teks((gbd[r - 1] || [])[D.nama]);
    if (!namaIni.has(norm(nama))) baru.push({ r, nama });
  }
  if (!baru.some((p) => norm(p.nama) === norm(namaBaru))) {
    const r = gbd.findIndex((x, i) => i > 0 && norm((x || [])[D.nama]) === norm(namaBaru)) + 1;
    if (r < 2) throw new Error(`"${namaBaru}" tidak ditemukan di ${GBD}.`);
    baru = [{ r, nama: teks((gbd[r - 1] || [])[D.nama]) }];
    hasil.catatan.push(`GAJI BULAN INI tidak sepanjang/sejajar GAJI BULAN DEPAN — ${baru[0].nama} ditambahkan di akhir; periksa urutan barisnya.`);
  }
  const daftar = baru.map(({ r, nama }) => ({
    nama,
    bank: D.bank >= 0 ? teks((gbd[r - 1] || [])[D.bank]) : "",
    rekening: D.rek >= 0 ? teks((gbdTampil[r - 1] || [])[D.rek]) : "",
    gaji: 0,
    kasbon: D.kasbon >= 0 ? barisKasbonDari((gbdRumus[r - 1] || [])[D.kasbon]) : null,
  }));
  hasil.rentang = await sisipPegawaiGbi(id, akhirIni, daftar, I, iniRumus);
  hasil.ditambah = daftar.map((p) => p.nama);
  hasil.baris = daftar.map((_, i) => akhirIni + 1 + i);
  // Rentang IMPORTRANGE yang sudah mencakup baris baru akan mengisinya dengan data bulan lalu milik orang lain.
  const baris2 = ((await readRange(id, `'${GBI}'!A2:R2`, "FORMULA"))[0] || []).map(teks).filter((f) => /IMPORTRANGE/i.test(f));
  for (const f of baris2) {
    const m = f.match(/GAJI BULAN DEPAN!\$?[A-Z]{1,3}\$?2:\$?[A-Z]{1,3}\$?(\d+)/i);
    if (m && +m[1] >= hasil.baris[0]) hasil.catatan.push(`Rentang IMPORTRANGE di ${GBI} baris 2 sudah sampai baris ${m[1]} — baris pegawai baru bisa terisi data bulan lalu; periksa.`);
  }
  const sesudah = await readRange(id, `'${GBI}'!A1:R60`, "UNFORMATTED_VALUE");
  hasil.totalSesudah = totalThp(sesudah, akhirIni + daftar.length);
  if (Math.abs(hasil.totalSesudah - hasil.totalSebelum) >= 0.5) {
    hasil.catatan.push(`Total THP GAJI BULAN INI berubah dari ${hasil.totalSebelum.toLocaleString("id-ID")} menjadi ${hasil.totalSesudah.toLocaleString("id-ID")} — periksa baris ${hasil.baris.join(", ")}.`);
  }
  return hasil;
}

function catatanSinkronGaji() {
  const c = cfg.getStoredConfig();
  return c.gajiPokokSinkron && typeof c.gajiPokokSinkron === "object" ? c.gajiPokokSinkron : {};
}
function simpanSinkronGaji(obj) {
  const c = cfg.getStoredConfig();
  const kunci = Object.keys(obj);
  if (kunci.length > 6) kunci.slice(0, kunci.length - 6).forEach((k) => delete obj[k]);
  c.gajiPokokSinkron = obj;
  cfg.saveStoredConfig(c);
}

/**
 * Samakan GAJI BULAN INI dengan GAJI BULAN DEPAN bulan lalu (LINK!A2):
 *  - pegawai yang belum ada → ditambah di akhir tabel (gaji pokok dari GAJI BULAN DEPAN bulan lalu);
 *  - GAJI POKOK yang masih SALINAN APA ADANYA dari GAJI BULAN INI bulan lalu tetapi berbeda dengan GAJI BULAN DEPAN bulan
 *    lalu (pegawai baru yang bulan lalu dicantumkan bergaji 0, pegawai yang berhenti) → disamakan, sekali per spreadsheet
 *    per nama (config gajiPokokSinkron) sehingga ubahan manual sesudahnya tidak ditimpa;
 *  - rentang IMPORTRANGE diperpanjang.
 * Mengembalikan { ditambah: [nama], gajiPokok: [{nama, dari, ke}], rentang, catatan }.
 */
async function sinkronGajiBulanIni(id, opsi = {}) {
  const c = cacheSinkron.get(id);
  if (!opsi.paksa && c && Date.now() - c.at < CACHE_MS) return { ...c.hasil, ditambah: [], gajiPokok: [], dariCache: true };
  const hasil = { ditambah: [], gajiPokok: [], rentang: 0, catatan: [] };
  const simpan = () => { cacheSinkron.set(id, { at: Date.now(), hasil }); return hasil; };
  const meta = await getSheetTitles(id);
  if (!meta.sheets.includes(GBI) || !meta.sheets.includes("LINK")) return simpan();
  const idLalu = idDariLink(((await readRange(id, "'LINK'!A2", "FORMATTED_VALUE"))[0] || [])[0]);
  if (!idLalu || idLalu === id) return simpan();
  let lalu, laluTampil, laluRumus;
  try {
    [lalu, laluTampil, laluRumus] = await Promise.all([
      readRange(idLalu, `'${GBD}'!A1:R60`, "UNFORMATTED_VALUE"),
      readRange(idLalu, `'${GBD}'!A1:R60`, "FORMATTED_VALUE"),
      readRange(idLalu, `'${GBD}'!A1:R60`, "FORMULA"),
    ]);
  } catch (e) {
    hasil.catatan.push(`GAJI BULAN DEPAN di spreadsheet bulan lalu (LINK!A2) tidak bisa dibaca: ${e.message} — pegawai baru bulan lalu tidak bisa disamakan otomatis.`);
    return simpan();
  }
  let laluGbi = null; // GAJI BULAN INI bulan lalu: penanda gaji pokok yang masih salinan apa adanya
  try { laluGbi = await readRange(idLalu, `'${GBI}'!A1:R60`, "UNFORMATTED_VALUE"); } catch { laluGbi = null; }
  const [ini, iniRumus] = await Promise.all([
    readRange(id, `'${GBI}'!A1:R60`, "UNFORMATTED_VALUE"),
    readRange(id, `'${GBI}'!A1:R60`, "FORMULA"),
  ]);
  const L = kolomGbi(lalu[0] || []);
  const I = kolomGbi(ini[0] || []);
  const LI = laluGbi ? kolomGbi(laluGbi[0] || []) : null;
  if (L.nama < 0 || I.nama < 0) return simpan();
  const akhirLalu = barisAkhir(lalu, L.nama);
  const akhirIni = barisAkhir(ini, I.nama);

  for (let r = 2; r <= Math.min(akhirLalu, akhirIni); r++) {
    const a = teks((ini[r - 1] || [])[I.nama]);
    const b = teks((lalu[r - 1] || [])[L.nama]);
    if (norm(a) !== norm(b)) {
      hasil.catatan.push(`Baris ${r}: GAJI BULAN INI berisi "${a}" tetapi GAJI BULAN DEPAN bulan lalu berisi "${b}" — angka IMPORTRANGE (lembur, potongan, dll.) bisa tertukar. Samakan urutan barisnya.`);
    }
  }
  // Baris yang tidak ada di GAJI BULAN DEPAN bulan lalu wajar untuk pegawai baru (bergaji 0 bulan ini); selain itu periksa.
  for (let r = akhirLalu + 1; r <= akhirIni; r++) {
    const g = angkaSel((ini[r - 1] || [])[I.gaji]);
    if (g) hasil.catatan.push(`${teks((ini[r - 1] || [])[I.nama])} (baris ${r}) bergaji pokok ${g.toLocaleString("id-ID")} di GAJI BULAN INI tetapi tidak ada di GAJI BULAN DEPAN bulan lalu — lembur/potongannya tidak terambil.`);
  }

  // GAJI POKOK: salinan apa adanya dari bulan lalu → samakan dengan GAJI BULAN DEPAN bulan lalu (sekali per spreadsheet).
  if (LI && LI.nama >= 0 && LI.gaji >= 0 && I.gaji >= 0 && L.gaji >= 0) {
    const semua = catatanSinkronGaji();
    const sudah = semua[id] || {};
    const tulis = [];
    for (let r = 2; r <= Math.min(akhirLalu, akhirIni); r++) {
      const nama = teks((ini[r - 1] || [])[I.nama]);
      const k = norm(nama);
      if (k !== norm((lalu[r - 1] || [])[L.nama]) || k !== norm((laluGbi[r - 1] || [])[LI.nama]) || sudah[k]) continue;
      const sekarang = (ini[r - 1] || [])[I.gaji];
      const lama = (laluGbi[r - 1] || [])[LI.gaji];
      const seharusnya = angkaSel((lalu[r - 1] || [])[L.gaji]);
      if (/^=/.test(teks((iniRumus[r - 1] || [])[I.gaji]))) continue; // gaji pokok berupa rumus → dibiarkan
      const salinan = angkaSel(sekarang) === angkaSel(lama); // belum diubah sejak disalin dari bulan lalu
      if (!salinan || angkaSel(sekarang) === seharusnya) continue;
      tulis.push({ range: `'${GBI}'!${colLetter(I.gaji)}${r}`, values: [[seharusnya]] });
      hasil.gajiPokok.push({ nama, dari: angkaSel(sekarang), ke: seharusnya });
      sudah[k] = { dari: angkaSel(sekarang), ke: seharusnya };
    }
    if (tulis.length) {
      await tulisRaw(id, tulis);
      semua[id] = sudah;
      simpanSinkronGaji(semua);
    }
  }

  if (akhirLalu > akhirIni) {
    const daftar = [];
    for (let r = akhirIni + 1; r <= akhirLalu; r++) {
      daftar.push({
        nama: teks((lalu[r - 1] || [])[L.nama]),
        bank: L.bank >= 0 ? teks((lalu[r - 1] || [])[L.bank]) : "",
        rekening: L.rek >= 0 ? teks((laluTampil[r - 1] || [])[L.rek]) : "",
        gaji: L.gaji >= 0 ? angkaSel((lalu[r - 1] || [])[L.gaji]) : 0,
        kasbon: L.kasbon >= 0 ? barisKasbonDari((laluRumus[r - 1] || [])[L.kasbon]) : null,
      });
    }
    hasil.rentang += await sisipPegawaiGbi(id, akhirIni, daftar, I, iniRumus);
    hasil.ditambah = daftar.map((p) => p.nama);
  }

  // IMPORTRANGE baris 2: "GAJI BULAN DEPAN!E2:G10" → sampai baris pegawai terakhir bulan lalu.
  const baris2 = (await readRange(id, `'${GBI}'!A2:R2`, "FORMULA"))[0] || [];
  const ubah = [];
  baris2.forEach((f, c2) => {
    const s = teks(f);
    if (!/IMPORTRANGE/i.test(s)) return;
    const b = perpanjangRentangImport(s, GBD, akhirLalu);
    if (b !== s) ubah.push({ range: `'${GBI}'!${colLetter(c2)}2`, values: [[b]] });
  });
  if (ubah.length) await batchWrite(id, ubah);
  hasil.rentang += ubah.length;
  if (hasil.ditambah.length || hasil.gajiPokok.length) cacheSinkron.delete(id);
  else simpan();
  return hasil;
}

/** Lupakan cache sinkron (mis. setelah tambah pegawai) agar pemeriksaan berikutnya membaca ulang. */
const lupakanCache = (id) => cacheSinkron.delete(id);

module.exports = {
  tambahKeProyeksi, tambahBarisKasbon, tambahKeGajiBulanIni, sinkronGajiBulanIni, lupakanCache,
  sisipkanSuku, perpanjangRentangImport, kelompokOutlet, idDariLink,
};
