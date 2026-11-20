/*
 * DIBUAT OTOMATIS — JANGAN DIUBAH MANUAL.
 * Salinan apa adanya dari Dashboard Internal (andwowor/Internal-Co-Clean-Laundry)
 * google-apps-script/Kode.gs @ d48577a, oleh scripts/sync-transaksi-internal.js.
 * Perbarui dengan menjalankan skrip itu lagi bila aturan pembacaan nota berubah di sana.
 *
 * Isi: labelKeOutletLK_, xlsxColNum_, KATA_PCS, parseKiloanKeterangan_, kataSudahDikenal_, frasaTakDikenal_, KATA_SARUNG_BANTAL, hitungSarungBantal_, SATUAN_BAJU, hitungSatuanBaju_, kataSatuanBaju_, parseSatuanBaris_, satuanKeTeks_, agregasiTransaksi_, KOLOM_KOREKSI_PCS, num_
 */
/* eslint-disable */

function labelKeOutletLK_(v) {
  var s = String(v || '').toUpperCase();
  if (s.indexOf('MAUMBI') >= 0) return 'MAUMBI';
  if (s.indexOf('PERKAMIL') >= 0) return 'PERKAMIL';
  return s;
}

function xlsxColNum_(ref) {
  var m = String(ref).match(/^([A-Z]+)/);
  if (!m) return 0;
  var letters = m[1], n = 0;
  for (var i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n;
}

// Baris KILOAN (kolom W diawali "Cuci"): ambil berat (kg) & jumlah pcs dari
// keterangan (kolom AB). Data sumber tidak konsisten, jadi:
//   - "10.080 kg" -> 10.08 kg
//   - "34.131" telanjang (tanpa "kg") -> 34.131 kg
//   - "4.826 pcs" (desimal salah label) -> dianggap kg
//   - "69 pcs" -> 69 pcs (angka desimal di depan "pcs" tidak dihitung sbg pcs)
/* Kata yang dipakai kasir untuk menyatakan JUMLAH POTONG pada baris kiloan.
 * Selain "pcs", di lapangan juga muncul singkatan dan padanan Indonesianya.
 * Urutan penting: "pcs" harus dicoba sebelum "pc" agar tidak terpotong.
 */
var KATA_PCS = '(?:pcs|pcx|psc|pcd|pc|picis|lcs|potong|ptg|lembar|lbr|helai|hlai|item)';

function parseKiloanKeterangan_(ab) {
  var s = String(ab || '');
  /* "4.492kg / 3o pcs" — huruf o diketik sebagai pengganti angka 0.
   * Hanya diperbaiki bila menempel pada angka DAN diikuti satuan pcs,
   * supaya kata biasa yang mengandung 'o' tidak ikut berubah. */
  s = s.replace(/(\d)[oO](?=[\s.]*(?:pcs|pc))/g, '$10');
  var kg = null, pcs = null;
  /* "32 kg / 6.454 kg" — yang bulat itu sebenarnya jumlah PCS yang salah
   * ketik satuannya (arti dari owner), yang berdesimal barulah beratnya.
   * Karena itu angka berdesimal didahulukan; angka bulatnya nanti terbaca
   * sebagai pcs di bawah, lengkap dengan catatan bahwa itu hasil terkaan. */
  var mkg = s.match(/(\d+\.\d+)\s*kg/i) || s.match(/(\d+(?:\.\d+)?)\s*kg/i);
  if (mkg) kg = parseFloat(mkg[1]);
  if (kg === null) {
    var mp = s.match(/(\d+\.\d+)\s*pcs/i);          // "4.826 pcs" -> kg
    if (mp) kg = parseFloat(mp[1]);
  }
  if (kg === null) {
    var lines = s.split(/[\n,]+/);
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (/^\d+\.\d{2,3}$/.test(t)) { kg = parseFloat(t); break; }  // "34.131"
    }
  }
  // Angka DI DEPAN: "16 pcs", "16pcs", "16 potong", "16 lbr".
  // Sengaja TANPA penjaga huruf di belakang, karena di data nyata satuan
  // sering menempel ke kalimat berikutnya ("3 pcstdk lntr" = 3 pcs).
  // Urutan di KATA_PCS menaruh "pcs" sebelum "pc" agar tidak terpotong.
  // "[\s.]*" — bukan hanya spasi — karena titik nyasar sering muncul:
  // "2.892 kg / 7.pcs" maksudnya 7 pcs.
  var mm = s.match(new RegExp('(^|[^\\d.])(\\d+)[\\s.]*' + KATA_PCS, 'i'));
  if (mm) pcs = parseInt(mm[2], 10);
  // angka DI BELAKANG: "pcs 16", "pcs: 16" — bentuk ini dulu tidak terbaca
  if (pcs === null) {
    var mb = s.match(new RegExp('(^|[^a-z])' + KATA_PCS + '\\s*[:.]?\\s*(\\d+)(?!\\s*\\d*\\s*kg)', 'i'));
    if (mb) pcs = parseInt(mb[2], 10);
  }

  /* Kasir kadang menulis jumlah potong TANPA satuan sama sekali, satu baris
   * sendiri. Contoh nyata di file rekap:
   *   "4.160kg / 25 / tdk luntur"          -> 25 pcs
   *   "47 + kos kaki stngh / 3.768 kg"     -> 47 pcs
   * Hanya diterima bila barisnya memang HANYA angka (boleh diikuti "+"),
   * supaya baris keterangan seperti "1 kaos kki stngh" — yang menerangkan
   * salah satu potong, bukan menghitungnya — tidak ikut terbaca sebagai pcs.
   */
  var barisPcsKg = null;
  if (pcs === null) {
    var brs = s.split(/\n/);
    for (var b = 0; b < brs.length; b++) {
      var baris = brs[b].trim();
      // "25" (hanya angka) atau "47 + kos kaki stngh" (angka lalu tanda +)
      var mAngka = baris.match(/^(\d+)\s*$/) || baris.match(/^(\d+)\s*\+/);
      if (mAngka) { pcs = parseInt(mAngka[1], 10); break; }
      /* "69 kg" pada baris KEDUA sementara beratnya sudah ketemu di baris lain:
       * berat laundry rumah tangga tidak ditulis bulat sebesar itu, jadi ini
       * hampir pasti salah ketik "pcs". Tetap dicatat agar bisa diperiksa. */
      var mKg = baris.match(/^(\d+)\s*kg\.?$/i);
      if (mKg && kg !== null && parseInt(mKg[1], 10) !== Math.round(kg)) {
        pcs = parseInt(mKg[1], 10);
        barisPcsKg = baris;
        break;
      }
    }
  }
  return { kg: kg, pcs: pcs, pcsDariKg: barisPcsKg };
}

/* Cari frasa "<angka> <kata>" pada keterangan yang BELUM ditangani sistem.
 *
 * Tujuannya bukan menebak artinya, melainkan MEMBUAT KEKURANGAN TERLIHAT.
 * Kasus "5 sb" dulu hilang tanpa jejak; dengan ini, satuan apa pun yang belum
 * dikenali akan dilaporkan pada hasil upload dan saat nomor notanya dicek,
 * sehingga owner tahu persis apa yang perlu ditambahkan.
 */
/* Disusun SAAT DIPANGGIL dari KATA_PCS dan KATA_SARUNG_BANTAL, bukan disalin
 * ulang. Salinan manual pernah membuat "pcd" dan "saban" tetap dilaporkan
 * sebagai satuan asing padahal keduanya sudah dikenali parser.
 */
function kataSudahDikenal_() {
  /* 'pcs?[a-z]{0,5}' menutup ekor huruf yang menempel pada satuan pcs:
   * "38 pca", "12 pcsa", "33 pcw", "53 pcsltdk" (= "53 pcs tidak ada yang
   * luntur"). Angkanya sendiri SUDAH terbaca benar oleh parseKiloanKeterangan_
   * — yang tersisa hanya laporannya, dan laporan palsu membuat peringatan
   * sungguhan ikut diabaikan. */
  return '(?:kg|kgkg|kilo(?:gram)?|pcs?[a-z]{0,5}|' +
    KATA_PCS.replace(/^\(\?:|\)$/g, '') + '|' +
    KATA_SARUNG_BANTAL.replace(/^\(\?:|\)$/g, '') + '|' +
    'sprei|seprai|seprei|spre|sprey|sp|selimut|slmut|slimut|slmt|selmt|' +
    'handuk|hdk|hnduk|' +
    'bed\\s*co?ve?r|bed\\s*cvr|bedcover|bdcvr|bd\\s*cvr|bec\\s*co?ve?r|' +
    'pasang|psg|psng|pasng|unit|' +
    // "1 satuan handuk" = 1 handuk. 'satuan' hanya kata sambung ke nama
    // barangnya, bukan satuan tersendiri — jadi dikenali tetapi tidak dihitung.
    'satuan|sataun|' +
    // Hanger disewakan untuk menggantung baju, bukan cucian. 'biaya' hanya
    // penanda keterangan ("2 biaya hanger"). Keduanya tidak menambah pcs.
    'hanger|hnger|hager|biaya|' +
    kataSatuanBaju_() + '|' +
    'hari|hr|jam|rb|ribu|k|x|kali)';
}

function frasaTakDikenal_(teks) {
  var KATA_SUDAH_DIKENAL = kataSudahDikenal_();
  var s = ' ' + String(teks || '').toLowerCase().replace(/[()\[\];\/]/g, ' ') + ' ';
  // Ambil SAMPAI DUA KATA supaya satuan bernama ganda ("bed cover",
  // "sarung bantal") tidak terpotong menjadi "bed" lalu salah dilaporkan.
  // '.' ikut dikecualikan agar bagian desimal ('1.732kgkg') tidak
  // salah dilaporkan sebagai '732 kgkg'.
  var re = /(?:^|[^a-z0-9.])(\d+)[ \t]*([a-z]+(?:[ \t]+[a-z]+)?)\.?/g;
  var reDikenal = new RegExp('^' + KATA_SUDAH_DIKENAL + '\\.?$', 'i');
  var out = [], sudah = {}, m;
  while ((m = re.exec(s)) !== null) {
    var duaKata = m[2].replace(/[.\s]+$/, '').trim();
    var satuKata = duaKata.split(/[ \t]+/)[0];
    if (!satuKata || satuKata.length < 2) continue;
    if (reDikenal.test(duaKata) || reDikenal.test(satuKata)) continue;
    var frasa = m[1] + ' ' + satuKata;
    if (sudah[frasa]) continue;
    sudah[frasa] = true;
    out.push(frasa);
  }
  return out;
}

/* Hitung sarung bantal tambahan yang hanya tertulis di keterangan (kolom AB).
 *
 * Kasir menulisnya bermacam-macam: "8 sarban", "sb 5", "sb. 5", "5 sb", "5sb",
 * "5 sarung bantal". Versi sebelumnya hanya mengenali bentuk dengan angka DI
 * BELAKANG singkatan, sehingga "5 sb" pada nota <nota> hilang
 * diam-diam dan total pcs nota berkurang 5.
 *
 * Ditangani dua arah sekaligus, dengan penjaga agar "sb" di dalam kata lain
 * (mis. "sbr") tidak ikut tertangkap.
 */
var KATA_SARUNG_BANTAL = '(?:sarung\\s*bantal|sr(?:u|)ng\\s*bantal|srg\\s*bantal|sarban|saban|sb)';

function hitungSarungBantal_(teks) {
  var s = ' ' + String(teks || '').toLowerCase().replace(/[()\[\],;\/]/g, ' ') + ' ';
  /* Penyaring cepat: harus memuat SEMUA awalan yang dipakai
   * KATA_SARUNG_BANTAL. Penjaga ini pernah gagal diam-diam — saat ejaan
   * "srung bantal" ditambahkan, penyaringnya masih hanya memeriksa 'sa'/'sb',
   * sehingga "4 sprei / 6 srung bantal" berhenti di sini dan 6 sarung
   * bantalnya hilang TANPA peringatan apa pun. Menambah ejaan baru berarti
   * memeriksa baris ini juga. */
  if (s.indexOf('sa') < 0 && s.indexOf('sb') < 0 && s.indexOf('sr') < 0) return 0;
  var total = 0, m;
  // angka DI DEPAN: "5 sb", "5sb", "8 sarban", "5 sarung bantal"
  var reDepan = new RegExp('(?:^|[^a-z0-9])(\\d+)\\s*' + KATA_SARUNG_BANTAL + '(?![a-z])', 'g');
  while ((m = reDepan.exec(s)) !== null) total += parseInt(m[1], 10);
  // angka DI BELAKANG: "sb 5", "sb. 5", "sarban 5"
  var reBelakang = new RegExp('(?:^|[^a-z0-9])' + KATA_SARUNG_BANTAL + '\\s*\\.?\\s*(\\d+)', 'g');
  while ((m = reBelakang.exec(s)) !== null) total += parseInt(m[1], 10);
  return total;
}

/* ---- Satuan baju yang ditulis kasir di kolom keterangan --------------------
 * Selain sarung bantal, kasir juga menuliskan potong baju satuan pada
 * keterangan: "26 sarung", "1 taplak", "1 kemeja, 1 rok, 2 jaket, 1 gaun",
 * "2 kaos". Sebelumnya semuanya dilaporkan "satuan belum dikenali" dan tidak
 * ikut terhitung, sehingga jumlah pcs nota berkurang diam-diam.
 *
 * Dihitung dengan cara yang SAMA seperti sarung bantal — yang sudah dipakai
 * dan diterima sejak awal: angka boleh di depan ("2 kaos") maupun di belakang
 * ("kaos 2"), dan setiap keterangan yang sama persis hanya dihitung sekali per
 * nota.
 *
 * Daftar ini sengaja berupa satu tempat saja supaya ejaan baru cukup
 * ditambahkan di sini. `pola` tidak boleh menangkap kata lain yang lebih
 * panjang: 'sarung' diberi penjaga agar "sarung bantal" tetap milik
 * hitungSarungBantal_ dan tidak terhitung dua kali.
 * -------------------------------------------------------------------------- */
var SATUAN_BAJU = [
  // 'Kaos kaki' HARUS berada sebelum 'Kaos', dan 'Kaos' diberi penjaga,
  // supaya "2 kaos kaki" tidak terhitung sebagai 2 kaos biasa.
  { jenis: 'Kaos kaki', pola: '(?:kaos|kaus|kos)\\s*(?:kaki|kki)' },
  { jenis: 'Kaos', pola: 'kaos(?!\\s*k)|kaus(?!\\s*k)|kos(?!\\s*k)|t\\s*-?\\s*shirt' },
  { jenis: 'Kemeja', pola: 'kemeja|kmja|kmeja|hem' },
  { jenis: 'Celana', pola: 'celana|clana|clna|cln' },
  { jenis: 'Rok', pola: 'rok' },
  { jenis: 'Jaket', pola: 'jaket|jacket|jkt' },
  { jenis: 'Gaun', pola: 'gaun|dress' },
  { jenis: 'Jas', pola: 'jas(?!\\s*hujan)|jaz|blazer' },
  { jenis: 'Sweater', pola: 'sweater|swetter|hoodie' },
  { jenis: 'Batik', pola: 'batik' },
  { jenis: 'Kebaya', pola: 'kebaya' },
  { jenis: 'Daster', pola: 'daster' },
  { jenis: 'Mukena', pola: 'mukena|mukenah' },
  { jenis: 'Sajadah', pola: 'sajadah|sejadah|sejada' },
  { jenis: 'Taplak', pola: 'taplak|tplk' },
  { jenis: 'Gorden', pola: 'gorden|gordyn|gordeng|korden' },
  { jenis: 'Karpet', pola: 'karpet|karpe?t' },
  { jenis: 'Keset', pola: 'keset' },
  { jenis: 'Boneka', pola: 'boneka' },
  { jenis: 'Guling', pola: 'guling' },
  // 'sarung' TANPA 'bantal' — sarung bantal punya penghitungnya sendiri.
  // Ejaan singkat kasir (srg/srung/srng) diberi penjaga yang sama.
  { jenis: 'Sarung', pola: 'sarung(?!\\s*bantal)|sarong|srg(?!\\s*bantal)|srung(?!\\s*bantal)|srng(?!\\s*bantal)' },

  /* Jenis di bawah ini ditambahkan 28 Agu 2026 dari daftar arti yang
   * diberikan owner setelah menelaah 4.088 nota Des 2025 - Apr 2026. */
  { jenis: 'Toga', pola: 'toga' },
  { jenis: 'Tas', pola: 'tas(?!\\s*jid)' },
  { jenis: 'Bantal', pola: 'bantal' },
  { jenis: 'Kain', pola: 'kain' },
  { jenis: 'Gendongan', pola: 'gendongan' },
  { jenis: 'Set', pola: 'set' },
  // "1 sepatu" berarti 1 PASANG sepatu (arti dari owner); bentuk
  // "2 pasang sepatu" dan "sepatu 2 psng" menghasilkan angka yang sama.
  { jenis: 'Sepatu', pola: '(?:pasang\\s*|psng\\s*|psg\\s*)?sepatu' },
  { jenis: 'Sorban', pola: 'sorban|srbn|saeban' }
];

/* Semua satuan baju pada satu teks keterangan -> { Jenis: jumlah }. */
function hitungSatuanBaju_(teks) {
  var s = ' ' + String(teks || '').toLowerCase().replace(/[()\[\],;\/]/g, ' ') + ' ';
  var out = {};
  SATUAN_BAJU.forEach(function (d) {
    var total = 0, m;
    var kata = '(?:' + d.pola + ')';

    /* Angka DI DEPAN dulu ("2 kaos", "2kaos"). Bagian yang sudah terbaca
     * DIKOSONGKAN sebelum mencari bentuk sebaliknya — kalau tidak, pada
     * "3 sarung 5 sarung bantal" angka 5 terbaca dua kali: sekali sebagai
     * milik "sarung" di depannya, sekali lagi oleh sarung bantal. Panjang
     * teksnya dijaga tetap sama supaya posisi kata lain tidak bergeser. */
    var reDepan = new RegExp('(?:^|[^a-z0-9])(\\d+)\\s*' + kata + '(?![a-z])', 'g');
    var sisa = s, potong = [];
    while ((m = reDepan.exec(s)) !== null) {
      total += parseInt(m[1], 10);
      potong.push([m.index, m.index + m[0].length]);
    }
    for (var i = potong.length - 1; i >= 0; i--) {
      var a = potong[i][0], b = potong[i][1];
      sisa = sisa.slice(0, a) + new Array(b - a + 1).join(' ') + sisa.slice(b);
    }

    // angka DI BELAKANG: "kaos 2", "kaos. 2"
    var reBelakang = new RegExp('(?:^|[^a-z0-9])' + kata + '\\s*\\.?\\s*(\\d+)', 'g');
    while ((m = reBelakang.exec(sisa)) !== null) total += parseInt(m[1], 10);
    if (total > 0) out[d.jenis] = (out[d.jenis] || 0) + total;
  });

  /* "70 pcs + kaos kaki stngah" — kasir menyebut kaos kakinya TANPA angka.
   * Aturan owner: sebutan tanpa angka berarti SATU potong (sebelah, bukan
   * sepasang), sehingga nota itu bernilai 71 pcs, bukan 70. */
  if (!out['Kaos kaki'] && /(?:kaos|kaus|kos)\s*(?:kaki|kki)/.test(s)) {
    out['Kaos kaki'] = 1;
  }
  return out;
}

// Kata satuan baju untuk penyaring "belum dikenali" — supaya yang sudah bisa
// dihitung tidak lagi dilaporkan sebagai tidak dikenal.
function kataSatuanBaju_() {
  return SATUAN_BAJU.map(function (d) { return d.pola; }).join('|');
}

// Baris SATUAN (kolom W diawali "Satuan ..."): tentukan jenis layanan dari W dan
// jumlah utamanya dari kolom AA (Jumlah Item) / X. Sarung bantal TIDAK dihitung
// di sini — lihat agregasiTransaksi_, karena catatannya bisa menempel di baris
// kiloan maupun baris satuan dan harus dihitung sekali saja per nota.
function parseSatuanBaris_(w, aa, x, ab) {
  var wl = String(w || '').toLowerCase();
  var abl = String(ab || '').toLowerCase();
  var qty = num_(aa) > 0 ? Math.round(num_(aa)) : Math.round(num_(x));
  var jenis = '';
  if (/handuk/.test(wl)) jenis = 'Handuk';
  else if (/bed\s*co?ve?r|bed\s*cvr/.test(wl)) jenis = 'Bed cover';
  else if (/selimut/.test(wl) && !/sprei/.test(abl)) jenis = 'Selimut';
  else if (/sprei|selimut/.test(wl)) jenis = /selimut/.test(abl) && !/sprei/.test(abl) ? 'Selimut' : 'Sprei';
  else jenis = 'Satuan';
  if (qty <= 0) qty = 1;
  return [{ jenis: jenis, jumlah: qty }];
}

// Gabungkan rincian satuan {jenis->jumlah} jadi teks "8 sarban, 2 sprei, ...".
function satuanKeTeks_(map) {
  var urut = ['Sarban', 'Sprei', 'Selimut', 'Handuk', 'Bed cover', 'Satuan'];
  var label = { 'Sarban': 'sarban', 'Sprei': 'sprei', 'Selimut': 'selimut',
    'Handuk': 'handuk', 'Bed cover': 'bed cover', 'Satuan': 'satuan' };
  var parts = [];
  urut.forEach(function (k) { if (map[k]) parts.push(map[k] + ' ' + label[k]); });
  Object.keys(map).forEach(function (k) { if (urut.indexOf(k) < 0 && map[k]) parts.push(map[k] + ' ' + k.toLowerCase()); });
  return parts.join(', ');
}

// Agregasi per-nota dari baris xlsx. Kolom: B(2)=No Nota, C(3)=Customer,
// G(7)=Outlet, H(8)=Tgl Terima, I(9)=Tgl Selesai, O(15)=Total, W(23)=Nama layanan,
// X(24)=Jumlah, Y(25)=Satuan, AA(27)=Jumlah Item, AB(28)=Keterangan.
function agregasiTransaksi_(rows) {
  var headerR = -1;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].cells[2] || '').trim().toUpperCase() === 'NO NOTA') { headerR = rows[i].r; break; }
  }
  if (headerR < 0) throw new Error('Kolom "No Nota" tidak ditemukan pada file. Pastikan file rekap transaksi yang benar.');

  var byNota = {};
  rows.forEach(function (ro) {
    if (ro.r <= headerR + 1) return; // lewati header + sub-header
    var nota = String(ro.cells[2] || '').trim();
    if (!nota || nota.toUpperCase() === 'NO NOTA') return;

    var w = String(ro.cells[23] || '');   // W nama layanan
    var y = String(ro.cells[25] || '');    // Y satuan (Load/KG/Pasang/PCS/Unit)
    var ab = String(ro.cells[28] || '');   // AB keterangan
    var x = num_(ro.cells[24]);             // X jumlah
    var aa = num_(ro.cells[27]);            // AA jumlah item (satuan)

    if (!byNota[nota]) {
      byNota[nota] = {
        nota: nota, customer: String(ro.cells[3] || ''), outlet: labelKeOutletLK_(ro.cells[7]),
        tglTerima: String(ro.cells[8] || ''), tglSelesai: String(ro.cells[9] || ''),
        total: num_(ro.cells[15]), pcs: 0, kg: 0, satuanMap: {}, pcsSatuan: 0,
        adaCucian: false, ketLain: [], ketLainSudah: {},
        sbTeks: {}, sbTotal: 0, bajuTotal: {}, ketAsli: [],
        catatan: [], takDikenal: {}, kiloanTanpaPcs: 0, pcsDariKg: {}
      };
    }
    var g = byNota[nota];
    if (!g.customer && ro.cells[3]) g.customer = String(ro.cells[3]);
    if (!g.total && ro.cells[15]) g.total = num_(ro.cells[15]);

    /* Sarung bantal bisa dicatat pada keterangan baris MANA PUN — kadang di
     * baris satuan ("2 sprei / 8 sarban"), kadang menempel di baris kiloan
     * ("14 pcs / 5 sb"). Karena itu dihitung di tingkat NOTA, bukan per baris.
     * Keterangan yang sama persis pada beberapa baris hanya dihitung sekali,
     * supaya catatan yang diulang oleh aplikasi kasir tidak menggandakan pcs.
     */
    var sbKunci = String(ab || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (sbKunci && !g.sbTeks[sbKunci]) {
      g.sbTeks[sbKunci] = true;
      g.sbTotal += hitungSarungBantal_(ab);
      // Satuan baju yang ditulis di keterangan ikut dihitung di tingkat NOTA,
      // dengan aturan sekali-per-teks yang sama seperti sarung bantal.
      var baju = hitungSatuanBaju_(ab);
      for (var jns in baju) g.bajuTotal[jns] = (g.bajuTotal[jns] || 0) + baju[jns];
      // frasa jumlah yang belum dikenali sistem — dilaporkan, bukan dibuang
      frasaTakDikenal_(ab).forEach(function (f) { g.takDikenal[f] = true; });
      // teks aslinya disimpan supaya pola penulisan kasir bisa ditelusuri lagi
      if (g.ketAsli.length < 6) g.ketAsli.push(String(ab).trim());
    }

    /* Keterangan baris NON-kiloan disimpan sebagai cadangan: kasir kadang
     * menuliskan jumlah pcs cucian kiloan di baris layanan lain pada nota yang
     * sama (mis. "20.000kg" di satu baris, "1 sprey / 70 pcs + kaos kaki
     * stngah" di baris berikutnya). Dipakai hanya kalau baris kiloannya benar-
     * benar tidak memuat angka pcs sendiri — lihat di bawah. */
    var isSatuan = /^\s*satuan/i.test(w);
    var pcsBarisIni = 0, jenisBarisIni = [];
    if (isSatuan) {
      g.adaCucian = true;
      var items = parseSatuanBaris_(w, aa, x, ab);
      items.forEach(function (it) {
        g.satuanMap[it.jenis] = (g.satuanMap[it.jenis] || 0) + it.jumlah;
        g.pcsSatuan += it.jumlah;
        pcsBarisIni += it.jumlah;
        jenisBarisIni.push(it.jenis);
      });
    }
    if (isSatuan || /^\s*biaya/i.test(w)) {
      var kunciLain = String(ab || '').trim().toLowerCase().replace(/\s+/g, ' ');
      if (kunciLain && !g.ketLainSudah[kunciLain]) {
        g.ketLainSudah[kunciLain] = true;
        // pcsBaris/jenisBaris disimpan karena angka pcs yang ditulis kasir di
        // baris ini biasanya sudah MENCAKUP barang baris ini sendiri.
        g.ketLain.push({ teks: String(ab || ''), pcsBaris: pcsBarisIni, jenisBaris: jenisBarisIni });
      }
    }
    if (isSatuan) {
      // (perhitungan satuan sudah dikerjakan di atas)
    } else if (/^\s*biaya/i.test(w)) {
      // "Biaya Hanger" dll bukan layanan satuan cucian -> abaikan dari hitungan pcs.
      // adaCucian sengaja TIDAK diubah: nota yang isinya hanya biaya memang
      // bernilai 0 pcs, dan itu benar — bukan data yang hilang.
    } else {
      g.adaCucian = true;
      // baris kiloan (Cuci ...)
      var kk = parseKiloanKeterangan_(ab);
      var kg = kk.kg, pcs = kk.pcs;
      if (kg === null && /kg/i.test(y)) kg = x;   // silang-cek X/Y
      if (pcs === null && /pcs/i.test(y)) pcs = Math.round(x);
      g.pcs += pcs || 0;
      g.kg += kg || 0;
      // Ada berat tetapi jumlah potongnya tidak terbaca — dulu diam-diam
      // tersimpan 0 pcs. Baris layanan lain (mis. cuci sepatu) yang memang
      // tidak berbobot TIDAK ikut ditandai di sini.
      if ((pcs === null || pcs === 0) && (kg || 0) > 0) g.kiloanTanpaPcs++;
      // Jumlah potong terbaca dari baris ber-"kg" yang kemungkinan salah ketik.
      if (kk.pcsDariKg) g.pcsDariKg[kk.pcsDariKg] = true;
    }
  });
  return Object.keys(byNota).map(function (k) {
    var g = byNota[k];
    if (g.sbTotal > 0) {
      g.satuanMap['Sarban'] = (g.satuanMap['Sarban'] || 0) + g.sbTotal;
      g.pcsSatuan += g.sbTotal;
    }
    for (var jenisBaju in g.bajuTotal) {
      g.satuanMap[jenisBaju] = (g.satuanMap[jenisBaju] || 0) + g.bajuTotal[jenisBaju];
      g.pcsSatuan += g.bajuTotal[jenisBaju];
    }
    g.keteranganAsli = g.ketAsli.join(' | ');
    g.satuan = satuanKeTeks_(g.satuanMap);
    g.totalPcs = g.pcs + g.pcsSatuan;

    /* Penyelamat terakhir: baris kiloan tidak memuat jumlah pcs, tetapi baris
     * lain pada nota yang sama memuatnya. Syaratnya ketat — g.pcs harus MASIH
     * NOL, artinya tidak ada satu pun baris kiloan yang sudah menyumbang
     * angka. Tanpa syarat itu, nota dengan beberapa baris kiloan bisa
     * terhitung dua kali. Nilai yang dipungut tetap dilaporkan supaya bisa
     * diperiksa, bukan diterima diam-diam. */
    if (g.kiloanTanpaPcs && g.pcs === 0 && g.ketLain.length) {
      for (var iL = 0; iL < g.ketLain.length; iL++) {
        var sumber = g.ketLain[iL];
        var pungut = parseKiloanKeterangan_(sumber.teks);
        if (pungut.pcs !== null && pungut.pcs > 0) {
          g.pcs += pungut.pcs;
          /* Angka itu ditulis kasir pada baris layanan satuan, dan pada data
           * nyata ia sudah MENCAKUP barang baris itu sendiri: nota
           * <nota> berbunyi "1 sprey / 70 pcs + kaos kaki stngah"
           * dan owner menegaskan totalnya 71 (70 termasuk sprei, ditambah
           * 1 kaos kaki), bukan 72. Karena itu sumbangan baris tersebut
           * dikurangkan supaya tidak terhitung dua kali. Barang yang ditulis
           * sebagai TAMBAHAN ("+ kaos kaki") tetap dihitung karena ia dibaca
           * dari keterangan, bukan dari kolom terstruktur baris ini. */
          if (sumber.pcsBaris > 0) {
            g.pcsSatuan -= sumber.pcsBaris;
            sumber.jenisBaris.forEach(function (jn) {
              g.satuanMap[jn] = (g.satuanMap[jn] || 0) - 1;
              if (g.satuanMap[jn] <= 0) delete g.satuanMap[jn];
            });
            g.satuan = satuanKeTeks_(g.satuanMap);
          }
          g.totalPcs = g.pcs + g.pcsSatuan;
          g.kiloanTanpaPcs = 0;
          g.catatan.push('jumlah pcs (' + pungut.pcs + ') diambil dari keterangan ' +
            'baris lain pada nota yang sama' +
            (sumber.pcsBaris > 0 ? ' — angka itu dianggap sudah mencakup barang baris tersebut' : ''));
          break;
        }
      }
    }

    if (g.kiloanTanpaPcs) {
      g.catatan.push('jumlah pcs cucian kiloan tidak terbaca dari keterangan');
    } else if (g.totalPcs === 0 && g.adaCucian) {
      g.catatan.push('nota ini tercatat 0 pcs — keterangannya tidak memuat jumlah apa pun');
    }
    /* Nota yang isinya HANYA biaya tambahan (mis. "Biaya Hanger" 2 pcs seharga
     * Rp10.000) memang bernilai 0 pcs cucian. Dulu ikut ditandai "perlu dicek",
     * dan owner sempat menduga keterangannya hilang — padahal notanya utuh:
     * pelanggan hanya membeli/menyewa hanger, tidak menitipkan cucian. */
    var dariKg = Object.keys(g.pcsDariKg);
    if (dariKg.length) {
      g.catatan.push('jumlah pcs dibaca dari "' + dariKg.join('", "') +
        '" (kemungkinan salah ketik, seharusnya pcs)');
    }
    var sisa = Object.keys(g.takDikenal);
    if (sisa.length) {
      g.catatan.push('satuan belum dikenali: ' + sisa.join(', '));
    }
    g.catatan = g.catatan.join(' • ');

    delete g.adaCucian; delete g.ketLain; delete g.ketLainSudah;
    delete g.satuanMap; delete g.sbTeks; delete g.sbTotal;
    delete g.bajuTotal; delete g.ketAsli;
    delete g.takDikenal; delete g.kiloanTanpaPcs; delete g.pcsDariKg;
    return g;
  });
}

// Kolom hasil koreksi manual; dipertahankan saat file transaksi di-upload ulang.
var KOLOM_KOREKSI_PCS = ['TOTAL PCS KOREKSI', 'ALASAN KOREKSI PCS', 'DIKOREKSI OLEH', 'WAKTU KOREKSI PCS'];

// Menerima angka, 'Rp30.000', '(1.324.124)', '-31.475.275', desimal '12,5'
function num_(v) {
  if (typeof v === 'number') return v;
  if (v === '' || v === null || v === undefined) return 0;
  var s = String(v).trim();
  var neg = /^\(.*\)$/.test(s) || s.indexOf('-') >= 0;
  s = s.replace(/[^\d.,]/g, '');
  if (!s) return 0;
  var n;
  // pola ribuan Indonesia (30.000 / 1.324.124) dengan desimal 1-2 digit opsional
  var m = s.match(/^(\d{1,3}(?:[.]\d{3})+|\d+)(?:[,](\d{1,2}))?$/);
  if (m) {
    n = parseFloat(m[1].replace(/\./g, '') + (m[2] ? '.' + m[2] : ''));
  } else if (/^\d+\.\d{1,2}$/.test(s)) {
    n = parseFloat(s); // desimal gaya 12.5
  } else {
    n = parseFloat(s.replace(/\./g, '').replace(',', '.'));
  }
  if (isNaN(n)) return 0;
  return neg ? -n : n;
}

module.exports = { labelKeOutletLK_, xlsxColNum_, KATA_PCS, parseKiloanKeterangan_, kataSudahDikenal_, frasaTakDikenal_, KATA_SARUNG_BANTAL, hitungSarungBantal_, SATUAN_BAJU, hitungSatuanBaju_, kataSatuanBaju_, parseSatuanBaris_, satuanKeTeks_, agregasiTransaksi_, KOLOM_KOREKSI_PCS, num_ };
