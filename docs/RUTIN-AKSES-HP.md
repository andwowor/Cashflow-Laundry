# Rutin Akses Dashboard dari HP (Mac + PM2 + Cloudflare quick tunnel)

Setup saat ini: dashboard (`laundry`) dan terowongan Cloudflare (`tunnel`) dijalankan
oleh PM2 di Mac. URL `trycloudflare.com` **berubah setiap kali Mac dinyalakan ulang
atau tunnel di-restart**, jadi tiap kali ingin akses dari HP, ambil URL terbaru.

> Syarat: Mac **menyala + terhubung internet**, dan tidak boleh tidur total saat dipakai.

---

## Setiap kali menyalakan Mac dan ingin buka dari HP

1. Nyalakan & login ke Mac, pastikan terhubung Wi-Fi/internet.
2. Buka **Terminal**.
3. Cek status:
   ```bash
   pm2 status
   ```
   - Kalau **laundry** dan **tunnel** sudah **online** → lanjut langkah 5.
   - Kalau daftar kosong / tidak online → pulihkan:
     ```bash
     pm2 resurrect
     ```
     lalu `pm2 status` lagi. Kalau `laundry`/`tunnel` masih belum ada, start manual:
     ```bash
     cd ~/Cashflow-Laundry
     pm2 start server.js --name laundry        # kalau laundry belum ada
     pm2 start cloudflared --name tunnel -- tunnel --url http://localhost:3000   # kalau tunnel belum ada
     pm2 save
     ```
4. (kalau perlu URL benar-benar baru) restart tunnel: `pm2 restart tunnel`
5. **Ambil URL terbaru** (tunggu ~10 detik setelah tunnel start):
   ```bash
   pm2 logs tunnel --nostream --lines 100
   ```
   Cari baris berisi `https://....trycloudflare.com`. (Kalau belum muncul, ulangi perintah ini.)
6. Buka URL itu di **browser HP** → login.
7. Agar Mac tidak tidur selama dipakai: buka Terminal baru → `caffeinate -s` (biarkan
   terbuka), atau atur di System Settings → Battery.

### Cara cepat (satu perintah) untuk dapat URL
```bash
pm2 logs tunnel --nostream --lines 100 | grep trycloudflare
```
Menampilkan baris URL-nya saja. (Kalau kosong, tunggu beberapa detik lalu ulangi.)

---

## Catatan
- **URL berubah** tiap restart Mac/tunnel → "Add to Home Screen" lama jadi kedaluwarsa;
  buka URL baru tiap kali (atau pakai URL tetap dgn domain sendiri / ngrok — lihat opsi
  yang sudah dijelaskan).
- Kalau HP tidak bisa buka: cek `pm2 status` (laundry & tunnel online?), pastikan Mac
  tidak tidur, dan URL yang dipakai adalah yang terbaru.
- Mac mati = tidak bisa diakses. Untuk akses 24 jam tanpa bergantung Mac → hosting
  (lihat `docs/DEPLOY-HOSTINGER.md`).
