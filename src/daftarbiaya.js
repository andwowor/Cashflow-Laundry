"use strict";

const cfg = require("./config");
const { readRange, batchWrite, getSheetTitles, getSheetId, batchUpdateRequests } = require("./sheets");

// Input subjek biaya baru ke sheet DAFTAR BIAYA (spreadsheet BIAYA & KAS LAUNDRY).
// Fokus kolom C..G sesuai instruksi:
//   C = KETERANGAN BIAYA   (ketik manual)
//   D = POS BIAYA          (pilih rekomendasi)
//   E = POS BIAYA APLIKASI (pilih rekomendasi)
//   F = ITEM APLIKASI      (pilih rekomendasi; di UI disebut "ITEM BIAYA")
//   G = KODE TRANSAKSI     (formula otomatis — disalin dari baris di atasnya)

const COLS = { keterangan: "C", posBiaya: "D", posAplikasi: "E", itemAplikasi: "F", kode: "G" };
const KODE_COL_IDX = 6; // kolom G (0-based) untuk copyPaste formula

function norm(v) {
  return String(v == null ? "" : v).trim();
}

/** Judul sheet DAFTAR BIAYA (toleran variasi penamaan). */
async function resolveSheetTitle() {
  const meta = await getSheetTitles(cfg.BIAYA_KAS_SPREADSHEET_ID);
  const found =
    meta.sheets.find((t) => t.trim().toUpperCase() === "DAFTAR BIAYA") ||
    meta.sheets.find((t) => /DAFTAR BIAYA/i.test(t));
  if (!found) throw new Error('Sheet "DAFTAR BIAYA" tidak ditemukan di spreadsheet BIAYA & KAS LAUNDRY.');
  return found;
}

/**
 * Opsi untuk form: header kolom C..G, daftar nilai unik untuk rekomendasi
 * (POS BIAYA, POS BIAYA APLIKASI, ITEM APLIKASI), seluruh baris (untuk peringkat
 * rekomendasi berdasarkan input sebelumnya), serta baris terbawah yang terisi.
 */
async function options() {
  const id = cfg.BIAYA_KAS_SPREADSHEET_ID;
  const sheet = await resolveSheetTitle();
  const grid = await readRange(id, `'${sheet}'!C1:G`, "FORMATTED_VALUE");

  const header = grid[0] || [];
  const headers = {
    keterangan: norm(header[0]) || "KETERANGAN BIAYA",
    posBiaya: norm(header[1]) || "POS BIAYA",
    posAplikasi: norm(header[2]) || "POS BIAYA APLIKASI",
    itemAplikasi: norm(header[3]) || "ITEM APLIKASI",
    kode: norm(header[4]) || "KODE TRANSAKSI",
  };

  const rows = [];
  let lastRow = 1; // baris 1 = header
  for (let i = 1; i < grid.length; i++) {
    const r = grid[i] || [];
    const ket = norm(r[0]);
    if (!ket) continue; // patokan baris terisi = kolom C (KETERANGAN BIAYA)
    rows.push({
      keterangan: ket,
      posBiaya: norm(r[1]),
      posAplikasi: norm(r[2]),
      itemAplikasi: norm(r[3]),
    });
    lastRow = i + 1; // nomor baris di sheet
  }

  const collator = new Intl.Collator("id");
  const uniqSorted = (arr) =>
    Array.from(new Set(arr.filter(Boolean))).sort((a, b) => collator.compare(a, b));

  return {
    sheet,
    columns: COLS,
    headers,
    rows,
    posBiayaList: uniqSorted(rows.map((r) => r.posBiaya)),
    posAplikasiList: uniqSorted(rows.map((r) => r.posAplikasi)),
    itemAplikasiList: uniqSorted(rows.map((r) => r.itemAplikasi)),
    lastRow,
    nextRow: lastRow + 1,
  };
}

/**
 * Tulis subjek biaya baru pada baris kosong terbawah. C..F diisi nilai;
 * G (KODE TRANSAKSI) disalin formulanya dari baris terisi terakhir agar
 * referensi relatif menyesuaikan otomatis.
 */
async function submit(payload) {
  const keterangan = norm(payload && payload.keterangan);
  const posBiaya = norm(payload && payload.posBiaya);
  const posAplikasi = norm(payload && payload.posAplikasi);
  const itemAplikasi = norm(payload && payload.itemAplikasi);
  if (!keterangan) throw new Error("KETERANGAN BIAYA wajib diisi.");
  if (!posBiaya) throw new Error("POS BIAYA wajib dipilih.");
  if (!posAplikasi) throw new Error("POS BIAYA APLIKASI wajib dipilih.");
  if (!itemAplikasi) throw new Error("ITEM BIAYA wajib dipilih.");

  const id = cfg.BIAYA_KAS_SPREADSHEET_ID;
  const sheet = await resolveSheetTitle();

  // Baris terbawah terisi (live) dari kolom C (KETERANGAN BIAYA), mulai baris 2.
  const colC = await readRange(id, `'${sheet}'!C2:C`, "FORMATTED_VALUE");
  let lastRow = 1;
  for (let i = 0; i < colC.length; i++) {
    if (colC[i] && norm(colC[i][0])) lastRow = i + 2;
  }
  const newRow = lastRow + 1;

  // Tulis C..F pada baris baru (USER_ENTERED).
  await batchWrite(id, [
    { range: `'${sheet}'!C${newRow}:F${newRow}`, values: [[keterangan, posBiaya, posAplikasi, itemAplikasi]] },
  ]);

  // Salin formula KODE TRANSAKSI (kolom G) dari baris terisi terakhir → baris baru.
  let kodeStatus = "tidak disalin (tidak ada baris sumber formula).";
  try {
    const sheetId = await getSheetId(id, sheet);
    if (sheetId != null && lastRow >= 2) {
      await batchUpdateRequests(id, [
        {
          copyPaste: {
            source: {
              sheetId,
              startRowIndex: lastRow - 1,
              endRowIndex: lastRow,
              startColumnIndex: KODE_COL_IDX,
              endColumnIndex: KODE_COL_IDX + 1,
            },
            destination: {
              sheetId,
              startRowIndex: newRow - 1,
              endRowIndex: newRow,
              startColumnIndex: KODE_COL_IDX,
              endColumnIndex: KODE_COL_IDX + 1,
            },
            pasteType: "PASTE_FORMULA",
            pasteOrientation: "NORMAL",
          },
        },
      ]);
      kodeStatus = `formula disalin dari baris ${lastRow}.`;
    }
  } catch (err) {
    kodeStatus = `gagal menyalin formula KODE TRANSAKSI: ${err.message}`;
  }

  // Baca kembali KODE TRANSAKSI yang dihasilkan (untuk ditampilkan).
  let kode = "";
  try {
    const g = await readRange(id, `'${sheet}'!G${newRow}`, "FORMATTED_VALUE");
    kode = g[0] && g[0][0] != null ? String(g[0][0]) : "";
  } catch {
    /* abaikan: pembacaan kode hanya untuk tampilan */
  }

  return { ok: true, sheet, row: newRow, keterangan, posBiaya, posAplikasi, itemAplikasi, kode, kodeStatus };
}

// ---------- Keterangan biaya untuk pegawai baru (Gaji & Kasbon › Tambah pegawai) ----------
// Permintaan Andre 26 Nov 2026: tiap pegawai baru otomatis mendapat 5 keterangan biaya, mis. pegawai dengan nama
// panggilan "Budi": Gaji Budi, Kasbon Gaji Budi, Lembur Budi, THR Budi, Bonus Kinerja Budi. POS BIAYA / POS BIAYA
// APLIKASI / ITEM BIAYA mengikuti isian yang PALING BANYAK dipakai keterangan serupa di sheet (cadangan di bawah
// bila belum ada contoh); KODE TRANSAKSI mengikuti baris contohnya (rumus disalin, angka disalin, kosong dibiarkan).
const PREFIKS_PEGAWAI = [
  ["Gaji", ["Gaji Karyawan", "", ""]],
  ["Kasbon Gaji", ["Gaji Karyawan", "", ""]],
  ["Lembur", ["Lembur Karyawan", "Biaya Gaji", "Pegawai tetap"]],
  ["THR", ["THR", "Biaya Gaji", "Pegawai tetap"]],
  ["Bonus Kinerja", ["Bonus", "Biaya Gaji", "Pegawai tetap"]],
];
const keteranganPegawai = (panggilan) => PREFIKS_PEGAWAI.map(([p]) => `${p} ${norm(panggilan).replace(/\s+/g, " ")}`);

/** Contoh isian per prefiks dari baris yang sudah ada. grid = C1:G (FORMULA). */
function contohPegawai(grid, prefiks, cadangan) {
  const awal = `${prefiks} `.toUpperCase();
  const hitung = new Map();
  for (let i = 1; i < grid.length; i++) {
    const r = grid[i] || [];
    const ket = norm(r[0]);
    if (!ket.toUpperCase().startsWith(awal) || ket.length <= awal.length) continue;
    const isi = [norm(r[1]), norm(r[2]), norm(r[3])];
    const k = isi.join("\u0001");
    const x = hitung.get(k) || { isi, n: 0, baris: 0, g: "" };
    x.n++;
    x.baris = i + 1;
    x.g = norm(r[4]);
    hitung.set(k, x);
  }
  let pilih = null;
  for (const x of hitung.values()) if (!pilih || x.n > pilih.n || (x.n === pilih.n && x.baris > pilih.baris)) pilih = x;
  return pilih || { isi: cadangan, n: 0, baris: 0, g: "" };
}

/** Tambahkan keterangan biaya pegawai baru yang belum ada. Mengembalikan { ditambah, sudahAda, sheet }. */
async function tambahKeteranganPegawai(panggilan) {
  const nama = norm(panggilan).replace(/\s+/g, " ");
  if (!nama) throw new Error("Nama panggilan kosong.");
  const id = cfg.BIAYA_KAS_SPREADSHEET_ID;
  const sheet = await resolveSheetTitle();
  const grid = await readRange(id, `'${sheet}'!C1:G`, "FORMULA");
  const ada = new Set(grid.slice(1).map((r) => norm((r || [])[0]).toUpperCase()));
  let lastRow = 1;
  for (let i = 1; i < grid.length; i++) if (norm((grid[i] || [])[0])) lastRow = i + 1;
  // Baris terakhir yang KODE TRANSAKSI-nya rumus (cadangan bila contoh belum ada).
  let barisRumusG = 0;
  for (let i = 1; i < grid.length; i++) if (/^=/.test(norm((grid[i] || [])[4]))) barisRumusG = i + 1;

  const ditambah = [];
  const sudahAda = [];
  const tulis = [];
  const salinG = [];
  const nilaiG = [];
  let baris = lastRow;
  for (const [prefiks, cadangan] of PREFIKS_PEGAWAI) {
    const ket = `${prefiks} ${nama}`;
    if (ada.has(ket.toUpperCase())) { sudahAda.push(ket); continue; }
    const c = contohPegawai(grid, prefiks, cadangan);
    baris++;
    tulis.push({ range: `'${sheet}'!C${baris}:F${baris}`, values: [[ket, ...c.isi]] });
    if (c.baris && /^=/.test(c.g)) salinG.push([c.baris, baris]);
    else if (c.baris && c.g) nilaiG.push({ range: `'${sheet}'!G${baris}`, values: [[c.g]] });
    else if (!c.baris && barisRumusG) salinG.push([barisRumusG, baris]);
    ditambah.push(ket);
  }
  if (!tulis.length) return { ditambah, sudahAda, sheet };
  await require("./google").sheetsClient().spreadsheets.values.batchUpdate({
    spreadsheetId: id,
    requestBody: { valueInputOption: "RAW", data: tulis.concat(nilaiG) },
  });
  if (salinG.length) {
    const sheetId = await getSheetId(id, sheet);
    await batchUpdateRequests(id, salinG.map(([dari, ke]) => ({
      copyPaste: {
        source: { sheetId, startRowIndex: dari - 1, endRowIndex: dari, startColumnIndex: KODE_COL_IDX, endColumnIndex: KODE_COL_IDX + 1 },
        destination: { sheetId, startRowIndex: ke - 1, endRowIndex: ke, startColumnIndex: KODE_COL_IDX, endColumnIndex: KODE_COL_IDX + 1 },
        pasteType: "PASTE_FORMULA",
        pasteOrientation: "NORMAL",
      },
    })));
  }
  return { ditambah, sudahAda, sheet, baris: [lastRow + 1, baris] };
}

module.exports = { options, submit, tambahKeteranganPegawai, keteranganPegawai, PREFIKS_PEGAWAI };
