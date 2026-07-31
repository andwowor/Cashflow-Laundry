# Panduan Deploy Dashboard ke Hostinger (VPS)

Panduan lengkap memindahkan dashboard Cashflow Laundry dari Mac ke **VPS Hostinger**
supaya online 24 jam dengan **alamat tetap + HTTPS** — tidak perlu lagi tunnel
Cloudflare yang alamatnya berubah-ubah.

Ditulis untuk pengguna non-teknis. Ikuti langkah **A → I** berurutan. Perintah yang
diawali `$` diketik di terminal VPS (lewat SSH), tanpa mengetik tanda `$`-nya.

---

## 0. Yang perlu dibeli & perkiraan biaya

| Item | Rekomendasi | Perkiraan biaya* |
|---|---|---|
| **VPS Hostinger** | Paket **KVM 1** (1 vCPU, 4 GB RAM) cukup untuk 2 dashboard. Ambil **KVM 2** (2 vCPU, 8 GB) bila ingin lega. | ± Rp80.000–160.000 / bulan |
| **Sistem operasi** | **Ubuntu 24.04 LTS** (pilih saat setup VPS) | (gratis) |
| **Domain** | 1 domain saja, mis. `.com` atau `.id`. Dua dashboard berbagi domain ini lewat subdomain. | ± Rp150.000–250.000 / tahun |
| **HTTPS (SSL)** | Let's Encrypt via Certbot | **gratis** |

\* Harga sering promo — cek harga terkini di Hostinger. Langganan tahunan jauh lebih murah daripada bulanan.

> **Penting:** produk **Shared/Web Hosting** biasa (hPanel) **tidak** direkomendasikan untuk
> aplikasi ini (tidak ada PM2/proses latar, batas memori ketat). Pilih **VPS**.

### Rencana dua dashboard, satu domain

Misal domainmu `coclean.id`:

```
                         VPS Hostinger (1 IP)
                                │
                    ┌───────────┴───────────┐
                 Nginx (pintu masuk :80/:443)
                    │                       │
   laundry.coclean.id            dashboard2.coclean.id
        │                                   │
   app "laundry"  (port 3000)      app "dashboard2" (port 3001)
```

Satu VPS + satu domain menjalankan **dua** aplikasi. Tiap aplikasi punya PORT sendiri,
Nginx mengarahkan tiap subdomain ke aplikasi yang benar. Dashboard laundry ini dulu;
dashboard kedua ditambah kemudian (Langkah I).

---

## A. Beli & buat VPS

1. Beli **VPS** di Hostinger → saat setup pilih OS **Ubuntu 24.04 LTS**.
2. Buat **password root** (catat baik-baik) atau tambahkan SSH key.
3. Setelah aktif, catat **alamat IP** VPS (mis. `123.45.67.89`).

## B. Masuk ke VPS (SSH) & buat user

Dari Terminal di Mac:

```
ssh root@123.45.67.89        # ganti dengan IP VPS-mu; masukkan password root
```

Buat user non-root khusus aplikasi (lebih aman daripada memakai root):

```
$ adduser coclean            # buat password untuk user ini
$ usermod -aG sudo coclean
$ su - coclean               # pindah ke user coclean
```

> Selanjutnya semua perintah dijalankan sebagai user **coclean** (bukan root).

## C. Install Node.js, PM2, Nginx, Certbot

```
$ sudo apt update && sudo apt -y upgrade
$ curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
$ sudo apt install -y nodejs git nginx
$ sudo npm install -g pm2
$ sudo apt install -y certbot python3-certbot-nginx
$ node -v        # pastikan v20.x
```

## D. Ambil kode aplikasi

Repo ini **privat**, jadi butuh akses. Cara termudah — buat **Personal Access Token**
GitHub (read-only untuk repo ini) lalu clone:

```
$ cd ~
$ git clone https://github.com/andwowor/Cashflow-Laundry.git
    # Username: andwowor
    # Password: tempel Personal Access Token (bukan password GitHub biasa)
$ cd Cashflow-Laundry
$ git checkout claude/beautiful-bohr-8l57ky      # branch berisi versi terbaru
$ npm install --omit=dev
```

> Membuat token: GitHub → Settings → Developer settings → **Personal access tokens**
> → Fine-grained token → beri akses **Contents: Read-only** ke repo `Cashflow-Laundry`.
>
> **Alternatif tanpa git:** upload folder proyek dari Mac lewat SFTP (aplikasi seperti
> FileZilla / Cyberduck), lalu `npm install --omit=dev` di server.

## E. Siapkan konfigurasi rahasia (.env + kredensial Google)

```
$ cp .env.example .env
$ nano .env
```

Isi minimal berikut lalu simpan (Ctrl+O, Enter, Ctrl+X):

- `ANTHROPIC_API_KEY` — kunci API Claude.
- `DASHBOARD_PASSWORD` — password login dashboard (buat kuat).
- `SESSION_SECRET` — teks acak; buat dengan: `openssl rand -hex 32`
- `PORT=3000`
- `GOOGLE_APPLICATION_CREDENTIALS=/home/coclean/Cashflow-Laundry/credentials/service-account.json`

Lalu unggah file **service-account.json** ke folder `credentials/`:

```
$ mkdir -p ~/Cashflow-Laundry/credentials
# dari Mac (jendela terminal baru), kirim file kredensialmu:
#   scp "/path/ke/service-account.json" coclean@123.45.67.89:~/Cashflow-Laundry/credentials/
$ chmod 600 ~/Cashflow-Laundry/credentials/service-account.json ~/Cashflow-Laundry/.env
```

> ⚠️ Jangan pernah `git add` file `.env` atau `service-account.json` — keduanya sudah
> diabaikan git dan harus tetap rahasia.

## F. Jalankan dengan PM2

```
$ cd ~/Cashflow-Laundry
$ pm2 start ecosystem.config.js
$ pm2 save
$ pm2 startup            # jalankan perintah yang ditampilkannya (agar auto-start saat VPS reboot)
$ pm2 status             # pastikan "laundry" online
$ curl -I http://localhost:3000/login   # harus membalas HTTP 200/302
```

## G. Arahkan domain ke VPS (DNS)

Di panel domain (Hostinger → Domains → DNS/Nameserver), tambahkan **A record**:

| Type | Name (host) | Value (points to) |
|---|---|---|
| A | `laundry` | `123.45.67.89` (IP VPS) |

Ini membuat `laundry.namadomainmu` menunjuk ke VPS. (Perubahan DNS bisa perlu
beberapa menit sampai 1 jam untuk aktif.)

## H. Pasang Nginx reverse proxy + HTTPS

```
$ cd ~/Cashflow-Laundry
$ nano deploy/nginx-coclean.conf     # ganti "laundry.contohdomain.com" jadi subdomain aslimu
$ sudo cp deploy/nginx-coclean.conf /etc/nginx/sites-available/coclean.conf
$ sudo ln -s /etc/nginx/sites-available/coclean.conf /etc/nginx/sites-enabled/
$ sudo nginx -t                      # pastikan "syntax is ok"
$ sudo systemctl reload nginx
$ sudo certbot --nginx               # pilih subdomainmu → pasang HTTPS otomatis
```

Selesai! Buka **https://laundry.namadomainmu** di browser/HP — dashboard sudah online
dengan gembok HTTPS. Certbot juga otomatis memperpanjang SSL.

## I. Menambah dashboard kedua nanti

1. Upload/clone proyek dashboard kedua ke server (mis. `~/Dashboard-Kedua`), lalu
   `npm install --omit=dev` dan buat `.env`-nya dengan **`PORT=3001`**.
2. Di `ecosystem.config.js`, hapus komentar blok **dashboard2**, sesuaikan `cwd` &
   PORT, lalu: `pm2 start ecosystem.config.js && pm2 save`.
3. Tambah **A record** DNS baru: `dashboard2` → IP VPS.
4. Di `deploy/nginx-coclean.conf`, hapus komentar blok server kedua, ganti subdomain,
   lalu `sudo nginx -t && sudo systemctl reload nginx && sudo certbot --nginx`.

---

## Update kode di kemudian hari

Setiap ada perubahan baru:

```
$ cd ~/Cashflow-Laundry
$ git pull origin claude/beautiful-bohr-8l57ky
$ npm install --omit=dev        # bila ada paket baru
$ pm2 restart laundry
```

## Catatan keamanan

- File `.env` & `credentials/service-account.json` **rahasia** — jangan dibagikan / di-commit.
- Ganti `DASHBOARD_PASSWORD` dengan yang kuat sebelum online.
- Data lokal dashboard tersimpan di folder `data/` pada VPS (persisten, aman selama VPS ada).
  Untuk cadangan, salin folder `data/` secara berkala.
- Aktifkan firewall dasar bila mau: `sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable`.

## Butuh bantuan?

Bila ada langkah yang gagal (mis. `pm2 status` tidak online, atau Nginx error), salin
pesan errornya dan kirimkan — akan saya bantu perbaiki.
