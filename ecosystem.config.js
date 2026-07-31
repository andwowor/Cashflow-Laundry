// Konfigurasi PM2 untuk menjalankan dashboard di server (VPS Hostinger).
// Jalankan dari dalam folder proyek:
//     pm2 start ecosystem.config.js
//     pm2 save
//
// Catatan: variabel rahasia (password, API key, kredensial Google) TIDAK ditulis
// di sini — semuanya dibaca dari file .env oleh aplikasi. File ini hanya mengatur
// nama proses, lokasi, dan PORT tiap aplikasi.

module.exports = {
  apps: [
    {
      // ---- Dashboard laundry ini ----
      name: "laundry",
      script: "server.js",
      cwd: __dirname,
      env: {
        PORT: 3000,
      },
      max_memory_restart: "600M",
      time: true, // beri timestamp pada log
    },

    // ---- Dashboard KEDUA (aktifkan nanti bila sudah ada) ----
    // Salin proyek dashboard kedua ke server, lalu hapus tanda komentar di bawah
    // dan sesuaikan "cwd" ke folder proyeknya. Gunakan PORT berbeda (3001).
    // {
    //   name: "dashboard2",
    //   script: "server.js",
    //   cwd: "/home/coclean/Dashboard-Kedua",
    //   env: { PORT: 3001 },
    //   max_memory_restart: "600M",
    //   time: true,
    // },
  ],
};
