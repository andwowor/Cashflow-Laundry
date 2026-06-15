# Akses Dashboard dari HP (tanpa hosting)

Dashboard berjalan di Mac Anda (PM2). Agar bisa dibuka dari HP, **Mac harus menyala
dan server berjalan**. Pilih salah satu cara di bawah sesuai kebutuhan.

> Prasyarat umum: pastikan server jalan (`pm2 status` → `laundry` online) dan login
> dashboard sudah diset (`DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD`). Agar Mac tidak
> tidur saat dipakai: System Settings → Lock Screen / Battery → atur "turn display off"
> lebih lama, atau jalankan `caffeinate -s` di terminal.

---

## Cara 1 — HP & Mac di Wi-Fi yang sama (paling cepat)
Cocok bila Anda mengakses dari rumah/kantor (jaringan yang sama dengan Mac).

1. Cari IP lokal Mac. Di terminal:
   ```bash
   ipconfig getifaddr en0   # mis. 192.168.1.10
   ```
   (kalau kosong, coba `ipconfig getifaddr en1`).
2. Di HP (terhubung Wi-Fi yang sama), buka browser:
   ```
   http://IP_MAC:3000      # mis. http://192.168.1.10:3000
   ```
3. Jika macOS menanyakan izin koneksi masuk untuk "node", pilih **Allow/Izinkan**.

Kelebihan: instan, tanpa aplikasi tambahan. Kekurangan: hanya di Wi-Fi yang sama,
dan koneksinya HTTP (aman-aman saja di jaringan pribadi).

---

## Cara 2 — Dari mana saja, privat & aman (DISARANKAN): Tailscale
Membuat "jaringan pribadi" antara Mac dan HP. Bisa diakses dari mana saja (termasuk
data seluler), terenkripsi, dan **tidak** membuka dashboard ke publik. Gratis untuk pribadi.

1. Di Mac: pasang Tailscale (https://tailscale.com/download atau `brew install --cask tailscale`),
   buka, **Sign in** (mis. dengan akun Google).
2. Di HP: pasang aplikasi **Tailscale** (App Store / Play Store), sign in dengan **akun yang sama**.
3. Di Mac, Tailscale memberi alamat seperti `100.x.y.z` (lihat di aplikasi Tailscale).
4. Di HP (Tailscale aktif/connected), buka:
   ```
   http://100.x.y.z:3000
   ```
   → muncul halaman login dashboard.

Kelebihan: aman (privat, hanya perangkat Anda), jalan dari mana saja. Kekurangan: HP perlu
aplikasi Tailscale aktif.

---

## Cara 3 — URL publik sementara: Cloudflare Tunnel
Memberi URL https publik yang bisa dibuka di HP dari mana saja. Dashboard tetap terlindungi
login. Cocok untuk akses cepat/sementara.

1. Di Mac: `brew install cloudflared`
2. Jalankan (biarkan terminal terbuka):
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```
3. Akan muncul URL seperti `https://random-kata.trycloudflare.com`. Buka URL itu di HP.

Catatan: URL berubah setiap kali perintah dijalankan ulang (kecuali pakai akun Cloudflare +
named tunnel untuk URL tetap). Karena dashboard punya login, akses tetap terkunci password.

---

## Kalau ingin permanen tanpa bergantung Mac menyala
Gunakan hosting (mis. Hostinger Node.js web apps hosting atau VPS) — lihat
`docs/DEPLOY-HOSTINGER.md`. Saat itu dashboard online 24 jam dengan domain + HTTPS.
