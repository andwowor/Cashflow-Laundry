# Deploy ke Hostinger (VPS)

Dashboard ini adalah aplikasi **Node.js (server berjalan terus)**, jadi **tidak bisa** di
Shared/Web Hosting Hostinger (itu untuk PHP/WordPress). Gunakan **Hostinger VPS**
(mis. paket KVM 1) yang memberi Anda server Linux dengan akses SSH.

Hasil akhir: dashboard online di `https://domain-anda.com`, berjalan 24 jam, terlindungi login.

---

## 0. Yang disiapkan
- Akun Hostinger + **VPS** (pilih template **Ubuntu 22.04**).
- (Disarankan) sebuah **domain/subdomain** untuk HTTPS. Tanpa domain pun bisa via `http://IP:3000` (kurang aman).
- API key Claude, file `service-account.json` Google, dan login dashboard (username/password).
- Kedua/ketiga spreadsheet sudah dibagikan ke email service account (BIAYA & KAS LAUNDRY,
  CASHFLOW bulan berjalan, dan ANALISA KEUANGAN).

---

## 1. Masuk ke VPS (SSH)
Dari panel Hostinger (hPanel) → VPS → **Browser terminal**, atau dari komputer:
```bash
ssh root@IP_VPS_ANDA
```

## 2. Pasang Node.js + Git
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git
node -v   # pastikan v20.x
```

## 3. Ambil kode (repo privat → pakai token GitHub)
Buat **Personal Access Token** di GitHub (Settings → Developer settings → Tokens, akses repo),
lalu:
```bash
cd /opt
git clone https://USERNAME:TOKEN@github.com/andwowor/Cashflow-Laundry.git
cd Cashflow-Laundry
git checkout claude/beautiful-bohr-8l57ky
npm install
```

## 4. Kredensial & konfigurasi
```bash
mkdir -p credentials
nano credentials/service-account.json   # tempel seluruh isi file service account, simpan (Ctrl+O, Enter, Ctrl+X)

cp .env.example .env
nano .env
```
Isi `.env` minimal:
```env
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_APPLICATION_CREDENTIALS=./credentials/service-account.json
BIAYA_KAS_SPREADSHEET_ID=17FSDZKdYnn3yl08lWDfTZaQZ-x2AhXn493HhVnfAZlY
ANALISA_SPREADSHEET_ID=1IsRwEzQ7xJdd0jpzxpGmvhBvx34CVuOElPFfyRs-5fM
TZ_NAME=Asia/Makassar
PORT=3000
DASHBOARD_USERNAME=admin
DASHBOARD_PASSWORD=password-kuat-anda
```

## 5. Jalankan permanen dengan PM2
```bash
npm install -g pm2
pm2 start server.js --name laundry
pm2 save
pm2 startup        # jalankan baris perintah yang ditampilkannya, lalu:
pm2 save
```
Uji sementara: buka `http://IP_VPS_ANDA:3000` (kalau firewall mengizinkan port 3000).

## 6. Domain + HTTPS (disarankan) — Nginx reverse proxy
1. Di DNS domain Anda (hPanel → Domains → DNS), buat **A record** mengarah ke **IP VPS**.
2. Pasang Nginx:
```bash
apt-get install -y nginx
nano /etc/nginx/sites-available/laundry
```
Isi:
```nginx
server {
    listen 80;
    server_name domain-anda.com;
    client_max_body_size 20M;   # untuk upload screenshot
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
3. Aktifkan + reload:
```bash
ln -s /etc/nginx/sites-available/laundry /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```
4. Pasang SSL gratis (Let's Encrypt):
```bash
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d domain-anda.com
```
Sekarang dashboard tersedia di `https://domain-anda.com` (login wajib). Cookie sesi otomatis
menjadi `Secure` karena aplikasi sudah `trust proxy` dan membaca `X-Forwarded-Proto`.

## 7. Firewall
```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'   # port 80 & 443
ufw enable
```
Jika pakai HTTPS via Nginx, **jangan** biarkan port 3000 terbuka ke publik (akses lewat domain saja).

---

## Operasional
| Tujuan | Perintah |
|---|---|
| Update kode terbaru | `cd /opt/Cashflow-Laundry && git pull origin claude/beautiful-bohr-8l57ky && npm install && pm2 restart laundry` |
| Lihat status | `pm2 status` |
| Lihat log | `pm2 logs laundry` |
| Restart (mis. ganti .env) | `pm2 restart laundry` |

## Catatan
- Data lokal (`data/`) tersimpan di disk VPS, jadi memori pembelajaran & status export tetap ada.
- Spreadsheet CASHFLOW bulanan tetap dideteksi otomatis (VPS punya akses internet).
- Karena ini data keuangan + saldo Claude, **gunakan HTTPS + password kuat**, dan rotasi API key bila pernah bocor.
