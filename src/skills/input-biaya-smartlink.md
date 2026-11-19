---
name: "input-biaya-smartlink"
description: "Jalankan saat Andre minta input biaya ke Smartlink: ambil baris biaya (bukan Setoran Owner) dari menu Lapor Smartlink, isi form Tambah Biaya di Biaya Outlet, lalu ubah status lapor jadi centang."
---

# Input Biaya ke Smartlink (Biaya Outlet)

Memindahkan tiap baris biaya yang masih ✘ di menu **Lapor Smartlink** (Dashboard Kas Laundry) menjadi
entri **Tambah Biaya di Outlet** di Smartlink, lalu menandai barisnya ✓. Milik Co Clean Laundry
(outlet Maumbi & Perkamil). Disusun dari panduan Andre `INPUT_BIAYA.docx`; uji coba pertama
19 Nov 2026 (Kuota Orbit Rp 180.000, Perkamil) berhasil.

| Langkah | Sumber | Tujuan |
|---|---|---|
| 1 | Lapor Smartlink (localhost) | daftar antrean + rencana, satu izin |
| 2 | Smartlink › Keuangan › Pengeluaran Biaya › Biaya Outlet › (+) › Tambah biaya | satu biaya per baris |
| 3 | kembali ke Lapor Smartlink | klik ✘ baris itu → ✓ |

**Beda dengan skill lain:** baris **Setoran Owner** di Lapor Smartlink milik `input-setoran-owner-smartlink`
(Pengambilan Prive). Skill ini **mengabaikannya total** — jangan disebut "dilewati".

## Data tetap

| Item | Nilai |
|---|---|
| Dashboard Kas Laundry | `http://localhost:3000/` — harus hidup; gagal dimuat → berhenti, minta Andre menyalakannya |
| Smartlink | `https://dashboard.smartlink.id/dashboard` (login owner) |
| Halaman form | aplikasi kedua `dashboard-vue.smartlink.id`, route `/biaya-outlet` → `/biaya-outlet/create` |

## Aturan isi form (dari panduan Andre — tidak boleh salah)

| Bagian form | Sumber (kolom Lapor Smartlink) | Cara isi |
|---|---|---|
| **Pilih Outlet** | OUTLET | **klik** box → **klik** pilihan. `MAUMBI` = *Co Clean Laundry Maumbi*, `PERKAMIL` = *Co Clean Laundry Perkamil* |
| **Nominal** | NOMINAL | klik box, **ketik** angka polos tanpa titik (`180000` → tampil `180.000`) |
| **Biaya dari akun** | SUMBER DANA | **klik** box → **klik** pilihan, pemetaan di bawah |
| **Untuk biaya** box 1 (*Pilih akun biaya…*) | ITEM BIAYA | **klik** box → **klik** pilihan yang namanya persis sama |
| **Untuk biaya** box 2 (*Item biaya…*) | SUB ITEM BIAYA | **klik** box → **klik** pilihan yang namanya persis sama |
| **Waktu pemakaian biaya** | TANGGAL | dari kalender, **tidak diketik** — Langkah 5e |
| **Penanggung jawab** | — | **klik** box → **klik** **Andre** (selalu) |
| **Catatan (Opsional)** | KETERANGAN | klik box, **ketik** teks KETERANGAN persis |

Pemetaan SUMBER DANA → *Biaya dari akun*:

| SUMBER DANA | Pilihan |
|---|---|
| BRI | Rekening BRI Andre |
| BNI | Rekening BNI Andre |
| BCA | Rekening BCA Andre |
| MANDIRI | Rekening Mandiri Andre |
| KAS TUNAI MAUMBI | Kas Outlet Co Clean Laundry Maumbi |
| KAS TUNAI PERKAMIL | Kas Outlet Co Clean Laundry Perkamil |

⚠️ Daftar akun juga berisi *Bank Mandiri*, *Bank BNI*, *Bank BCA a/n Betrix…*, *Bank BRI a/n Betrix…* —
**bukan** itu. Selalu yang berawalan **Rekening … Andre** / **Kas Outlet …**.

**Dropdown wajib klik, tidak boleh ketik** (aturan Andre). Kotak dropdown punya kolom cari, tapi jangan
diketik. Posisi pilihan dicari lewat DOM (helper `__opsi`), lalu diklik dengan mouse.

**Anomali** → lewati baris itu, lanjutkan yang lain, tanyakan di laporan akhir (keputusan Andre):
- OUTLET / SUMBER DANA di luar tabel pemetaan
- ITEM BIAYA atau SUB ITEM BIAYA kosong, tidak ada di dropdown, atau muncul lebih dari sekali
  (mis. *Lain-lain* ada 3× di *Biaya Produksi / Bahan Baku*)
- TANGGAL setelah hari ini, atau tidak terbaca
- Cek dobel (Langkah 4) menemukan biaya yang sama sudah ada di Smartlink
- Dua baris antrean identik (keterangan + nominal + tanggal + sumber sama) — helper status tidak bisa
  membedakannya

## Tab & kebiasaan tool (teruji 19 Nov 2026, tool side panel `mcp__claude-device__chrome_*`)

- **Tab Andre** (tab side panel) dipakai untuk Smartlink. Buka satu tab baru untuk
  **Dashboard Kas Laundry** dan sebutkan judulnya ke Andre. Tutup lagi di akhir.
- Smartlink bisa tampil versi **mobile** (lebar ±570 px, menu lewat tombol **Menu** di bawah). Form
  Biaya Outlet ada di iframe beda domain — **buka aplikasinya langsung sebagai halaman utama**
  (Langkah 2) supaya DOM-nya bisa dibaca.
- **Bingkai screenshot ≠ piksel CSS.** Mis. screenshot 511×1568 sementara `innerWidth` 568. Koordinat
  dari DOM dikali `k = lebar bingkai screenshot ÷ innerWidth` (helper `__k`). Set `window.__FW` ke lebar
  bingkai screenshot pertama.
- `browser_batch` jalan. Keluaran `javascript_tool` yang memuat `=`, `&`, `?` diblokir — ganti dengan
  `.replace(/[=&?]/g,'~')`. **Jangan pernah** mengembalikan URL iframe Smartlink (berisi token).
- Tab localhost: klik tab menu pakai `computer` (klik lewat JS pernah tidak jalan).
- Panggilan yang "gagal" kadang sudah terlanjur dijalankan — screenshot dulu sebelum mengulang.
- Halaman **Detail Pengeluaran Biaya** punya tombol **Hapus** — **jangan pernah diklik**.

## Langkah 0 — Antrean dari Lapor Smartlink

Tab localhost → klik tab **Lapor Smartlink** (`computer`), klik **Muat ulang**, tunggu ±5 detik, lalu:

```js
window.__slTable = () => Array.from(document.querySelectorAll('table')).find(t =>
  ((t.querySelector('tr')||{}).innerText||'').toUpperCase().includes('STATUS LAPOR APLIKASI SMARTLINK'));
window.__slNorm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g,'');
window.__slRows = () => Array.from(window.__slTable().querySelectorAll('tr')).slice(1).map(r => {
  const c = Array.from(r.children).map(x => x.innerText.trim().replace(/\s+/g,' '));
  const b = r.children[6].querySelector('button.sl-status');
  return { el:r, btn:b, subjek:c[1], ket:c[2], nominal:c[3], angka:c[3].replace(/[^0-9]/g,''),
           tgl:c[4], outlet:c[5], sumber:c[7], kode:c[8], item:c[9], sub:c[10],
           sudah: !!(b && b.classList.contains('sl-ok')) }; });
window.__biAntre = () => window.__slRows().filter(r => window.__slNorm(r.subjek) !== 'setoranowner'
  && window.__slNorm(r.ket) !== 'setoranowner' && !r.sudah);
window.__slCari = (ket, nominal, tgl, sumber) => window.__slRows().filter(r =>
  window.__slNorm(r.ket) === window.__slNorm(ket) && window.__slNorm(r.nominal) === window.__slNorm(nominal) &&
  window.__slNorm(r.tgl) === window.__slNorm(tgl) && window.__slNorm(r.sumber) === window.__slNorm(sumber));
window.__slTandai = (ket, nominal, tgl, sumber) => { const m = window.__slCari(ket, nominal, tgl, sumber);
  if (m.length !== 1) return {status: m.length === 0 ? 'NO-MATCH' : 'AMBIGU', n: m.length};
  if (m[0].sudah) return {status:'SUDAH'}; m[0].btn.click(); return {status:'DIKLIK'}; };
window.__slTunggu = async (ket, nominal, tgl, sumber, ms=12000) => { const t0 = Date.now();
  while (Date.now()-t0 < ms) { const m = window.__slCari(ket, nominal, tgl, sumber);
    if (m.length === 1 && m[0].sudah) return {status:'OK'}; await new Promise(s => setTimeout(s, 700)); }
  return {status:'TIMEOUT'}; };
'antre ' + window.__biAntre().length + ' dari ' + window.__slRows().length + '\n' + window.__biAntre().map(r =>
  [r.subjek, r.ket, r.nominal, r.tgl, r.outlet, r.sumber, r.item, r.sub].join(' | ')).join('\n')
```

Kolom (indeks sel): `0 checkbox | 1 SUBJEK BIAYA | 2 KETERANGAN | 3 NOMINAL | 4 TANGGAL | 5 OUTLET |
6 STATUS LAPOR APLIKASI SMARTLINK | 7 SUMBER DANA | 8 KODE TRANSAKSI | 9 ITEM BIAYA | 10 SUB ITEM BIAYA | 11 Edit`.
Status: `button.sl-status.sl-no` = ✘, `.sl-ok` = ✓. Di tabel ini **hanya tombol status** yang boleh diklik
(bukan ✎, checkbox, atau *Konfirmasi sembunyikan*).

Catat jumlah antrean awal untuk laporan. Simpan seluruh isi antrean (keterangan, nominal, tanggal,
outlet, sumber, item, sub item) — semua bagian form diisi dari catatan ini tanpa bolak-balik.

## Langkah 1 — Rencana & satu izin

Tampilkan tabel rencana, dua bahasa: tiap baris (outlet · nominal · akun · item › sub item · tanggal ·
catatan) + yang akan dilewati beserta alasannya. Tombol **Tambahkan** menyangkut uang dan tidak bisa
dibatalkan → **satu** AskUserQuestion: *Jalankan semua (Recommended)* / *Dry run saja*. Cukup sekali per run.

"Cek saja" / "dry run" → berhenti setelah rencana.

## Langkah 2 — Buka Biaya Outlet sebagai halaman utama

Tab Smartlink → `https://dashboard.smartlink.id/dashboard`, tunggu ±3 detik, lalu:
```js
const f = Array.from(document.querySelectorAll('iframe')).find(x => /dashboard-vue/.test(x.src));
f ? (() => { const u = new URL(f.src); u.pathname = '/biaya-outlet'; location.href = u.href; return 'pindah'; })() : 'iframe belum ada'
```
Tunggu ±5 detik → halaman **Biaya Outlet** (daftar kartu, ikon 🔍 kanan atas, tombol **+** biru kanan bawah).
`iframe belum ada` → buka **Menu › Keuangan › Pengeluaran Biaya › Biaya Outlet** dulu lewat menu
Smartlink, lalu ulangi.

## Langkah 3 — Pasang helper form (sekali per muat halaman; bertahan selama pindah halaman di aplikasi ini)

```js
window.__FW = 511; // lebar bingkai screenshot — sesuaikan dengan screenshot pertama
window.__k = () => window.__FW / innerWidth;
window.__vs = () => Array.from(document.querySelectorAll('.v-select')).map((v, i) => {
  const r = v.getBoundingClientRect(); const sel = v.querySelector('.vs__selected'); const inp = v.querySelector('.vs__search');
  return { i, ph: inp ? inp.placeholder : '', val: sel ? sel.innerText.trim() : '',
    x: Math.round((r.x + r.width/2) * window.__k()), y: Math.round((r.y + r.height/2) * window.__k()) }; });
window.__opsi = t => { const li = Array.from(document.querySelectorAll('.vs__dropdown-menu li.vs__dropdown-option'))
    .filter(l => l.innerText.trim() === t);
  if (li.length !== 1) return { status: li.length ? 'KEMBAR ' + li.length : 'TIDAK ADA' };
  li[0].scrollIntoView({ block: 'nearest' }); const r = li[0].getBoundingClientRect();
  return { status: 'OK', x: Math.round((r.x + r.width/2) * window.__k()), y: Math.round((r.y + r.height/2) * window.__k()) }; };
window.__pos = sel => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect();
  return Math.round((r.x + r.width/2) * window.__k()) + ',' + Math.round((r.y + r.height/2) * window.__k()); };
window.__bf = () => { const v = window.__vs().map(x => x.val); const d = document.getElementById('waktu-pemaikaian-biaya');
  const nom = document.querySelector('input[type=tel]'); const cat = document.querySelector('input[placeholder^=Catatan]');
  return { outlet: v[0], nominal: nom && nom.value, akun: v[1], biaya: v[2], item: v[3], waktu: d && d.value, pj: v[4], catatan: cat && cat.value }; };
'ok'
```

Elemen form (teruji): 5 `.v-select` berurutan **0 Pilih outlet · 1 Pilih akun · 2 Pilih akun biaya ·
3 Item biaya · 4 Pilih karyawan**; Nominal `input[type=tel]`; Waktu `#waktu-pemaikaian-biaya`
(`datetime-local`, `max` = hari ini 23:59); Catatan `input[placeholder^=Catatan]`; tombol **Tambahkan**.
Rujukan bingkai 511×1568 (CSS 568 lebar): outlet (256,105) · nominal (279,183) · akun (256,261) ·
akun biaya (256,338) · item (256,384) · ikon kalender (473,492) · penanggung jawab (256,587) ·
catatan (256,664) · Tambahkan (256,731). Tetap ambil dari helper.

## Langkah 4 — Cek dobel per baris (sebelum membuka form)

Di halaman Biaya Outlet: klik 🔍 kanan atas, klik kotak cari, ketik **SUB ITEM BIAYA** (kolom cari ini boleh
diketik — bukan bagian form; ia mencari nama akun, outlet, akun biaya, item biaya, karyawan), tunggu ±5 detik:
```js
document.body.innerText.slice(0, 2500)
```
Kartu hasil (terbaru dulu) berisi `Rp <nominal>` · `<akun biaya> • Co Clean Laundry <outlet>` ·
`Item biaya: …` · `tgl permintaan: …` · `Oleh <nama>` · **waktu pemakaian** · status. Ada kartu dengan
**nominal + outlet + item + tanggal waktu pemakaian** sama dengan baris → anomali "mungkin sudah diinput",
lewati. Tutup pencarian dengan ✕ kanan atas.

Ketikan pertama di kotak cari kadang tidak masuk (terjadi 3× pada 19 Nov, selalu sesaat setelah Tambahkan). Hasil `? hasil` atau `document.querySelector('input').value` kosong → klik kotak cari lagi dan ketik ulang.

Dua baris dengan item sama (mis. Biaya Admin 2.500 & 3.500, tanggal sama) cukup satu pencarian; cek nominal masing-masing.

## Langkah 5 — Isi form (satu baris per putaran)

Buka form persis seperti panduan: klik tombol **+** biru (`__pos('.flying-button')`), menu kecil muncul →
klik **Tambah biaya** (screenshot dulu untuk letaknya; ±(390,1384) pada bingkai 511×1568). Halaman
**Tambah Biaya di Outlet** (`/biaya-outlet/create`). Pasang helper Langkah 3 kalau belum ada.

Form bisa lama dimuat (19 Nov: spinner >30 detik karena API daftar akun biaya lambat). Tunggu dulu:
```js
const t0 = Date.now(); while (Date.now() - t0 < 40000 && document.querySelectorAll('.v-select').length < 5)
  await new Promise(s => setTimeout(s, 1000)); 'vs ' + document.querySelectorAll('.v-select').length
```
Baru klik setelah hasilnya `vs 5`. Masih kosong → `$router.back()`, buka **+ › Tambah biaya** lagi.

⚠️ Pernah terjadi: klik di posisi **+** dari screenshot justru membuka kartu di belakangnya (masuk
Detail dengan tombol Hapus). Selalu ambil posisi **+** dari `__pos('.flying-button')`. Salah masuk →
`document.querySelector('#app').__vue__.$router.back()`.

Untuk tiap dropdown: klik box (posisi dari `__vs()`), tunggu 1 detik, `JSON.stringify(__opsi('<teks persis>'))`
→ `OK` → klik koordinatnya. `KEMBAR`/`TIDAK ADA` → anomali: kembali (`$router.back()`), lewati baris.
Setelah tiap isian cek `JSON.stringify(__bf())`.

a. **Pilih Outlet** → *Co Clean Laundry Maumbi* / *Perkamil*.
b. **Nominal** → klik, ketik angka polos. `__bf().nominal` harus bertitik benar; dobel → `triple_click`, ketik ulang.
c. **Biaya dari akun** → pemetaan SUMBER DANA.
d. **Untuk biaya** → box 1 = ITEM BIAYA, tunggu ±2 detik (daftar box 2 dimuat), box 2 = SUB ITEM BIAYA.
e. **Waktu pemakaian biaya** (keputusan Andre 19 Nov 2026: ikon + panah kalender). Klik **ikon kalender**
   (ujung kanan kotak). Klik mouse pada tanggal di kalender **tidak tercatat** (kalender menutup, kotak
   kosong — teruji), jadi:
   1. Pastikan terbuka: `document.getElementById('waktu-pemaikaian-biaya').matches(':open')` = `true`.
   2. `ArrowLeft` lalu `ArrowRight` → kotak terisi **hari ini + jam sekarang**.
   3. Selisih hari d = hari ini − TANGGAL → `ArrowUp` ×⌊d/7⌋ (−7 hari) lalu `ArrowLeft` ×(d mod 7).
      Contoh teruji: hari ini 19 Nov → 17 Nov = `ArrowLeft` ×2 → `2026-11-17T11:06`.
   4. Tutup dengan **klik area kosong** (±255, 1100). **Jangan Enter/Escape.**
   5. `__bf().waktu` harus diawali `YYYY-MM-DD` milik TANGGAL. Jamnya biarkan.
   Kalender tidak mau terbuka (`:open` false; pernah terjadi 18 Nov) → cadangan: klik segmen tahun kotak,
   `ArrowUp ArrowRight ArrowUp ArrowRight ArrowUp ArrowRight ArrowUp ArrowRight ArrowUp` (→ `<tahun>-01-01T00:00`,
   kursor di menit), lalu menit `ArrowUp`×m · `ArrowLeft` · jam `ArrowDown`×(24−h) · `ArrowLeft` ·
   hari `ArrowUp`×(tgl−1) · `ArrowLeft` · bulan `ArrowDown`×(13−bulan); klik area kosong; cek. Tetap tanpa
   mengetik angka.
f. **Penanggung jawab** → *Andre*.
g. **Catatan** → klik, ketik KETERANGAN persis.

## Langkah 6 — Periksa, lalu Tambahkan

`JSON.stringify(__bf())` + screenshot harus persis: outlet, nominal, akun, item, sub item, tanggal,
`Andre`, catatan. Ada yang salah dan tidak bisa dibetulkan → `$router.back()` tanpa Tambahkan, lewati.

Semua benar → klik **Tambahkan** (posisi dari `getBoundingClientRect` tombolnya). Hasil teruji:
notifikasi hijau **"Berhasil Membuat Biaya Outlet"**, kembali ke daftar Biaya Outlet. Biaya buatan owner
langsung **Disetujui** (tidak perlu konfirmasi).

**Pastikan tersimpan lewat pencarian, bukan daftar** — daftar tanpa pencarian bisa basi (19 Nov: angka
"4816 Biaya" dan kartu teratas tidak berubah setelah Tambahkan). Cari SUB ITEM BIAYA (Langkah 4): kartu
teratas harus baru, `Oleh Andre`, nominal/outlet/item benar, waktu pemakaian = TANGGAL, **Disetujui**, dan
jumlah hasil naik 1. Ragu → buka kartunya: Detail menampilkan *Catatan: <KETERANGAN>*, Sumber dana,
Penanggung jawab Andre, Nominal, Waktu pemakaian, Akun & Item biaya. (*tgl permintaan* di kartu tampil
±1 jam lebih awal dari jam lokal — wajar.) Tidak ketemu → **jangan input ulang**; laporkan.

## Langkah 7 — Tandai ✓ di Lapor Smartlink

Tab localhost:
```js
const a = window.__slTandai('<KETERANGAN>', '<NOMINAL mis. Rp180.000>', '<TANGGAL mis. 17 November 2026>', '<SUMBER DANA>');
JSON.stringify(a.status === 'DIKLIK' ? await window.__slTunggu('<KETERANGAN>', '<NOMINAL>', '<TANGGAL>', '<SUMBER DANA>') : a)
```
`OK` → selesai untuk baris itu. `NO-MATCH`/`AMBIGU`/`TIMEOUT` → laporkan; biaya sudah tersimpan di Smartlink,
**jangan input ulang**. Lalu kembali ke Langkah 4 untuk baris berikutnya.

## Langkah 8 — Rapikan

Tab Smartlink → `https://dashboard.smartlink.id/dashboard` (jangan tinggal di halaman Detail yang ada tombol
Hapus). Tutup tab localhost yang Claude buka.

## Aturan keras

- Baris **Setoran Owner** tidak disentuh.
- Dropdown: **klik, tidak boleh ketik**. Tanggal: dari kalender (ikon + panah), **tidak mengetik angka**.
- **Jangan** klik **Hapus**, **Konfirmasi sembunyikan**, ✎ edit, atau checkbox di Lapor Smartlink.
- **Jangan** tekan Enter/Escape saat kalender terbuka.
- **Jangan** Tambahkan ulang sebelum memastikan lewat pencarian bahwa yang pertama memang tidak tersimpan.
- Satu baris = satu biaya. Ragu = lewati, catat, tanyakan di akhir.

## Laporan akhir (Indonesia lalu Inggris)

- Biaya yang dibuat: outlet · nominal · akun · item › sub item · tanggal · catatan, dan status ✓ di Lapor Smartlink
- Yang dilewati + alasannya (anomali, mungkin dobel, gagal tersimpan, gagal ditandai) — anomali ditanyakan
  lewat AskUserQuestion dengan opsi
- Sisa antrean: `window.__biAntre().map(r => [r.ket, r.nominal, r.tgl, r.outlet].join(' | ')).join('\n') || 'kosong'`
- Sisa baris Setoran Owner cukup disebut jumlahnya (milik skill `input-setoran-owner-smartlink`)