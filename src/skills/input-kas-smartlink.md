---
name: "input-kas-smartlink"
description: "Jalankan saat Andre minta input kas harian: unggah 4 screenshot saldo m-banking dari Drive serta screenshot Kas Laci, Kas Bank & Kas Mesin EDC Smartlink ke menu Input Kas (bagian 1–4) di Dashboard Kas Laundry, Analisis, lalu Konfirmasi & Simpan."
---

# Input Kas Harian (Dashboard Kas Laundry › Input Kas, bagian 1–4)

Milik Co Clean Laundry (outlet Maumbi & Perkamil). Disusun dari panduan Andre `INPUT_KAS.docx`.
Uji coba pertama 19 Nov 2026 12:46 WITA: keempat bagian tersimpan dan semuanya cocok.

| Bagian di Input Kas | Sumber screenshot | Isi screenshot | Sel tujuan |
|---|---|---|---|
| **1. Kas Bank (m-banking)** | 4 gambar di folder Drive | apa adanya, **4 gambar sekaligus** | BCA → `KAS!B6` · BRI → B7 · BNI → B8 · Mandiri → B9 (*BIAYA & KAS LAUNDRY*) |
| **2. Kas Aplikasi Outlet** | Smartlink › beranda › Keuangan › **Total Kas Laci** | hanya 2 kartu *Co Clean Laundry Maumbi / Perkamil* | Maumbi → B4 · Perkamil → B5 (*INPUT LAPORAN HARIAN*) |
| **3. Kas Bank di Aplikasi** | Smartlink › beranda › Keuangan › **Total Kas Bank** | hanya 4 kartu *Rekening BCA/BRI/BNI/Mandiri Andre* | BCA → B11 · BRI → B12 · BNI → B13 · Mandiri → B14 (*INPUT LAPORAN HARIAN*) |
| **4. Belum Settlement** | Smartlink › beranda › Keuangan | hanya baris **Total Kas Mesin EDC** (tidak diklik) | Total → B15 (*INPUT LAPORAN HARIAN*) |

Setiap bagian: masukkan screenshot → **🔍 Analisis** → cocokkan pratinjau → **✔ Konfirmasi & Simpan**.
Bagian **5** dan **6** di halaman yang sama **bukan** untuk skill ini, jadi jangan disentuh.

## Keputusan Andre (19 Nov 2026)

| Soal | Keputusan |
|---|---|
| Bagian 4 | Screenshot **baris Total Kas Mesin EDC di beranda**, persis contoh panduan. Halaman EDC (2 mesin tanpa nama outlet) tidak dipakai. |
| Folder Drive bukan tepat 4 gambar, atau ada gambar yang bukan dari hari ini (WITA) | **Berhenti untuk bagian 1, tanya Andre.** Bagian 2–4 tetap jalan. |
| Angka pratinjau AI berbeda lebih dari Rp1 dari bacaan Claude | **Jangan simpan bagian itu**, lanjut ke bagian lain, tanyakan di laporan akhir. Angka di kolom pratinjau **tidak diubah**. |
| Izin | **Satu izin per run** sebelum Konfirmasi & Simpan pertama. |

## Data tetap

| Item | Nilai |
|---|---|
| Folder Drive screenshot m-banking | `1rHmgRTGfTaxdhPpzNbh6OZCBb3uIyD9h` (nama file acak, mis. `IMG_0599.PNG`; bank dikenali dari isi gambar) |
| Dashboard Kas Laundry | `http://localhost:3000/` › tab **Input Kas**. Kalau tab ini tidak mau dimuat, berhenti dan minta Andre menyalakannya. |
| Smartlink | `https://dashboard.smartlink.id/dashboard` (login owner) |
| BIAYA & KAS LAUNDRY | ID `17FSDZKdYnn3yl08lWDfTZaQZ-x2AhXn493HhVnfAZlY`, sheet `KAS` |
| INPUT LAPORAN HARIAN | sheet di **CASHFLOW DAN BIAYA <BULAN> <TAHUN>** (bulan berjalan milik localhost). Nov 2026: `1zCl79M9ltiSl0NSIev2rENGpEPJ-p_zjMB08TTFJH3k`. Untuk bulan lain, ambil dari memori `/areas/co-clean-automation.md` atau localhost › Pengaturan. |
| Jam WITA | Bash: `TZ=Asia/Makassar date '+%Y-%m-%d %H:%M'` |

Konektor (cukup dimuat sekali):
`ToolSearch select:mcp__Google_Drive__search_files,mcp__Google_Sheets__get_values`

## Tab & kebiasaan tool (teruji 19 Nov 2026, tool side panel `mcp__claude-device__chrome_*`)

- **Tab Andre** dipakai untuk Smartlink. Buka 2 tab baru (tugas ini butuh beberapa halaman sekaligus) dan sebutkan judulnya ke Andre: **Dashboard Kas Laundry** (localhost) dan **penampil gambar** (Drive). Tutup keduanya di akhir.
- **Bingkai screenshot ≠ piksel CSS.** Setiap tab punya bingkai sendiri, mis. tab Smartlink 511×1568 (CSS 568) dan tab localhost 495×1568 (CSS 631). Koordinat DOM dikali `k = lebar bingkai ÷ innerWidth`. Ambil lebar bingkai dari screenshot pertama **tiap tab**.
- **Screenshot yang akan diunggah harus skala penuh**, jadi jangan beri parameter `scale`. Ambil screenshot tepat sebelum diunggah, karena ID-nya kedaluwarsa dalam beberapa menit. `browser_batch` tidak bisa memakai ID screenshot dari batch yang sama, jadi pola kerjanya: *screenshot* (batch A) → *upload + gambar berikutnya* (batch B).
- **Unggah = jatuhkan (drop) ke bagian kosong dropzone**, yaitu titik `drop` dari helper (pojok kanan bawah kotak bergaris). Drop di sana memakai *tarik & lepas* aplikasi, yang **menambah** file. Kalau dijatuhkan di atas tombol *Choose Files*, file **diganti** dan hanya 1 yang tersisa (teruji). Setelah tiap unggah, cek daftar file.
- Keluaran `javascript_tool` yang memuat `=`, `&`, atau `?` diblokir. Ganti dulu dengan `.replace(/[=&?]/g,'~')`. **Jangan pernah** mengembalikan URL iframe Smartlink, karena berisi token.
- Jangan refresh tab mana pun di tengah satu bagian.

## Langkah 0 — Jam & cek folder Drive

1. Ambil jam WITA (Bash), catat `HARI_INI`.
2. Ambil daftar file: `search_files` dengan `parentId = '1rHmgRTGfTaxdhPpzNbh6OZCBb3uIyD9h'`, `excludeContentSnippets: true`, dan ikuti `nextPageToken` sampai hasilnya kosong.
3. Syaratnya **tepat 4 file gambar** dan `createdTime` keempatnya jatuh di `HARI_INI` WITA (UTC+8; mis. `2026-11-19T04:03Z` = 19 Nov 12:03 WITA). Kalau tidak terpenuhi, bagian 1 **tidak dijalankan**: tanyakan lewat AskUserQuestion di rencana (Langkah 3), lalu lanjutkan bagian 2–4.

## Langkah 1 — Tab localhost & helper

Buka tab baru → `http://localhost:3000/`, tunggu 2 detik, lalu klik tombol **Input Kas**:

```js
Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === 'Input Kas').click(); 'ok'
```

Ambil screenshot sekali untuk tahu lebar bingkai, lalu pasang helper (ganti `__FW` dengan lebar itu):

```js
window.__FW = 495;
window.__kc = j => document.querySelector('.kas-card[data-jenis="' + j + '"]');
window.__kasPos = j => { const c = window.__kc(j); c.scrollIntoView({block: 'center'}); const k = window.__FW / innerWidth;
  const P = (el, dx, dy) => { const r = el.getBoundingClientRect();
    return [Math.round((dx == null ? r.x + r.width/2 : r.x + r.width + dx) * k), Math.round((dy == null ? r.y + r.height/2 : r.y + r.height + dy) * k)]; };
  return JSON.stringify({ drop: P(c.querySelector('.kas-dz'), -30, -12), analisis: P(c.querySelector('.kas-analyze')),
    submit: c.querySelector('.kas-preview').classList.contains('hidden') ? null : P(c.querySelector('.kas-submit')) }); };
window.__kasStatus = j => { const c = window.__kc(j); const vis = s => !c.querySelector(s).classList.contains('hidden');
  return JSON.stringify({ files: Array.from(c.querySelector('.kas-files').files).map(f => f.name), loading: vis('.kas-loading'),
    error: vis('.kas-error') ? c.querySelector('.kas-error').innerText : '',
    preview: vis('.kas-preview') ? Array.from(c.querySelectorAll('.kas-preview tbody tr')).map(tr => { const td = tr.children;
      return td[0].innerText.trim() + ' | ' + td[1].innerText.trim() + ' | ' + td[2].querySelector('input').value + ' | ' + td[3].innerText.trim(); }) : null,
    hasil: vis('.kas-result') ? c.querySelector('.kas-result').innerText : '',
    last: c.querySelector('.kas-last').innerText.trim() + (c.querySelector('.kas-last').classList.contains('kas-last-old') ? ' (MERAH)' : ' (hari ini)')
  }).replace(/[=&?]/g, '~'); };
window.__kasTunggu = async (j, ms = 90000) => { const t0 = Date.now(); await new Promise(s => setTimeout(s, 800));
  while (Date.now() - t0 < ms) { if (window.__kc(j).querySelector('.kas-loading').classList.contains('hidden')) return window.__kasStatus(j);
    await new Promise(s => setTimeout(s, 1000)); } return 'TIMEOUT ' + window.__kasStatus(j); };
window.__kasHasil = async (j, ms = 30000) => { const t0 = Date.now();
  while (Date.now() - t0 < ms) { const r = window.__kc(j).querySelector('.kas-result');
    if (!r.classList.contains('hidden') && r.innerText.trim()) return window.__kasStatus(j); await new Promise(s => setTimeout(s, 800)); }
  return 'TIMEOUT ' + window.__kasStatus(j); };
['bank','aplikasi-outlet','bank-aplikasi','belum-settlement'].map(j => j + ' ' + window.__kasStatus(j)).join('\n')
```

`data-jenis`: `bank` = bagian 1 · `aplikasi-outlet` = 2 · `bank-aplikasi` = 3 · `belum-settlement` = 4.
Ada bagian yang sudah berisi file sebelum mulai? Kosongkan dulu:
`window.__kc('<jenis>').querySelector('.dz-clear').click()`.

**Posisi tombol bergeser** setelah pratinjau muncul. Panggil `__kasPos` lagi tepat sebelum setiap klik.

## Langkah 2 — Kumpulkan angka (belum mengunggah apa pun)

**a. Gambar Drive.** Buka tab baru untuk penampil gambar. Untuk tiap file, buka `https://drive.google.com/uc?export=view&id=<fileId>`, tunggu 2 detik, lalu screenshot dan baca bank serta saldonya. Contoh 19 Nov: myBCA *Active Balance* IDR 2,083,762.87 · BRImo *Saldo Rekening Utama* Rp499.380,26 · wondr BNI *Saldo efektif* Rp574.100 · Tabungan Mandiri Rp 8.841.081,45. Banknya harus tepat BCA, BRI, BNI, dan Mandiri masing-masing satu. Kalau ada yang kembar atau tidak terbaca, itu anomali bagian 1.

**b. Smartlink.** Tab Andre → `https://dashboard.smartlink.id/dashboard`, tunggu sampai layar "Menghubungi Server" hilang. Beranda Smartlink ada di dalam iframe beda domain, jadi buka langsung sebagai halaman utama:

```js
const f = Array.from(document.querySelectorAll('iframe')).find(x => /dashboard-vue/.test(x.src));
f ? (() => { const u = new URL(f.src); u.pathname = '/dashboard'; location.href = u.href; return 'pindah'; })() : 'iframe belum ada'
```

Tunggu ±5 detik, screenshot sekali (untuk lebar bingkai), lalu pasang helper (ganti `__FW`):

```js
window.__FW = 511; window.__hidden = window.__hidden || [];
window.__unmask = () => { const o = document.getElementById('__mask'); if (o) o.remove();
  window.__hidden.forEach(e => e.style.display = ''); window.__hidden = []; return 'unmask'; };
window.__maskRect = (els, pad = 8) => { const rs = els.map(e => e.getBoundingClientRect());
  const L = Math.min(...rs.map(r => r.left)), T = Math.min(...rs.map(r => r.top)), R = Math.max(...rs.map(r => r.right)), B = Math.max(...rs.map(r => r.bottom));
  const o = document.createElement('div'); o.id = '__mask';
  Object.assign(o.style, { position: 'fixed', left: (L - pad) + 'px', top: (T - pad) + 'px', width: (R - L + 2*pad) + 'px', height: (B - T + 2*pad) + 'px',
    boxShadow: '0 0 0 9999px #ffffff', pointerEvents: 'none', zIndex: 2147483647 });
  document.body.appendChild(o); return [L, T, R - L, B - T].map(Math.round).join(','); };
window.__barisKeu = re => { const row = Array.from(document.querySelectorAll('.section-keuangan-main .inner-panel-item')).find(r => re.test(r.innerText.trim()));
  row.scrollIntoView({block: 'center'}); const b = row.getBoundingClientRect(); const k = window.__FW / innerWidth;
  return Math.round((b.x + b.width/2) * k) + ',' + Math.round((b.y + b.height/2) * k) + ' :: ' + row.innerText.replace(/\s+/g, ' ').trim(); };
window.__fokusKartu = re => { window.__unmask(); const cards = Array.from(document.querySelectorAll('.list-card .set-card')).filter(e => e.offsetParent);
  const nama = c => (c.innerText.split('\n').map(s => s.trim()).find(s => s) || ''); const ok = cards.filter(c => re.test(nama(c)));
  cards.filter(c => !ok.includes(c)).forEach(c => { const w = c.parentElement; w.style.display = 'none'; window.__hidden.push(w); });
  if (!ok.length) return 'TIDAK ADA'; ok[0].scrollIntoView({block: 'center'}); const rect = window.__maskRect(ok);
  return ok.length + ' kartu @' + rect + '\n' + ok.map(c => c.innerText.replace(/\s+/g, ' ').trim()).join('\n'); };
Array.from(document.querySelectorAll('.section-keuangan-main .inner-panel-item')).map(r => r.innerText.replace(/\s+/g, ' ').trim()).join('\n')
```

Keluaran terakhirnya berisi 4 baris Keuangan (Total Kas Laci, Total Kas Bank, Total Kas Merchant Online, Total Kas Mesin EDC). Catat **Total Kas Mesin EDC** untuk bagian 4.

Baca rincian Kas Laci dan Kas Bank:
1. `window.__barisKeu(/^Total Kas Laci/)` mengembalikan koordinat, lalu klik dengan `computer` dan tunggu 3 detik. Halaman **Kas Laci** terbuka sebagai lapisan (path tetap `/dashboard`).
2. `window.__fokusKartu(/^Co Clean Laundry (Maumbi|Perkamil)$/)` harus menghasilkan `2 kartu` beserta nominalnya. Kembalikan tampilan dengan `window.__unmask()`.
3. Tutup lapisan lewat **←** kiri atas (±(67,20) pada bingkai 511; lihat dari screenshot).
4. Ulangi untuk `/^Total Kas Bank/` dengan `window.__fokusKartu(/^Rekening (BCA|BRI|BNI|Mandiri) Andre$/)`, yang harus menghasilkan `4 kartu`. Kartu *Bank BCA a/n Betrix…*, *Bank Mandiri*, *Bank BNI*, dan *Bank BRI a/n Betrix…* **bukan** sasaran; helper menyembunyikannya.

Jumlah kartu tidak sesuai (≠2 / ≠4) atau `TIDAK ADA` → anomali bagian itu.

## Langkah 3 — Rencana & satu izin

Tampilkan dalam dua bahasa: tiap bagian beserta angka → sel tujuan, ditambah bagian yang dilewati dan alasannya (mis. syarat Drive tidak terpenuhi). Lalu ajukan **satu** AskUserQuestion: *Jalankan semua (Recommended)* / *Dry run saja*. Pertanyaan anomali Drive digabung ke AskUserQuestion yang sama.

Kalau Andre bilang "cek saja" / "dry run", kerjakan Langkah 4 sampai pratinjau Analisis saja, lalu kosongkan tiap bagian dengan `.dz-clear` tanpa Konfirmasi & Simpan.

## Langkah 4 — Jalankan per bagian

Urutan pengerjaan: 1 → 2 → 3 → 4.

### Bagian 1 — Kas Bank (m-banking)
Untuk tiap gambar (urutan bebas, beri nama file sesuai bank):
1. Di tab penampil, buka `uc?export=view&id=<fileId>`, tunggu 2 detik, lalu pastikan gambarnya utuh:
   `const im = document.querySelector('img'); im ? (im.height <= innerHeight && im.width <= innerWidth ? 'utuh' : 'terpotong') : 'bukan gambar'`
   Kalau hasilnya `terpotong`, jalankan `im.style.maxHeight='100vh'; im.style.maxWidth='100vw'` lalu cek lagi.
2. Ambil screenshot **skala penuh**.
3. `chrome_upload_image`: `imageId` dari screenshot itu, `tabId` localhost, `coordinate` = `drop` dari `__kasPos('bank')`, `filename` `BCA.png` / `BRI.png` / `BNI.png` / `MANDIRI.png`.
4. `__kasStatus('bank')`: daftar `files` harus bertambah satu. Kalau jumlahnya tetap 1, file terganti; kosongkan (`.dz-clear`) dan ulangi dengan titik `drop`.

Setelah daftar berisi 4 file, lanjut ke **Analisis & simpan** di bawah. Jumlah baris pratinjau yang diharapkan: **4**.

### Bagian 2 — Kas Aplikasi Outlet
1. Klik Total Kas Laci, lalu `__fokusKartu(/^Co Clean Laundry (Maumbi|Perkamil)$/)`.
2. Ambil **screenshot skala penuh**. Yang terlihat hanya 2 kartu di latar putih, sama dengan contoh Andre.
3. Unggah ke titik `drop` dari `__kasPos('aplikasi-outlet')`, `filename` `KAS-APLIKASI-OUTLET.png`.
4. Jalankan `__unmask()` lalu tutup lapisan dengan ←.

Jumlah baris pratinjau yang diharapkan: **2**.

### Bagian 3 — Kas Bank di Aplikasi
1. Klik Total Kas Bank, lalu `__fokusKartu(/^Rekening (BCA|BRI|BNI|Mandiri) Andre$/)`.
2. Ambil **screenshot skala penuh**. Yang terlihat hanya 4 kartu *Rekening … Andre*.
3. Unggah ke `__kasPos('bank-aplikasi').drop`, `filename` `KAS-BANK-APLIKASI.png`.
4. Jalankan `__unmask()` lalu tutup lapisan dengan ←.

Jumlah baris pratinjau yang diharapkan: **4**.

### Bagian 4 — Belum Settlement
1. Pastikan Anda berada di beranda (tidak ada lapisan terbuka), lalu jalankan:
   ```js
   window.__unmask(); window.__barisKeu(/^Total Kas Mesin EDC/); await new Promise(s => setTimeout(s, 400));
   window.__maskRect([Array.from(document.querySelectorAll('.section-keuangan-main .inner-panel-item')).find(r => /^Total Kas Mesin EDC/.test(r.innerText.trim()))], 4)
   ```
   **Barisnya tidak diklik.**
2. Ambil **screenshot skala penuh**. Yang terlihat hanya baris *Total Kas Mesin EDC Rp …*.
3. Unggah ke `__kasPos('belum-settlement').drop`, `filename` `BELUM-SETTLEMENT.png`.
4. Jalankan `__unmask()`.

Jumlah baris pratinjau yang diharapkan: **1**.

### Analisis & simpan (sama untuk tiap bagian)
1. Panggil `__kasPos(j)`, klik **analisis** dengan `computer`, lalu `await __kasTunggu(j)`. Biasanya selesai dalam 10–20 detik (pesan *Claude sedang membaca screenshot…*).
2. Periksa `preview` (kolom: Tujuan | Sel | Nominal | Catatan AI):
   - Jumlah baris harus persis seperti yang diharapkan dan `error` harus kosong. Pesan *"Sebagian item tidak dikenali target selnya dan dilewati."* atau *"Tidak ada nominal yang terbaca…"* berarti anomali.
   - **Sel** harus sesuai tabel di atas, dan banknya harus sesuai label. Contoh: label *Kas Bank BCA* harus ke `KAS!B6`, bukan B7.
   - **Nominal** harus sama dengan bacaan Claude, dengan selisih maksimal **Rp1**. Sen boleh dibulatkan; AI kadang membulatkan (BCA ,87 → naik) dan kadang membuang sen (BRI ,26 / Mandiri ,45). Keduanya wajar.
3. Semua benar → panggil `__kasPos(j)` lagi untuk posisi `submit`, zoom area itu untuk bukti, klik **✔ Konfirmasi & Simpan** dengan `computer`, lalu `await __kasHasil(j)`.
   Hasil yang benar: `hasil` diawali **`✔ Tersimpan (<tanggal hari ini>)`** beserta daftar `label: Rp… → sel`, `files` kosong (dikosongkan otomatis), dan `last` menjadi *Upload data terakhir: <hari ini> … (hari ini)*.
   Kalau `hasil` diawali `✘` atau hasilnya `TIMEOUT`, **jangan klik ulang**. Laporkan saja.
4. Kalau ada yang tidak cocok, **jangan Konfirmasi & Simpan** dan jangan mengubah angka di kolom pratinjau. Kosongkan dengan `window.__kc(j).querySelector('.dz-clear').click()`, catat untuk laporan, lalu lanjut ke bagian berikutnya.

## Langkah 5 — Verifikasi di spreadsheet

- `get_values` BIAYA & KAS LAUNDRY `KAS!A6:C9` → BCA/BRI/BNI/MANDIRI berisi angka bagian 1 dengan tanggal hari ini.
- `get_values` CASHFLOW bulan berjalan `'INPUT LAPORAN HARIAN'!A4:C15` → B4:B5 (bagian 2), B11:B14 (bagian 3), dan B15 (bagian 4) berisi angka baru dengan tanggal hari ini. B10 *KAS BANK APLIKASI* adalah rumus `=SUM(B11:B14)`.
- Fakta yang perlu diketahui (dicek 19 Nov 2026): B6:B9 di INPUT LAPORAN HARIAN (BCA…MANDIRI) **tidak** ditulis oleh skill ini, karena bagian 1 menulis ke `KAS!B6:B9` di BIAYA & KAS LAUNDRY. Sebaliknya, `KAS!B10:C15` mengambil data dari INPUT LAPORAN HARIAN lewat IMPORTRANGE.

## Langkah 6 — Rapikan

Jalankan `__unmask()` di tab Smartlink, lalu buka `https://dashboard.smartlink.id/dashboard`. Tutup tab localhost dan tab penampil gambar yang Claude buka.

## Aturan keras

- Hanya bagian **1–4** yang disentuh. Bagian 5 *Pendapatan EDC Harian* dan 6 *Transfer Masuk Dana EDC* tidak boleh disentuh.
- **Jangan** mengubah angka di kolom pratinjau. Kalau tidak cocok, bagian itu tidak disimpan dan ditanyakan ke Andre.
- Dalam satu run, **jangan** klik Konfirmasi & Simpan dua kali, dan jangan mengulang bagian yang sudah `✔ Tersimpan`. Run baru atas permintaan Andre (mis. malam hari) memang menimpa nilai hari itu, dan itu disengaja.
- **Jangan** menghapus, memindah, atau mengganti nama file di folder Drive.
- Di Smartlink, yang boleh diklik hanya baris Keuangan (Total Kas Laci / Total Kas Bank) dan tombol ← penutup lapisan. Jangan klik kartu di dalam lapisan, menu lain, atau Total Kas Mesin EDC.
- Jangan unggah screenshot yang masih memperlihatkan hal lain (judul halaman, total, kartu *Bank … a/n Betrix*). Masker (`__fokusKartu` / `__maskRect`) wajib aktif saat screenshot.
- Angka Smartlink di lapisan *Terhitung Per …* (jam WIB) berasal dari saat beranda dimuat. Karena itu beranda selalu dimuat ulang di awal (Langkah 2b), bukan memakai halaman lama.

## Laporan akhir (Indonesia lalu Inggris)

- Tiap bagian: tersimpan / dilewati, angka → sel, dan jam *Upload data terakhir*.
- Hasil cek spreadsheet (Langkah 5).
- Yang dilewati beserta alasannya (syarat Drive, selisih AI, jumlah kartu, error). Anomali ditanyakan lewat AskUserQuestion dengan opsi.
- Jangan menilai selisih antara saldo m-banking dan saldo di aplikasi. Itu bahan kontrol Andre sendiri; cukup tampilkan angkanya.