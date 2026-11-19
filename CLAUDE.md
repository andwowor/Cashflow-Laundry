# Catatan kerja untuk Claude — Dashboard Cashflow Laundry

## Aturan utama: kerjakan sendiri

Pemilik proyek ini **bukan orang teknis**. Semua yang bisa dikerjakan sendiri oleh
Claude, **kerjakan sendiri** — jangan diserahkan sebagai langkah manual yang harus
dia lakukan.

Yang harus dilakukan sendiri (jangan dijadikan instruksi untuk user):
- Menulis, menguji, memperbaiki, meng-commit, dan mem-push kode.
- Memverifikasi hasil sebelum melapor (jalankan server/uji di container bila perlu;
  `npm install --omit=dev` lalu `node server.js` dengan env sementara sudah cukup
  untuk endpoint yang tidak butuh kredensial).
- Mencari sendiri fakta dari spreadsheet/Drive lewat tool yang tersedia, alih-alih
  menanyakannya ke user.

Hanya minta bantuan user untuk hal yang **benar-benar** di luar jangkauan sesi cloud
ini, dan sebutkan alasannya dalam satu kalimat:
- Tindakan di Mac miliknya yang tidak bisa dijangkau dari cloud.
- Pembelian/akun (VPS, domain), serta pemberian izin Google Drive/Sheets.
- Keputusan bisnis yang memang haknya.

## Pembaruan aplikasi: lewat dashboard, bukan terminal

Dashboard bisa memperbarui dirinya sendiri: tab **Pengaturan → Versi & Pembaruan
Aplikasi** (`src/appupdate.js`, endpoint `/api/app/version` & `/api/app/update`).
Dashboard mengecek pembaruan otomatis saat dibuka dan menampilkan tombol bila ada.

Karena itu **JANGAN lagi menutup jawaban dengan instruksi**
`git pull` + `pm2 restart` + *hard refresh*. Cukup push, lalu beri tahu bahwa
pembaruannya tinggal diklik di tab Pengaturan (atau akan muncul sendiri).
Berkas `app.js`/`styles.css` disajikan dengan penanda versi, jadi hard refresh
tidak diperlukan lagi.

Pengecualian sah: bila updater di Mac **tidak bisa** menerapkan pembaruan (versi
updater-nya sendiri lama/rusak), satu kali `git pull` + `pm2 restart` manual memang
diperlukan — sebutkan alasannya dalam satu kalimat.

Pelajaran updater (jangan diulang): berkas yang **tidak dilacak git** di mesin user
(mis. `public/logo.jpeg`, `data/`, `.env`) tidak boleh pernah menghalangi pembaruan;
`package-lock.json` yang berubah karena `npm install` lokal dipulihkan otomatis; untuk
perubahan lain biarkan `git pull --ff-only` yang menilai (ia menolak dengan aman).
Setiap perubahan pada `src/appupdate.js` wajib diuji terhadap repo git terisolasi
yang meniru kondisi Mac (logo lokal + lock berubah), pakai `APP_REPO_DIR`.

## Konteks proyek

- Bahasa jawaban: **Indonesia**, sederhana dan ringkas.
- Zona waktu bisnis: Asia/Makassar (WITA). Tanggal di sheet: `dd/mm/yyyy`.
  Pemisah argumen formula spreadsheet: `;` (locale Indonesia).
- Cabang kerja: `claude/beautiful-bohr-8l57ky`. Jangan push ke cabang lain.
- Spreadsheet CASHFLOW **berganti tiap bulan**. Jangan pernah menyimpan state
  lokal yang dikunci ke nomor baris/NOMOR tanpa memisahkannya per bulan atau per
  spreadsheet — pola ini sudah dua kali menyebabkan bug (lihat `src/moninput.js`
  dan `src/monbiaya.js`).
- Jangan pernah menulis rahasia (API key, isi service account) ke repo, commit,
  atau jawaban chat.
- **ITEM BIAYA (I) & SUB ITEM BIAYA (J)** di INPUT PENGGUNAAN BIAYA (`src/itembiaya.js`):
  I = dropdown dari `'BANTU DAFTAR ITEM'!A2:A200` (=UNIQUE item dari
  `DAFTAR ITEM BIAYA SMARTLINK` kolom B). J baris N = dropdown bertingkat dari
  `'BANTU SUB ITEM'!A{N}:CB{N}` (=UNIQUE(FILTER(C; B = I{N}))) — hanya sub-item milik
  item di baris itu, maks. 80. Sejak 18 Nov 2026 seluruh J2:J998 (CASHFLOW NOVEMBER 2026)
  sudah bertingkat; sebelumnya baris 121+ memakai daftar datar C2:C1000 — cek lagi bila
  spreadsheet bulan baru dibuat dari templat lama.
  Item tanpa sub-item ada (4 item "Penyesuaian Persediaan …"). Selalu tulis ejaan
  resmi dari dropdown; sub-item yang disaring per item sah untuk kedua jenis baris.
- **Konfirmasi Biaya Smartlink otomatis** (tombol di Monitoring Biaya; `src/konfirmasi.js`,
  `src/smartlinkbrowser.js`, `src/konfirmasiprompt.js`): menjalankan skill
  konfirmasi-biaya-smartlink lewat Claude computer use (`computer_toolset_20260801`) pada Chrome
  tersembunyi di Mac (playwright-core, `channel: "chrome"`, profil `data/smartlink-chrome`; login
  Smartlink sekali lewat tombol "Login Smartlink"). Pencocokan 5 kolom + tanda ✓ VERIFIKASI OWNER
  dikerjakan server (tool `cocokkan_biaya` → sheet BIAYA), bukan lewat DOM dashboard. Baris yang
  sudah ✓ tapi belum disetujui disimpan per KODE TRANSAKSI (`data/konfirmasi_pending.json`), bukan
  per nomor baris. dashboard.smartlink.id tidak terjangkau dari sesi cloud — uji dengan tiruan
  Smartlink kanvas + tiruan API. Bila skill-nya berubah, sesuaikan `src/konfirmasiprompt.js`.
