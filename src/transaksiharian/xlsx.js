"use strict";

const { unzipSync, strFromU8 } = require("fflate");
const { xlsxColNum_ } = require("./kodeinternal");

/*
 * Padanan Node untuk bacaXlsxSheet_() & xlsxSiText_() di Dashboard Internal
 * (Kode.gs), yang di sana memakai Utilities.unzip + XmlService. Perilakunya
 * dibuat SAMA:
 *  - worksheet yang dibaca = nama 'xl/worksheets/sheetN.xml' terkecil secara
 *    perbandingan teks (persis seperti kode aslinya);
 *  - nilai sel selalu TEKS mentah: t="s" → teks shared string, t="inlineStr" →
 *    teks <is>, selain itu isi <v> apa adanya ('' bila tidak ada <v>);
 *  - shared string: anak <t> langsung bila ada, kalau tidak gabungan <r><t>;
 *  - sel tanpa atribut r dilewati; baris tanpa r diberi nomor urut.
 * Hasil: [{ r: nomorBaris, cells: { nomorKolom: nilai } }].
 */

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decode(s) {
  return String(s).replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, e) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENT[e];
  });
}

function attr(attrs, name) {
  const m = String(attrs).match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`));
  return m ? decode(m[2] !== undefined ? m[2] : m[3]) : null;
}

/**
 * Pohon XML sederhana (cukup untuk sharedStrings & worksheet): elemen dengan
 * nama lokal (awalan namespace dibuang), atribut mentah, anak, dan teks.
 */
function parseXml(xml) {
  const root = { name: "#root", attrs: "", children: [], text: "" };
  const stack = [root];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)(?:[\w.-]+:)?([\w.-]+)((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) {
      top.text += m[1]; // CDATA
    } else if (m[3] !== undefined) {
      if (m[2] === "/") {
        if (stack.length > 1) stack.pop();
      } else {
        const el = { name: m[3], attrs: m[4] || "", children: [], text: "" };
        top.children.push(el);
        if (m[5] !== "/") stack.push(el);
      }
    } else if (m[6] !== undefined) {
      top.text += decode(m[6]);
    }
  }
  return root;
}

const child = (el, name) => (el ? el.children.find((c) => c.name === name) || null : null);
const kids = (el, name) => (el ? el.children.filter((c) => c.name === name) : []);

// = xlsxSiText_(si): anak <t> langsung, atau gabungan <r><t>.
function siText(si) {
  const t = child(si, "t");
  if (t) return t.text;
  let s = "";
  for (const r of kids(si, "r")) {
    const tt = child(r, "t");
    if (tt) s += tt.text;
  }
  return s;
}

function bacaXlsxSheet(bytes) {
  let files;
  try {
    files = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  } catch (e) {
    throw new Error("File bukan xlsx yang valid (tidak bisa dibuka).");
  }

  const shared = [];
  if (files["xl/sharedStrings.xml"]) {
    const sroot = parseXml(strFromU8(files["xl/sharedStrings.xml"]));
    const sst = sroot.children.find((c) => c.name === "sst");
    for (const si of kids(sst, "si")) shared.push(siText(si));
  }

  let sheetName = null;
  for (const k of Object.keys(files)) {
    if (/^xl\/worksheets\/sheet\d+\.xml$/.test(k)) {
      if (!sheetName || k < sheetName) sheetName = k;
    }
  }
  if (!sheetName) throw new Error("File bukan xlsx yang valid (worksheet tidak ditemukan).");

  const wroot = parseXml(strFromU8(files[sheetName]));
  const ws = wroot.children.find((c) => c.name === "worksheet");
  const data = child(ws, "sheetData");
  const out = [];
  for (const row of kids(data, "row")) {
    const rAttr = attr(row.attrs, "r");
    const rnum = rAttr !== null ? parseInt(rAttr, 10) : out.length + 1;
    const cells = {};
    for (const c of kids(row, "c")) {
      const refA = attr(c.attrs, "r");
      if (!refA) continue;
      const col = xlsxColNum_(refA);
      const t = attr(c.attrs, "t");
      const v = child(c, "v");
      let val = "";
      if (t === "s" && v) val = shared[parseInt(v.text, 10)] || "";
      else if (t === "inlineStr") {
        const is = child(c, "is");
        val = is ? siText(is) : "";
      } else if (v) val = v.text;
      cells[col] = val;
    }
    out.push({ r: rnum, cells });
  }
  return out;
}

module.exports = { bacaXlsxSheet, _parseXml: parseXml };
