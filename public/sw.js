// Service worker minimal untuk Co Clean Laundry.
// Sengaja TIDAK men-cache apa pun: setiap permintaan selalu diambil dari jaringan
// agar tidak ada kode/data basi setelah update (git pull + restart). Keberadaan
// service worker dengan fetch handler ini cukup untuk membuat aplikasi installable.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {
  /* pass-through: biarkan browser mengambil dari jaringan seperti biasa */
});
