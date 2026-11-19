---
name: "settlement-qris-smartlink"
description: "Jalankan saat Andre minta settlement QRIS/EDC: catat daftar settlement Smartlink ke INPUT QRIS, submit mutasi Drive ke DATA QRIS via localhost, lalu Buat Settlement per tanggal di Smartlink."
---

# Settlement QRIS (EDC Bank Mandiri) — Co Clean Laundry

Tiga fase, selalu berurutan:

| Fase | Sumber | Tujuan |
|---|---|---|
| **A** | Daftar *Pilih Pembayaran* tiap mesin EDC di Smartlink | sheet **INPUT QRIS** (tanggal · nominal · outlet) |
| **B** | Gambar mutasi bank di Google Drive | sheet **DATA QRIS** lewat localhost › Input Kas › seksi 6 |
| **C** | Gambar mutasi **D+1** | **Buat Settlement** per tanggal di Smartlink |

Dirancang 18 Nov 2026; uji coba nyata pertama (tanggal 4 Nov 2026, kedua outlet) berhasil hari itu juga dengan tool side panel `mcp__claude-device__chrome_*` (viewport 1000×744; tab baru bisa 1000×800).

## Dua mode perintah

| Perintah Andre | Fase A (INPUT QRIS) | Fase B (DATA QRIS) | Fase C (settlement) |
|---|---|---|---|
| **Tanggal tertentu D** (mis. "jalankan 4 Nov 2026") | tanggal D, kedua outlet | **file D+1 → baris D+1** | D, kedua outlet, bukti file D+1 |
| **Semua / tanpa tanggal** | semua tanggal di DAFTAR_AWAL | semua file yang baris DATA QRIS-nya kosong | semua tanggal di DAFTAR_AWAL |

Keputusan Andre (18 Nov 2026): perintah "4 Nov 2026" = INPUT QRIS 4 Nov · file `5 Nov` → DATA QRIS baris 5 Nov · Buat Settlement 4 Nov dengan bukti `5 Nov`, tanggal 5 Nov 2026. Beberapa tanggal → kerjakan per tanggal dengan pola yang sama.

## Data tetap

| Item | Nilai |
|---|---|
| Smartlink | `https://dashboard.smartlink.id/dashboard` (login owner) |
| Dashboard Kas Laundry | `http://localhost:3000/` — harus hidup; gagal dimuat → berhenti, minta Andre menyalakannya |
| Spreadsheet Nov 2026 | **CASHFLOW DAN BIAYA NOVEMBER 2026**, ID `1zCl79M9ltiSl0NSIev2rENGpEPJ-p_zjMB08TTFJH3k` |
| Spreadsheet bulan lain | lihat Langkah 0 |
| Folder Drive mutasi | `1WDQ3oGhyMVHbz-6sbEwiKKCPOrrvmsvA` › folder tahun (`2026`) › folder bulan huruf kapital (`OKTOBER`, `NOVEMBER`, `DESEMBER`, …) |
| Nama file mutasi | `<tgl> <Bln>.<ext>`, mis. `1 Nov.jpg`, `2 Nov.png`, `17 Nov.PNG`. Ekstensi campur — ambil **angka hari di depan**, bulannya dari folder. |
| Mesin EDC | `1.13.001` = Co Clean Laundry **Maumbi** (id `EDC17638779448507`) · `1.13.002` = Co Clean Laundry **Perkamil** (id `EDC17638779669045`) |
| Jam WITA | Bash: `TZ=Asia/Makassar date '+%Y-%m-%d %H:%M'` |

Muat konektor sekali:
`ToolSearch select:mcp__Google_Sheets__get_values,mcp__Google_Sheets__get_spreadsheet,mcp__Google_Sheets__update_values,mcp__Google_Drive__search_files`

## Aturan inti — tidak boleh salah

1. **Nama file mutasi = tanggal uang masuk ke rekening.** Settlement transaksi tanggal **D** dibuktikan file **D+1**. Contoh: pilih 11 Nov 2026 di Smartlink → file `12 Nov`, *Settlement pada* dan *Diterima pada* = 12 Nov 2026. D = hari terakhir bulan → file tanggal 1 ada di folder bulan berikutnya.
2. **DATA QRIS tanpa +1:** baris tanggal X ↔ file `X …`.
3. **Pemetaan entri di file D+1 — ikut kode merchant** (keputusan Andre, 18 Nov 2026). Hanya **Bayar/Top-up** bernilai **positif** (hijau, `+ IDR`). Abaikan *Transfer Rupiah*, *Biaya*, dan semua nominal negatif. Baris keterangan kedua tiap entri berisi kode merchant:
   - diawali **`71892646590`** (mis. `7189264659099…QRCO CLEA` atau `71892646590/CO CLEAN LAUNDRY/MND`) = **Perkamil**
   - diawali **`71891390044`** (mis. `7189139004499…QRCO CLEA`) = **Maumbi**
   - Beberapa entri berkode sama → dijumlahkan ke outlet itu (contoh 8 Nov: 238.800 + 21 = Perkamil 238.821; 878.909 = Maumbi).
   - Cek silang dengan posisi: selama ini entri Perkamil selalu di atas entri Maumbi. Kode asing/tak terbaca → anomali. Teks terlalu kecil → `zoom`; pratinjau Analisis localhost juga menampilkan kodenya di kolom Subjek.
   - Outlet yang punya entri harus sama dengan outlet yang **bertransaksi di D** = tanggal D ada di **DAFTAR_AWAL** outlet itu (Langkah 2, dicatat sebelum settlement apa pun) **atau** ada baris INPUT QRIS (D, outlet itu). Tidak cocok → anomali.
4. **Nominal yang diterima ≤ Settlement.** Angka dari gambar **lebih besar** → isi dengan angka Settlement dan catat selisih lebih (gambar − Settlement) untuk laporan — **inilah yang jadi perhatian Andre**. Angka dari gambar sedikit **lebih kecil** = potongan admin/MDR bank, **wajar** (keputusan Andre); Smartlink menghitungnya sendiri sebagai *Biaya MDR* di form (uji 3 Nov Maumbi: 302.700 → diterima 301.860, MDR 840). Angka dari gambar **< 98 % Settlement** → anomali (outlet kemungkinan tertukar).
5. **Jam 21.00 WITA.** Sebelum 21.00, **tanggal hari ini** di daftar settlement tidak diproses — tidak ditulis ke INPUT QRIS dan tidak di-settle. Satu-satunya pengecualian: Fase B (Submit ke DATA QRIS) tetap jalan, termasuk file bertanggal hari ini.
6. **Satu tanggal per settlement.** Jangan pernah klik *Pilih semua*.
7. *Settlement pada* / *Diterima pada* **dipilih dari kalender, tidak diketik.** Karena klik mouse tidak sampai ke kalender bawaan Chrome, "klik tanggal" dijalankan dengan membuka kalender lewat ikonnya lalu menggeser pilihan dengan tombol panah (Langkah 7b). Kalender tidak mau terbuka → cadangan: tombol panah di segmen kotak tanggal (Langkah 7b) — tetap tanpa mengetik angka. *Nominal yang diterima* **diketik**.

**Anomali** — kode merchant asing/tak terbaca, outlet yang punya entri tidak cocok dengan outlet yang bertransaksi di D (mis. ada entri berkode Maumbi padahal Maumbi tidak bertransaksi, atau sebaliknya), nominal < 98 % Settlement, tanggal hasil Analisis ≠ tanggal file, atau dua file untuk satu tanggal → **lewati item itu**, lanjutkan yang lain, tanyakan di laporan akhir (keputusan Andre).

## Tab & kebiasaan tool

- **Tab Andre** (tab side panel) dipakai untuk Smartlink.
- Buka 2 tab baru (tugas ini butuh beberapa halaman sekaligus) dan sebutkan judulnya ke Andre: **Dashboard Kas Laundry** (localhost) dan **penampil gambar** (Drive).
- Jangan refresh tab mana pun di tengah satu item.
- Tab bisa hilang di tengah run (grup tab panel berganti; terjadi 18 Nov 2026) → `tabs_context_mcp`, lalu buat ulang hanya tab yang masih diperlukan.
- `browser_batch` jalan — rangkai klik + tunggu + screenshot. `find` gagal di shell Flutter Smartlink, tapi berfungsi di aplikasi dalam (Langkah 1) dan di localhost.
- Output `javascript_tool` yang memuat `=`, `&`, atau `?` (URL ber-token, rumus `=a+b`) diblokir sebagai *"Cookie/query string data"* → ganti dulu dengan `.replace(/[=&?]/g,'~')`. **Jangan pernah** mengembalikan URL iframe Smartlink (berisi token).
- **Screenshot yang akan di-upload harus skala penuh** (tanpa parameter `scale`). Screenshot `scale: 0.3` hanya ±8 KB dan tidak terbaca.
- ID screenshot kedaluwarsa dalam beberapa menit — ambil screenshot gambar tepat sebelum upload.

## Langkah 0 — Waktu, bulan, spreadsheet

1. Ambil jam WITA (Bash). Catat `HARI_INI` dan apakah sudah ≥ 21:00.
2. Spreadsheet untuk tiap bulan yang terlibat:
   - November 2026 → ID di Data tetap.
   - Bulan lain → baca memori `/areas/co-clean-automation.md`, cari baris `Link spreadsheet CASHFLOW DAN BIAYA <BULAN> <TAHUN>`.
   - **Belum ada → wajib tanya Andre** (aturan Andre). Cari dulu kandidat di Drive (`title contains 'CASHFLOW DAN BIAYA <BULAN> <TAHUN>'`), lalu AskUserQuestion: kandidat yang ketemu (Recommended) / tempel link sendiri (Other). Jangan memakai spreadsheet apa pun sebelum Andre memilih.
   - Setelah dikonfirmasi, rekam ke memori (`memory_read` untuk versinya, lalu `memory_append`):
     `- [stated] Link spreadsheet CASHFLOW DAN BIAYA <BULAN> <TAHUN> (dipakai skill settlement-qris-smartlink sepanjang bulan itu): https://docs.google.com/spreadsheets/d/<ID>/edit`
   - Pastikan spreadsheet itu punya sheet **INPUT QRIS** dan **DATA QRIS** dengan kolom seperti Peta sheet. Beda → berhenti, laporkan.
3. Localhost menulis DATA QRIS ke spreadsheet **"bulan berjalan"** miliknya sendiri (otomatis mencari judul `CASHFLOW DAN BIAYA <BULAN> <TAHUN>` tiap awal bulan). Di tab localhost buka **Pengaturan**, baca *Bulan berjalan* dan *CASHFLOW bulan ini*. Harus sama dengan bulan & spreadsheet bulan berjalan di poin 2; beda → berhenti, minta Andre membetulkannya di Pengaturan.

## Peta sheet

**INPUT QRIS** — `A TANGGAL` (tanggal asli, format `d mmmm yyyy`, validasi tanggal) · `B NOMINAL` (angka `#,##0`) · `C OUTLET` (dropdown `MAUMBI` / `PERKAMIL`). Baris kosong di bawahnya sudah berformat & bervalidasi (dicek s.d. baris 200).

**DATA QRIS** — `A TANGGAL` · `B TOTAL BANK` (rumus, mis. `=147400+277120`) · `C TOTAL TRANSAKSI` (SUMIF dari INPUT QRIS) · `D SELISIH` (= B baris ini − C baris sebelumnya). Baris 2 = hari terakhir bulan lalu. Baris paling bawah setelah satu baris kosong adalah **baris total** (labelnya tampak seperti tanggal 1 bulan depan) — abaikan. Claude **tidak pernah** menulis DATA QRIS lewat konektor; hanya lewat Submit di localhost.

## Langkah 1 — Buka aplikasi dalam Smartlink sebagai halaman utama

Mesin EDC › Pilih Pembayaran › Buat Settlement di Smartlink adalah aplikasi kedua (`dashboard-vue.smartlink.id`) di dalam **iframe beda domain**. Di dalam iframe: teks tidak terbaca, `find`/`read_page` buta, dan upload Bukti Settlement gagal (drag & drop tidak masuk). Solusinya (teruji 18 Nov 2026): buka aplikasi itu langsung di tab Smartlink.

1. Tab Smartlink → `https://dashboard.smartlink.id/dashboard`, tunggu sampai layar biru "Menghubungi Server" hilang.
2. Jalankan:
   ```js
   const f = document.querySelector('iframe[src*="dashboard-vue.smartlink.id"]');
   f ? (() => { const u = new URL(f.src); u.pathname = '/mesin-edc'; location.href = u.href; return 'pindah'; })() : 'iframe belum ada'
   ```
   Biasanya iframe sudah ada langsung di halaman dashboard (terbukti 18 Nov). `iframe belum ada` → buka sidebar **Keuangan › Rekening Bank & EDC › Mesin EDC** dulu (nyalakan pohon aksesibilitas Flutter seperti skill Smartlink lain), lalu ulangi.
3. Tunggu ±4 detik. Halaman **Mesin EDC** tampil penuh (tanpa sidebar) dengan 2 kartu *EDC Bank Mandiri*. Sejak sini semuanya HTML biasa.

Navigasi di dalam aplikasi ini:
- **Buka daftar settlement satu outlet:** screenshot, klik **Settlement >** pada kartu bertuliskan *Co Clean Laundry Maumbi* (kartu 1) atau *Perkamil* (kartu 2). Rujukan 1000×744: Maumbi ±(925, 295), Perkamil ±(925, 480) — tetap tentukan dari screenshot. Path menjadi `/mesin-edc/pilih-pembayaran/<id EDC>/`; Maumbi = `EDC17638779448507`.
- **Halaman Detail EDC** (`/mesin-edc/detail/<id EDC>/`): tempat aplikasi mendarat setelah *Buat Settlement*. Berisi *Saldo aktif* dan tombol **Settlement** (±907, 167) yang membuka *Pilih Pembayaran* outlet itu lagi. ← dari *Pilih Pembayaran* kembali ke halaman asalnya (Detail EDC atau Mesin EDC).
- **Angka di kartu Mesin EDC bisa basi** (saldo & tanggal tidak ter-update setelah settlement). Jangan dipakai sebagai acuan setelah settlement pertama; pakai halaman Detail EDC.
- Helper `window.__*` **tetap ada** selama pindah halaman di dalam aplikasi ini; pasang ulang hanya setelah muat ulang penuh.
- **Kembali:** klik ← kiri atas (±30, 23). Kalau ada tanggal yang tercentang di *Pilih Pembayaran*, muncul dialog **"Batal Settlement EDC"** → **Ya, batal** (hanya membatalkan draf, tidak menghapus apa pun); tanpa centang, dialog tidak muncul:
  ```js
  const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.trim() === 'Ya, batal'); b ? (b.click(), 'batal') : 'tidak ada dialog'
  ```

## Langkah 2 — Baca daftar kedua outlet (belum menulis apa pun)

Di halaman *Pilih Pembayaran*, pasang helper (sekali per muat halaman):

```js
window.__bln = {jan:1,feb:2,mar:3,apr:4,mei:5,may:5,jun:6,jul:7,agu:8,agt:8,ags:8,aug:8,sep:9,okt:10,oct:10,nov:11,des:12,dec:12};
window.__iso = s => { const m = String(s).match(/(\d{1,2})\s+([A-Za-z]{3})\w*\s+(\d{4})/); if (!m) return null;
  return m[3] + '-' + String(window.__bln[m[2].toLowerCase()]).padStart(2, '0') + '-' + m[1].padStart(2, '0'); };
window.__st = () => Array.from(document.querySelectorAll('.pembayaran-list .list-wrapper')).map(w => {
  const p = Array.from(w.querySelectorAll('.data-header p')).map(x => x.textContent.trim());
  const box = w.querySelector('.data-header .grid-cspan-2');
  const m = (p[1] || '').match(/(\d+) Transaksi\s*\S\s*Rp\s*([\d.]+),(\d{2})/);
  return { box, hari: p[0], tgl: window.__iso(p[0]), trx: m ? +m[1] : null,
           rp: m ? +m[2].replace(/\./g, '') : null, sen: m ? m[3] : null,
           centang: !!(box && box.querySelector('rect[fill="#206CFF" i]')) };
});
window.__stTeks = () => location.pathname + '\n' + window.__st().slice().sort((a, b) => a.tgl < b.tgl ? -1 : 1)
  .map(x => `${x.tgl} | ${x.trx} trx | ${x.rp}${x.sen !== '00' ? ',' + x.sen : ''} | ${x.centang ? 'CENTANG' : '-'}`).join('\n');
window.__stTeks()
```

- Satu kartu = satu tanggal yang belum di-settle; urutan di layar acak, helper mengurutkannya.
- Kotak centang = `div.grid-cspan-2` berisi SVG; tercentang bila ada `rect` ber-`fill #206CFF`.
- Simpan hasil **kedua** outlet sebagai **DAFTAR_AWAL** (acuan Aturan inti 3).
- Daftar satu outlet kosong → outlet itu tidak punya apa pun untuk diisi ke INPUT QRIS maupun di-settle.
- Sen ≠ `,00` → tulis apa adanya di rencana dan tanyakan.
- Kembali ke Mesin EDC (← lalu *Ya, batal*) sebelum pindah outlet.

## Langkah 3 — Kumpulkan bahan rencana

**Fase A — INPUT QRIS.** `get_values 'INPUT QRIS'!A1:C1000` di spreadsheet bulan tanggal itu. Untuk tiap (tanggal, outlet) di DAFTAR_AWAL:
- Tanggal = hari ini dan jam < 21:00 → lewati ("hari ini").
- Sudah ada baris dengan **tanggal + outlet sama** → lewati (cek dobel; Maumbi dan Perkamil memang boleh punya tanggal sama). Nominalnya beda dari Smartlink → jangan ditimpa, catat untuk laporan.
- Selain itu → masuk rencana tulis. Tanggal bulan lalu ditulis ke spreadsheet bulan lalu.

**Fase B — DATA QRIS.** Mode tanggal D: target = file D+1, asalkan baris D+1 di DATA QRIS masih kosong (sudah terisi → lewati, laporkan). Mode semua: `get_values 'DATA QRIS'!A1:B40` → tanggal bulan berjalan yang kolom B-nya kosong. Daftar file folder bulan berjalan (`parentId = '<id folder bulan>'`, ikuti `nextPageToken` sampai habis). Target = file yang tanggalnya ada di daftar kosong itu. File bulan sebelumnya yang barisnya masih kosong → **jangan** diproses (localhost sudah pindah bulan), cukup laporkan.

**Fase C — settlement.** Untuk tiap (outlet, D) di DAFTAR_AWAL, kecuali D = hari ini sebelum 21:00:
- Cari file D+1 (di folder bulan milik D+1). Tidak ada → lewati ("file D+1 belum ada").
- **Baca gambarnya** (Langkah 6a): daftar Bayar/Top-up positif atas → bawah, terapkan Aturan inti 3–4 → nominal yang akan diisi + selisih lebih (bila ada).

## Langkah 4 — Rencana & satu persetujuan

Tampilkan ringkas, dua bahasa: baris yang akan ditulis ke INPUT QRIS; file yang akan di-Analisis & Submit ke DATA QRIS; tiap settlement (outlet · D · file D+1 · nominal diisi · Settlement · selisih lebih); semua yang dilewati beserta alasannya. Lalu **satu** AskUserQuestion: *Jalankan semua (Recommended)* / *Dry run saja*. Cukup sekali per sesi — jangan bertanya per item.

"Cek saja" / "dry run" → berhenti setelah rencana; jangan menulis, submit, atau settle apa pun.

## Langkah 5 — Fase A: tulis INPUT QRIS (konektor, bukan klik)

Keputusan Andre: lewat konektor Google Sheets — nilainya identik dengan memilih tanggal dari kalender, dan tidak rawan salah sel.

1. Baris kosong pertama = jumlah baris hasil `get_values 'INPUT QRIS'!A1:C1000` + 1. Baca ulang tepat sebelum menulis.
2. Urutan: semua tanggal **Maumbi** (naik), lalu semua tanggal **Perkamil** (naik).
3. `update_values` range `'INPUT QRIS'!A<r>:C<r+n-1>`, tiap baris `[serial, nominal, "MAUMBI" | "PERKAMIL"]`:
   - `serial` = jumlah hari sejak 30 Des 1899 (1 Nov 2026 = **46327**, 31 Okt 2026 = 46326). Kirim sebagai angka, bukan teks — format kolom A yang menampilkannya sebagai tanggal.
   - `nominal` = angka bulat tanpa titik (mis. `230800`).
4. Verifikasi dengan `get_values` range itu: harus tampil `5 November 2026 | 230.800 | MAUMBI`, dst. Ada yang aneh → laporkan; jangan ditulis ulang tanpa izin.

## Langkah 6 — Fase B: DATA QRIS lewat localhost (satu file per putaran)

Siapkan tab localhost:
```js
Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === 'Input Kas').click();
await new Promise(s => setTimeout(s, 1000)); document.getElementById('qbank-files').scrollIntoView({block: 'center'}); 'ok'
```
Seksi 5 *Pendapatan EDC Harian → sheet INPUT QRIS* **bukan** untuk skill ini — jangan disentuh.

### a. Buka & baca gambar
Tab penampil gambar → `https://drive.google.com/uc?export=view&id=<fileId>`, tunggu 2 detik. Gambar tampil utuh menyesuaikan layar (dicek: 1284×1558 tampil 613×744). Pastikan:
```js
const im = document.querySelector('img'); im ? (im.height <= innerHeight && im.width <= innerWidth ? 'utuh' : 'terpotong ' + im.width + 'x' + im.height) : 'bukan gambar'
```
`terpotong` → `im.style.maxHeight = '100vh'; im.style.maxWidth = '100vw'`, cek lagi. Ambil **screenshot skala penuh**, baca tanggal di judul gambar dan daftar entrinya. Teks terlalu kecil → `zoom` area itu (untuk dibaca saja; yang di-upload tetap screenshot penuh).

### b. Upload → Analisis
1. Pastikan input kosong: `document.getElementById('qbank-files').files.length === 0`. Kalau tidak, klik **✕ kosongkan** di seksi 6.
2. `find` "file input in section 6 Transfer Masuk Dana EDC" → ref → **upload screenshot** (`chrome_upload_image`: `imageId` screenshot tadi, `ref`, filename `<tgl> <Bln>.png`). Harus muncul "1 file: …".
3. Klik **🔍 Analisis** (`#btn-qbank-analyze`). Tunggu tabel pratinjau muncul (±10 detik, maks 60).
4. Baca hasil:
   ```js
   window.__qb = () => Array.from(document.querySelectorAll('table'))
     .filter(t => /Pakai|Isi \(formula\)/i.test((t.querySelector('tr') || {}).innerText || ''))
     .map(t => Array.from(t.querySelectorAll('tr')).map(r => Array.from(r.children).map(c => {
        const i = c.querySelector('input');
        return i ? '[' + (i.type === 'checkbox' ? (i.checked ? 'x' : ' ') : i.value) + ']'
                 : c.innerText.trim().replace(/\s+/g, ' ').replace(/[=&?]/g, '~'); }).join(' | ')).join('\n'))
     .join('\n-----\n');
   window.__qb()
   ```
   Tabel 1 *Pratinjau transaksi* (Pakai · Tanggal · Subjek · Nominal · Top-up?); tabel 2 *Yang akan ditulis ke DATA QRIS* (Tanggal · Sel · Isi (formula) · Total). Contoh nyata 17 Nov: dua baris tercentang `304855` & `760635` → `B19` `~304855+760635`, total Rp1.065.490.

### c. Periksa, baru Submit
- Baris tercentang = **persis** entri Bayar/Top-up positif yang kamu baca (jumlah & nominal sama). Beda → anomali, lewati.
- **Ada Tanggal kosong** pada baris tercentang → berhenti untuk file ini dan **tanyakan Andre tanggalnya** (AskUserQuestion, tanggal dari nama file sebagai opsi pertama). Jangan menebak. Setelah dijawab, isi kolom tanggal pratinjau itu, lalu baca ulang tabel 2.
- Tanggal tabel 2 = tanggal file, dan `Sel` = baris tanggal itu di DATA QRIS. Beda → anomali, lewati.
- Semua cocok → `scrollIntoView` tombol **💾 Submit ke DATA QRIS** (`#btn-qbank-submit`), klik dengan mouse. Setelah Submit seksi 6 **mengosongkan dirinya sendiri** (input file kosong, *Upload data terakhir* ikut berubah) — tidak perlu ✕ kosongkan.
- Verifikasi: `get_spreadsheet` sel `'DATA QRIS'!A<row>:D<row>` (field `formattedValue`, `userEnteredValue`) → B berisi rumus komponen tadi. Bila INPUT QRIS tanggal sebelumnya sudah lengkap, **D SELISIH harus 0 di luar admin bank**: nilai **0 atau negatif sebesar total MDR** tanggal itu adalah wajar (5 Nov: D7 = 0; 4 Nov: D6 = −840 = MDR Maumbi). **SELISIH positif** = uang masuk lebih besar dari transaksi → sorot sebagai **selisih lebih** di laporan. Negatif melebihi perkiraan MDR → catat. Jangan diubah.
- Melewati file → klik **✕ kosongkan** tanpa Submit.

## Langkah 7 — Fase C: Buat Settlement (satu tanggal per putaran)

Kerjakan semua tanggal **Maumbi** dulu, lalu **Perkamil**.

### a. Pilih tanggal
Dari Mesin EDC buka *Settlement >* outlet itu, pasang helper Langkah 2, lalu:
```js
window.__stPilih = async tgl => {
  for (const x of window.__st()) if (x.centang !== (x.tgl === tgl)) { x.box.click(); await new Promise(s => setTimeout(s, 400)); }
  const on = window.__st().filter(x => x.centang).map(x => x.tgl);
  return on.length === 1 && on[0] === tgl ? 'OK ' + tgl : 'GAGAL ' + JSON.stringify(on);
};
await window.__stPilih('2026-11-11')
```
Harus `OK`. Footer kiri bawah *N Pembayaran / Rp …* = nominal tanggal itu. Lalu:
```js
Array.from(document.querySelectorAll('button')).find(b => /Lanjutkan/.test(b.textContent)).click(); 'lanjut'
```

### b. Isi form *Buat Settlement*
Elemen (teruji): `#openGallerycamera-1` = Bukti Settlement · `#tgl-settlement` · `#nominal_diterima` · `#tgl-diterima` · tombol **Buat Settlement**. Input file kedua (`#openGallerycamera-2`, di *Data opsional › Bukti mutasi rekening*) dan *Data opsional* lainnya **tidak dipakai**.
```js
window.__fm = () => { const t = document.body.innerText;
  const s = t.match(/Settlement\s+Rp\s*([\d.]+),(\d{2})/);
  return { outlet: (t.match(/Co Clean Laundry (\w+)/) || [])[1], settlement: s ? +s[1].replace(/\./g, '') : null,
    tglSettlement: document.getElementById('tgl-settlement').value,
    nominal: document.getElementById('nominal_diterima').value,
    tglDiterima: document.getElementById('tgl-diterima').value }; };
JSON.stringify(window.__fm())
```
`outlet` harus outlet yang sedang dikerjakan dan `settlement` = nominal tanggal D di DAFTAR_AWAL.

**1) Bukti Settlement = file D+1.** Buka file D+1 di tab penampil gambar (Langkah 6a), screenshot skala penuh, pastikan judul tanggalnya D+1. Kembali ke tab Smartlink: `find` "Bukti Settlement file input" → ambil ref yang berada di bagian *Bukti Settlement* (bukan *Bukti mutasi rekening*) → `chrome_upload_image` dengan ref itu. Screenshot: kotak harus menampilkan thumbnail + ✕ dan slot "Tambah…". Salah gambar → klik ✕ pada thumbnail, ulangi.

**2) Settlement pada = D+1, lewat kalender.** Klik mouse di dalam kalender Chrome **tidak masuk** (popup tertutup, kotak tetap kosong) — gunakan keyboard di kalender:
1. Koordinat ikon kalender:
   ```js
   const el = document.getElementById('tgl-settlement'); el.scrollIntoView({block: 'center'});
   const r = el.getBoundingClientRect(); `${Math.round(r.right - 24)},${Math.round(r.top + r.height / 2)}`
   ```
2. Klik ikon itu. Kalender muncul (bisa di bawah **atau di atas** kotak) dengan hari ini tersorot, jam = jam sekarang.
3. Tekan `ArrowLeft` lalu `ArrowRight` supaya kotak terisi, lalu baca `__fm().tglSettlement`.
4. Hitung selisih hari ke D+1 → `ArrowLeft` (−1 hari) / `ArrowRight` (+1) / `ArrowUp` (−7) / `ArrowDown` (+7) sebanyak perlu (pakai `repeat`). Kotak berubah langsung. Contoh teruji: hari ini 18 Nov → 5 Nov = `ArrowUp` ×1 lalu `ArrowLeft` ×6.
5. Baca lagi; ulangi sampai tepat (maks 3 putaran).
6. Tutup kalender dengan **klik area kosong** (mis. ±700, 110). **Jangan Enter** (bisa mengirim form) dan **jangan Escape**.
7. `__fm().tglSettlement` harus diawali `YYYY-MM-DD` milik D+1. Jamnya biarkan.

Tanggal setelah *sekarang* tidak bisa dipilih (`max` = sekarang) — wajar, D+1 tidak pernah di masa depan.

**Cadangan bila kalender tidak mau terbuka** (18 Nov 2026, run 11–17 Nov: setelah klik ikon `document.getElementById('tgl-settlement').matches(':open')` = `false`, panah malah menggulir halaman, kotak tetap kosong). Isi lewat **segmen kotak dengan tombol panah** — bukan mengetik angka; nilai akhirnya sama dengan memilih di kalender:
1. `window.scrollTo(0, 0)`, lalu klik segmen tahun (±55, y tengah kotak; 1000×744: *Settlement pada* y 357, *Diterima pada* y 669).
2. `ArrowUp ArrowRight ArrowUp ArrowRight ArrowUp ArrowRight ArrowUp ArrowRight ArrowUp` → kotak menjadi `<tahun ini>-01-01T00:00` (segmen kosong + ArrowUp = tahun berjalan untuk tahun, nilai minimum untuk lainnya). Kursor berakhir di segmen menit.
3. Menit `ArrowUp` ×m · `ArrowLeft` · jam `ArrowDown` ×(24−h) · `ArrowLeft` · hari `ArrowUp` ×(tgl−1) · `ArrowLeft` · bulan `ArrowDown` ×(13−bulan) (Nov = ×2).
4. Klik area kosong (700, 110), cek `__fm()`. Teruji 14× pada run 11–17 Nov dengan jam 17:15 (contoh 12 Nov: menit ↑×15, jam ↓×7, hari ↑×11, bulan ↓×2 → `2026-11-12T17:15`). Bila D+1 = hari ini, jam harus ≤ `max`.

**3) Nominal yang diterima — diketik.** Ambil koordinat tengah `#nominal_diterima` (cara sama), klik, `triple_click`, ketik angka polos tanpa titik (mis. `565460`). Kotak otomatis menjadi `565.460`. Cek `__fm().nominal`. Salah/dobel → `triple_click` lalu ketik ulang — **screenshot dulu sebelum mengulang**, ketikan yang tampak gagal kadang sudah masuk.

**4) Diterima pada = D+1, lewat kalender.** Sama persis dengan poin 2, untuk `#tgl-diterima`. `min`-nya = nilai *Settlement pada* (tanggal sebelumnya tidak bisa dipilih — wajar); kalender tetap terbuka di hari ini, jadi jumlah tombol panahnya sama dengan poin 2. Cadangan segmen juga sama (klik segmen tahun kotak *Diterima pada*); nilai sementara `…-01-01T00:00` di bawah `min` tidak masalah selama nilai akhirnya = *Settlement pada*.

Rujukan koordinat 1000×744 setelah `scrollIntoView({block:'center'})` (tetap hitung dari JS): ikon *Settlement pada* (956, 358) · *Nominal* (526, 393) · ikon *Diterima pada* (956, 502) · **Buat Settlement** (500, 708) · klik penutup kalender (700, 110).

### c. Periksa, baru Buat Settlement
Semua harus benar:
- `outlet` benar; `settlement` = nominal D di DAFTAR_AWAL
- thumbnail Bukti = file D+1 (judul tanggalnya sudah dicek)
- `tglSettlement` dan `tglDiterima` = D+1
- `nominal` = hasil Aturan inti 3–4 (gambar > Settlement → isi angka Settlement, catat selisih lebih)
- Bila sel DATA QRIS baris D+1 berupa rumus (`get_spreadsheet`, `ranges` `'DATA QRIS'!B<row>`, field `sheets.data.rowData.values.userEnteredValue`), angka-angka di rumus itu harus sama dengan entri yang kamu baca. Beda → anomali.

Ada yang salah dan tidak bisa dibetulkan → ← lalu **Ya, batal**, lewati, catat.
Semua benar → `scrollIntoView` tombol **Buat Settlement**, klik dengan mouse (koordinat dari `getBoundingClientRect`). Form ini memakai reCAPTCHA: muncul tantangan gambar / kotak "I'm not a robot" → **berhenti** dan minta Andre menyelesaikannya sendiri. Claude tidak boleh mengerjakan CAPTCHA.

### d. Pastikan tersimpan
Catat *Saldo aktif* outlet sebelum settlement pertama sesi itu (kartu Mesin EDC saat pertama dibuka, atau halaman Detail EDC).

Setelah klik, tunggu 3–5 detik. Yang terjadi pada uji 4 Nov (tanpa CAPTCHA):
- notifikasi hijau **"Berhasil Settlement Keuangan EDC"**
- aplikasi pindah ke **Detail EDC** outlet itu; *Saldo aktif* turun **tepat sebesar Settlement**, bukan sebesar nominal diterima (Maumbi 4 Nov 6.339.342 → 6.120.542; Maumbi 3 Nov Settlement 302.700 / diterima 301.860 → 6.120.542 → 5.817.842)
- *Riwayat Settlement › Terakhir* menampilkan tanggal settlement **terbaru**, jadi tidak berubah bila tanggal yang di-settle lebih lama (bukan tanda gagal)

Lalu klik tombol **Settlement** di Detail EDC dan jalankan `__stTeks()`: tanggal D **harus sudah hilang**. Masih ada, atau saldo tidak turun sesuai → **jangan buat ulang**; catat dan laporkan ke Andre (bisa jadi dobel). Setelah itu ← dua kali untuk kembali ke Mesin EDC.

**Saldo dan daftar bisa basi sesaat setelah submit** (18 Nov, Perkamil 14 Nov: toast muncul, tetapi *Saldo aktif* dan daftar belum berubah). Sebelum menyimpulkan gagal, buka **Riwayat Settlement** di Detail EDC: entri dengan nominal Settlement + tanggal D+1 ada **tepat sekali** = tersimpan; ← ke Detail EDC lagi, saldo sudah benar. Saldo juga bisa **naik** di tengah run karena transaksi hari ini masuk (18 Nov Perkamil +192.000) — cocokkan dengan daftar, jangan dianggap selisih.

## Langkah 8 — Rapikan

Kembalikan tab Smartlink ke `https://dashboard.smartlink.id/dashboard`, tutup tab localhost dan penampil gambar yang Claude buka.

## Aturan keras

- **Jangan** klik *Pilih semua*. Satu tanggal per settlement.
- **Jangan** tekan Enter/Escape saat kalender Smartlink terbuka, dan **jangan** mengetik angka tanggal (tombol panah di kalender, atau di segmen kotak sebagai cadangan, boleh).
- **Jangan** menulis DATA QRIS lewat konektor; **jangan** menyentuh kolom C/D DATA QRIS.
- **Jangan** menimpa baris INPUT QRIS yang sudah ada.
- **Jangan** settle tanpa file D+1, dan jangan memakai file selain D+1.
- **Jangan** mengulang Submit atau Buat Settlement sebelum memastikan yang pertama memang gagal (cek sheet / daftar).
- **Jangan** mengerjakan CAPTCHA.
- **Jangan** mempersoalkan atau mengubah isi DATA QRIS / INPUT QRIS yang sudah ada — sebagian diisi manual oleh Andre (mis. DATA QRIS 3 Nov `=207300+759300`).
- Ragu = lewati, catat, tanyakan di akhir.

## Laporan akhir (Indonesia lalu Inggris)

- **Selisih lebih** (permintaan Andre, wajib ada): per tanggal & outlet (nominal gambar − Settlement) dan **total** seluruhnya. Tidak ada → tulis "tidak ada".
- INPUT QRIS: baris yang ditulis (tanggal · outlet · nominal) dan yang dilewati + alasan (sudah ada / hari ini < 21:00 / nominal beda).
- DATA QRIS: file yang di-submit (tanggal · sel · total · SELISIH) dan yang dilewati + alasan. SELISIH negatif sebesar MDR cukup disebut sebagai admin bank (wajar); SELISIH positif disorot sebagai selisih lebih.
- Settlement: yang dibuat (outlet · D · file D+1 · nominal · saldo aktif sebelum → sesudah) dan yang dilewati + alasan (file D+1 belum ada / anomali / hari ini / gagal tersimpan).
- **Pertanyaan anomali** — AskUserQuestion dengan opsi, mis. untuk entri berkode outlet yang tidak bertransaksi di D: "Jumlahkan ke <outlet>" / "Biarkan, saya cek manual".