---
name: konfirmasi-biaya-smartlink
description: "Jalankan saat Andre minta konfirmasi/verifikasi biaya outlet Smartlink: cocokkan tiap biaya berstatus Menunggu konfirmasi dengan Monitoring Biaya di Dashboard Kas Laundry, lalu setujui dengan kode transaksi."
---

# Konfirmasi Biaya Outlet Smartlink

Mencocokkan setiap biaya berstatus **Menunggu konfirmasi** di Smartlink dengan baris di
**Monitoring Biaya** pada Dashboard Kas Laundry, lalu menyetujuinya dengan kode transaksi
sebagai catatan. Milik Co Clean Laundry (outlet Maumbi & Perkamil).

## Prasyarat

1. Chrome dengan dua tab terbuka (pakai tool `mcp__claude-in-chrome__*`):
   - **Smartlink**: `https://dashboard.smartlink.id` — sudah login sebagai owner.
   - **Dashboard Kas Laundry**: `http://localhost:3000/` — aplikasi lokal ini **harus hidup**.
     Kalau tab-nya tidak ada atau gagal dimuat, berhenti dan minta Andre menjalankannya dulu.
2. Jangan pernah me-refresh (F5) tab mana pun di tengah proses.
3. Pakai `browser_batch` untuk merangkai klik + tunggu + screenshot dalam satu panggilan —
   jauh lebih cepat daripada satu-satu.

## Karakter kedua aplikasi (penting)

- **Smartlink = aplikasi Flutter di atas kanvas.** Tidak ada teks DOM sama sekali —
  `get_page_text`, `find`, dan `read_page` tidak berguna di sini. Baca isinya **hanya lewat
  screenshot**, klik **lewat koordinat**.
  - Sekali di awal sesi, nyalakan pohon aksesibilitasnya agar menu sidebar bisa dibaca sebagai
    teks berikut koordinatnya:
    ```js
    const ph = document.querySelector('flt-semantics-placeholder'); if (ph) ph.click();
    ```
    lalu baca menu + koordinatnya:
    ```js
    Array.from(document.querySelectorAll('flt-semantics'))
      .filter(n => n.querySelectorAll('flt-semantics').length === 0)
      .map(n => { const r = n.getBoundingClientRect();
        return `${Math.round(r.x+r.width/2)},${Math.round(r.y+r.height/2)} :: ${(n.getAttribute('aria-label')||n.innerText||'').trim().replace(/\s+/g,' ')}`; })
      .filter(s => s.split(':: ')[1]).join('\n')
    ```
  - Isi area utama (kartu biaya, detail, dialog) **tidak** masuk pohon aksesibilitas — tetap baca
    dari screenshot.
- **Dashboard Kas Laundry = HTML biasa.** Baca dan klik lewat `javascript_tool`. Ini sisi yang
  akurat, jadi seluruh logika pencocokan dikerjakan di sini.

## Langkah 0 — Pasang helper di tab Dashboard Kas Laundry

Jangan pernah mengandalkan indeks tabel yang di-hardcode; cari tabelnya lewat judul kolom.

```js
window.__mbTable = () => Array.from(document.querySelectorAll('table')).find(t => {
  const h = ((t.querySelector('tr')||{}).innerText||'').toUpperCase();
  return h.includes('VERIFIKASI OWNER') && h.includes('KODE TRANSAKSI');
});
window.__mbNorm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g,'');
// WAJIB: "2 Sept 2026 18:43" dan "2 September 2026" harus dianggap sama
window.__mbDate = s => { const m = String(s).match(/(\d{1,2})\s*([A-Za-z]+)\s*(\d{4})/);
  return m ? m[1]+'-'+m[2].slice(0,3).toLowerCase()+'-'+m[3] : String(s).toLowerCase(); };
window.__mbRows = () => Array.from(window.__mbTable().querySelectorAll('tr')).slice(1).map(r => {
  const c = Array.from(r.children).map(x => x.innerText.trim().replace(/\s+/g,' '));
  return { el:r, nomor:c[1].replace(/[^0-9]/g,''), subjek:c[2], ket:c[3], nominal:c[4],
           tgl:c[5], outlet:c[6], sumber:c[7], guna:c[8], kode:c[10], ver:c[11] };
});
window.__mbMatch = (ket, nominal, tgl, outlet) => window.__mbRows().filter(r =>
  window.__mbNorm(r.ket)     === window.__mbNorm(ket) &&
  window.__mbNorm(r.nominal) === window.__mbNorm(nominal) &&
  window.__mbDate(r.tgl)     === window.__mbDate(tgl) &&
  window.__mbNorm(r.outlet)  === window.__mbNorm(outlet));
window.__mbDo = async (ket, nominal, tgl, outlet) => {
  const m = window.__mbMatch(ket, nominal, tgl, outlet);
  if (m.length !== 1) return {status: m.length === 0 ? 'NO-MATCH' : 'AMBIGU', n: m.length};
  const r = m[0];
  if (!/^KAS TUNAI/i.test(r.sumber)) return {status:'BUKAN-KAS', sumber:r.sumber};
  if (r.ver !== '—') return {status:'SUDAH-VERIF', nomor:r.nomor, kode:r.kode};
  r.el.children[11].querySelector('button.mb-verif').click(); // — → … → ✓
  r.el.children[10].click();                                  // salin KODE TRANSAKSI
  return {status:'DIKLIK', nomor:r.nomor, kode:r.kode};
};
window.__mbWait = async (nomor, ms=12000) => { const t0 = Date.now();
  while (Date.now()-t0 < ms) { const r = window.__mbRows().find(x => x.nomor === nomor);
    if (r && r.ver === '✓') return {status:'OK', nomor, kode:r.kode};
    await new Promise(s => setTimeout(s, 700)); }
  return {status:'TIMEOUT', nomor}; };
'helper siap: ' + window.__mbRows().length + ' baris, belum diverifikasi: ' +
  window.__mbRows().filter(r => r.ver === '—').length
```

Susunan kolom Monitoring Biaya (indeks sel):
`0 (kosong) | 1 NOMOR | 2 SUBJEK BIAYA | 3 KETERANGAN | 4 NOMINAL | 5 TANGGAL | 6 OUTLET |
7 SUMBER DANA | 8 KETERANGAN PENGGUNAAN | 9 STATUS LAPOR APLIKASI | 10 KODE TRANSAKSI |
11 VERIFIKASI OWNER | 12 KETERANGAN KOREKSI`

Catat jumlah baris ber-`—` di awal sebagai pembanding di laporan akhir.

## Langkah 1 — Buka daftar biaya di Smartlink

Sidebar: **Keuangan › Pengeluaran Biaya › Biaya Outlet** (URL menjadi `/biaya-outlet`).
Tunggu sampai spinner hilang — mengklik saat halaman masih memuat akan meleset ke kartu yang
salah. Kartu berlabel **"Menunggu konfirmasi"** adalah antrean kerjanya. Filter bawaan hanya
menampilkan bulan berjalan — biarkan apa adanya kecuali Andre minta lain.

Badge "N Tindakan butuh konfirmasi" di halaman Depan mencakup jenis tindakan lain juga, jadi
angkanya biasanya lebih besar dari jumlah biaya outlet yang menunggu. Jangan pakai itu sebagai
target.

## Langkah 2 — Ambil satu item, baca 4 bagian

**Selalu screenshot daftarnya lebih dulu, lalu tentukan koordinat kartu dari yang terlihat.**
Jangan memakai koordinat hafalan: item yang dilewati tetap bertahan di daftar dan menggeser
posisi kartu di bawahnya.

Dari halaman **Detail Pengeluaran Biaya**, baca lewat screenshot:

| Bagian di Smartlink | Dipakai untuk mencocokkan |
|---|---|
| **Keterangan** (paling bawah) | kolom `KETERANGAN` |
| **Sumber dana** → nama outlet | kolom `OUTLET` (Perkamil / Maumbi) |
| **Sumber dana** → jenisnya | kolom `SUMBER DANA` ("Kas Outlet ..." ↔ "KAS TUNAI ...") |
| **Nominal** | kolom `NOMINAL` |
| **Waktu pemakaian** — **tanggalnya saja, jam diabaikan** | kolom `TANGGAL` |

Jangan memakai *tgl permintaan*, *Akun biaya*, atau *Item biaya* untuk mencocokkan — sering
berbeda dari data dashboard.

Status pada kartu daftar bisa basi: kartu kadang masih tertulis "Menunggu konfirmasi" padahal
sudah disetujui. Halaman detail adalah kebenarannya — kalau di sana muncul kotak hijau
**"Permintaan Disetujui"**, item itu sudah selesai; kembali dan lanjut ke berikutnya.

## Langkah 3 — Cocokkan, tandai, ambil kode

```js
const a = await window.__mbDo('<keterangan>', '<nominal>', '<waktu pemakaian>', '<outlet>');
JSON.stringify(a.nomor ? await window.__mbWait(a.nomor) : a)
```

- **`OK`** → lanjut ke Langkah 4 memakai kode yang dikembalikan.
- **`NO-MATCH` / `AMBIGU` / `BUKAN-KAS` / `SUDAH-VERIF` / `TIMEOUT`** → **LEWATI**, catat
  untuk laporan, dan **jangan** menyetujui apa pun di Smartlink.

**Kelima kolom harus cocok semua.** Kembar itu nyata: sering ada baris dengan keterangan,
nominal, dan outlet identik yang hanya beda tanggal — mencocokkan sebagian akan menyetujui
baris yang salah.

Dua pola yang pasti tidak akan berpasangan:

- Biaya Smartlink yang **tidak punya bagian Keterangan sama sekali** (mis. Rp120.000 dengan
  "Item biaya: Air" sementara dashboard mencatatnya sebagai "Air Tong") — lewati dan laporkan.
- Baris dashboard berketerangan **Setoran Owner** — itu setoran, bukan pengeluaran, jadi tidak
  akan pernah muncul di Biaya Outlet. Abaikan, cukup sebut di laporan akhir.

Tombol `button.mb-verif` menyimpan sendiri ke server — **jangan** klik tombol "Simpan"; itu
milik kolom KETERANGAN KOREKSI. Penyimpanan bisa lebih dari 2 detik (`—` → `…` → `✓`), karena
itu `__mbWait` yang menunggunya. Jangan menyetujui di Smartlink sebelum statusnya `✓`.

## Langkah 4 — Setujui di Smartlink

1. Screenshot dulu, lalu klik **Setujui**. **Posisi tombolnya bergeser**: pada biaya tanpa blok
   Keterangan, tombol itu naik sekitar 130px. Tentukan koordinatnya dari screenshot, jangan
   dari hafalan.
2. Muncul dialog **"Setujui Permintaan"** dengan isian **Catatan (Opsional)**.
3. Klik isian itu, ketik **kode transaksi** (mis. `202602181322`).
4. Screenshot untuk memastikan kodenya benar-benar terketik, baru klik **Setujui** di dialog.
5. Tunggu notifikasi hijau **"Berhasil Mengonfirmasi Biaya Outlet."** Aplikasi kembali ke
   daftar, biasanya di posisi paling atas.

## Langkah 5 — Ulangi

Kembali ke Langkah 2 untuk kartu Menunggu konfirmasi berikutnya. Item yang dilewati tetap ada
di daftar, jadi simpan daftar item yang sudah dilewati (keterangan + nominal + tanggal) supaya
tidak diperiksa berulang. Selesai bila tidak ada lagi kartu "Menunggu konfirmasi" selain yang
memang dilewati.

## Aturan keras

- **JANGAN PERNAH klik "Tolak".** Item tanpa pasangan diserahkan ke Andre, bukan ditolak.
- Jangan mengarang kecocokan. Ragu = lewati.
- Jangan menyetujui di Smartlink sebelum verifikasi di dashboard benar-benar `✓`.
- Jangan mengisi kolom KETERANGAN KOREKSI kecuali Andre memintanya.

## Izin sebelum eksekusi

Tombol Setujui menyangkut uang dan tidak bisa dibatalkan. Sebelum item pertama disetujui,
tampilkan rencananya (berapa item menunggu, berapa baris dashboard belum terverifikasi,
aturan pencocokan yang dipakai) dan minta **satu persetujuan untuk seluruh batch**.
Cukup sekali per sesi, tidak perlu bertanya per item.

Kalau Andre menulis "cek saja" / "dry run", jalankan Langkah 1–3 tanpa mengklik apa pun —
laporkan pasangan yang ditemukan saja. Cara cepat menyusunnya: gulir daftar Smartlink sambil
screenshot (kartu sudah menampilkan keterangan, nominal, dan outlet), cocokkan ketiga kolom
itu ke daftar baris ber-`—`, lalu buka detail hanya untuk yang kembar atau yang tak
berpasangan.

## Laporan akhir

Tutup dengan ringkasan singkat:

- Berapa disetujui, dengan kode transaksi masing-masing
- Berapa dilewati, item apa saja, dan alasannya (tidak ada pasangan / ambigu / sumber bank /
  sudah terverifikasi / tanpa keterangan / Setoran Owner)
- Sisa "Menunggu konfirmasi" di Smartlink dan sisa baris `—` di dashboard:
  ```js
  const rows = window.__mbRows();
  JSON.stringify({verified: rows.filter(r=>r.ver==='✓').length,
    sisa: rows.filter(r=>r.ver==='—').map(r=>`${r.nomor} | ${r.ket} | ${r.nominal} | ${r.tgl} | ${r.outlet}`)})
  ```

Gunakan dua bahasa (Indonesia lalu Inggris) sesuai preferensi Andre.