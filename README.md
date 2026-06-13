# Dashboard Kas Laundry

Dashboard untuk memantau kas bisnis laundry (outlet **MAUMBI** & **PERKAMIL**) dengan
**Claude Sonnet 4.6** sebagai otaknya. Terhubung langsung ke dua Google Spreadsheet:

| Spreadsheet | Sifat |
|---|---|
| **BIAYA & KAS LAUNDRY** | Tetap (ID dikunci di konfigurasi) |
| **CASHFLOW DAN BIAYA \<BULAN\> \<TAHUN\>** | Berganti tiap bulan — dideteksi otomatis dari judul, atau diisi manual lewat menu Pengaturan |

## Tiga Fungsi Utama

### 1. Tombol "Jalankan Update Harian" (tab Monitoring)

Satu klik menjalankan rangkaian berikut (urutan sudah disesuaikan agar data mengalir benar):

1. Cari blok bulan berjalan di sheet `REKAP KAS DAN TRANSAKSI MAUMBI` dan
   `REKAP KAS DAN TRANSAKSI PERKAMIL` (mis. blok **JUNI** = baris 198–247, baris
   **KAS TUNAI LAPOR** = baris 226). Saat bulan berganti, blok baru terdeteksi
   otomatis dari nama bulan di kolom A — mengikuti pola baris bulan-bulan sebelumnya.
2. Ambil nominal **KAS TUNAI LAPOR** pada kolom tanggal hari ini, lalu tulis ke
   sheet `KAS`: **B2** (Maumbi) dan **B3** (Perkamil). *(Catatan: instruksi awal
   menyebut "C2/C3" untuk nominal, tetapi kolom C adalah kolom tanggal — nominal
   ditulis ke kolom B sesuai struktur sheet. Sel B2/B3 yang sebelumnya berisi
   formula ke blok bulan lalu akan tertimpa nilai harian — ini memang tujuan tombol.)*
3. Set tanggal hari ini di `KAS!C2:C3` dan `KAS!C6:C9`.
4. Salin nominal+tanggal `KAS!B2:C3` (kas tunai outlet) dan `KAS!B6:C9` (kas bank
   BCA/BRI/BNI/Mandiri) ke `INPUT LAPORAN HARIAN!B2:C3` dan `B6:C9` di spreadsheet CASHFLOW.
5. Set tanggal hari ini di `INPUT LAPORAN HARIAN!C4:C5`, `C10:C15`, dan `C16:C25`.

Tab Monitoring juga menampilkan isi sheet `KAS` dan `INPUT LAPORAN HARIAN`
berdampingan (baris yang sudah ter-update hari ini di-highlight).

### 2. Input Biaya (tab Input Biaya)

Upload screenshot / bukti transfer pengeluaran → Claude Sonnet 4.6 membaca bukti dan
mengusulkan isian untuk sheet `INPUT PENGGUNAAN BIAYA`:

- **Subjek Biaya** & **Kode Transaksi**: otomatis oleh spreadsheet (hanya ditampilkan, tidak ditulis).
- **Keterangan**: dipilih dari dropdown `DAFTAR BIAYA` (AI mengusulkan, Anda bisa ganti).
- **Nominal** & **Tanggal**: dibaca dari bukti.
- **Outlet**: selalu Anda pilih manual.
- **Status Smartlink**: selalu terisi `BELUM INPUT`.
- **Sumber Dana**: dipilih dari dropdown; otomatis terisi bila nama bank terlihat di bukti.

Sebelum submit selalu ada pratinjau yang bisa diedit. Setiap submit final dicatat ke
`data/learning.json` dan riwayat sheet ikut dibaca ulang — makin sering dipakai,
usulan AI makin sesuai kebiasaan pengisian Anda.

### 3. Input Kas Bank & Kas Laundry (tab Input Kas)

Empat jenis upload, semuanya **dengan pratinjau konfirmasi** sebelum ditulis, dan
tanggal otomatis diset ke hari upload:

| Upload | Tujuan |
|---|---|
| Kas bank BCA / BRI / BNI / Mandiri | `KAS!B6–B9` + `C6–C9` (BIAYA & KAS LAUNDRY) |
| Kas aplikasi outlet Maumbi / Perkamil | `INPUT LAPORAN HARIAN!B4–B5` + `C4–C5` |
| Kas bank di aplikasi (BCA/BRI/BNI/Mandiri) | `INPUT LAPORAN HARIAN!B11–B14` + `C11–C14` |
| Belum settlement | `INPUT LAPORAN HARIAN!B15` + `C15` |

## Setup

1. **Node.js 18+**, lalu `npm install`.
2. **Google service account**:
   - Buat project di [Google Cloud Console](https://console.cloud.google.com), aktifkan
     **Google Sheets API** dan **Google Drive API**.
   - Buat service account + key JSON, simpan mis. di `credentials/service-account.json`.
   - **Bagikan kedua spreadsheet** (dan spreadsheet CASHFLOW bulan-bulan berikutnya)
     ke email service account sebagai **Editor**. Email-nya tampil di tab Pengaturan.
3. **API key Claude**: buat di platform.claude.com.
4. Salin `.env.example` → `.env` dan isi nilainya.
5. Jalankan: `npm start` → buka `http://localhost:3000`.

## Pergantian Bulan

Setiap awal bulan dashboard mencari spreadsheet berjudul persis
`CASHFLOW DAN BIAYA <BULAN> <TAHUN>` (mis. `CASHFLOW DAN BIAYA JULI 2026`) di Drive
yang dibagikan ke service account. Jika belum dibagikan / judul berbeda, tempel
link-nya di tab **Pengaturan** — override hanya berlaku untuk bulan tersebut.

Blok bulan baru di sheet REKAP (baris baru mengikuti pola: header bulan → +28 baris
ke "KAS TUNAI LAPOR") terdeteksi otomatis dari nama bulan, jadi tidak perlu mengubah
kode saat baris 226 berganti ke baris bulan berikutnya.

## Catatan Teknis

- Zona waktu default **Asia/Makassar (WITA)** — bisa diubah lewat `TZ_NAME`.
- Tanggal ditulis sebagai `dd/mm/yyyy` dengan `USER_ENTERED` sehingga Google Sheets
  memparsenya sebagai tanggal (locale Indonesia).
- Penulisan biaya hanya menyentuh kolom **B–G**; kolom A (formula VLOOKUP) dan H
  tidak pernah ditimpa.
- `INPUT LAPORAN HARIAN!B10` (formula SUM) tidak pernah ditimpa.
