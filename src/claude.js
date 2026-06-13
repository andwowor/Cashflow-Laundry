"use strict";

const Anthropic = require("@anthropic-ai/sdk");

// Sesuai permintaan: otak dashboard menggunakan Claude Sonnet 4.6.
const MODEL = "claude-sonnet-4-6";

let _client = null;
function client() {
  if (!_client) _client = new Anthropic(); // ANTHROPIC_API_KEY dari environment
  return _client;
}

function imageBlock(base64, mediaType) {
  return {
    type: "image",
    source: { type: "base64", media_type: mediaType, data: base64 },
  };
}

function firstText(response) {
  const block = response.content.find((b) => b.type === "text");
  if (!block) throw new Error("Claude tidak mengembalikan teks.");
  return block.text;
}

/**
 * Ekstraksi bukti pengeluaran biaya (screenshot / bukti transfer) menjadi
 * baris-baris kandidat untuk sheet INPUT PENGGUNAAN BIAYA.
 */
async function extractBiaya({ images, keteranganList, sumberDanaList, historyText, learningText, todayIso }) {
  const schema = {
    type: "object",
    properties: {
      entries: {
        type: "array",
        items: {
          type: "object",
          properties: {
            keterangan: {
              type: "string",
              description: "WAJIB salah satu dari daftar KETERANGAN yang diberikan, persis sama penulisannya.",
            },
            nominal: { type: "integer", description: "Nominal rupiah tanpa titik/koma." },
            tanggal: {
              type: ["string", "null"],
              description: "Tanggal transaksi pada bukti, format YYYY-MM-DD. null jika tidak terbaca.",
            },
            idpel: {
              type: ["string", "null"],
              description:
                "Khusus bukti pembelian TOKEN LISTRIK PLN: nomor IDPEL / ID Pelanggan (11–12 digit). " +
                "JANGAN ambil nomor token/stroom 20 digit, dan jangan nomor seri meter. " +
                "null bila bukan pembelian token listrik atau IDPEL tak terbaca.",
            },
            sumber_dana: {
              type: ["string", "null"],
              description: "Hanya diisi bila nama bank/sumber dana terlihat jelas pada bukti; harus salah satu dari daftar SUMBER DANA. Selain itu null.",
            },
            catatan: { type: "string", description: "Penjelasan singkat apa yang terbaca dari bukti (untuk diperiksa user)." },
            keyakinan: { type: "string", enum: ["tinggi", "sedang", "rendah"] },
          },
          required: ["keterangan", "nominal", "tanggal", "idpel", "sumber_dana", "catatan", "keyakinan"],
          additionalProperties: false,
        },
      },
    },
    required: ["entries"],
    additionalProperties: false,
  };

  const system = [
    "Kamu adalah asisten pembukuan bisnis laundry (outlet MAUMBI dan PERKAMIL di Manado).",
    "Tugasmu: membaca screenshot/bukti transfer pengeluaran biaya, lalu mengusulkan isian untuk sheet INPUT PENGGUNAAN BIAYA.",
    "Aturan:",
    "- Kolom KETERANGAN harus dipilih PERSIS dari daftar dropdown yang diberikan (jangan mengarang teks baru).",
    "- Satu bukti bisa berisi lebih dari satu transaksi; buat satu entry per transaksi.",
    "- Nominal dalam rupiah, bilangan bulat.",
    "- Tanggal diambil dari bukti (bukan tanggal hari ini), kecuali tidak terbaca → null.",
    "- sumber_dana hanya diisi bila nama bank pengirim terlihat (mis. logo/teks BCA, BRI, BNI, Mandiri) dan harus persis dari daftar SUMBER DANA; jika ragu → null.",
    "- Bila bukti adalah pembelian TOKEN LISTRIK PLN (token/stroom prabayar), baca nomor IDPEL/ID Pelanggan (11–12 digit) dan isikan di field idpel. Jangan tertukar dengan nomor token 20 digit atau nomor seri meter.",
    "- Gunakan riwayat pengisian dan koreksi sebelumnya untuk memilih keterangan yang paling sesuai kebiasaan user.",
  ].join("\n");

  const promptParts = [
    `Hari ini: ${todayIso}.`,
    "",
    "DAFTAR KETERANGAN (dropdown, pilih persis):",
    keteranganList.join(" | "),
    "",
    "DAFTAR SUMBER DANA (dropdown):",
    sumberDanaList.join(" | "),
    "",
    "RIWAYAT PENGISIAN TERAKHIR (KETERANGAN → NOMINAL → OUTLET → SUMBER DANA):",
    historyText || "(belum ada)",
  ];
  if (learningText) {
    promptParts.push("", "PEMBELAJARAN DARI KOREKSI USER SEBELUMNYA (hasil final yang dipilih user):", learningText);
  }
  promptParts.push("", "Analisis bukti pengeluaran berikut dan keluarkan entries sesuai skema.");

  const content = [...images.map((img) => imageBlock(img.base64, img.mediaType)), { type: "text", text: promptParts.join("\n") }];

  const response = await client().messages.create({
    model: MODEL,
    max_tokens: 16000,
    system,
    messages: [{ role: "user", content }],
    output_config: { format: { type: "json_schema", schema } },
  });

  return JSON.parse(firstText(response)).entries;
}

/**
 * Ekstraksi screenshot saldo kas.
 * jenis: "bank" | "aplikasi-outlet" | "bank-aplikasi" | "belum-settlement"
 */
async function extractKas({ images, jenis, todayIso }) {
  const isBank = jenis === "bank" || jenis === "bank-aplikasi";
  const isOutlet = jenis === "aplikasi-outlet";

  const itemProps = {
    nominal: { type: "integer", description: "Saldo/nominal rupiah, bilangan bulat." },
    catatan: { type: "string", description: "Apa yang terbaca (nama rekening/aplikasi, tanggal, dsb)." },
  };
  if (isBank) {
    itemProps.bank = {
      type: "string",
      enum: ["BCA", "BRI", "BNI", "MANDIRI"],
      description: "Bank pemilik saldo pada screenshot.",
    };
  }
  if (isOutlet) {
    itemProps.outlet = {
      type: "string",
      enum: ["MAUMBI", "PERKAMIL"],
      description: "Outlet pemilik kas aplikasi pada screenshot.",
    };
  }

  const schema = {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: itemProps,
          required: Object.keys(itemProps),
          additionalProperties: false,
        },
      },
    },
    required: ["items"],
    additionalProperties: false,
  };

  const deskripsi = {
    bank: "screenshot mutasi/saldo rekening bank (m-banking). Ambil SALDO AKHIR/saldo rekening, tentukan banknya (BCA/BRI/BNI/Mandiri).",
    "aplikasi-outlet": "screenshot kas tunai pada aplikasi kasir laundry (Smartlink) per outlet. Tentukan outlet (MAUMBI/PERKAMIL) dan nominal kas.",
    "bank-aplikasi": "screenshot saldo bank yang tercatat di APLIKASI kasir laundry. Tentukan bank (BCA/BRI/BNI/Mandiri) dan nominalnya.",
    "belum-settlement": "screenshot nominal dana yang BELUM SETTLEMENT. Ambil total nominalnya.",
  }[jenis];

  const system =
    "Kamu membaca screenshot keuangan bisnis laundry dan mengekstrak nominal saldo dengan teliti. " +
    "Angka rupiah Indonesia memakai titik sebagai pemisah ribuan (mis. 1.583.701 = 1583701).";

  const content = [
    ...images.map((img) => imageBlock(img.base64, img.mediaType)),
    {
      type: "text",
      text: `Hari ini: ${todayIso}.\nJenis upload: ${deskripsi}\nSatu screenshot bisa memuat lebih dari satu item. Keluarkan items sesuai skema.`,
    },
  ];

  const response = await client().messages.create({
    model: MODEL,
    max_tokens: 8000,
    system,
    messages: [{ role: "user", content }],
    output_config: { format: { type: "json_schema", schema } },
  });

  return JSON.parse(firstText(response)).items;
}

/**
 * Ekstraksi screenshot pendapatan EDC/QRIS harian menjadi baris-baris
 * {tanggal, nominal, outlet} untuk sheet INPUT QRIS.
 */
async function extractQris({ images, todayIso }) {
  const schema = {
    type: "object",
    properties: {
      entries: {
        type: "array",
        items: {
          type: "object",
          properties: {
            tanggal: {
              type: ["string", "null"],
              description: "Tanggal transaksi pada bukti, format YYYY-MM-DD. null jika tidak terbaca.",
            },
            nominal: { type: "integer", description: "Nominal rupiah, bilangan bulat." },
            outlet: {
              type: ["string", "null"],
              description: "MAUMBI atau PERKAMIL bila nama/merchant outlet terlihat jelas pada bukti; selain itu null.",
            },
            catatan: { type: "string", description: "Apa yang terbaca (mis. nama merchant/outlet, tanggal, label EDC)." },
          },
          required: ["tanggal", "nominal", "outlet", "catatan"],
          additionalProperties: false,
        },
      },
    },
    required: ["entries"],
    additionalProperties: false,
  };

  const system = [
    "Kamu membaca screenshot/laporan pendapatan EDC harian bisnis laundry (outlet MAUMBI & PERKAMIL).",
    "Ekstrak setiap baris pendapatan menjadi: tanggal, nominal, dan outlet.",
    "Angka rupiah memakai titik sebagai pemisah ribuan (mis. 1.234.567 = 1234567).",
    "Outlet hanya diisi bila nama/merchant outlet terlihat (mengandung 'Maumbi' atau 'Perkamil'); selain itu null.",
    "Satu screenshot bisa memuat beberapa baris/tanggal — buat satu entry per baris transaksi.",
  ].join("\n");

  const content = [
    ...images.map((img) => imageBlock(img.base64, img.mediaType)),
    { type: "text", text: `Hari ini: ${todayIso}.\nKeluarkan entries sesuai skema.` },
  ];

  const response = await client().messages.create({
    model: MODEL,
    max_tokens: 8000,
    system,
    messages: [{ role: "user", content }],
    output_config: { format: { type: "json_schema", schema } },
  });

  return JSON.parse(firstText(response)).entries;
}

/**
 * Ekstraksi screenshot mutasi/transfer masuk dana EDC menjadi baris-baris
 * transaksi {tanggal, subjek, nominal(bertanda), topup} untuk sheet DATA QRIS.
 */
async function extractQrisBank({ images, todayIso }) {
  const schema = {
    type: "object",
    properties: {
      entries: {
        type: "array",
        items: {
          type: "object",
          properties: {
            tanggal: {
              type: ["string", "null"],
              description: "Tanggal transaksi, format YYYY-MM-DD. Bila tahun tak tertera, pakai tahun hari ini. null jika tak terbaca.",
            },
            subjek: { type: "string", description: "Teks keterangan/subjek transaksi apa adanya (verbatim)." },
            nominal: {
              type: "integer",
              description: "Nominal rupiah BERTANDA: positif untuk dana masuk/kredit, negatif untuk pengurangan/biaya/debit.",
            },
            topup: {
              type: "boolean",
              description: "true bila subjek/keterangan menunjukkan 'Bayar/Top-up' (penyetoran dana EDC); selain itu false.",
            },
          },
          required: ["tanggal", "subjek", "nominal", "topup"],
          additionalProperties: false,
        },
      },
    },
    required: ["entries"],
    additionalProperties: false,
  };

  const system = [
    "Kamu membaca screenshot mutasi/transfer masuk dana EDC (rekening bank) bisnis laundry.",
    "Setiap baris transaksi memiliki: tanggal, subjek/keterangan, dan nominal yang bisa positif (kredit/dana masuk) atau negatif (debit/biaya).",
    "Kembalikan SEMUA baris transaksi apa adanya (jangan disaring) — penyaringan dilakukan di tahap berikutnya.",
    "nominal harus BERTANDA: beri tanda negatif bila transaksi berupa pengurangan/biaya/debit.",
    "topup = true HANYA bila subjek/keterangan baris itu adalah jenis 'Bayar/Top-up' (penyetoran dana EDC); selain itu false.",
    "Angka rupiah memakai titik sebagai pemisah ribuan (mis. 1.234.567 = 1234567).",
  ].join("\n");

  const content = [
    ...images.map((img) => imageBlock(img.base64, img.mediaType)),
    { type: "text", text: `Hari ini: ${todayIso}.\nKeluarkan entries sesuai skema.` },
  ];

  const response = await client().messages.create({
    model: MODEL,
    max_tokens: 12000,
    system,
    messages: [{ role: "user", content }],
    output_config: { format: { type: "json_schema", schema } },
  });

  return JSON.parse(firstText(response)).entries;
}

module.exports = { extractBiaya, extractKas, extractQris, extractQrisBank, MODEL };
