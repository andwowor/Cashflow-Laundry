"use strict";

// Gaji & Kasbon › Gaji Bulan Depan — sheet GAJI BULAN DEPAN (spreadsheet CASHFLOW bulan X = gaji yang dibayar
// tanggal 2 bulan X+1).
//
// Sheet GAJI BULAN DEPAN (CASHFLOW NOVEMBER 2026), baris 2.. per pegawai (berhenti di baris kosong pertama):
//   PEGAWAI | GAJI BANK | AKUN BANK | GAJI POKOK (diketik) | LEMBUR (=8*6250+…; ditulis Dashboard Internal dari
//   lembur yang disetujui) | UANG MAKAN (mis. =15000*26) | THR | BONUS | BONUS REFERAL | TUNJANGAN LAIN |
//   POTONGAN LEMBUR & POTONGAN KETIDAKHADIRAN (ditulis Dashboard Internal dari absensi bulan lalu; isian manual
//   dipertahankan bila hasil hitung aplikasi 0) | POTONGAN KASBON (=KASBON!C{n}, atau =MIN(KASBON!C{n};cicilan) dari
//   menu Kasbon) | POTONGAN KERUGIAN (ditulis Dashboard Internal) | POTONGAN LAIN-LAIN | THP = pendapatan − potongan |
//   JAM LEMBUR (=LEMBUR/6250). Bulan berikutnya GAJI BULAN INI mengambil kolom-kolom ini lewat IMPORTRANGE.
//   Di bawahnya tabel "TOTAL TRANSFER PER REKENING": KEBUTUHAN = SUMIF($B$2:$B$<akhir>; bank; $P$2:$P$<akhir>) (BSI
//   dipisah, dikurangkan dari MANDIRI), saldo dari INPUT LAPORAN HARIAN, selisih = saldo − kebutuhan − 100.000
//   (BCA − 1.350.000 return investasi, angka tetap). Dashboard memakai aturan Gaji Bulan Ini; return investasi =
//   KEBUTUHAN AWAL BULAN DEPAN.
//
// THR otomatis (keputusan Andre 26 Nov 2026): nominal tetap per pegawai (bawaan Rp500.000, bisa diubah di menu),
// hanya pegawai berstatus AKTIF di sheet PEGAWAI (spreadsheet PERFORMA PEGAWAI, Dashboard Internal):
//   gajian 2 Desember → pegawai Kristen Protestan/Katolik; gajian tanggal 2 bulan Idul Fitri → pegawai Islam.
// Hanya sel THR yang KOSONG/0 yang diisi (isian manual tidak ditimpa). Dijalankan saat menu dibuka dan berkala oleh
// server. Nilai yang diisi otomatis dicatat per ID spreadsheet + nama (data/config.json › thrOtomatis).
//
// Pegawai baru: baris disisipkan setelah pegawai terakhir, rumus THP & JAM LEMBUR disalin dari baris atasnya, dan
// rentang `x2:x<akhir>` di bawah tabel (SUMIF TOTAL TRANSFER) diperpanjang satu baris.
// Non-aktif (permintaan Andre 26 Nov 2026): hari kerja bulan berjalan s/d tanggal berhenti (Minggu tidak dihitung)
// × Rp50.000 = gaji yang dibayar; selisih dengan gaji pokok DITAMBAHKAN ke POTONGAN KETIDAKHADIRAN (kolom itu bisa
// sudah berisi potongan absensi dari Dashboard Internal); STATUS & TANGGAL BERHENTI di sheet PEGAWAI diubah; di
// spreadsheet bulan-bulan berikutnya GAJI POKOK pegawai itu otomatis dibuat 0. Catatan per nama di
// data/config.json › pegawaiNonaktif (berisi ID spreadsheet & bulan) supaya "Aktifkan" bisa membatalkannya.

const cfg = require("./config");
const { resolveCashflowSpreadsheetId, readRange, getSheetTitles, getSheetId, batchWrite, batchUpdateRequests } = require("./sheets");
const { sheetsClient } = require("./google");
const gaji = require("./gaji");
const kasbon = require("./kasbon");

const SHEET = "GAJI BULAN DEPAN";
const NOMINAL_THR_BAWAAN = 500000;
const TARIF_HARIAN_BERHENTI = 50000;
const AGAMA_NATAL = new Set(["KRISTEN PROTESTAN", "KRISTEN", "PROTESTAN", "KATOLIK", "KATHOLIK", "KRISTEN KATOLIK"]);
const AGAMA_ISLAM = new Set(["ISLAM"]);
// Bulan Idul Fitri (1 Syawal) di Indonesia per tahun Masehi — perkiraan kalender hijriah, perbarui bila
// pemerintah menetapkan lain. 2026: 20 Mar, 2027: ±9 Mar, 2028: ±26 Feb, 2029: ±14 Feb, 2030: ±4 Feb,
// 2031: ±24 Jan, 2032: ±14 Jan, 2033: ±2 Jan & ±23 Des, 2034: ±12 Des, 2035: ±1 Des.
const BULAN_IDUL_FITRI = { 2026: [3], 2027: [3], 2028: [2], 2029: [2], 2030: [2], 2031: [1], 2032: [1], 2033: [1, 12], 2034: [12], 2035: [12] };
const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
// Kolom yang boleh diedit manual dari dashboard (judul di sheet; boleh beberapa ejaan).
const EDITABLE = {
  gajiPokok: ["GAJI POKOK"],
  tunjanganLain: ["TUNJANGAN LAIN", "TUNJANGAN LAIN LAIN", "TUNJANGAN LAIN-LAIN"],
  potKetidakhadiran: ["POTONGAN KETIDAKHADIRAN", "POTONGAN ABSEN"],
  potLain: ["POTONGAN LAIN-LAIN", "POTONGAN LAIN LAIN", "POTONGAN LAIN"],
};
const LABEL = { gajiPokok: "Gaji pokok", tunjanganLain: "Tunjangan lain", potKetidakhadiran: "Potongan ketidakhadiran", potLain: "Potongan lain-lain" };
const BANK_BOLEH = ["BCA", "BRI", "BNI", "MANDIRI", "BSI", "CASH"];
const MAX_NOMINAL = 1e10;

const { httpError, angka, norm } = gaji;
const teks = (v) => String(v == null ? "" : v).trim();
function colLetter(i) {
  let n = i + 1, s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function bulanSpreadsheet(title) {
  const t = norm(title);
  const i = cfg.MONTH_NAMES_ID.findIndex((m) => new RegExp(`(^|\\W)${m}(\\W|$)`).test(t));
  const y = (t.match(/\b(20\d{2})\b/) || [])[1];
  if (i < 0 || !y) {
    const [mn, yy] = cfg.currentMonthKey().split(" ");
    return { m: cfg.MONTH_NAMES_ID.indexOf(mn) + 1, y: Number(yy) };
  }
  return { m: i + 1, y: Number(y) };
}
const kunciBulan = ({ m, y }) => `${y}-${String(m).padStart(2, "0")}`;

/** Gajian GAJI BULAN DEPAN = tanggal 2 bulan setelah bulan spreadsheet; aturan THR yang berlaku. */
function infoGajian(title) {
  const { m, y } = bulanSpreadsheet(title);
  const bm = m === 12 ? 1 : m + 1;
  const by = m === 12 ? y + 1 : y;
  const tabel = BULAN_IDUL_FITRI[by];
  return {
    bulan: bm, tahun: by, label: `2 ${BULAN[bm - 1]} ${by}`,
    natal: bm === 12,
    idulFitri: !!(tabel && tabel.includes(bm)),
    tabelIdulFitriAda: !!tabel,
  };
}

/** Hari kerja (Senin–Sabtu) dari tanggal 1 s/d tanggal iso (termasuk). */
function hariKerjaSampai(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return 0;
  let n = 0;
  for (let d = 1; d <= +m[3]; d++) if (new Date(Date.UTC(+m[1], +m[2] - 1, d)).getUTCDay() !== 0) n++;
  return n;
}
function hariIniIso() {
  const { year, month, day } = cfg.nowInBusinessTz();
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function isoKeTeks(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${+m[3]} ${BULAN[+m[2] - 1]} ${m[1]}` : "";
}

function nominalThr() {
  const n = Number(cfg.getStoredConfig().thrNominal);
  return Number.isFinite(n) && n > 0 ? n : NOMINAL_THR_BAWAAN;
}
function catatanNonaktif() {
  const c = cfg.getStoredConfig();
  return c.pegawaiNonaktif && typeof c.pegawaiNonaktif === "object" ? c.pegawaiNonaktif : {};
}
function simpanCatatanNonaktif(obj) {
  const c = cfg.getStoredConfig();
  c.pegawaiNonaktif = obj;
  cfg.saveStoredConfig(c);
}

// ---------- sheet PEGAWAI (Dashboard Internal) — hanya NAMA, STATUS, TANGGAL BERHENTI, AGAMA ----------

const performaId = () => require("./transaksiharian").spreadsheetId();

async function bacaPegawaiInternal() {
  const id = performaId();
  const judul = ((await readRange(id, "'PEGAWAI'!A1:Z1", "FORMATTED_VALUE"))[0] || []).map(norm);
  const ix = { nama: judul.indexOf("NAMA"), status: judul.indexOf("STATUS"), agama: judul.indexOf("AGAMA"), berhenti: judul.indexOf("TANGGAL BERHENTI") };
  if (ix.nama < 0 || ix.status < 0 || ix.agama < 0) throw new Error("Kolom NAMA/STATUS/AGAMA tidak ditemukan di sheet PEGAWAI.");
  const kol = async (i) => (i < 0 ? [] : (await readRange(id, `'PEGAWAI'!${colLetter(i)}2:${colLetter(i)}300`, "FORMATTED_VALUE")).map((r) => teks((r || [])[0])));
  const [nama, status, agama, berhenti] = await Promise.all([kol(ix.nama), kol(ix.status), kol(ix.agama), kol(ix.berhenti)]);
  const peta = new Map();
  const ganda = new Set();
  nama.forEach((n, i) => {
    if (!n) return;
    const k = norm(n);
    if (peta.has(k)) ganda.add(k);
    peta.set(k, { nama: n, baris: i + 2, status: norm(status[i]), agama: norm(agama[i]), berhenti: berhenti[i] || "" });
  });
  for (const k of ganda) peta.get(k).ganda = true;
  peta.kolom = { status: colLetter(ix.status), berhenti: ix.berhenti >= 0 ? colLetter(ix.berhenti) : null };
  return peta;
}

async function bacaGbd(id) {
  const [nilai, tampil, rumus] = await Promise.all([
    readRange(id, `'${SHEET}'!A1:R60`, "UNFORMATTED_VALUE"),
    readRange(id, `'${SHEET}'!A1:R60`, "FORMATTED_VALUE"),
    readRange(id, `'${SHEET}'!A1:R60`, "FORMULA"),
  ]);
  return { nilai, tampil, rumus };
}

function kolomIndex(judulBaris, daftar) {
  const j = (judulBaris || []).map(norm);
  for (const h of daftar) { const i = j.indexOf(h); if (i >= 0) return i; }
  return -1;
}

/** Baris pegawai terakhir (1-based) di GAJI BULAN DEPAN. */
function barisAkhirPegawai(gbd) {
  const iNama = kolomIndex(gbd.nilai[0], ["PEGAWAI"]);
  let akhir = 1;
  for (let i = 1; i < gbd.nilai.length; i++) {
    if (!teks((gbd.nilai[i] || [])[iNama])) break;
    akhir = i + 1;
  }
  return akhir;
}

/** Hitung (dan bila tulis=true, isi) THR otomatis. peg = peta PEGAWAI atau Error. */
async function prosesThr(id, title, gbd, tulis, peg) {
  const g = infoGajian(title);
  const nominal = nominalThr();
  const hasil = { gajian: g.label, natal: g.natal, idulFitri: g.idulFitri, nominal, penerima: [], diisi: [], diperbarui: [], catatan: [] };
  if (!g.tabelIdulFitriAda) hasil.catatan.push(`Bulan Idul Fitri tahun ${g.tahun} belum ada di daftar dashboard — THR Idul Fitri tidak bisa diisi otomatis.`);
  const judul = gbd.nilai[0] || [];
  const iNama = kolomIndex(judul, ["PEGAWAI"]);
  const iThr = kolomIndex(judul, ["THR"]);
  if (iNama < 0 || iThr < 0) { hasil.catatan.push("Kolom PEGAWAI/THR tidak ditemukan di sheet GAJI BULAN DEPAN."); return hasil; }
  if (peg instanceof Error || !peg) {
    hasil.catatan.push(`Data agama/status pegawai (sheet PEGAWAI, Dashboard Internal) tidak bisa dibaca: ${peg ? peg.message : "-"}`);
    return hasil;
  }
  const stored = cfg.getStoredConfig();
  const catat = (stored.thrOtomatis && stored.thrOtomatis[id]) || {};
  const tulisan = [];
  for (let i = 1; i < gbd.nilai.length; i++) {
    const r = gbd.nilai[i] || [];
    const nama = teks(r[iNama]);
    if (!nama) break;
    const p = peg.get(norm(nama));
    const thr = angka(r[iThr]);
    const rumus = teks((gbd.rumus[i] || [])[iThr]);
    const agamaOk = p && ((g.natal && AGAMA_NATAL.has(p.agama)) || (g.idulFitri && AGAMA_ISLAM.has(p.agama)));
    const berhak = !!(agamaOk && p.status === "AKTIF");
    if (berhak) hasil.penerima.push(nama);
    const sel = `'${SHEET}'!${colLetter(iThr)}${i + 1}`;
    if (berhak && !thr && !/^=/.test(rumus)) {
      tulisan.push({ range: sel, values: [[nominal]] });
      hasil.diisi.push(nama);
      catat[nama] = nominal;
    } else if (berhak && thr !== nominal && catat[nama] != null && thr === catat[nama] && !/^=/.test(rumus)) {
      tulisan.push({ range: sel, values: [[nominal]] }); // masih nilai otomatis lama → ikut nominal baru
      hasil.diperbarui.push(nama);
      catat[nama] = nominal;
    } else if (berhak && thr && thr !== nominal) {
      hasil.catatan.push(`${nama}: THR ${thr.toLocaleString("id-ID")} diisi manual (bukan ${nominal.toLocaleString("id-ID")}) — dibiarkan.`);
    } else if (!berhak && thr) {
      const alasan = !g.natal && !g.idulFitri ? `gajian ${g.label} bukan bulan THR`
        : !p ? "nama tidak ada di sheet PEGAWAI"
        : p.status !== "AKTIF" ? `status ${p.status || "kosong"} di sheet PEGAWAI`
        : `agama ${p.agama || "kosong"} tidak mendapat THR bulan ini`;
      hasil.catatan.push(`${nama}: THR ${thr.toLocaleString("id-ID")} terisi padahal ${alasan} — periksa.`);
    }
  }
  if (tulis && tulisan.length) {
    await batchWrite(id, tulisan);
    const c2 = cfg.getStoredConfig();
    c2.thrOtomatis = c2.thrOtomatis || {};
    c2.thrOtomatis[id] = catat;
    const kunci = Object.keys(c2.thrOtomatis);
    if (kunci.length > 6) kunci.slice(0, kunci.length - 6).forEach((k) => delete c2.thrOtomatis[k]);
    cfg.saveStoredConfig(c2);
  }
  return hasil;
}

/** Pegawai yang dinonaktifkan di bulan sebelumnya → GAJI POKOK di spreadsheet bulan ini dibuat 0. */
async function nolkanGajiPokok(id, title, gbd) {
  const bulanIni = kunciBulan(bulanSpreadsheet(title));
  const rec = catatanNonaktif();
  const judul = gbd.nilai[0] || [];
  const iNama = kolomIndex(judul, ["PEGAWAI"]);
  const iGaji = kolomIndex(judul, EDITABLE.gajiPokok);
  const hasil = [];
  if (iNama < 0 || iGaji < 0) return hasil;
  const tulisan = [];
  for (let i = 1; i < gbd.nilai.length; i++) {
    const nama = teks((gbd.nilai[i] || [])[iNama]);
    if (!nama) break;
    const r = rec[norm(nama)];
    if (!r || !(r.bulan < bulanIni)) continue;
    r.dinolkan = r.dinolkan || {};
    if (r.dinolkan[id] != null) continue; // sudah pernah dinolkan di spreadsheet ini
    const gp = angka((gbd.nilai[i] || [])[iGaji]);
    r.dinolkan[id] = gp;
    if (gp) {
      tulisan.push({ range: `'${SHEET}'!${colLetter(iGaji)}${i + 1}`, values: [[0]] });
      hasil.push(`${nama}: gaji pokok ${gp.toLocaleString("id-ID")} dibuat 0 (nonaktif sejak ${isoKeTeks(r.tanggal)}).`);
    }
  }
  if (Object.values(rec).some((r) => r.dinolkan)) simpanCatatanNonaktif(rec);
  if (tulisan.length) await batchWrite(id, tulisan);
  return hasil;
}

async function sumber() {
  const { id } = await resolveCashflowSpreadsheetId();
  const meta = await getSheetTitles(id);
  for (const s of [SHEET, "KONTROL KAS"]) {
    if (!meta.sheets.includes(s)) throw httpError(404, `Sheet "${s}" tidak ditemukan di spreadsheet ${meta.title}.`);
  }
  return { id, meta };
}

/** Pekerjaan otomatis (jadwal berkala server): THR & gaji pokok 0 untuk pegawai nonaktif bulan lalu. */
async function isiThrOtomatis() {
  const { id, meta } = await sumber();
  let gbd = await bacaGbd(id);
  const dinol = await nolkanGajiPokok(id, meta.title, gbd);
  if (dinol.length) gbd = await bacaGbd(id);
  let peg;
  try { peg = await bacaPegawaiInternal(); } catch (e) { peg = e; }
  const hasil = await prosesThr(id, meta.title, gbd, true, peg);
  hasil.dinolkan = dinol;
  return hasil;
}

async function load() {
  const { id, meta } = await sumber();
  let gbd = await bacaGbd(id);
  const dinol = await nolkanGajiPokok(id, meta.title, gbd);
  if (dinol.length) gbd = await bacaGbd(id);
  let peg;
  try { peg = await bacaPegawaiInternal(); } catch (e) { peg = e; }
  const thr = await prosesThr(id, meta.title, gbd, true, peg);
  if (thr.diisi.length || thr.diperbarui.length) gbd = await bacaGbd(id);

  const adaKeb = meta.sheets.includes("KEBUTUHAN AWAL BULAN DEPAN");
  const [kontrol, keb] = await Promise.all([
    readRange(id, "'KONTROL KAS'!A1:B30", "UNFORMATTED_VALUE"),
    adaKeb ? readRange(id, "'KEBUTUHAN AWAL BULAN DEPAN'!A1:C60", "UNFORMATTED_VALUE") : Promise.resolve([]),
  ]);
  const pegawai = gaji.susunPegawai(gbd.nilai, gbd.tampil);
  const judul = gbd.nilai[0] || [];
  const ixEdit = {};
  for (const k of Object.keys(EDITABLE)) ixEdit[k] = kolomIndex(judul, EDITABLE[k]);
  const iThr = kolomIndex(judul, ["THR"]);
  const catatan = dinol.slice();

  let kb = null;
  try {
    kb = await kasbon.load();
  } catch (e) {
    catatan.push(`Data KASBON tidak bisa dibaca: ${e.message}`);
  }
  const kasbonPer = {};
  if (kb) for (const b of kb.baris) if (b.gbd) kasbonPer[b.gbd.barisGbd] = b;
  const rec = catatanNonaktif();
  const bulanIni = kunciBulan(bulanSpreadsheet(meta.title));

  for (const p of pegawai) {
    const i = p.baris - 1;
    p.edit = {};
    for (const k of Object.keys(EDITABLE)) {
      if (ixEdit[k] < 0) continue;
      const f = teks((gbd.rumus[i] || [])[ixEdit[k]]);
      p.edit[k] = { kolom: colLetter(ixEdit[k]), rumus: /^=/.test(f) ? f : null };
    }
    if (iThr >= 0) {
      const f = teks((gbd.rumus[i] || [])[iThr]);
      p.thrRumus = /^=/.test(f) ? f : null;
      p.thrOtomatis = thr.penerima.includes(p.nama);
    }
    const b = kasbonPer[p.baris];
    if (b) {
      p.kasbon = {
        baris: b.baris, subjek: b.subjek, nama: b.nama, mode: b.gbd.mode, cicilan: b.gbd.cicilan || null, ditunda: b.gbd.ditunda || null,
        rumus: b.gbd.rumus, rencanaDepan: b.rencanaDepan, sisaSetelahDepan: b.sisaSetelahDepan,
      };
    }
    // Status pegawai: sheet PEGAWAI (Dashboard Internal) bila terdaftar, selain itu catatan dashboard ini.
    const pi = peg instanceof Error ? null : peg.get(norm(p.nama));
    const r = rec[norm(p.nama)];
    p.status = {
      terdaftar: !!pi,
      aktif: pi ? pi.status === "AKTIF" : !r,
      teks: pi ? pi.status || "?" : r ? "NONAKTIF" : "belum terdaftar",
      berhenti: pi ? pi.berhenti : r ? isoKeTeks(r.tanggal) : "",
      olehDashboard: r ? { tanggal: r.tanggal, hariKerja: r.hariKerja, selisih: r.selisih, bulanIni: r.bulan === bulanIni } : null,
    };
  }
  for (const k of Object.keys(EDITABLE)) if (ixEdit[k] < 0) catatan.push(`Kolom ${EDITABLE[k][0]} tidak ditemukan di sheet GAJI BULAN DEPAN — tidak bisa diedit.`);

  const ret = gaji.bacaReturnInvestasi(keb);
  if (!ret.ada) catatan.push('Baris "Return Investasi" di sheet KEBUTUHAN AWAL BULAN DEPAN tidak ditemukan — return investasi dianggap 0.');
  const st = gaji.hitungStatusKas(pegawai, kontrol, ret.nilai);
  const ringkas = gaji.ringkasPegawai(pegawai);
  ringkas.totalThr = pegawai.reduce((a, p) => a + (p.thr || 0), 0);
  const sync = cfg.getLastSync ? cfg.getLastSync() : null;
  return {
    ok: true,
    spreadsheet: { id, title: meta.title, url: `https://docs.google.com/spreadsheets/d/${id}/edit` },
    gajian: thr.gajian,
    bulanBerjalan: kunciBulan(bulanSpreadsheet(meta.title)),
    hariIni: hariIniIso(),
    tarifHarianBerhenti: TARIF_HARIAN_BERHENTI,
    bankPilihan: BANK_BOLEH,
    pegawai,
    ringkas,
    status: st.status,
    total: st.total,
    returnInvestasi: ret.nilai,
    saldoMinimum: gaji.SALDO_MINIMUM,
    thr,
    catatan: catatan.concat(st.catatan),
    updateHarian: sync ? sync.display : null,
    dimuat: cfg.formatBusinessDateTime(new Date()),
  };
}

function parseNominal(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  const s = String(v).replace(/rp/gi, "").replace(/\s+/g, "");
  if (s === "") return null;
  if (!/^\d{1,3}(\.\d{3})*$|^\d+$/.test(s)) return NaN;
  return Number(s.replace(/\./g, ""));
}

let antrean = Promise.resolve();
function eksklusif(fn) {
  const run = antrean.then(fn);
  antrean = run.catch(() => {});
  return run;
}

async function tulisRaw(id, data) {
  await sheetsClient().spreadsheets.values.batchUpdate({ spreadsheetId: id, requestBody: { valueInputOption: "RAW", data } });
}

/** Ubah Gaji pokok / Tunjangan lain / Potongan ketidakhadiran / Potongan lain-lain. body: { baris, kolom, nilai, lama, nama, token }. */
function ubah(body) {
  return eksklusif(async () => {
    const b = body || {};
    const key = teks(b.kolom);
    if (!EDITABLE[key]) throw httpError(400, "Kolom itu tidak bisa diedit dari dashboard.");
    const baris = Number(b.baris);
    if (!Number.isInteger(baris) || baris < 2) throw httpError(400, "Baris tidak valid.");
    const nilai = parseNominal(b.nilai);
    if (Number.isNaN(nilai) || (nilai != null && nilai < 0)) throw httpError(400, "Nominal harus angka 0 atau lebih, mis. 50.000 (kosongkan untuk menghapus).");
    if (nilai != null && nilai >= MAX_NOMINAL) throw httpError(400, "Nominal terlalu besar.");
    const { id } = await sumber();
    if (b.token && b.token !== id) throw httpError(409, "Spreadsheet CASHFLOW bulan ini sudah berganti. Data dimuat ulang — silakan ulangi.");
    const gbd = await bacaGbd(id);
    const judul = gbd.nilai[0] || [];
    const iNama = kolomIndex(judul, ["PEGAWAI"]);
    const iKol = kolomIndex(judul, EDITABLE[key]);
    if (iKol < 0) throw httpError(400, `Kolom ${EDITABLE[key][0]} tidak ditemukan di sheet ${SHEET}.`);
    const r = gbd.nilai[baris - 1] || [];
    const nama = teks(r[iNama]);
    if (!nama || baris > barisAkhirPegawai(gbd) || (b.nama != null && teks(b.nama) !== nama)) {
      throw httpError(409, "Susunan baris GAJI BULAN DEPAN berubah. Data dimuat ulang — silakan ulangi.");
    }
    const sekarang = teks(r[iKol]) === "" ? null : angka(r[iKol]);
    if (b.lama !== undefined) {
      const lama = b.lama === null || b.lama === "" ? null : Number(b.lama);
      const sama = (sekarang == null && lama == null) || (sekarang != null && lama != null && Math.abs(sekarang - lama) < 0.5);
      if (!sama) throw httpError(409, `${LABEL[key]} ${nama} di spreadsheet sudah berubah menjadi ${sekarang == null ? "kosong" : sekarang.toLocaleString("id-ID")}. Data dimuat ulang — silakan cek lalu ulangi.`);
    }
    const sel = `'${SHEET}'!${colLetter(iKol)}${baris}`;
    const rumusLama = teks((gbd.rumus[baris - 1] || [])[iKol]);
    await batchWrite(id, [{ range: sel, values: [[nilai == null ? "" : nilai]] }]);
    const data = await load();
    const p = data.pegawai.find((x) => x.baris === baris);
    return {
      ok: true,
      disimpan: { nama, kolom: key, label: LABEL[key], sel: `${SHEET}!${colLetter(iKol)}${baris}`, lama: sekarang, baru: nilai, rumusLama: /^=/.test(rumusLama) ? rumusLama : null, thp: p ? p.thp : null },
      data,
    };
  });
}

/** Ubah nominal THR per pegawai lalu jalankan pengisian otomatis lagi. */
function aturNominalThr(body) {
  return eksklusif(async () => {
    const n = parseNominal((body || {}).nominal);
    if (n == null || Number.isNaN(n) || n <= 0) throw httpError(400, "Nominal THR harus angka lebih dari 0, mis. 500.000");
    if (n >= MAX_NOMINAL) throw httpError(400, "Nominal terlalu besar.");
    const c = cfg.getStoredConfig();
    c.thrNominal = n;
    cfg.saveStoredConfig(c);
    return { ok: true, nominal: n, data: await load() };
  });
}

/**
 * Tambah pegawai baru: sisipkan baris setelah pegawai terakhir. body: { nama, bank, rekening, gajiPokok, token }.
 */
function tambahPegawai(body) {
  return eksklusif(async () => {
    const b = body || {};
    const nama = teks(b.nama).replace(/\s+/g, " ");
    const bank = norm(b.bank);
    const rekening = teks(b.rekening).replace(/[\s.-]/g, "");
    const gp = parseNominal(b.gajiPokok);
    if (!nama || nama.length > 80) throw httpError(400, "Nama pegawai wajib diisi (maks. 80 huruf).");
    if (!BANK_BOLEH.includes(bank)) throw httpError(400, `Pilih gaji bank: ${BANK_BOLEH.join(", ")}.`);
    if (bank !== "CASH" && !/^\d{5,20}$/.test(rekening)) throw httpError(400, "Nomor akun bank harus angka (5–20 digit).");
    if (gp == null || Number.isNaN(gp) || gp < 0) throw httpError(400, "Gaji pokok harus angka 0 atau lebih, mis. 1.500.000");
    if (gp >= MAX_NOMINAL) throw httpError(400, "Gaji pokok terlalu besar.");

    const { id } = await sumber();
    if (b.token && b.token !== id) throw httpError(409, "Spreadsheet CASHFLOW bulan ini sudah berganti. Data dimuat ulang — silakan ulangi.");
    const gbd = await bacaGbd(id);
    const judul = gbd.nilai[0] || [];
    const ix = {
      nama: kolomIndex(judul, ["PEGAWAI"]), bank: kolomIndex(judul, ["GAJI BANK", "BANK"]), rek: kolomIndex(judul, ["AKUN BANK", "NOMOR REKENING"]),
      gaji: kolomIndex(judul, EDITABLE.gajiPokok), thp: kolomIndex(judul, ["THP"]), jam: kolomIndex(judul, ["JAM LEMBUR"]),
    };
    if (ix.nama < 0 || ix.bank < 0 || ix.rek < 0 || ix.gaji < 0) throw httpError(500, "Kolom PEGAWAI/GAJI BANK/AKUN BANK/GAJI POKOK tidak ditemukan di sheet GAJI BULAN DEPAN.");
    const akhir = barisAkhirPegawai(gbd);
    for (let i = 1; i < akhir; i++) {
      if (norm((gbd.nilai[i] || [])[ix.nama]) === norm(nama)) throw httpError(409, `Pegawai "${nama}" sudah ada di GAJI BULAN DEPAN (baris ${i + 1}).`);
    }
    const sheetId = await getSheetId(id, SHEET);
    if (sheetId == null) throw httpError(404, `Sheet "${SHEET}" tidak ditemukan.`);
    const baru = akhir + 1; // nomor baris pegawai baru
    const req = [{ insertDimension: { range: { sheetId, dimension: "ROWS", startIndex: akhir, endIndex: akhir + 1 }, inheritFromBefore: true } }];
    for (const c of [ix.thp, ix.jam]) {
      if (c < 0) continue;
      req.push({
        copyPaste: {
          source: { sheetId, startRowIndex: akhir - 1, endRowIndex: akhir, startColumnIndex: c, endColumnIndex: c + 1 },
          destination: { sheetId, startRowIndex: akhir, endRowIndex: akhir + 1, startColumnIndex: c, endColumnIndex: c + 1 },
          pasteType: "PASTE_FORMULA",
        },
      });
    }
    await batchUpdateRequests(id, req);
    await tulisRaw(id, [
      { range: `'${SHEET}'!${colLetter(ix.nama)}${baru}`, values: [[nama]] },
      { range: `'${SHEET}'!${colLetter(ix.bank)}${baru}`, values: [[bank === "MANDIRI" ? "Mandiri" : bank]] },
      { range: `'${SHEET}'!${colLetter(ix.rek)}${baru}`, values: [[rekening]] },
      { range: `'${SHEET}'!${colLetter(ix.gaji)}${baru}`, values: [[gp]] },
    ]);

    // Perpanjang rentang "x2:x<akhir>" pada rumus di bawah tabel pegawai (SUMIF TOTAL TRANSFER PER REKENING).
    const bawah = await readRange(id, `'${SHEET}'!A${baru + 1}:Z${baru + 40}`, "FORMULA");
    const ubahRumus = [];
    const pola = new RegExp(`(\\$?[A-Z]{1,2}\\$?)2:(\\$?[A-Z]{1,2}\\$?)${akhir}(?!\\d)`, "g");
    bawah.forEach((row, ri) => (row || []).forEach((f, ci) => {
      const s = teks(f);
      if (!/^=/.test(s)) return;
      const baruF = s.replace(pola, (m0, a, z) => `${a}2:${z}${baru}`);
      if (baruF !== s) ubahRumus.push({ range: `'${SHEET}'!${colLetter(ci)}${baru + 1 + ri}`, values: [[baruF]] });
    }));
    if (ubahRumus.length) await batchWrite(id, ubahRumus);

    const data = await load();
    return {
      ok: true,
      ditambah: { nama, bank, rekening, gajiPokok: gp, baris: baru, rumusDiperpanjang: ubahRumus.length },
      catatan: [
        "Pegawai baru belum terdaftar di Dashboard Internal (sheet PEGAWAI) — status & THR otomatis mengikuti data di sana.",
        "Sheet KEBUTUHAN AWAL BULAN DEPAN menjumlah gaji per sel pegawai, jadi gaji pegawai baru belum ikut di sana.",
        "Bila pegawai ini kasbon, tambahkan barisnya di sheet KASBON dan rumus POTONGAN KASBON-nya.",
      ],
      data,
    };
  });
}

/**
 * Aktif / nonaktifkan pegawai. body: { baris, nama, aktif (bool), tanggal "yyyy-mm-dd" (nonaktif), token }.
 */
function ubahStatus(body) {
  return eksklusif(async () => {
    const b = body || {};
    const baris = Number(b.baris);
    if (!Number.isInteger(baris) || baris < 2) throw httpError(400, "Baris tidak valid.");
    const aktif = b.aktif === true || b.aktif === "true";
    const { id, meta } = await sumber();
    if (b.token && b.token !== id) throw httpError(409, "Spreadsheet CASHFLOW bulan ini sudah berganti. Data dimuat ulang — silakan ulangi.");
    const gbd = await bacaGbd(id);
    const judul = gbd.nilai[0] || [];
    const iNama = kolomIndex(judul, ["PEGAWAI"]);
    const iGaji = kolomIndex(judul, EDITABLE.gajiPokok);
    const iPot = kolomIndex(judul, EDITABLE.potKetidakhadiran);
    if (iGaji < 0 || iPot < 0) throw httpError(500, "Kolom GAJI POKOK / POTONGAN KETIDAKHADIRAN tidak ditemukan.");
    const row = gbd.nilai[baris - 1] || [];
    const nama = teks(row[iNama]);
    if (!nama || baris > barisAkhirPegawai(gbd) || (b.nama != null && teks(b.nama) !== nama)) {
      throw httpError(409, "Susunan baris GAJI BULAN DEPAN berubah. Data dimuat ulang — silakan ulangi.");
    }
    let peg = null;
    let pegCatatan = null;
    try { peg = await bacaPegawaiInternal(); } catch (e) { pegCatatan = `Sheet PEGAWAI (Dashboard Internal) tidak bisa diubah: ${e.message}`; }
    const pi = peg ? peg.get(norm(nama)) : null;
    if (pi && pi.ganda) throw httpError(409, `Nama "${nama}" ada lebih dari sekali di sheet PEGAWAI — ubah statusnya di Dashboard Internal.`);
    const rec = catatanNonaktif();
    const k = norm(nama);
    const bulanIni = kunciBulan(bulanSpreadsheet(meta.title));
    const potSekarang = teks(row[iPot]) === "" ? null : angka(row[iPot]);
    const gajiSekarang = angka(row[iGaji]);
    const tulisPegawai = async (status, tanggalIso) => {
      if (!pi) return false;
      const data = [{ range: `'PEGAWAI'!${peg.kolom.status}${pi.baris}`, values: [[status]] }];
      if (peg.kolom.berhenti) {
        const t = tanggalIso ? tanggalIso.split("-").reverse().join("/") : "";
        data.push({ range: `'PEGAWAI'!${peg.kolom.berhenti}${pi.baris}`, values: [[t]] });
      }
      await batchWrite(performaId(), data);
      return true;
    };

    let hasil;
    if (!aktif) {
      if (rec[k] && rec[k].spreadsheetId === id) throw httpError(409, `${nama} sudah dinonaktifkan dari dashboard pada ${isoKeTeks(rec[k].tanggal)}.`);
      if (pi && pi.status !== "AKTIF") throw httpError(409, `${nama} sudah berstatus ${pi.status} di sheet PEGAWAI.`);
      const tanggal = teks(b.tanggal) || hariIniIso();
      const m = tanggal.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m || `${m[1]}-${m[2]}` !== bulanIni) throw httpError(400, `Tanggal berhenti harus di bulan ${BULAN[+bulanIni.slice(5) - 1]} ${bulanIni.slice(0, 4)}.`);
      if (tanggal > hariIniIso()) throw httpError(400, "Tanggal berhenti tidak boleh setelah hari ini.");
      const hariKerja = hariKerjaSampai(tanggal);
      const dibayar = hariKerja * TARIF_HARIAN_BERHENTI;
      const selisih = Math.max(0, gajiSekarang - dibayar);
      const potBaru = (potSekarang || 0) + selisih;
      if (selisih) await batchWrite(id, [{ range: `'${SHEET}'!${colLetter(iPot)}${baris}`, values: [[potBaru]] }]);
      const diubahPegawai = await tulisPegawai("NONAKTIF", tanggal);
      rec[k] = {
        nama, tanggal, bulan: bulanIni, spreadsheetId: id, baris, hariKerja, tarif: TARIF_HARIAN_BERHENTI, gajiPokok: gajiSekarang,
        potLama: potSekarang, potBaru: selisih ? potBaru : potSekarang, selisih, pegawaiDiubah: diubahPegawai,
      };
      simpanCatatanNonaktif(rec);
      hasil = { nama, aktif: false, tanggal, tanggalTeks: isoKeTeks(tanggal), hariKerja, dibayar, gajiPokok: gajiSekarang, selisih, potLama: potSekarang, potBaru: rec[k].potBaru, pegawaiDiubah: diubahPegawai };
    } else {
      const r = rec[k];
      const dipulihkan = [];
      const tulis = [];
      if (r && r.spreadsheetId === id && r.selisih && potSekarang === r.potBaru) {
        tulis.push({ range: `'${SHEET}'!${colLetter(iPot)}${baris}`, values: [[r.potLama == null ? "" : r.potLama]] });
        dipulihkan.push(`potongan ketidakhadiran kembali ${r.potLama == null ? "kosong" : r.potLama.toLocaleString("id-ID")}`);
      } else if (r && r.spreadsheetId === id && r.selisih) {
        dipulihkan.push(`potongan ketidakhadiran TIDAK dikembalikan (sudah diubah menjadi ${potSekarang == null ? "kosong" : potSekarang.toLocaleString("id-ID")})`);
      }
      if (r && r.dinolkan && r.dinolkan[id] && gajiSekarang === 0) {
        tulis.push({ range: `'${SHEET}'!${colLetter(iGaji)}${baris}`, values: [[r.dinolkan[id]]] });
        dipulihkan.push(`gaji pokok kembali ${r.dinolkan[id].toLocaleString("id-ID")}`);
      }
      if (tulis.length) await batchWrite(id, tulis);
      if (!pi && !r) throw httpError(409, `${nama} belum terdaftar di sheet PEGAWAI dan tidak pernah dinonaktifkan dari dashboard.`);
      if (pi && pi.status === "AKTIF" && !r) throw httpError(409, `${nama} sudah AKTIF.`);
      const diubahPegawai = await tulisPegawai("AKTIF", "");
      delete rec[k];
      simpanCatatanNonaktif(rec);
      hasil = { nama, aktif: true, dipulihkan, pegawaiDiubah: diubahPegawai };
    }
    const data = await load();
    return { ok: true, hasil, catatan: pegCatatan ? [pegCatatan] : pi ? [] : [`${nama} belum terdaftar di sheet PEGAWAI (Dashboard Internal) — status hanya dicatat di dashboard ini.`], data };
  });
}

module.exports = {
  load, ubah, aturNominalThr, tambahPegawai, ubahStatus, isiThrOtomatis, infoGajian, prosesThr, hariKerjaSampai,
  BULAN_IDUL_FITRI, NOMINAL_THR_BAWAAN, TARIF_HARIAN_BERHENTI,
};
