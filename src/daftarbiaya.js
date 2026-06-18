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

module.exports = { options, submit };
