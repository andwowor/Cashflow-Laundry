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
// 3. GAJI BULAN INI (spreadsheet bulan berikutnya, dibuat dari salinan bulan ini): kolom E..O diambil dengan
//    IMPORTRANGE(LINK!A2; "GAJI BULAN DEPAN!E2:G10") dst. — urutan baris harus sama dengan GAJI BULAN DEPAN bulan
//    lalu. Saat menu Gaji Bulan Ini dibuka (dan berkala), pegawai yang ada di GAJI BULAN DEPAN bulan lalu tetapi belum
//    ada di GAJI BULAN INI ditambahkan (nama, bank, rekening, gaji pokok; rumus THP & JAM LEMBUR disalin; SISA
//    KASBON = KASBON!H{baris kasbonnya}), dan rentang IMPORTRANGE + SUMIF TOTAL TRANSFER diperpanjang.

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

// ---------------------------------------------------------------- GAJI BULAN INI (bulan berikutnya)

const cacheSinkron = new Map(); // id spreadsheet -> { at, hasil } (hindari baca ulang bulan lalu tiap muat)
const CACHE_MS = 15 * 60 * 1000;

function idDariLink(v) {
  const m = teks(v).match(/\/d\/([A-Za-z0-9_-]{20,})/) || teks(v).match(/^"?([A-Za-z0-9_-]{30,})"?$/);
  return m ? m[1] : null;
}

/**
 * Samakan GAJI BULAN INI dengan GAJI BULAN DEPAN bulan lalu (LINK!A2): tambah pegawai yang belum ada di akhir tabel
 * dan perpanjang rentang IMPORTRANGE. Mengembalikan { ditambah: [nama], rentang, catatan }.
 */
async function sinkronGajiBulanIni(id, opsi = {}) {
  const c = cacheSinkron.get(id);
  if (!opsi.paksa && c && Date.now() - c.at < CACHE_MS) return { ...c.hasil, ditambah: [], dariCache: true };
  const hasil = { ditambah: [], rentang: 0, catatan: [] };
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
  const [ini, iniRumus] = await Promise.all([
    readRange(id, `'${GBI}'!A1:R60`, "UNFORMATTED_VALUE"),
    readRange(id, `'${GBI}'!A1:R60`, "FORMULA"),
  ]);
  const jl = lalu[0] || [];
  const ji = ini[0] || [];
  const L = { nama: kolomIndex(jl, ["PEGAWAI"]), bank: kolomIndex(jl, ["GAJI BANK", "BANK"]), rek: kolomIndex(jl, ["AKUN BANK", "NOMOR REKENING"]), gaji: kolomIndex(jl, ["GAJI POKOK"]), kasbon: kolomIndex(jl, ["POTONGAN KASBON"]) };
  const I = { nama: kolomIndex(ji, ["PEGAWAI"]), bank: kolomIndex(ji, ["GAJI BANK", "BANK"]), rek: kolomIndex(ji, ["AKUN BANK", "NOMOR REKENING"]), gaji: kolomIndex(ji, ["GAJI POKOK"]), thp: kolomIndex(ji, ["THP"]), sisa: kolomIndex(ji, ["SISA KASBON"]), jam: kolomIndex(ji, ["JAM LEMBUR"]) };
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
  if (akhirIni > akhirLalu) {
    hasil.catatan.push(`GAJI BULAN INI punya ${akhirIni - 1} pegawai, GAJI BULAN DEPAN bulan lalu hanya ${akhirLalu - 1} — pegawai di bawah baris ${akhirLalu} tidak mendapat data IMPORTRANGE.`);
  }

  if (akhirLalu > akhirIni) {
    const n = akhirLalu - akhirIni;
    const sheetId = await getSheetId(id, GBI);
    const req = [sisipBaris(sheetId, akhirIni, n)];
    for (const c of [I.thp, I.jam]) if (c >= 0 && /^=/.test(teks((iniRumus[akhirIni - 1] || [])[c]))) req.push(salinRumus(sheetId, akhirIni, akhirIni + 1, akhirLalu, c));
    await batchUpdateRequests(id, req);
    const raw = [];
    const rumus = [];
    for (let r = akhirIni + 1; r <= akhirLalu; r++) {
      const nama = teks((lalu[r - 1] || [])[L.nama]);
      raw.push({ range: `'${GBI}'!${colLetter(I.nama)}${r}`, values: [[nama]] });
      if (I.bank >= 0 && L.bank >= 0) raw.push({ range: `'${GBI}'!${colLetter(I.bank)}${r}`, values: [[teks((lalu[r - 1] || [])[L.bank])]] });
      if (I.rek >= 0 && L.rek >= 0) raw.push({ range: `'${GBI}'!${colLetter(I.rek)}${r}`, values: [[teks((laluTampil[r - 1] || [])[L.rek])]] });
      if (I.gaji >= 0 && L.gaji >= 0) {
        const g = (lalu[r - 1] || [])[L.gaji];
        raw.push({ range: `'${GBI}'!${colLetter(I.gaji)}${r}`, values: [[typeof g === "number" ? g : 0]] });
      }
      const k = L.kasbon >= 0 ? teks((laluRumus[r - 1] || [])[L.kasbon]).match(/KASBON!\$?C\$?(\d+)/i) : null;
      if (I.sisa >= 0 && k) rumus.push({ range: `'${GBI}'!${colLetter(I.sisa)}${r}`, values: [[`=KASBON!H${k[1]}`]] });
      hasil.ditambah.push(nama);
    }
    await tulisRaw(id, raw);
    if (rumus.length) await batchWrite(id, rumus);
    // SUMIF TOTAL TRANSFER di bawah tabel: x2:x<akhirIni> → x2:x<akhirLalu>
    const bawah = await readRange(id, `'${GBI}'!A${akhirLalu + 1}:Z${akhirLalu + 40}`, "FORMULA");
    const pola = new RegExp(`(\\$?[A-Z]{1,2}\\$?)2:(\\$?[A-Z]{1,2}\\$?)${akhirIni}(?!\\d)`, "g");
    const ubahBawah = [];
    bawah.forEach((row, ri) => (row || []).forEach((f, ci) => {
      const s = teks(f);
      if (!/^=/.test(s)) return;
      const b = s.replace(pola, (m0, a, z) => `${a}2:${z}${akhirLalu}`);
      if (b !== s) ubahBawah.push({ range: `'${GBI}'!${colLetter(ci)}${akhirLalu + 1 + ri}`, values: [[b]] });
    }));
    if (ubahBawah.length) await batchWrite(id, ubahBawah);
    hasil.rentang += ubahBawah.length;
  }

  // IMPORTRANGE baris 2: "GAJI BULAN DEPAN!E2:G10" → sampai baris pegawai terakhir bulan lalu.
  const baris2 = (await readRange(id, `'${GBI}'!A2:R2`, "FORMULA"))[0] || [];
  const ubah = [];
  baris2.forEach((f, c) => {
    const s = teks(f);
    if (!/IMPORTRANGE/i.test(s)) return;
    const b = perpanjangRentangImport(s, GBD, akhirLalu);
    if (b !== s) ubah.push({ range: `'${GBI}'!${colLetter(c)}2`, values: [[b]] });
  });
  if (ubah.length) await batchWrite(id, ubah);
  hasil.rentang += ubah.length;
  if (hasil.ditambah.length) cacheSinkron.delete(id);
  else simpan();
  return hasil;
}

module.exports = { tambahKeProyeksi, tambahBarisKasbon, sinkronGajiBulanIni, sisipkanSuku, perpanjangRentangImport, kelompokOutlet, idDariLink };
