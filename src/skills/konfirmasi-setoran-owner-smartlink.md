---
name: "konfirmasi-setoran-owner-smartlink"
description: "Jalankan saat Andre minta konfirmasi/input setoran owner dari Monitoring Biaya: setujui Setoran Kas Outlet di Smartlink dengan kode transaksi, lalu input Pengambilan Prive."
---

# Konfirmasi Setoran Owner dari Monitoring Biaya

Untuk tiap baris **Setoran Owner** di **Monitoring Biaya** (Dashboard Kas Laundry) yang
**Verifikasi Owner**-nya belum ✓:

1. Setujui pasangannya di Smartlink **Setoran Kas Outlet** (catatan = kode transaksi).
2. Setelah semua disetujui, input satu entri **Pengambilan Prive** per baris.
3. Tandai **Verifikasi Owner ✓** di dashboard setelah Prive baris itu tersimpan.

Milik Co Clean Laundry (outlet Maumbi & Perkamil).

**Beda dengan `input-setoran-owner-smartlink`:** skill itu mengambil antrean dari menu
**Lapor Smartlink** (setoran owner dari rekening bank, tanpa approval). Skill ini mengambil dari
**Monitoring Biaya** dan selalu diawali approval Setoran Kas Outlet. Kalau permintaan Andre tidak
jelas menunjuk salah satunya, tanyakan dulu.

## Prasyarat

1. Chrome dengan dua tab:
   - **Smartlink**: `https://dashboard.smartlink.id` — sudah login sebagai owner.
   - **Dashboard Kas Laundry**: `http://localhost:3000/` — aplikasi lokal ini **harus hidup**.
     Kalau gagal dimuat, berhenti dan minta Andre menjalankannya dulu.
   - Kalau salah satu tab belum ada, buka tab baru untuknya (tugas ini butuh dua halaman sekaligus)
     dan sebutkan judul tab itu ke Andre.
2. Jangan pernah me-refresh (F5) tab mana pun di tengah proses.
3. Persetujuan batch di Langkah 3 selalu dari Andre. Selain itu Andre baru perlu di depan layar
   kalau dropdown akun gagal dipilih (Langkah 6a).

### Kebiasaan tool (diuji 31 Okt 2026 dengan tool side panel `mcp__claude-device__chrome_*`)

- `browser_batch` jalan — rangkai klik + tunggu + screenshot dalam satu panggilan.
- `find` gagal, dan `read_page` tidak bisa melihat isi iframe Pengambilan Prive.
- `javascript_tool` kadang gagal pada skrip panjang yang sekaligus mengklik tab dan menunggu.
  Klik tab dashboard pakai `computer`, skripnya pendek-pendek, ulangi sekali kalau gagal.
- Keluaran `javascript_tool` yang berisi `=` bercampur `&` (mis. `innerHTML`, `className=`)
  diblokir sebagai *"Cookie/query string data"*. Kembalikan teks polos dengan pemisah ` | `.
- **Panggilan yang "gagal" kadang sudah terlanjur dijalankan.** Screenshot dulu sebelum mengulang.
- Bingkai koordinat screenshot pernah 1372×882 (sementara JS melaporkan 1408×905). Koordinat di
  skill ini rujukan pada **1372×882** — selalu tentukan ulang dari screenshot.

## Karakter tiap bagian

| Bagian | Sifatnya | Cara kerjanya |
|---|---|---|
| **Dashboard Kas Laundry** | HTML biasa | Baca & klik lewat `javascript_tool`. Semua logika pencocokan di sini. |
| **Sidebar & Setoran Kas Outlet** | Flutter di atas kanvas | Baca dari screenshot, klik lewat koordinat. Koordinat sidebar dari pohon aksesibilitas. |
| **Pengambilan Prive** | HTML di dalam iframe beda domain | Screenshot + klik/ketik koordinat saja. |

Menyalakan pohon aksesibilitas Smartlink (sekali di awal sesi) dan membaca menu sidebar:
```js
const ph = document.querySelector('flt-semantics-placeholder'); if (ph) ph.click();
await new Promise(s => setTimeout(s, 1000));
Array.from(document.querySelectorAll('flt-semantics'))
  .filter(n => n.querySelectorAll('flt-semantics').length === 0)
  .map(n => { const r = n.getBoundingClientRect();
    return `${Math.round(r.x+r.width/2)},${Math.round(r.y+r.height/2)} :: ${(n.getAttribute('aria-label')||n.innerText||'').trim().replace(/\s+/g,' ')}`; })
  .filter(s => s.split(':: ')[1] && parseInt(s.split(',')[0])<400).join('\n')
```
Item bernilai y negatif atau melebihi tinggi layar ada di luar layar — gulir sidebar lalu baca ulang.

## Langkah 0 — Pasang helper di tab Dashboard Kas Laundry

Buka tab **Monitoring Biaya** (klik dengan `computer`), tunggu tulisan "Memuat..." hilang, lalu:

```js
window.__mbTable = () => Array.from(document.querySelectorAll('table')).find(t => {
  const h = ((t.querySelector('tr')||{}).innerText||'').toUpperCase();
  return h.includes('VERIFIKASI OWNER') && h.includes('KODE TRANSAKSI'); });
window.__mbNorm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g,'');
// "31 Okt 2026 17:27" dan "31 Oktober 2026" harus dianggap sama
window.__mbDate = s => { const m = String(s).match(/(\d{1,2})\s*([A-Za-z]+)\s*(\d{4})/);
  return m ? parseInt(m[1],10)+'-'+m[2].slice(0,3).toLowerCase()+'-'+m[3] : String(s).toLowerCase(); };
// SUMBER DANA -> akun Smartlink (tujuan setoran = sumber Pengambilan Prive)
window.__akun = s => { const u = String(s).toUpperCase();
  if (u.includes('BNI')) return 'Rekening BNI Andre';
  if (u.includes('BRI')) return 'Rekening BRI Andre';
  if (u.includes('BCA')) return 'Rekening BCA Andre';
  if (u.includes('MANDIRI')) return 'Rekening Mandiri Andre';
  if (u.includes('KAS')) return 'Kas Besar (Perusahaan)';   // KAS TUNAI MAUMBI / PERKAMIL
  return null; };
window.__soRows = () => Array.from(window.__mbTable().querySelectorAll('tr')).slice(1).map(r => {
  const c = Array.from(r.children).map(x => x.innerText.trim().replace(/\s+/g,' '));
  return { el:r, nomor:c[1].replace(/[^0-9]/g,''), subjek:c[2], ket:c[3], nominal:c[4],
           angka:c[4].replace(/[^0-9]/g,''), tgl:c[5], outlet:c[6], sumber:c[7], kode:c[10], ver:c[11] };
}).filter(r => window.__mbNorm(r.subjek) === 'setoranowner');
window.__soAntre = () => window.__soRows().filter(r => r.ver === '—');
window.__soCari = (nominal, tgl, outlet, tujuan) => window.__soAntre().filter(r =>
  r.angka === String(nominal).replace(/[^0-9]/g,'') &&
  window.__mbDate(r.tgl) === window.__mbDate(tgl) &&
  window.__mbNorm(outlet).includes(window.__mbNorm(r.outlet)) &&
  window.__mbNorm(window.__akun(r.sumber) || '') === window.__mbNorm(tujuan));
window.__soVerif = async (nomor, ms=12000) => {
  const r = window.__soRows().find(x => x.nomor === nomor);
  if (!r) return {status:'HILANG'};
  if (r.ver === '✓') return {status:'SUDAH'};
  if (r.ver !== '—') return {status:'TIDAK-JELAS', ver:r.ver};
  r.el.children[11].querySelector('button.mb-verif').click();      // — → … → ✓
  const t0 = Date.now();
  while (Date.now()-t0 < ms) { const x = window.__soRows().find(y => y.nomor === nomor);
    if (!x) return {status:'HILANG-SETELAH-KLIK', nomor};
    if (x.ver === '✓') return {status:'OK', nomor};
    await new Promise(s => setTimeout(s, 700)); }
  return {status:'TIMEOUT', nomor}; };
'antrean ' + window.__soAntre().length + '\n' + window.__soAntre().map(r =>
  [r.nomor, r.nominal, r.tgl, r.outlet, r.sumber, window.__akun(r.sumber), r.kode].join(' | ')).join('\n')
```

Susunan kolom Monitoring Biaya (indeks sel):
`0 (checkbox) | 1 NOMOR | 2 SUBJEK BIAYA | 3 KETERANGAN | 4 NOMINAL | 5 TANGGAL | 6 OUTLET |
7 SUMBER DANA | 8 KETERANGAN PENGGUNAAN | 9 STATUS LAPOR APLIKASI | 10 KODE TRANSAKSI |
11 VERIFIKASI OWNER | 12 KETERANGAN KOREKSI`

- Hanya **SUBJEK BIAYA = Setoran Owner** yang dikerjakan. Subjek lain diabaikan total — jangan
  disebut "dilewati".
- Kolom STATUS LAPOR APLIKASI tidak dipakai untuk memilih baris dan **tidak boleh diklik**.
- Baris dengan `__akun(...) === null` (sumber dana tak dikenal) → jangan dikerjakan, tanyakan Andre.

Catat jumlah antrean di awal sebagai pembanding di laporan akhir.

## Langkah 1 — Baca daftar Setoran Kas Outlet

Sidebar: **Keuangan › Setoran Masuk › Setoran Kas Outlet**. Tunggu sampai daftar termuat.

Bentuk kartu (baca dari screenshot, gulir sampai habis):

```
[Menunggu konfirmasi]                     ← hanya pada yang belum disetujui
Rp 200.000                                ← nominal
Co Clean Laundry Maumbi                   ← outlet
↳ Kas Besar (Perusahaan)                  ← akun tujuan setoran
Oleh Irhariani            (31 Okt 2026 17:27)   ← tanggal
```

- Kartu **Menunggu konfirmasi** ada di atas (terbaru dulu); kartu yang sudah disetujui tidak punya
  chip itu dan berlabel hijau **Disetujui** di kanan bawah kartu.
- Filter bawaan **hanya bulan berjalan** (ada tulisan Info di atas daftar). Kalau ada baris antrean
  dari bulan sebelumnya yang tidak ketemu pasangannya, ubah filter lewat tombol **Filter** di kanan
  atas — kalau tampilannya tidak jelas, tanyakan Andre.

## Langkah 2 — Pasangkan seluruh batch (belum mengklik apa pun)

Untuk tiap kartu **Menunggu konfirmasi**, jalankan di tab dashboard:

```js
JSON.stringify(window.__soCari('<nominal kartu>', '<tanggal kartu>', '<outlet kartu>', '<akun tujuan kartu>')
  .map(r => r.nomor + ' | ' + r.kode))
```

**Keempat unsur harus cocok:** nominal, tanggal (jam diabaikan), outlet, dan akun tujuan kartu ==
akun hasil pemetaan SUMBER DANA. Akun tujuan ini sekaligus menjadi *Ambil Dari Akun* di Prive,
jadi kalau tidak cocok, ada yang salah di salah satu sisi.

| Hasil | Tindakan |
|---|---|
| 1 baris | Pasangan. Catat nomor, kode, akun. |
| 0 baris | Kartu tanpa pasangan → **lewati**, laporkan. Jangan disetujui. |
| >1 baris | Kembar. Hitung kartu pending dengan nominal + tanggal + outlet + akun yang sama. **Jumlahnya sama** → pasangkan berurutan (jam kartu paling awal ↔ NOMOR terkecil); keduanya identik secara keuangan. **Jumlahnya beda** → AMBIGU, lewati semua kembaran itu, laporkan. |

Lalu dari sisi dashboard: baris antrean yang tidak mendapat kartu pending → **jangan diinput
Prive**. Cari kartu **Disetujui** dengan nominal + tanggal yang sama; kalau ada, laporkan sebagai
"sudah disetujui sebelumnya, cek Prive-nya" dan tanyakan Andre apakah Prive-nya perlu diinput.

## Langkah 3 — Minta izin satu kali

Setujui dan Simpan menyangkut uang dan tidak bisa dibatalkan. Tampilkan tabel rencana
(nomor, nominal, tanggal, outlet, akun Prive, kode transaksi) plus daftar yang akan dilewati, lalu
minta **satu persetujuan untuk seluruh batch**. Tidak perlu bertanya per baris.

Kalau Andre menulis "cek saja" / "dry run": berhenti setelah menampilkan rencana ini.

## Langkah 4 — Setujui di Setoran Kas Outlet (satu per satu)

1. Screenshot daftar, tentukan koordinat kartu dari yang terlihat (kartu ±155px tingginya; posisi
   bergeser setelah tiap persetujuan). Klik kartunya.
2. Di **Detail Setoran**, periksa: judul *Setoran Kas dari Co Clean Laundry <outlet>*, baris
   *Disetor <tanggal> oleh ...*, kotak *Disetor ke akun* (akun + nominal) dan *Total*.
   - Jam di daftar dan di detail bisa beda 1 jam (pernah 17:27 vs 18:27) — yang dicocokkan tanggalnya.
     **Kalau tanggal di daftar dan di detail berbeda** (setoran dekat tengah malam) → lewati, laporkan.
   - Tidak ada tombol Setujui / sudah berstatus disetujui → lewati, kembali ke daftar.
3. Klik **Setujui** — tombol biru kanan bawah (±1109, 772). Tombol putih di kirinya (±607, 772)
   adalah **Tolak — jangan pernah diklik**.
4. Muncul dialog **"Setujui Setoran"** (teruji 31 Okt 2026). Isinya: kotak info bahwa persetujuan
   hanya mengubah status karena pencatatan keuangan sudah diproses saat karyawan membuat setoran,
   pertanyaan *"Pastikan seluruh data sudah benar. Setujui setoran ini?"*, isian
   **Catatan (Opsional)** (±858, 637), dan tombol biru **Setujui** (±858, 744). Screenshot dulu —
   kalau dialognya berbeda dari ini, tutup lewat **✕** di kanan atas dialog (±1061, 456) tanpa
   menyetujui dan tanyakan Andre.
5. Klik isian Catatan, tunggu ±1 detik, ketik **kode transaksi** baris itu (mis. `202601011699`).
6. Zoom ke dialog untuk memastikan kodenya terketik benar, baru klik **Setujui** di dialog.
7. Notifikasi hijau **"Berhasil Mengonfirmasi Setoran Outlet."** muncul dan aplikasi kembali ke
   daftar, di posisi paling atas. Gulir sampai kartu itu terlihat dan screenshot: chip
   *Menunggu konfirmasi* hilang dan label hijau **Disetujui** muncul di kanan bawah kartu.
8. Catat baris itu sebagai **DISETUJUI**. Ulangi untuk pasangan berikutnya.

Persetujuan gagal / ragu → baris itu **tidak** lanjut ke Prive.

## Langkah 5 — Cek pengaman input dobel di Pengambilan Prive

Sidebar: **Keuangan › Pengambilan Prive**. Daftarnya terurut tanggal terbaru, 10 baris per halaman.

⚠️ **Judul kolom daftar terbalik dari form:** *Akun Asset* berisi `Dividen Investor`, *Akun Prive*
berisi akun sumber (mis. `Kas Besar (Perusahaan)`). Format tanggal `DD/MM/YY HH:MM`.

⚠️ **Daftar tanpa filter bisa basi.** Pada 31 Okt 2026 daftar tetap menampilkan 647 entri tanpa
baris baru setelah Simpan, bahkan setelah menu dibuka ulang. Hasil kotak **Search** selalu segar
(diambil ulang dari server). Karena itu **semua pengecekan memakai Search**, bukan daftar mentah.

Sebelum membuat entri untuk satu baris, klik kotak **Search** kanan atas (±1270, 89), ketik nominal
bertitik (mis. `200.000`), lalu screenshot. Pastikan belum ada entri dengan **tanggal + Akun Prive +
nominal + `Setoran Owner`** yang sama, dan catat angka **N** dari teks
*"filtered from N total entries"*. Kosongkan lagi (`triple_click` lalu `Backspace`).

Sudah ada → **jangan input**, tandai baris itu SUDAH-ADA, laporkan ke Andre.

## Langkah 6 — Input Pengambilan Prive (satu baris satu kali)

Klik **+ Tambah** biru kanan bawah (±1297, 723). Kalau dialog **Ambil Prive** belum muncul,
screenshot, lalu klik sekali lagi.

Tata letak dialog (rujukan 1372×882):

| Bagian | Koordinat |
|---|---|
| Ambil Dari Akun (select) | 858, 181 |
| Pilih Akun Prive (select) | 858, 288 |
| Nominal | 858, 395 |
| Waktu Pengambilan Prive | 840, 462 |
| Keterangan | 858, 547 |
| **Simpan** / Batal | 1006, 653 / 1094, 653 |

### a. Dua dropdown akun — pakai ketik-langsung

Klik dropdown-nya, tunggu ±1 detik, lalu `type` awalan nama akunnya. Pilihan berpindah sendiri;
tidak perlu (dan **dilarang**) menekan Enter. Lanjut dengan mengklik isian berikutnya.

| SUMBER DANA di dashboard | Ketik di *Ambil Dari Akun* | Hasil yang harus tampil |
|---|---|---|
| KAS TUNAI MAUMBI / KAS TUNAI PERKAMIL | `Kas Besar` | Kas Besar (Perusahaan) |
| BRI | `Rekening BRI` | Rekening BRI Andre |
| BNI | `Rekening BNI` | Rekening BNI Andre |
| BCA | `Rekening BCA` | Rekening BCA Andre |
| MANDIRI | `Rekening Mandiri` | Rekening Mandiri Andre |

*Pilih Akun Prive*: klik, ketik `Dividen Investor`.

Setelah masing-masing, zoom ke area dropdown: teksnya harus persis seperti kolom "Hasil" dan
**Saldo Awal-nya tidak lagi Rp. 0**. Keenam teks di atas (termasuk `Dividen Investor`) sudah
terbukti jalan pada 31 Okt 2026.

**Kalau nilainya tidak berubah** (sesi lama dengan tool berbeda pernah gagal total): jangan
mencoba cara lain dan jangan tekan Escape/Enter. Isi bagian lain dulu, lalu minta Andre memilih dua
dropdown itu sendiri, sebutkan persis akunnya, dan tunggu ia bilang sudah.

### b. Nominal

Klik kotaknya, ketik **angka polos tanpa titik** (mis. `200000`); tampilannya otomatis `200.000`.
Zoom untuk memeriksa. Terlanjur dobel → `triple_click` kotaknya, `Backspace`, ketik ulang.

### c. Waktu Pengambilan Prive (tidak bisa diketik)

Klik kotaknya → langsung terisi waktu sekarang (`DD-MM-YYYY HH:MM:SS`) dan kalender muncul **di
atas** kotak, menutupi kedua dropdown.

- Tanggalnya hari ini → isian otomatis sudah benar.
- Bukan hari ini → klik tanggal yang benar. Rujukan grid (1372×882): judul bulan y≈183,
  `‹` x≈608, `›` x≈842; kolom Su–Sa x≈608/648/688/728/768/805/842; baris y≈241/270/300/329/358/387.
  Tetap tentukan dari screenshot.
- Jamnya biarkan — tidak penting.
- Kalender menutup sendiri saat kotak Keterangan diklik.

### d. Keterangan

Klik kotaknya, ketik `Setoran Owner` (S dan O kapital).

## Langkah 7 — Verifikasi, baru Simpan

Screenshot seluruh dialog dan periksa **semua**:

- *Ambil Dari Akun* persis akun hasil pemetaan (dan sama dengan akun tujuan kartu setorannya)
- *Pilih Akun Prive* persis `Dividen Investor`
- Saldo Awal kedua akun terisi angka (bukan Rp. 0)
- **Saldo Akhir akun sumber = Saldo Awal − nominal**, dan **Saldo Akhir Dividen Investor = Saldo Awal
  + nominal**. Ini pengecekan silang terkuat.
- Saldo Akhir akun sumber **tidak negatif**
- Nominal, tanggal (DD-MM-YYYY) sesuai baris dashboard; Keterangan `Setoran Owner`

Ada yang tidak cocok → klik **Batal**, lewati baris itu, laporkan. Semua cocok → klik **Simpan**.

## Langkah 8 — Pastikan tersimpan, lalu tandai Verifikasi Owner

1. Dialog menutup sendiri. **Jangan menilai berhasil/gagal dari daftar** — daftar sering tidak
   ter-refresh. Verifikasi lewat **Search** (±1270, 89) dengan nominal bertitik:
   - Harus ada **tepat satu** baris baru dengan tanggal itu (jamnya jam input, mis. `30/10/26 23:05`),
     `Dividen Investor`, akun sumber, nominal, dan `Setoran Owner`.
   - Teks *"filtered from N total entries"* harus = N dari Langkah 5 **+ 1**.
   - Kosongkan Search lagi (`triple_click` lalu `Backspace`).
   - Search pun tidak menunjukkannya → klik **+ Tambah**, pilih akun sumber dan `Dividen Investor`
     saja, lalu baca Saldo Awal-nya. Sudah bergeser sebesar nominal dibanding sebelum Simpan →
     entri tersimpan; tutup dengan **Batal**. Saldo tidak berubah → tutup dengan **Batal** dan
     laporkan ke Andre. **Jangan input ulang tanpa izinnya.**
2. Pindah ke tab dashboard:
   ```js
   JSON.stringify(await window.__soVerif('<nomor>'))
   ```
   - `OK` → selesai untuk baris itu.
   - `HILANG-SETELAH-KLIK` → klik **⟳ Muat ulang** di Monitoring Biaya, pasang ulang helper, pastikan
     barisnya sudah tidak ada di antrean.
   - `TIMEOUT` / `TIDAK-JELAS` / `HILANG` → laporkan ke Andre. Entri Prive sudah tersimpan, jadi
     **jangan diinput ulang**.
3. Kembali ke Langkah 5 untuk baris DISETUJUI berikutnya.

Tombol `button.mb-verif` menyimpan sendiri ke sheet — jangan klik tombol lain di baris itu.

## Aturan keras

- **JANGAN PERNAH klik Tolak** di Setoran Kas Outlet. Kartu tanpa pasangan diserahkan ke Andre.
- **JANGAN tekan Enter atau Escape** saat dialog Ambil Prive terbuka (Enter mengirim form, Escape
  menutup seluruh dialog).
- **JANGAN klik ikon tong sampah** di daftar Pengambilan Prive — itu menghapus transaksi.
- Prive hanya untuk baris yang **disetujui di sesi ini**, atau baris tertentu yang Andre minta secara
  eksplisit setelah laporan Langkah 2. Yang lain hanya dilaporkan.
- Satu entri Prive untuk satu baris dashboard. Cek Langkah 5 sebelum setiap entri.
- **Jangan pernah input ulang** hanya karena daftar Pengambilan Prive tidak menampilkan entri baru.
  Pastikan dulu lewat Search dan saldo (Langkah 8).
- Di tabel Monitoring Biaya, hanya `button.mb-verif` yang boleh diklik (selain tab menu dan
  **⟳ Muat ulang**). Jangan sentuh Status Lapor Aplikasi, Keterangan Koreksi, tombol Export, atau
  Sembunyikan.
- Jangan mengarang kecocokan. Ragu = lewati dan tanyakan Andre.

## Laporan akhir

Tutup dengan ringkasan singkat, dua bahasa (Indonesia lalu Inggris):

- Berapa setoran disetujui, dengan nominal, tanggal, dan kode transaksinya
- Berapa entri Pengambilan Prive dibuat, dengan akun sumbernya
- Berapa baris ditandai Verifikasi Owner ✓
- Yang dilewati dan alasannya (kartu tanpa pasangan / ambigu / tanggal daftar-detail beda /
  sudah ada di Prive / saldo tidak bergeser sesuai nominal / gagal menandai)
- Sisa antrean di dashboard:
  ```js
  window.__soAntre().map(r => [r.nomor, r.nominal, r.tgl, r.sumber].join(' | ')).join('\n') || 'kosong'
  ```