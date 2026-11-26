"use strict";

// Gaji & Kasbon › Kasbon — sheet KASBON (spreadsheet CASHFLOW bulan berjalan) + cicilan potongan.
//
// Sheet KASBON (CASHFLOW NOVEMBER 2026), satu baris per pegawai:
//   A SUBJEK ("Kasbon Gaji <nama>", sama dengan keterangan di DAFTAR BIAYA)
//   B NOMINAL KASBON BULAN INI = SUMIF('INPUT PENGGUNAAN BIAYA'!B; A; C)  (kasbon baru bulan ini)
//   C RENCANA POTONG BULAN DEPAN = B + H                                   (seluruh kasbon yang belum lunas)
//   D SISA KASBON BULAN SEBELUMNYA = IMPORTRANGE(LINK!A2; "KASBON!H2:H11")
//   E RENCANA POTONG BULAN INI = IMPORTRANGE(LINK!A2; "KASBON!C2:C11")    (= C bulan lalu; judul lama "RENCANA POTONG";
//     rentang diperluas dari C2:C9 dan A11 "Kasbin…" diperbaiki jadi "Kasbon…" pada 26 Nov 2026)
//   F DIBAYAR (diketik), G TANGGAL BAYAR (diketik), H SISA = E − F, I TOTAL KASBON = B + H
// Potongan gaji bulan depan: sheet GAJI BULAN DEPAN kolom POTONGAN KASBON (M) = KASBON!C{baris pegawai itu}
// (urutan baris kedua sheet tidak sama; pemetaannya dibaca dari rumus kolom M).
//
// CICILAN: bila pegawai minta dicicil, KASBON!C TIDAK diubah — C tetap seluruh kasbon sehingga bulan
// depan E (= C bulan ini) tetap penuh dan H = E − F (F = yang benar-benar dipotong) menyimpan sisanya.
// Yang diubah hanya rumus POTONGAN KASBON di GAJI BULAN DEPAN: =MIN(KASBON!C{n};cicilan)
// (potong paling banyak sebesar cicilan; bila sisa kasbon lebih kecil, dipotong sisanya saja).
// Kembali "potong penuh" = =KASBON!C{n}. Pola ini sama dengan cara manual owner (=KASBON!C3-1000000).

const cfg = require("./config");
const { resolveCashflowSpreadsheetId, readRange, getSheetTitles, batchWrite } = require("./sheets");

const SHEET = "KASBON";
const GBD = "GAJI BULAN DEPAN";
// Judul kolom (boleh beberapa ejaan; E diganti "RENCANA POTONG BULAN INI" pada 26 Nov 2026).
const KOLOM = [
  ["subjek", ["SUBJEK"]], ["baru", ["NOMINAL KASBON BULAN INI"]], ["rencanaDepan", ["RENCANA POTONG BULAN DEPAN"]],
  ["sisaLalu", ["SISA KASBON BULAN SEBELUMNYA"]], ["rencana", ["RENCANA POTONG BULAN INI", "RENCANA POTONG"]],
  ["dibayar", ["DIBAYAR"]], ["tanggalBayar", ["TANGGAL BAYAR"]], ["sisa", ["SISA"]], ["total", ["TOTAL KASBON"]],
];
const MAX_NOMINAL = 1e10;

const teks = (v) => String(v == null ? "" : v).trim();
const norm = (v) => teks(v).toUpperCase().replace(/\s+/g, " ");
function angka(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = teks(v);
  if (!s || s === "-") return 0;
  const n = Number(s.replace(/[^\d,-]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}
function httpError(status, message, extra) {
  const e = new Error(message);
  e.status = status;
  Object.assign(e, extra || {});
  return e;
}
const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
function serialKeTeks(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return teks(n);
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
  return `${d.getUTCDate()} ${BULAN[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
const colLetter = (i) => String.fromCharCode(65 + i);

/** Jenis rumus POTONGAN KASBON di GAJI BULAN DEPAN. */
function bacaRumusPotong(f) {
  const s = teks(f);
  let m = s.match(/^=\s*KASBON!\$?C\$?(\d+)\s*$/i);
  if (m) return { baris: +m[1], mode: "penuh" };
  m = s.match(/^=\s*MIN\(\s*KASBON!\$?C\$?(\d+)\s*[;,]\s*(\d+(?:\.\d+)?)\s*\)\s*$/i);
  if (m) return { baris: +m[1], mode: "cicil", cicilan: Number(m[2]) };
  m = s.match(/^=\s*KASBON!\$?C\$?(\d+)\s*-\s*(\d+(?:\.\d+)?)\s*$/i);
  if (m) return { baris: +m[1], mode: "manual", ditunda: Number(m[2]) };
  m = s.match(/KASBON!\$?C\$?(\d+)/i);
  if (m) return { baris: +m[1], mode: "khusus" };
  return null;
}

async function bacaSemua() {
  const { id } = await resolveCashflowSpreadsheetId();
  const meta = await getSheetTitles(id);
  if (!meta.sheets.includes(SHEET)) throw httpError(404, `Sheet "${SHEET}" tidak ditemukan di spreadsheet ${meta.title}.`);
  const adaGbd = meta.sheets.includes(GBD);
  const adaDaftar = meta.sheets.includes("DAFTAR BIAYA");
  const [kas, kasRumus, gbd, gbdRumus, daftar] = await Promise.all([
    readRange(id, `'${SHEET}'!A1:I80`, "UNFORMATTED_VALUE"),
    readRange(id, `'${SHEET}'!A2:I2`, "FORMULA"),
    adaGbd ? readRange(id, `'${GBD}'!A1:Q60`, "UNFORMATTED_VALUE") : Promise.resolve([]),
    adaGbd ? readRange(id, `'${GBD}'!A1:Q60`, "FORMULA") : Promise.resolve([]),
    adaDaftar ? readRange(id, "'DAFTAR BIAYA'!A2:A1000", "UNFORMATTED_VALUE") : Promise.resolve(null),
  ]);
  return { id, title: meta.title, kas, kasRumus, gbd, gbdRumus, daftar, adaGbd };
}

function susun(src) {
  const { kas, kasRumus, gbd, gbdRumus, daftar } = src;
  const judul = (kas[0] || []).map(norm);
  const ix = {};
  KOLOM.forEach(([k, hs]) => (ix[k] = hs.map((h) => judul.indexOf(h)).find((i) => i >= 0) ?? -1));
  if (ix.subjek < 0 || ix.sisa < 0) throw httpError(500, 'Kolom "SUBJEK"/"SISA" tidak ditemukan di baris judul sheet KASBON.');
  const catatan = [];

  // GAJI BULAN DEPAN: kolom PEGAWAI & POTONGAN KASBON, dipetakan ke baris KASBON lewat rumusnya.
  const gJudul = (gbd[0] || []).map(norm);
  const gNama = gJudul.indexOf("PEGAWAI");
  const gPot = gJudul.indexOf("POTONGAN KASBON");
  const peta = {};
  if (src.adaGbd && gPot >= 0) {
    for (let i = 1; i < gbd.length; i++) {
      const nama = teks((gbd[i] || [])[gNama]);
      if (!nama) break;
      const f = (gbdRumus[i] || [])[gPot];
      const r = bacaRumusPotong(f);
      if (!r) continue;
      const v = (gbd[i] || [])[gPot];
      peta[r.baris] = {
        barisGbd: i + 1, kolomGbd: colLetter(gPot), pegawai: nama, rumus: teks(f), ...r,
        dipotong: typeof v === "number" ? v : null, galat: typeof v === "number" ? null : teks(v) || null,
      };
    }
  } else {
    catatan.push(`Sheet ${GBD} atau kolom POTONGAN KASBON tidak ditemukan — cicilan tidak bisa diatur.`);
  }

  const daftarSet = daftar ? new Set(daftar.map((r) => norm((r || [])[0])).filter(Boolean)) : null;
  const baris = [];
  for (let i = 1; i < kas.length; i++) {
    const r = kas[i] || [];
    const subjek = teks(r[ix.subjek]);
    if (!subjek) break;
    const v = (k) => (ix[k] >= 0 ? angka(r[ix[k]]) : 0);
    const kosong = (k) => ix[k] < 0 || teks(r[ix[k]]) === "";
    const g = peta[i + 1] || null;
    const b = {
      baris: i + 1,
      subjek,
      nama: subjek.replace(/^kasb[a-z]*\s+gaji\s+/i, "").trim() || subjek,
      baru: v("baru"), rencanaDepan: v("rencanaDepan"), sisaLalu: v("sisaLalu"), rencana: v("rencana"),
      rencanaKosong: kosong("rencana"), dibayar: v("dibayar"), dibayarKosong: kosong("dibayar"),
      tanggalBayar: ix.tanggalBayar >= 0 ? serialKeTeks(r[ix.tanggalBayar]) : "", sisa: v("sisa"), total: v("total"),
      gbd: g,
    };
    b.dipotongDepan = g && g.dipotong != null ? g.dipotong : null;
    b.sisaSetelahDepan = b.dipotongDepan != null ? b.rencanaDepan - b.dipotongDepan : null;
    b.adaKasbon = [b.baru, b.rencanaDepan, b.sisaLalu, b.rencana, b.dibayar, b.sisa, b.total].some((x) => x !== 0);
    if (daftarSet && !daftarSet.has(norm(subjek))) {
      b.peringatan = `SUBJEK "${subjek}" tidak ada di DAFTAR BIAYA — kasbon baru untuk pegawai ini tidak akan terjumlah di kolom B.`;
    }
    if (g && g.galat) b.peringatan = (b.peringatan ? b.peringatan + " " : "") + `Rumus POTONGAN KASBON di ${GBD} galat (${g.galat}).`;
    baris.push(b);
  }

  // Rentang IMPORTRANGE kolom D/E (dari spreadsheet bulan lalu) harus mencakup semua baris pegawai.
  const barisAkhir = baris.length ? baris[baris.length - 1].baris : 1;
  for (const [k, label] of [["rencana", "E (RENCANA POTONG BULAN INI)"], ["sisaLalu", "D (SISA KASBON BULAN SEBELUMNYA)"]]) {
    if (ix[k] < 0) continue;
    const f = teks((kasRumus[0] || [])[ix[k]]);
    const m = f.match(/IMPORTRANGE\([^)]*"[^"!]*!\$?[A-Z]+\$?(\d+)\s*:\s*\$?[A-Z]+\$?(\d+)"/i);
    if (m && +m[2] < barisAkhir) {
      catatan.push(
        `Kolom ${label} hanya mengambil data bulan lalu sampai baris ${m[2]} (${f.replace(/^=/, "")}), padahal pegawai sampai baris ${barisAkhir}. Baris ${+m[2] + 1}–${barisAkhir} jadi kosong.`
      );
    }
  }
  const tanpaGbd = baris.filter((b) => b.adaKasbon && !b.gbd && src.adaGbd);
  if (tanpaGbd.length) catatan.push(`Kasbon berikut tidak dipotong di ${GBD} (tidak ada rumus yang merujuk barisnya): ${tanpaGbd.map((b) => b.nama).join(", ")}.`);

  const jumlah = (k) => baris.reduce((a, b) => a + (b[k] || 0), 0);
  return {
    baris,
    ringkas: {
      totalKasbon: jumlah("total"), baru: jumlah("baru"), dibayar: jumlah("dibayar"), sisa: jumlah("sisa"),
      rencanaDepan: jumlah("rencanaDepan"), dipotongDepan: jumlah("dipotongDepan"),
      jumlahBerkasbon: baris.filter((b) => b.total > 0).length, cicilan: baris.filter((b) => b.gbd && b.gbd.mode !== "penuh").length,
    },
    catatan,
  };
}

async function load() {
  const src = await bacaSemua();
  return {
    ok: true,
    spreadsheet: { id: src.id, title: src.title, url: `https://docs.google.com/spreadsheets/d/${src.id}/edit` },
    ...susun(src),
    dimuat: cfg.formatBusinessDateTime(new Date()),
  };
}

function parseNominal(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  const s = String(v == null ? "" : v).replace(/rp/gi, "").replace(/\s+/g, "");
  if (!/^\d{1,3}(\.\d{3})*$|^\d+$/.test(s)) return NaN;
  return Number(s.replace(/\./g, ""));
}

let antrean = Promise.resolve();
function eksklusif(fn) {
  const run = antrean.then(fn);
  antrean = run.catch(() => {});
  return run;
}

/**
 * Atur potongan kasbon bulan depan. body: { baris (baris KASBON), subjek, mode "penuh"|"cicil", cicilan, token }.
 * Menulis rumus POTONGAN KASBON di GAJI BULAN DEPAN; sheet KASBON tidak diubah.
 */
function aturCicilan(body) {
  return eksklusif(async () => {
    const b = body || {};
    const baris = Number(b.baris);
    if (!Number.isInteger(baris) || baris < 2) throw httpError(400, "Baris kasbon tidak valid.");
    const mode = teks(b.mode).toLowerCase();
    if (mode !== "penuh" && mode !== "cicil") throw httpError(400, "Pilih: potong penuh atau dicicil.");
    let cicilan = null;
    if (mode === "cicil") {
      cicilan = parseNominal(b.cicilan);
      if (!Number.isFinite(cicilan) || cicilan <= 0) throw httpError(400, "Nominal cicilan harus angka lebih dari 0, mis. 500.000");
      if (cicilan >= MAX_NOMINAL) throw httpError(400, "Nominal cicilan terlalu besar.");
    }

    const src = await bacaSemua();
    const data = { spreadsheet: { id: src.id, title: src.title }, ...susun(src) };
    if (b.token && b.token !== src.id) throw httpError(409, "Spreadsheet CASHFLOW bulan ini sudah berganti. Data dimuat ulang — silakan ulangi.", { data });
    const k = data.baris.find((x) => x.baris === baris);
    if (!k) throw httpError(404, "Baris kasbon itu tidak ditemukan lagi.", { data });
    if (b.subjek != null && teks(b.subjek) !== k.subjek) {
      throw httpError(409, "Susunan baris sheet KASBON berubah. Data dimuat ulang — silakan ulangi.", { data });
    }
    if (!k.gbd) throw httpError(400, `Kasbon ${k.nama} tidak terhubung ke POTONGAN KASBON di ${GBD}.`, { data });

    const sel = `'${GBD}'!${k.gbd.kolomGbd}${k.gbd.barisGbd}`;
    const rumusLama = k.gbd.rumus;
    const tulis = async (f) => batchWrite(src.id, [{ range: sel, values: [[f]] }]);
    const cekNilai = async () => {
      const v = await readRange(src.id, sel, "UNFORMATTED_VALUE");
      return ((v || [])[0] || [])[0];
    };
    let rumus;
    if (mode === "penuh") {
      rumus = `=KASBON!C${baris}`;
      await tulis(rumus);
    } else {
      // Pemisah argumen mengikuti locale spreadsheet (Indonesia = ";"); bila galat, coba ",".
      rumus = `=MIN(KASBON!C${baris};${cicilan})`;
      await tulis(rumus);
      let v = await cekNilai();
      if (typeof v !== "number") {
        rumus = `=MIN(KASBON!C${baris},${cicilan})`;
        await tulis(rumus);
        v = await cekNilai();
        if (typeof v !== "number") {
          await tulis(rumusLama);
          throw httpError(500, `Rumus cicilan tidak bisa dihitung di spreadsheet (${teks(v) || "galat"}). Rumus lama dikembalikan.`);
        }
      }
    }
    const fresh = await load();
    const kini = fresh.baris.find((x) => x.baris === baris);
    return {
      ok: true,
      disimpan: {
        nama: k.nama, pegawai: k.gbd.pegawai, mode, cicilan, sel: `${GBD}!${k.gbd.kolomGbd}${k.gbd.barisGbd}`, rumusLama, rumusBaru: rumus,
        rencanaDepan: kini ? kini.rencanaDepan : k.rencanaDepan, dipotongDepan: kini ? kini.dipotongDepan : null,
        sisaSetelahDepan: kini ? kini.sisaSetelahDepan : null,
      },
      data: fresh,
    };
  });
}

module.exports = { load, aturCicilan, bacaRumusPotong, parseNominal, susun };
