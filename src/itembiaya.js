"use strict";

// ITEM BIAYA (kolom I) & SUB ITEM BIAYA (kolom J) pada sheet INPUT PENGGUNAAN BIAYA
// (spreadsheet CASHFLOW bulan berjalan — ikut berganti tiap bulan).
//
// Cara kerja dropdown di spreadsheet (dipelajari dari formulanya, Nov 2026):
//  - Kolom I  : dropdown dari 'BANTU DAFTAR ITEM'!A2:A200, isinya
//               =UNIQUE(FILTER('DAFTAR ITEM BIAYA SMARTLINK'!B2:B1000; B<>""))
//  - Kolom J  : baris N memakai 'BANTU SUB ITEM'!A{N}:CB{N}, isinya
//               =IF(I{N}="";"";IFERROR(TRANSPOSE(UNIQUE(FILTER(
//                  'DAFTAR ITEM BIAYA SMARTLINK'!C2:C1000;
//                  'DAFTAR ITEM BIAYA SMARTLINK'!B2:B1000 = I{N}; C<>"")));""))
//               → hanya sub-item milik item di baris yang sama, maks. 80 (kolom A..CB).
//               (Sejak Nov 2026 berlaku untuk J2:J998. Templat lama memakai daftar
//               datar C2:C1000 di baris 121+; sub-item yang disaring per item tetap
//               sah untuk keduanya.)
//  - Item tanpa sub-item (kolom C kosong) → SUB ITEM harus kosong.
// Daftar item dibaca LANGSUNG dari sumber dropdown kolom I, dan sub-item dihitung
// dengan logika yang sama persis dengan formula BANTU SUB ITEM.

const cfg = require("./config");
const { readRange, getDataValidation, resolveCashflowSpreadsheetId } = require("./sheets");

const SHEET = "INPUT PENGGUNAAN BIAYA";
const MASTER = "DAFTAR ITEM BIAYA SMARTLINK"; // B = Item Biaya, C = Sub-Item Biaya
const SUB_MAX = 80; // lebar 'BANTU SUB ITEM' A..CB

const str = (v) => (v == null ? "" : String(v));
const key = (v) => str(v).trim().toLowerCase();

/** Daftar item (persis isi dropdown kolom I) + peta item -> sub-item (meniru formula). */
async function loadItemOptions(cashflowId) {
  const rule = await getDataValidation(cashflowId, `'${SHEET}'!I2`);
  const cond = rule && rule.condition;
  let items = [];
  if (cond && cond.type === "ONE_OF_RANGE") {
    const a1 = str(cond.values && cond.values[0] && cond.values[0].userEnteredValue).replace(/^=/, "").replace(/\$/g, "");
    items = (await readRange(cashflowId, a1)).flat().map(str);
  } else if (cond && cond.type === "ONE_OF_LIST") {
    items = (cond.values || []).map((v) => str(v.userEnteredValue));
  } else {
    throw new Error(`Kolom ITEM BIAYA (I) di sheet ${SHEET} belum memiliki dropdown.`);
  }
  // UNIQUE peka huruf besar/kecil; buang kosong, pertahankan urutan.
  const seen = new Set();
  items = items.filter((v) => v.trim() && !seen.has(v) && seen.add(v));

  // FILTER(C; B = item; C<>"") — perbandingan teks di Sheets TIDAK peka huruf besar/kecil.
  const master = await readRange(cashflowId, `'${MASTER}'!B2:C1000`);
  const subs = {};
  for (const item of items) {
    const want = str(item).toLowerCase();
    const got = new Set();
    const list = [];
    for (const r of master) {
      const b = str(r && r[0]);
      const c = str(r && r[1]);
      if (!c.trim() || b.toLowerCase() !== want || got.has(c)) continue;
      got.add(c);
      list.push(c);
    }
    subs[item] = list.slice(0, SUB_MAX);
  }
  return { items, subs };
}

/**
 * Samakan pasangan item/sub-item ke ejaan resmi dropdown. Melempar bila tidak sah.
 * Kosong boleh (keduanya opsional), tetapi sub-item tanpa item tidak boleh.
 */
function resolvePair(opts, item, sub) {
  const it = str(item).trim();
  const sb = str(sub).trim();
  if (!it) {
    if (sb) throw new Error(`SUB ITEM BIAYA "${sb}" diisi tanpa ITEM BIAYA.`);
    return { item: "", sub: "" };
  }
  const ci = opts.items.find((x) => key(x) === key(it));
  if (!ci) throw new Error(`ITEM BIAYA "${it}" tidak ada di dropdown kolom ITEM BIAYA.`);
  if (!sb) return { item: ci, sub: "" };
  const cs = (opts.subs[ci] || []).find((x) => key(x) === key(sb));
  if (!cs) throw new Error(`SUB ITEM BIAYA "${sb}" bukan pilihan untuk ITEM BIAYA "${ci}".`);
  return { item: ci, sub: cs };
}

/**
 * Saran item/sub-item per KETERANGAN (kunci huruf kecil):
 *  1) riwayat bulan ini di INPUT PENGGUNAAN BIAYA (pilihan user sendiri) — diutamakan;
 *  2) sheet DAFTAR BIAYA (BIAYA & KAS LAUNDRY): kolom ITEM BIAYA di sana berisi nama
 *     sub-item Smartlink → item induknya dicari di daftar Smartlink. Bila sub-item itu
 *     dimiliki beberapa item, dipilih yang namanya sama dengan POS BIAYA APLIKASI /
 *     POS BIAYA; bila tetap ragu, tidak disarankan. Bila ITEM BIAYA kosong tetapi
 *     POS BIAYA sama dengan nama item (mis. "Gaji Karyawan"), item saja yang disarankan.
 * Hasil selalu memakai ejaan resmi dropdown. Toleran: sumber yang gagal dibaca dilewati.
 */
async function loadSaran(cashflowId, opts) {
  const saran = {};
  const bySub = new Map();
  for (const item of opts.items) {
    for (const s of opts.subs[item] || []) {
      if (!bySub.has(key(s))) bySub.set(key(s), []);
      bySub.get(key(s)).push({ item, sub: s });
    }
  }
  const itemByName = new Map(opts.items.map((i) => [key(i), i]));

  try {
    const rows = await readRange(cfg.BIAYA_KAS_SPREADSHEET_ID, `'DAFTAR BIAYA'!C2:F`);
    for (const r of rows) {
      const ket = key(r && r[0]);
      if (!ket) continue;
      const pos = key(r[1]);
      const posApl = key(r[2]);
      const sub = key(r[3]);
      let pick = null;
      if (sub) {
        const cands = bySub.get(sub) || [];
        if (cands.length === 1) pick = cands[0];
        else if (cands.length > 1) pick = cands.find((c) => [posApl, pos].includes(key(c.item))) || null;
      } else {
        const it = itemByName.get(posApl) || itemByName.get(pos);
        if (it) pick = { item: it, sub: "" };
      }
      if (pick) saran[ket] = { ...pick, sumber: "daftar" };
    }
  } catch {
    /* DAFTAR BIAYA tak terbaca -> lewati sumber ini */
  }

  try {
    const hist = await readRange(cashflowId, `'${SHEET}'!B2:J`); // B=0 ... I=7, J=8
    const freq = new Map();
    for (const r of hist) {
      const ket = key(r && r[0]);
      if (!ket || !str(r[7]).trim()) continue;
      let pair;
      try {
        pair = resolvePair(opts, r[7], r[8]);
      } catch {
        continue; // isian lama yang tak lagi sah tidak dipakai
      }
      if (!freq.has(ket)) freq.set(ket, new Map());
      const m = freq.get(ket);
      const pk = `${pair.item}\u0001${pair.sub}`;
      m.set(pk, { pair, n: ((m.get(pk) || {}).n || 0) + 1 });
    }
    for (const [ket, m] of freq) {
      const best = [...m.values()].sort((a, b) => b.n - a.n)[0];
      saran[ket] = { ...best.pair, sumber: "riwayat" };
    }
  } catch {
    /* riwayat tak terbaca -> lewati */
  }
  return saran;
}

/** Pilihan + saran untuk menu Input Biaya. Tidak pernah melempar. */
async function getItemOptions() {
  try {
    const cashflow = await resolveCashflowSpreadsheetId();
    const opts = await loadItemOptions(cashflow.id);
    const saran = await loadSaran(cashflow.id, opts);
    return { ok: true, items: opts.items, subs: opts.subs, saran, error: null };
  } catch (err) {
    return { ok: true, items: [], subs: {}, saran: {}, error: err.message || String(err) };
  }
}

module.exports = { loadItemOptions, resolvePair, loadSaran, getItemOptions, SHEET };
