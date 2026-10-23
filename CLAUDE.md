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
