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
            sumber_dana: {
              type: ["string", "null"],
              description: "Hanya diisi bila nama bank/sumber dana terlihat jelas pada bukti; harus salah satu dari daftar SUMBER DANA. Selain itu null.",
            },
            catatan: { type: "string", description: "Penjelasan singkat apa yang terbaca dari bukti (untuk diperiksa user)." },
            keyakinan: { type: "string", enum: ["tinggi", "sedang", "rendah"] },
          },
          required: ["keterangan", "nominal", "tanggal", "sumber_dana", "catatan", "keyakinan"],
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

module.exports = { extractBiaya, extractKas, MODEL };
