#!/usr/bin/env node
"use strict";

/*
 * Menyalin aturan pembacaan file "Rekap Data Transaksi" dari Dashboard Internal
 * (repo andwowor/Internal-Co-Clean-Laundry, google-apps-script/Kode.gs) ke
 * src/transaksiharian/kodeinternal.js — APA ADANYA, fungsi demi fungsi.
 *
 * Pakai:  node scripts/sync-transaksi-internal.js /path/ke/internal-co-clean-laundry
 *
 * Yang disalin: agregasiTransaksi_ beserta seluruh fungsi/var tingkat atas yang
 * dipakainya (dicari otomatis), plus KOLOM_KOREKSI_PCS dan xlsxColNum_.
 * bacaXlsxSheet_/xlsxSiText_ TIDAK disalin karena memakai layanan Apps Script
 * (Utilities/XmlService); padanannya untuk Node ada di src/transaksiharian/xlsx.js.
 * Skrip gagal bila ada fungsi tersalin yang memakai layanan Apps Script.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const repo = process.argv[2];
if (!repo) {
  console.error("Pakai: node scripts/sync-transaksi-internal.js /path/ke/internal-co-clean-laundry");
  process.exit(2);
}
const kodePath = path.join(repo, "google-apps-script", "Kode.gs");
const src = fs.readFileSync(kodePath, "utf8");
const lines = src.split("\n");

const ROOTS = ["agregasiTransaksi_", "KOLOM_KOREKSI_PCS", "xlsxColNum_"];
const EXCLUDE = new Set(["bacaXlsxSheet_", "xlsxSiText_"]);
const SERVICES = /\b(Utilities|XmlService|SpreadsheetApp|DriveApp|CacheService|LockService|PropertiesService|Session|Logger|UrlFetchApp|MailApp|GmailApp|HtmlService|ContentService|ScriptApp)\b/;

const stripStrings = (t) =>
  t
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''");

// Deklarasi tingkat atas beserta rentang barisnya.
const decls = [];
lines.forEach((l, i) => {
  let m = l.match(/^function\s+([A-Za-z0-9_$]+)\s*\(/);
  if (m) decls.push({ name: m[1], kind: "function", start: i });
  m = l.match(/^var\s+([A-Za-z0-9_$]+)\s*=/);
  if (m) decls.push({ name: m[1], kind: "var", start: i });
});
for (const d of decls) {
  if (d.kind === "function") {
    let j = d.start;
    while (j < lines.length && lines[j] !== "}") j++;
    d.end = j;
  } else {
    let depth = 0;
    let j = d.start;
    for (; j < lines.length; j++) {
      const t = stripStrings(lines[j]);
      for (const ch of t) {
        if ("([{".includes(ch)) depth++;
        else if (")]}".includes(ch)) depth--;
      }
      if (depth <= 0 && /;\s*(\/\/.*)?$/.test(lines[j])) break;
    }
    d.end = j;
  }
  // Komentar tepat di atas deklarasi ikut disalin (penjelasan aturan).
  let c = d.start;
  while (c > 0 && /^\s*(\/\/|\/\*|\*)/.test(lines[c - 1])) c--;
  d.commentStart = c;
}
const byName = new Map(decls.map((d) => [d.name, d]));

const order = [];
const seen = new Set();
function visit(n) {
  if (seen.has(n) || EXCLUDE.has(n) || !byName.has(n)) return;
  seen.add(n);
  const d = byName.get(n);
  const body = lines.slice(d.start, d.end + 1).join("\n");
  const ids = new Set(stripStrings(body).match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || []);
  for (const id of ids) if (id !== n) visit(id);
  if (SERVICES.test(stripStrings(body))) {
    throw new Error(`${n} memakai layanan Apps Script — tidak bisa disalin apa adanya.`);
  }
  order.push(d);
}
ROOTS.forEach((r) => {
  if (!byName.has(r)) throw new Error(`${r} tidak ditemukan di Kode.gs.`);
  visit(r);
});
order.sort((a, b) => a.start - b.start);

let commit = "?";
try {
  commit = execSync("git rev-parse --short HEAD", { cwd: repo }).toString().trim();
} catch {
  /* bukan repo git */
}

const out = [];
out.push("/*");
out.push(" * DIBUAT OTOMATIS — JANGAN DIUBAH MANUAL.");
out.push(" * Salinan apa adanya dari Dashboard Internal (andwowor/Internal-Co-Clean-Laundry)");
out.push(` * google-apps-script/Kode.gs @ ${commit}, oleh scripts/sync-transaksi-internal.js.`);
out.push(" * Perbarui dengan menjalankan skrip itu lagi bila aturan pembacaan nota berubah di sana.");
out.push(" *");
out.push(" * Isi: " + order.map((d) => d.name).join(", "));
out.push(" */");
out.push("/* eslint-disable */");
out.push("");
// Repo dashboard ini publik: nomor nota contoh di dalam KOMENTAR disamarkan.
// Baris kode tidak disentuh sama sekali.
const samarkan = (l) => (/^\s*(\/\/|\/\*|\*)/.test(l) ? l.replace(/\b[A-Z]{3}\d{12,}\b/g, "<nota>") : l);
for (const d of order) {
  out.push(lines.slice(d.commentStart, d.end + 1).map(samarkan).join("\n"));
  out.push("");
}
out.push("module.exports = { " + order.map((d) => d.name).join(", ") + " };");
out.push("");

const target = path.join(__dirname, "..", "src", "transaksiharian", "kodeinternal.js");
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, out.join("\n"));
console.log(`Tersalin ${order.length} deklarasi dari Kode.gs @ ${commit} → ${path.relative(process.cwd(), target)}`);
for (const d of order) console.log(`  ${d.kind.padEnd(8)} ${d.name} (baris ${d.start + 1}-${d.end + 1})`);
