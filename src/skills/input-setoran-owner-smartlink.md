---
name: "input-setoran-owner-smartlink"
description: "Jalankan saat Andre minta input setoran owner ke Smartlink: ambil baris Setoran Owner dari menu Lapor Smartlink, input sebagai Pengambilan Prive, lalu ubah status lapor jadi centang."
---

# Input Setoran Owner ke Smartlink

Memindahkan tiap baris **Setoran Owner** yang masih berstatus ✘ di menu **Lapor Smartlink**
(Dashboard Kas Laundry) menjadi entri **Pengambilan Prive** di Smartlink, lalu menandai barisnya
jadi centang. Milik Co Clean Laundry (outlet Maumbi & Perkamil).

**Beda dengan `konfirmasi-setoran-owner-smartlink`:** skill itu mengambil antrean dari menu
**Monitoring Biaya** dan selalu diawali approval Setoran Kas Outlet. Skill ini mengambil dari
**Lapor Smartlink** (umumnya setoran owner lewat rekening bank) tanpa approval. Kalau permintaan
Andre tidak jelas menunjuk salah satunya, tanyakan dulu.

## Prasyarat

1. Chrome dengan dua tab:
   - **Smartlink**: `https://dashboard.smartlink.id` — sudah login sebagai owner.
   - **Dashboard Kas Laundry**: `http://localhost:3000/` — aplikasi lokal ini **harus hidup**.
     Kalau gagal dimuat, berhenti dan minta Andre menjalankannya dulu.
   - Kalau salah satu tab belum ada, buka tab baru untuknya (tugas ini butuh dua halaman sekaligus)
     dan sebutkan judul tab itu ke Andre.
2. Jangan pernah me-refresh (F5) tab mana pun di tengah proses.
3. Persetujuan batch di Langkah 1 selalu dari Andre. Selain itu Andre baru perlu di depan layar
   kalau dropdown akun gagal dipilih (Langkah 3a).

### Kebiasaan tool (diuji 31 Okt 2026 dengan tool side panel `mcp__claude-device__chrome_*`)

- `browser_batch` jalan — rangkai klik + tunggu + screenshot dalam satu panggilan.
  (Dengan tool lama `mcp__claude-in-chrome__*`, `browser_batch` dan `find` hampir selalu gagal
  dengan pesan *"Tab ... is not in Claude's tab group"*; obatnya panggil `tabs_context_mcp` sekali
  lalu ulangi, atau pakai panggilan tunggal.)
- `find` gagal, dan `read_page` tidak bisa melihat isi iframe Pengambilan Prive.
- Keluaran `javascript_tool` yang berisi `=` bercampur `&` (mis. `innerHTML`, `className=`)
  diblokir sebagai *"Cookie/query string data"*. Kembalikan teks polos dengan pemisah ` | `.
- **Panggilan yang "gagal" kadang sudah terlanjur dijalankan.** Pernah terjadi `type` gagal tapi
  teksnya masuk, lalu diulang → nominal jadi `401.000.401.000`. **Selalu screenshot dulu sebelum
  mengulang.**
- Ukuran viewport berubah-ubah antar sesi (pernah 1372×882, 1400×840, 1547×784). Koordinat di
  skill ini rujukan pada **1372×882** — selalu screenshot dan tentukan ulang dari yang terlihat.

## Karakter tiap bagian

| Bagian | Sifatnya | Cara kerjanya |
|---|---|---|
| **Dashboard Kas Laundry** | HTML biasa | Baca & klik lewat `javascript_tool`. Sisi yang akurat — semua logika pencocokan dikerjakan di sini. |
| **Sidebar Smartlink** | Flutter di atas kanvas | Nyalakan pohon aksesibilitas untuk dapat koordinat menu. |
| **Halaman Pengambilan Prive** | HTML di dalam **iframe beda domain** (`dashboard-vue.smartlink.id`) | `javascript_tool`, `find`, `read_page`, dan `form_input` **tidak bisa menembusnya**. Screenshot + klik/ketik koordinat saja. |

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
Item sidebar di luar layar bernilai y negatif atau lebih besar dari tinggi layar — gulir sidebar
lalu baca ulang sampai targetnya masuk layar.

## Langkah 0 — Ambil antrean dari Lapor Smartlink

Di tab Dashboard Kas Laundry: buka tab **Lapor Smartlink** (klik dengan `computer`), klik
**Muat ulang**, tunggu ±5 detik supaya daftarnya terupdate, lalu pasang helper:

```js
window.__slTable = () => Array.from(document.querySelectorAll('table')).find(t =>
  ((t.querySelector('tr')||{}).innerText||'').toUpperCase().includes('STATUS LAPOR APLIKASI SMARTLINK'));
window.__slNorm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g,'');
window.__slRows = () => Array.from(window.__slTable().querySelectorAll('tr')).slice(1).map(r => {
  const c = Array.from(r.children).map(x => x.innerText.trim().replace(/\s+/g,' '));
  const b = r.children[6].querySelector('button.sl-status');
  return { el:r, btn:b, subjek:c[1], ket:c[2], nominal:c[3], angka:c[3].replace(/[^0-9]/g,''),
           tgl:c[4], outlet:c[5], sumber:c[7], kode:c[8],
           sudah: !!(b && b.classList.contains('sl-ok')) };
});
window.__slAntre = () => window.__slRows().filter(r =>
  window.__slNorm(r.subjek) === 'setoranowner' && !r.sudah);
window.__slCari = (ket, nominal, tgl, sumber) => window.__slRows().filter(r =>
  window.__slNorm(r.ket)     === window.__slNorm(ket) &&
  window.__slNorm(r.nominal) === window.__slNorm(nominal) &&
  window.__slNorm(r.tgl)     === window.__slNorm(tgl) &&
  window.__slNorm(r.sumber)  === window.__slNorm(sumber));
window.__slTandai = (ket, nominal, tgl, sumber) => {
  const m = window.__slCari(ket, nominal, tgl, sumber);
  if (m.length !== 1) return {status: m.length === 0 ? 'NO-MATCH' : 'AMBIGU', n:m.length};
  if (m[0].sudah) return {status:'SUDAH'};
  m[0].btn.click();
  return {status:'DIKLIK'};
};
window.__slTunggu = async (ket, nominal, tgl, sumber, ms=12000) => { const t0 = Date.now();
  while (Date.now()-t0 < ms) { const m = window.__slCari(ket, nominal, tgl, sumber);
    if (m.length === 1 && m[0].sudah) return {status:'OK'};
    await new Promise(s => setTimeout(s, 700)); }
  return {status:'TIMEOUT'}; };
'antre: ' + window.__slAntre().length + ' dari ' + window.__slRows().length + ' baris\n' +
  window.__slAntre().map(r=>[r.ket,r.nominal,r.tgl,r.outlet,r.sumber].join(' | ')).join('\n')
```

Susunan kolom Lapor Smartlink (indeks sel):
`0 (checkbox) | 1 SUBJEK BIAYA | 2 KETERANGAN | 3 NOMINAL | 4 TANGGAL | 5 OUTLET |
6 STATUS LAPOR APLIKASI SMARTLINK | 7 SUMBER DANA | 8 KODE TRANSAKSI | 9 Edit`

Tombol status: `button.sl-status.sl-no` = ✘ (belum input), `button.sl-status.sl-ok` = ✓ (sudah).

Hanya baris **SUBJEK BIAYA = Setoran Owner** yang dikerjakan skill ini. Subjek lain diabaikan
total — jangan disebut sebagai "dilewati", memang bukan urusan skill ini.

Catat jumlah antrean di awal sebagai pembanding di laporan akhir.

## Langkah 1 — Susun rencana & minta izin

Untuk tiap baris antrean, tentukan akun sumbernya dari kolom **SUMBER DANA**:

| SUMBER DANA | Pilihan di "Ambil Dari Akun" | Yang diketik (Langkah 3a) |
|---|---|---|
| BCA | **Rekening BCA Andre** | `Rekening BCA` |
| BRI | **Rekening BRI Andre** | `Rekening BRI` |
| BNI | **Rekening BNI Andre** | `Rekening BNI` |
| MANDIRI | **Rekening Mandiri Andre** | `Rekening Mandiri` |
| selain itu (kas tunai, mis. KAS MAUMBI / KAS PERKAMIL) | **Kas Besar (Perusahaan)** | `Kas Besar` |

Kolom **OUTLET** tidak dipakai sama sekali — rekeningnya rekening pribadi Andre, bukan per outlet.

Tombol Simpan menyangkut uang dan tidak bisa dibatalkan. Sebelum entri pertama disimpan,
tampilkan rencananya (berapa baris, akun sumber, nominal, tanggal) dan minta **satu persetujuan
untuk seluruh batch**. Cukup sekali per sesi, tidak perlu bertanya per baris.

Kalau Andre menulis "cek saja" / "dry run": tampilkan rencananya saja, jangan buka form apa pun.

## Langkah 2 — Cek dobel, lalu buka form di Smartlink

Sidebar: **Keuangan › Pengambilan Prive**. Daftarnya terurut tanggal terbaru, 10 baris per halaman.

⚠️ **Judul kolom di daftar terbalik dari form:** akun yang diisi di *Ambil Dari Akun* muncul di
kolom **Akun Prive**, sedangkan *Dividen Investor* muncul di kolom **Akun Asset**. Format tanggal
`DD/MM/YY HH:MM`.

⚠️ **Daftar tanpa filter bisa basi.** Pada 31 Okt 2026 daftar tetap menampilkan 647 entri tanpa
baris baru setelah Simpan, bahkan setelah menu dibuka ulang. Hasil kotak **Search** selalu segar
(diambil ulang dari server). Karena itu **semua pengecekan memakai Search**, bukan daftar mentah.

**Cek dobel dulu.** Sebelum membuat entri untuk satu baris, klik kotak **Search** kanan atas
(±1270, 89), ketik nominal bertitik (mis. `401.000`), lalu screenshot. Pastikan belum ada entri
dengan **tanggal + Akun Prive + nominal + `Setoran Owner`** yang sama (bisa terjadi kalau sesi
sebelumnya terputus setelah Simpan tapi sebelum status ditandai), dan catat angka **N** dari teks
*"filtered from N total entries"*. Kosongkan lagi (`triple_click` lalu `Backspace`). Sudah ada →
**jangan input**, laporkan ke Andre.

Lalu klik tombol biru **+ Tambah** di kanan bawah (±1297, 723). Kalau dialog belum muncul,
screenshot, lalu klik sekali lagi.

Kalau bilah menu Flutter (Depan/Karyawan/Menu/Outlet/Bantuan) menutupi bagian bawah, klik tombol
merah **Tutup** di tengahnya untuk melipatnya.

Tata letak dialog **Ambil Prive** (rujukan 1372×882):

| Bagian | Koordinat |
|---|---|
| Ambil Dari Akun (select) | 858, 181 |
| Pilih Akun Prive (select) | 858, 288 |
| Nominal | 858, 395 |
| Waktu Pengambilan Prive | 840, 462 (ikon kalender 1111, 462) |
| Keterangan | 858, 547 |
| **Simpan** / Batal | 1006, 653 / 1094, 653 |

## Langkah 3 — Isi form

### a. Dua dropdown akun — pakai ketik-langsung

Klik dropdown-nya, tunggu ±1 detik, lalu `type` teks dari kolom "Yang diketik" di Langkah 1.
Pilihan berpindah sendiri. **Jangan tekan Enter** (mengirim form). Lanjut dengan mengklik isian
berikutnya.

- **Ambil Dari Akun** → teks sesuai tabel Langkah 1.
- **Pilih Akun Prive** → ketik `Dividen Investor` (selalu).

Keenam teks itu (`Kas Besar`, `Rekening BRI`, `Rekening BNI`, `Rekening BCA`,
`Rekening Mandiri`, `Dividen Investor`) sudah terbukti jalan pada 31 Okt 2026. Setelah
masing-masing, zoom ke area dropdown: teksnya harus persis nama akun yang dituju dan
**Saldo Awal-nya tidak lagi Rp. 0**.

**Kalau nilainya tidak berubah:** jangan mencoba cara lain dan jangan tekan Escape (menutup seluruh
dialog) atau Enter. Sesi lama dengan tool `mcp__claude-in-chrome__*` gagal total memakai klik +
ketik, panah, Shift+Tab, dan klik posisi pilihan — jangan diulang. Isi bagian lain dulu, lalu minta
Andre memilih dua dropdown itu sendiri, sebutkan persis akunnya, dan tunggu ia bilang sudah. Satu
baris satu kali serah-terima; jangan menumpuk beberapa form sekaligus.

### b. Nominal

Klik kotaknya, ketik **angka polos tanpa titik** (mis. `401000`); kotaknya otomatis menampilkan
`401.000`. **Zoom untuk memeriksa hasilnya** — kalau terlanjur dobel (mis. `401.000.401.000`),
`triple_click` kotaknya, `Backspace`, lalu ketik ulang.

### c. Waktu Pengambilan Prive (tidak bisa diketik)

Klik kotaknya. Isinya **langsung terisi otomatis dengan waktu sekarang**, format
`DD-MM-YYYY HH:MM:SS`, dan kalender tampil **di dalam halaman, di atas kotak** (menutupi kedua
dropdown) — terlihat di screenshot.

- Kalau kolom TANGGAL memang hari ini, isian otomatis itu sudah benar.
- Kalau bukan hari ini, klik tanggal yang benar; pindah bulan dengan panah **‹** dan **›** di
  kiri-kanan judul bulan. **Jamnya biarkan apa adanya** — tidak penting.
- Rujukan grid (1372×882): judul bulan y≈183, ‹ x≈608, › x≈842; kolom Su–Sa
  x≈608/648/688/728/768/805/842; baris y≈241/270/300/329/358/387. Tetap tentukan dari
  screenshot, jangan dari hafalan.
- Mengklik tanggal yang **sudah** terpilih tidak menutup kalender dan tidak mengubah apa pun —
  itu normal. Kalender tertutup sendiri saat kotak Keterangan diklik, dan nilainya bertahan.

Setelah kalender tertutup, screenshot dan pastikan tanggalnya sama dengan kolom TANGGAL.

### d. Keterangan

Salin isi kolom **KETERANGAN** baris itu — praktis selalu **`Setoran Owner`** (S dan O kapital).
Kalau kolomnya ternyata berisi teks lain, ikuti kolomnya.

## Langkah 4 — Verifikasi, baru Simpan

Screenshot dan periksa **semua** ini sebelum menyentuh Simpan:

- Teks di **Ambil Dari Akun** persis nama akun yang dituju
- Teks di **Pilih Akun Prive** persis `Dividen Investor`
- **Saldo Awal/Akhir kedua akun sudah terisi angka** (bukan Rp. 0)
- **Saldo Akhir bergeser tepat sebesar nominal** — akun sumber berkurang, Dividen Investor
  bertambah. Ini pengecekan silang terkuat yang ada; kalau tidak cocok, ada yang salah.
- Saldo Akhir akun sumber **tidak negatif**
- Nominal dan tanggal sesuai baris dashboard
- Keterangan `Setoran Owner`

Ada yang tidak cocok → klik **Batal**, lewati baris itu, catat untuk laporan.
Semua cocok → klik **Simpan**.

## Langkah 5 — Pastikan tersimpan

Dialog menutup sendiri. **Jangan menilai berhasil/gagal dari daftar** — daftar sering tidak
ter-refresh. Verifikasi lewat **Search** (±1270, 89) dengan nominal bertitik:

- Harus ada **tepat satu** baris baru dengan tanggal itu (jamnya jam input, mis. `30/10/26 23:05`),
  `Dividen Investor` (kolom Akun Asset), akun banknya (kolom Akun Prive), nominal, dan
  `Setoran Owner`.
- Teks *"filtered from N total entries"* harus = N dari Langkah 2 **+ 1**.
- Kosongkan Search lagi (`triple_click` lalu `Backspace`).
- Search pun tidak menunjukkannya → klik **+ Tambah**, pilih akun sumber dan `Dividen Investor`
  saja, lalu baca Saldo Awal-nya. Sudah bergeser sebesar nominal dibanding sebelum Simpan → entri
  tersimpan; tutup dengan **Batal**. Saldo tidak berubah → tutup dengan **Batal** dan laporkan ke
  Andre. **Jangan input ulang tanpa izinnya.**

## Langkah 6 — Tandai statusnya di Dashboard Kas

Kembali ke tab Dashboard Kas Laundry:

```js
const a = window.__slTandai('<keterangan>', '<nominal>', '<tanggal>', '<sumber dana>');
JSON.stringify(a.status === 'DIKLIK'
  ? await window.__slTunggu('<keterangan>', '<nominal>', '<tanggal>', '<sumber dana>')
  : a)
```

Gunakan nominal dan tanggal **persis seperti tertulis di tabel** (mis. `Rp401.000`,
`7 September 2026`).

- **`OK`** → baris sudah ✓ (`button.sl-status.sl-ok`), lanjut ke baris berikutnya.
- **`NO-MATCH` / `AMBIGU` / `TIMEOUT`** → catat untuk laporan dan beri tahu Andre; entrinya sudah
  terlanjur tersimpan di Smartlink, jadi **jangan diinput ulang** — cukup laporkan bahwa status di
  dashboard belum berubah.

## Langkah 7 — Ulangi

Kembali ke Langkah 2 untuk baris antrean berikutnya. Tandai baris yang sudah dilewati supaya tidak
diperiksa berulang. Selesai bila `window.__slAntre()` kosong selain yang memang dilewati.

## Aturan keras

- **JANGAN tekan Escape atau Enter** saat dialog Ambil Prive terbuka.
- **JANGAN PERNAH klik ikon tong sampah** di daftar Pengambilan Prive — itu menghapus transaksi.
- **JANGAN klik "Konfirmasi sembunyikan tercentang"** di Lapor Smartlink kecuali Andre memintanya —
  itu menghilangkan baris dari daftar.
- **JANGAN pakai tombol Edit (✎)** di Lapor Smartlink kecuali diminta — itu mengubah data sheet.
- Jangan klik Simpan sebelum seluruh daftar periksa di Langkah 4 lolos.
- Ragu = klik **Batal**, lewati, laporkan.
- Satu entri Smartlink untuk satu baris dashboard — cek dobel di Langkah 2 sebelum setiap entri.
- **Jangan pernah input ulang** hanya karena daftar Pengambilan Prive tidak menampilkan entri baru.
  Pastikan dulu lewat Search dan saldo (Langkah 5).

## Laporan akhir

Tutup dengan ringkasan singkat:

- Berapa entri Pengambilan Prive dibuat, dengan akun sumber, nominal, dan tanggalnya
- Berapa dilewati dan alasannya (sudah ada di Prive / saldo tidak bergeser sesuai nominal /
  tanggal tak bisa dipilih / dropdown gagal dan Andre tidak ada / status gagal ditandai)
- Sisa antrean:
  ```js
  const a = window.__slAntre();
  JSON.stringify({sisa: a.length, baris: a.map(r=>`${r.ket} | ${r.nominal} | ${r.tgl} | ${r.sumber}`)})
  ```

Gunakan dua bahasa (Indonesia lalu Inggris) sesuai preferensi Andre.