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
  Login otomatis: akun Smartlink diisi user SEKALI di formulir dashboard → `data/smartlink_akun.json`
  (izin 600, `src/smartlinkakun.js`). Tool `isi_login` mengetik nilainya langsung ke kolom yang aktif;
  email/sandi tidak pernah masuk percakapan AI, log, riwayat, ataupun repo (maks. 2 percobaan/proses).
- **Robot skill Smartlink umum** (`src/robotjobs.js`; tombol di Monitoring Biaya, Lapor Smartlink, Input Kas):
  menjalankan skill konfirmasi-setoran-owner, input-setoran-owner, input-biaya, input-kas, dan
  settlement-qris dengan **salinan teks skill asli di `src/skills/*.md`** + prompt adaptor yang memetakan
  alat Claude in Chrome ke alat robot (tab smartlink/dashboard/gambar, `javascript`, `unggah_file`,
  `daftar_drive`, `baca_sheet`, `tulis_sheet` khusus INPUT QRIS baris kosong, `tanya_andre` → kartu
  pertanyaan di panel, `catat_progres`, `laporan_akhir`). Bila Andre mengubah skill di claude.ai, salin
  ulang SKILL.md-nya ke `src/skills/` (di sesi cloud ada di `/root/.claude/skills/synced/…`).
  Tab dashboard robot memakai cookie login buatan server. Skill mencari tombol tab lewat innerText persis
  (mis. 'Input Kas') — jangan menambah teks/elemen ke label tab; tanda robot dibuat lewat CSS `::after`.
- **Upload File** (dulu menu "Upload Pelunasan"): dua sub menu — *Upload Pelunasan* (fitur lama, `#sub-pelunasan`)
  dan *Upload Transaksi Harian* (`src/transaksiharian/`), **tanpa login** (keputusan Andre 20 Nov 2026). Sama persis
  dengan menu di Dashboard Internal (repo privat `andwowor/Internal-Co-Clean-Laundry`): aturan baca nota =
  `kodeinternal.js`, salinan apa adanya dari `Kode.gs` yang DIBUAT oleh `node scripts/sync-transaksi-internal.js
  <clone repo internal>` — jangan diedit manual; jalankan ulang skrip itu bila aturan di sana berubah. `xlsx.js` =
  padanan Node `bacaXlsxSheet_`; `index.js` = padanan `apiUploadTransaksi_`/`apiGetTransaksiInfo_` yang menulis
  langsung ke sheet TRANSAKSI HARIAN (spreadsheet PERFORMA PEGAWAI CO CLEAN LAUNDRY) lewat service account:
  upsert per NO NOTA, kolom koreksi PCS/tanpa judul tak disentuh, USER_ENTERED, KONFIG › TRANSAKSI_LAST_UPLOAD.
  Kesetaraan diuji dengan menjalankan fungsi ASLI Kode.gs di vm (pola harness repo internal) vs salinan.
  Service account harus Editor di spreadsheet itu (bila belum, UI menampilkan petunjuk berbagi).
  **Klarifikasi nota perlu dicek** (`src/transaksiharian/klarifikasi.js`; `/api/transaksi-harian/{perlu-dicek,
  klarifikasi,kamus,kamus/hapus}`): owner menulis arti keterangan di kotak kanan tiap nota. Ditafsirkan jadi aturan
  ALIAS (salah ketik → kata yang dikenal parser, mis. hndk→handuk, pvs→pcs), HITUNG (barang baru, ditambahkan
  sementara ke `SATUAN_BAJU` selama agregasi), ABAIKAN (diganti "satuan"), atau NOTA (teks mis. "10 pcs" ditempel ke
  baris kiloan nota itu saja). Disimpan di sheet **KLARIFIKASI KETERANGAN** (PERFORMA PEGAWAI; RAW; AKTIF=TIDAK untuk
  menghapus) dan diterapkan sebagai lapisan SEBELUM `agregasiTransaksi_` — `kodeinternal.js` tetap salinan murni; tanpa
  aturan hasil upload identik dengan aslinya. KETERANGAN ASLI di sheet tetap teks kasir. Nota perlu dicek upload
  terakhir + baris mentahnya disimpan di `data/transaksi_perlu_dicek.json` (per NO NOTA) agar bisa dihitung ulang dan
  ditulis ulang ke TRANSAKSI HARIAN begitu diklarifikasi. Aturan ini belum dipakai Dashboard Internal (Kode.gs).
- Repo ini **publik**. Jangan menambah ID file/folder Drive baru, data pribadi, atau rahasia ke repo.
- **Proyeksi Biaya** (`src/proyeksi.js`, `/api/proyeksi`, `/api/proyeksi/simpan`): menampilkan seluruh sheet
  PROYEKSI BIAYA (CASHFLOW bulan berjalan) lengkap dengan sel gabungan, KECUALI kolom berjudul LOKASI & KET
  (disembunyikan atas permintaan Andre; dicari dari judulnya, `hiddenCols`). Yang boleh diedit HANYA sel angka/kosong di
  kolom berjudul nama bulan spreadsheet (NOVEMBER = kolom C MAUMBI & I PERKAMIL) yang bukan formula dan bukan luapan
  rumus array (B/H = IMPORTRANGE). Kolom dicari ulang tiap muat dari baris judul (jangan dikunci ke huruf kolom).
  Setiap simpan memvalidasi ulang di server: ID spreadsheet, SUBJEK baris, bukan formula, dan nilai lama belum berubah
  (bila berubah → 409 + tabel terbaru, tidak menimpa). Ditulis per sel (USER_ENTERED), lalu tabel dibaca ulang agar
  TOTAL ikut terbarui.
  **Isi dari berkas proyeksi** (`src/proyeksiupload.js`, `/api/proyeksi/berkas{,/pratinjau,/terapkan}`): unggah workbook
  `Proyeksi_LabaRugi_CoCleanLaundry_…xlsx` → nominal komponen dari sheet "5. Proyeksi MAUMBI"/"6. Proyeksi PERKAMIL"
  (cari sheet `Proyeksi <OUTLET>` sesuai kelompok kolom), blok "SKENARIO …" (default REALISTIS, bisa dipilih), kolom
  bulan = bulan spreadsheet CASHFLOW aktif ("Nov 26"; di blok REALISTIS ada juga realisasi "Nov-25" → pilih yang di
  bawah judul PROYEKSI). Cocok per nama SUBJEK, dibulatkan ke rupiah, sel formula dilewati, pratinjau dulu lalu satu
  batchWrite (sel yang berubah sejak pratinjau dilewati). Sel di berkas itu FORMULA TANPA NILAI TERSIMPAN → seluruh
  workbook dihitung ulang dengan **HyperFormula** (`hyperformula` 3.5.0, lisensi gpl-v3). Uji kesetaraan: hasilnya
  sama dengan LibreOffice (`soffice --headless --convert-to csv…`, tersedia di container) untuk semua sel sheet 5 & 6;
  sheet analisa lain memakai FORECAST/INTERCEPT/FIXED yang belum didukung — sel galat tidak pernah ditulis.
  **Undo** (`/api/proyeksi/berkas/undo` GET status / POST {id}): tiap simpan dari berkas mencatat angka lama per sel di
  `data/proyeksi_undo.json` (maks. 20, per ID spreadsheet, outlet + SUBJEK + a1). Undo bersifat tumpukan (yang terbaru
  dulu), mencari baris lewat SUBJEK, dan hanya mengembalikan sel yang nilainya MASIH sama dengan hasil upload.
