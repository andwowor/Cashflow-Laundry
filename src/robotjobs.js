"use strict";

const fs = require("fs");
const path = require("path");
const cfg = require("./config");
const browser = require("./smartlinkbrowser");
const { driveClient } = require("./google");
const sheets = require("./sheets");
const auth = require("./auth");

// =====================================================================
// Robot skill Smartlink: menjalankan skill milik Andre (yang semula dipakai
// Claude di Chrome dengan beberapa tab) secara otomatis dari tombol dashboard.
// Teks skill asli disimpan di src/skills/*.md dan dipakai hampir apa adanya;
// prompt adaptor di bawah memetakan alat Claude in Chrome ke alat robot.
// =====================================================================

const SKILL_DIR = path.join(__dirname, "skills");

const JOBS = {
  setoran: {
    skill: "konfirmasi-setoran-owner-smartlink",
    title: "Konfirmasi Setoran Owner",
    menu: "Monitoring Biaya",
    viewport: { width: 1280, height: 800 },
    maxMinutes: 90,
    blockEnterEscape: true,
  },
  input_setoran: {
    skill: "input-setoran-owner-smartlink",
    title: "Input Setoran Owner",
    menu: "Lapor Smartlink",
    viewport: { width: 1280, height: 800 },
    maxMinutes: 90,
    blockEnterEscape: true,
  },
  input_biaya: {
    skill: "input-biaya-smartlink",
    title: "Input Biaya ke Smartlink",
    menu: "Lapor Smartlink",
    viewport: { width: 568, height: 1000 },
    maxMinutes: 120,
    blockEnterEscape: true,
  },
  input_kas: {
    skill: "input-kas-smartlink",
    title: "Input Kas Harian",
    menu: "Input Kas",
    viewport: { width: 568, height: 1000 },
    maxMinutes: 60,
    blockEnterEscape: false,
  },
  settlement: {
    skill: "settlement-qris-smartlink",
    title: "Settlement QRIS",
    menu: "Input Kas",
    viewport: { width: 1000, height: 744 },
    maxMinutes: 150,
    blockEnterEscape: true,
    sheetWrite: "INPUT_QRIS",
    tanggalOpsional: true,
  },
};
for (const [key, j] of Object.entries(JOBS)) j.key = key;

const DASH_VIEW = { width: 1280, height: 900 };
const GAMBAR_VIEW = { width: 1000, height: 744 };

function skillText(job) {
  return fs.readFileSync(path.join(SKILL_DIR, `${job.skill}.md`), "utf8");
}

const dashPort = () => Number(process.env.PORT) || 3000;
const dashUrl = (p = "/") => `http://localhost:${dashPort()}${p}`;

function smartlinkHostOk(u) {
  try {
    const url = new URL(u);
    const base = new URL(browser.SMARTLINK_URL);
    if (url.host === base.host) return true;
    return url.protocol === "https:" && /(^|\.)smartlink\.id$/i.test(url.hostname);
  } catch {
    return false;
  }
}

function nowWita() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: cfg.TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value])
  );
  const hour = Number(p.hour) % 24;
  return { tanggal: `${p.year}-${p.month}-${p.day}`, jam: `${String(hour).padStart(2, "0")}:${p.minute}`, jam21: hour >= 21 };
}

function toWita(iso) {
  if (!iso) return "";
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: cfg.TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value])
  );
  return `${p.year}-${p.month}-${p.day} ${String(Number(p.hour) % 24).padStart(2, "0")}:${p.minute} WITA`;
}

// ---------------- Prompt ----------------

function systemPrompt(job, { dryRun }) {
  const v = job.viewport;
  const mode = dryRun
    ? `MODE CEK SAJA (dry run) — Andre menekan tombol "Cek saja". Ikuti jalur "cek saja / dry run" yang
ditulis skill: kumpulkan data & susun rencana, lalu berhenti sesuai skill. JANGAN menulis, menyimpan,
mengunggah-lalu-menyimpan, menyetujui, atau membuat transaksi apa pun. Tidak perlu meminta izin.`
    : `MODE JALANKAN — Andre menekan tombol "Jalankan". Izin batch tetap diminta persis seperti skill
(lewat \`tanya_andre\`, mis. pilihan "Jalankan semua" / "Dry run saja"); tunggu jawabannya.`;

  return `Kamu menjalankan skill "${job.skill}" milik Andre (Co Clean Laundry) secara otomatis di latar
belakang, dipicu dari tombol "${job.title}" di menu ${job.menu} pada Dashboard Kas Laundry.
Teks skill aslinya ada di bagian "SKILL" di bawah. Skill itu ditulis untuk Claude di Chrome; di sini kamu
berjalan di ROBOT BROWSER milik dashboard. Ikuti skill itu seakurat mungkin dengan padanan alat berikut.

${mode}

## Padanan alat
| Di skill | Di robot ini |
|---|---|
| Tab Andre / tab Smartlink | tab "smartlink" (sudah terbuka di https://dashboard.smartlink.id, ukuran ${v.width}×${v.height}) |
| Tab localhost / Dashboard Kas Laundry (http://localhost:3000/) | tab "dashboard": \`tab\` aksi "buka" tab "dashboard" url "/" — sudah login |
| Tab penampil gambar (drive.google.com/uc?export=view&id=X) | \`buka_gambar_drive\` file_id X → tab "gambar" (gambar tampil utuh menyesuaikan layar) |
| computer: screenshot, klik, ketik, key, scroll, zoom | tool komputer — bekerja pada tab yang AKTIF |
| javascript_tool | \`javascript\` pada tab aktif: boleh \`await\` di level atas; nilai ekspresi terakhir dikembalikan. Tidak ada pemblokiran "=", "&", "?" — trik \`.replace(/[=&?]/g,'~')\` tidak wajib. URL ber-token disensor otomatis |
| browser_batch | beberapa tool dalam satu giliran |
| find / read_page / form_input | \`javascript\` (DOM) atau screenshot + klik |
| tabs_context_mcp / buat tab | \`tab\` aksi "buka" / "pindah" / "tutup" |
| chrome_upload_image (imageId, ref/coordinate, filename) | \`unggah_file\`: sumber "screenshot" (screenshot skala penuh tab_sumber SAAT ITU JUGA — siapkan layarnya dulu) atau "drive" (file asli Drive, lebih tajam — pakai ini untuk gambar Drive); tujuan = selector CSS sebuah input file di tab_tujuan; mode "tambah" (menambah file = setara drop di bagian kosong dropzone) atau "ganti" |
| Google Drive search_files (parentId) | \`daftar_drive\` (semua halaman sekaligus; createdTime sudah dalam WITA) |
| Google Sheets get_values / get_spreadsheet | \`baca_sheet\` (render FORMATTED_VALUE / UNFORMATTED_VALUE / FORMULA) |
| Google Sheets update_values | ${job.sheetWrite ? "`tulis_sheet` — HANYA 'INPUT QRIS'!A<r>:C<r2> pada baris kosong; server menolak selain itu" : "tidak tersedia untuk skill ini"} |
| Bash TZ=Asia/Makassar date | jam WITA ada di pesan pertama; ulangi kapan saja dengan \`jam_wita\` |
| Memori /areas/co-clean-automation.md | tidak ada — pakai \`info_cashflow\` (bulan berjalan dari Pengaturan dashboard; bulan lain dicari menurut judul) |
| AskUserQuestion (izin rencana, pertanyaan anomali, pilihan) | \`tanya_andre\` — pertanyaan + pilihan tampil di panel dashboard; proses menunggu jawaban Andre (maks. 30 menit) |
| "sebutkan judul tab ke Andre", "tutup tab yang Claude buka" | tidak perlu menyebutkan; tutup tab tambahan di akhir dengan \`tab\` aksi "tutup" |
| Ringkasan / laporan akhir | \`laporan_akhir\` (wajib, sekali di akhir) |

## Aturan robot (tambahan, mengikat)
- Koordinat = piksel screenshot = piksel CSS (k = 1). Bila skill memakai \`__FW\`, isi dengan \`innerWidth\` tab itu.
  Ukuran tab: smartlink ${v.width}×${v.height}, dashboard ${DASH_VIEW.width}×${DASH_VIEW.height}, gambar ${GAMBAR_VIEW.width}×${GAMBAR_VIEW.height}.
  Rujukan koordinat di skill dibuat pada ukuran lain — selalu tentukan dari screenshot / DOM terbaru.
- ${job.blockEnterEscape ? "Tombol Enter dan Escape DIBLOKIR (skill melarangnya pada dialog/kalender); `type` juga tidak boleh berisi baris baru." : "Hati-hati dengan Enter/Escape; ikuti larangan di skill."}
- Jangan me-refresh tab di tengah satu item. Halaman Smartlink yang dimuat ulang di awal skill boleh.
- Login Smartlink: bila halaman login tampil, klik kolom email → \`isi_login\` "email"; klik kolom kata sandi →
  \`isi_login\` "password"; klik tombol masuk; tunggu 3 detik. Jangan mengetik email/sandi sendiri. Gagal → \`butuh_login\`.
- CAPTCHA / "I'm not a robot" → jangan dikerjakan: lewati item itu, catat, lanjutkan yang lain.
- Di tab dashboard hanya lakukan klik / JavaScript yang memang diminta skill. Jangan menekan tombol robot
  (Jalankan / Cek saja / Hentikan) dan jangan memanggil API dashboard lewat fetch.
- Setelah tiap item/bagian selesai (berhasil atau dilewati), panggil \`catat_progres\` satu baris. Catatan ini
  dibawa bila percakapan dipangkas, jadi tulis cukup jelas (item, hasil, angka penting).
- Pertanyaan anomali yang menurut skill ditanyakan "di laporan akhir": cukup tuliskan di \`laporan_akhir\`.
  Gunakan \`tanya_andre\` untuk izin batch dan untuk keputusan yang menurut skill harus ditunggu sebelum lanjut.
- Ragu = lewati, catat, laporkan. Jangan mengarang data.

## SKILL (teks asli "${job.skill}")
${skillText(job)}`;
}

function kickoffText(job, run) {
  const t = nowWita();
  const lines = [
    `MODE: ${run.dryRun ? "CEK SAJA (dry run)" : "JALANKAN"} — skill ${job.skill}.`,
    `Sekarang: ${t.tanggal} ${t.jam} WITA${t.jam21 ? " (sudah ≥ 21:00)" : " (belum 21:00)"}.`,
  ];
  if (job.tanggalOpsional) {
    lines.push(run.param && run.param.tanggal
      ? `Perintah Andre: jalankan untuk tanggal ${run.param.tanggal} (mode tanggal tertentu D).`
      : "Perintah Andre: semua (tanpa tanggal).");
  }
  lines.push(`Tab smartlink sudah terbuka. Tab dashboard: ${dashUrl("/")} (buka dengan tool tab bila diperlukan).`);
  if (run.episodes <= 1) {
    lines.push("Mulai dari Langkah 0 skill. Screenshot tab smartlink saat ini terlampir.");
  } else {
    lines.push(
      `Ini lanjutan proses yang sama (bagian ${run.episodes}); percakapan lama dipangkas agar ringan. ` +
        `Tab yang terbuka: ${browser.tabNames().join(", ")}; tab aktif: ${browser.activeTab()} — screenshot terlampir.`
    );
    lines.push("Catatan progres sejauh ini (jangan ulangi item yang sudah selesai):",
      run.notes.length ? run.notes.map((n, i) => `${i + 1}. ${n.text}`).join("\n") : "(belum ada)");
    if (run.qa.length) {
      lines.push("Pertanyaan yang sudah dijawab Andre:", run.qa.map((q) => `- ${q.pertanyaan.slice(0, 300)} → ${q.jawaban}`).join("\n"));
    }
    if (run.actions.length) {
      lines.push("Aksi penting yang sudah dijalankan server:", run.actions.slice(-20).map((a) => `- ${a.text}`).join("\n"));
    }
    lines.push("Lanjutkan dari posisi terakhir.");
  }
  return lines.join("\n");
}

// ---------------- Tool ----------------

const TABS = ["smartlink", "dashboard", "gambar"];

function tools(t, job) {
  const list = [
    t(
      "tab",
      "Kelola tab robot. aksi 'buka' = buka/pakai tab lalu jadikan aktif (opsional pindah ke url); 'pindah' = jadikan aktif; " +
        "'tutup' = tutup tab (bukan smartlink). Tab smartlink hanya untuk domain *.smartlink.id; tab dashboard memakai path " +
        "dashboard (mis. '/'). Tab gambar dibuka lewat buka_gambar_drive.",
      {
        aksi: { type: "string", enum: ["buka", "pindah", "tutup"] },
        tab: { type: "string", enum: TABS },
        url: { type: "string", description: "URL/path tujuan; '' = tetap di halaman sekarang." },
      },
      ["aksi", "tab", "url"]
    ),
    t(
      "javascript",
      "Jalankan JavaScript di tab AKTIF (setara javascript_tool). Mendukung await di level atas dan beberapa pernyataan; " +
        "nilai ekspresi terakhir dikembalikan sebagai teks (objek → JSON). Maks. 120 detik.",
      { kode: { type: "string" } },
      ["kode"]
    ),
    t(
      "unggah_file",
      "Unggah satu gambar ke <input type=file> (selector CSS) di tab_tujuan (setara chrome_upload_image). " +
        "sumber 'screenshot' = screenshot skala penuh tab_sumber saat itu juga; sumber 'drive' = file asli Drive (file_id). " +
        "mode 'tambah' menambah file yang sudah ada (setara drop di bagian kosong dropzone), 'ganti' mengganti isinya. " +
        "Hasil: daftar nama file di input itu.",
      {
        sumber: { type: "string", enum: ["screenshot", "drive"] },
        tab_sumber: { type: "string", enum: TABS, description: "Untuk sumber 'screenshot'." },
        file_id: { type: "string", description: "Untuk sumber 'drive' ('' bila tidak dipakai)." },
        tab_tujuan: { type: "string", enum: ["smartlink", "dashboard"] },
        selector: { type: "string", description: "Selector CSS input file, mis. '#qbank-files' atau '.kas-card[data-jenis=\"bank\"] .kas-files'." },
        nama_file: { type: "string", description: "Nama file, mis. 'BCA.png'." },
        mode: { type: "string", enum: ["tambah", "ganti"] },
      },
      ["sumber", "tab_sumber", "file_id", "tab_tujuan", "selector", "nama_file", "mode"]
    ),
    t(
      "daftar_drive",
      "Daftar isi folder Google Drive (setara search_files dengan parentId; semua halaman sekaligus). " +
        "Tiap file: id, name, mimeType, createdTime & modifiedTime (WITA).",
      { folder_id: { type: "string" } },
      ["folder_id"]
    ),
    t(
      "buka_gambar_drive",
      "Buka gambar Drive (file_id) di tab 'gambar' (setara drive.google.com/uc?export=view&id=...) dan jadikan tab aktif.",
      { file_id: { type: "string" } },
      ["file_id"]
    ),
    t(
      "baca_sheet",
      "Baca range Google Sheets (setara get_values / get_spreadsheet).",
      {
        spreadsheet_id: { type: "string" },
        range: { type: "string", description: "Notasi A1, mis. \"'INPUT QRIS'!A1:C1000\"." },
        render: { type: "string", enum: ["FORMATTED_VALUE", "UNFORMATTED_VALUE", "FORMULA"] },
      },
      ["spreadsheet_id", "range", "render"]
    ),
    t(
      "info_cashflow",
      "Spreadsheet 'CASHFLOW DAN BIAYA <BULAN> <TAHUN>'. bulan=0 → bulan berjalan dashboard (seperti di Pengaturan). " +
        "Bulan lain → kandidat menurut judul (wajib dikonfirmasi Andre lewat tanya_andre sebelum dipakai, sesuai skill).",
      { bulan: { type: "integer", description: "1–12, atau 0 untuk bulan berjalan." }, tahun: { type: "integer" } },
      ["bulan", "tahun"]
    ),
    t("jam_wita", "Tanggal & jam sekarang (WITA).", {}, []),
    t(
      "tanya_andre",
      "Ajukan pertanyaan ke Andre (setara AskUserQuestion) — tampil di panel dashboard dan proses menunggu jawabannya. " +
        "Pakai untuk izin batch dan keputusan yang menurut skill harus ditunggu. Pertanyaan boleh panjang (rencana dalam " +
        "dua bahasa). Pilihan pertama = rekomendasi.",
      {
        pertanyaan: { type: "string" },
        pilihan: { type: "array", items: { type: "string" }, description: "2–4 pilihan jawaban." },
      },
      ["pertanyaan", "pilihan"]
    ),
    t(
      "catat_progres",
      "Catat satu baris progres setelah tiap item/bagian selesai (berhasil atau dilewati). Catatan ini dibawa bila percakapan dipangkas.",
      { catatan: { type: "string" } },
      ["catatan"]
    ),
    t(
      "laporan_akhir",
      "Panggil SEKALI di akhir. Laporan seperti yang diminta skill: bahasa Indonesia lalu Inggris, plus butir per item/bagian.",
      {
        ringkasan_id: { type: "string", description: "Laporan lengkap bahasa Indonesia (boleh beberapa baris)." },
        ringkasan_en: { type: "string", description: "Laporan yang sama dalam bahasa Inggris." },
        butir: {
          type: "array",
          items: {
            type: "object",
            properties: {
              bagian: { type: "string", description: "Item/bagian, mis. 'Bagian 1 Kas Bank' atau 'Maumbi 4 Nov'." },
              status: { type: "string", enum: ["BERHASIL", "DILEWATI", "GAGAL", "INFO"] },
              keterangan: { type: "string" },
            },
            required: ["bagian", "status", "keterangan"],
            additionalProperties: false,
          },
        },
      },
      ["ringkasan_id", "ringkasan_en", "butir"]
    ),
  ];
  if (job.sheetWrite) {
    list.push(
      t(
        "tulis_sheet",
        "Tulis ke Google Sheets (setara update_values) — HANYA \"'INPUT QRIS'!A<r>:C<r2>\" di spreadsheet CASHFLOW, " +
          "pada baris yang masih kosong. Nilai per baris: [serial tanggal, nominal, 'MAUMBI'|'PERKAMIL'] sebagai teks angka.",
        {
          spreadsheet_id: { type: "string" },
          range: { type: "string" },
          nilai: { type: "array", items: { type: "array", items: { type: "string" } } },
        },
        ["spreadsheet_id", "range", "nilai"]
      )
    );
  }
  return list;
}

// ---------------- Pelaksana tool ----------------

function record(run, ctx, text) {
  run.actions.push({ t: Date.now(), text });
  ctx.log(run, text, "info");
}

async function ensureDashboardCookie() {
  await browser.addCookies([
    { name: auth.COOKIE_NAME, value: auth.signToken(), url: dashUrl("/"), httpOnly: true, sameSite: "Lax" },
  ]);
}

async function driveMeta(fileId) {
  const res = await driveClient().files.get({ fileId, fields: "id,name,mimeType,size", supportsAllDrives: true });
  return res.data;
}

async function driveBytes(fileId) {
  const meta = await driveMeta(fileId);
  if (!/^image\//.test(meta.mimeType || "")) throw new Error(`File ${meta.name} bukan gambar (${meta.mimeType}).`);
  const res = await driveClient().files.get({ fileId, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" });
  return { meta, buffer: Buffer.from(res.data) };
}

async function listDrive(folderId) {
  const drive = driveClient();
  const files = [];
  let pageToken;
  do {
    const res = await drive.files.list({
      q: `'${String(folderId).replace(/'/g, "")}' in parents and trashed = false`,
      fields: "nextPageToken, files(id,name,mimeType,createdTime,modifiedTime)",
      pageSize: 1000,
      orderBy: "name",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      pageToken,
    });
    files.push(...(res.data.files || []));
    pageToken = res.data.nextPageToken;
  } while (pageToken && files.length < 2000);
  return files;
}

function sanitizeName(n) {
  const s = String(n || "gambar.png").replace(/[^\w .()+-]/g, "_").slice(0, 80);
  return /\.(png|jpe?g|webp|gif)$/i.test(s) ? s : s + ".png";
}

function mimeOf(name, fallback) {
  if (/\.jpe?g$/i.test(name)) return "image/jpeg";
  if (/\.webp$/i.test(name)) return "image/webp";
  if (/\.gif$/i.test(name)) return "image/gif";
  return fallback || "image/png";
}

async function handle(job, run, name, input, ctx) {
  switch (name) {
    case "tab": {
      const tab = TABS.includes(input.tab) ? input.tab : "smartlink";
      const aksi = input.aksi;
      const url = String(input.url || "").trim();
      if (aksi === "tutup") {
        await browser.closeTab(tab);
        return { result: { ok: true, aktif: browser.activeTab(), tab_terbuka: browser.tabNames() } };
      }
      if (aksi === "pindah") {
        browser.switchTab(tab);
        return { result: { ok: true, ...browser.tabInfo(), tab_terbuka: browser.tabNames() } };
      }
      // buka
      if (tab === "smartlink") {
        if (url && !smartlinkHostOk(url)) throw new Error("Tab smartlink hanya boleh membuka domain *.smartlink.id.");
        await browser.openTab("smartlink", url || null, null);
      } else if (tab === "dashboard") {
        const p = url ? (url.startsWith("http") ? new URL(url).pathname + new URL(url).hash : url) : "/";
        if (!p.startsWith("/") || p.startsWith("/api/")) throw new Error("Tab dashboard hanya untuk halaman dashboard (mis. '/').");
        await ensureDashboardCookie();
        const exists = browser.tabNames().includes("dashboard");
        await browser.openTab("dashboard", exists && !url ? null : dashUrl(p), DASH_VIEW);
      } else {
        if (url) throw new Error("Tab gambar dibuka lewat buka_gambar_drive.");
        browser.switchTab("gambar");
      }
      return { result: { ok: true, ...browser.tabInfo(), tab_terbuka: browser.tabNames() } };
    }

    case "javascript": {
      const kode = String(input.kode || "");
      if (browser.activeTab() === "dashboard" && /\bfetch\s*\(|XMLHttpRequest|sendBeacon|\/api\//.test(kode)) {
        throw new Error("Di tab dashboard, JavaScript tidak boleh memanggil API dashboard langsung — pakai klik/DOM seperti di skill.");
      }
      const out = await browser.evalJs(kode);
      ctx.log(run, `🧩 JavaScript (${browser.activeTab()})`, "detail");
      return { result: out };
    }

    case "unggah_file": {
      const nama = sanitizeName(input.nama_file);
      let file;
      if (input.sumber === "drive") {
        if (!input.file_id) throw new Error("file_id wajib untuk sumber 'drive'.");
        const { meta, buffer } = await driveBytes(input.file_id);
        file = { name: nama, mimeType: mimeOf(nama, meta.mimeType), buffer };
      } else {
        const tabSumber = TABS.includes(input.tab_sumber) ? input.tab_sumber : browser.activeTab();
        const buffer = await browser.screenshotFull(tabSumber);
        file = { name: nama.replace(/\.(jpe?g|webp|gif)$/i, ".png"), mimeType: "image/png", buffer };
      }
      const tujuan = input.tab_tujuan === "smartlink" ? "smartlink" : "dashboard";
      const files = await browser.setFiles(tujuan, String(input.selector || ""), [file], input.mode === "ganti" ? "ganti" : "tambah");
      record(run, ctx, `📤 Unggah ${file.name} (${input.sumber === "drive" ? "file Drive" : "screenshot " + input.tab_sumber}) → ${tujuan} ${input.selector}`);
      return { result: { ok: true, files } };
    }

    case "daftar_drive": {
      const files = await listDrive(input.folder_id);
      return {
        result: {
          jumlah: files.length,
          files: files.slice(0, 400).map((f) => ({
            id: f.id, name: f.name, mimeType: f.mimeType, createdTime: toWita(f.createdTime), modifiedTime: toWita(f.modifiedTime),
          })),
        },
      };
    }

    case "buka_gambar_drive": {
      const meta = await driveMeta(input.file_id);
      if (!/^image\//.test(meta.mimeType || "")) throw new Error(`File ${meta.name} bukan gambar.`);
      await ensureDashboardCookie();
      await browser.openTab("gambar", dashUrl(`/api/robot/drive/${encodeURIComponent(meta.id)}`), GAMBAR_VIEW);
      ctx.log(run, `🖼 Membuka gambar Drive ${meta.name}`, "detail");
      return { result: { ok: true, nama: meta.name, mimeType: meta.mimeType, aktif: "gambar" } };
    }

    case "baca_sheet": {
      const render = ["FORMATTED_VALUE", "UNFORMATTED_VALUE", "FORMULA"].includes(input.render) ? input.render : "FORMATTED_VALUE";
      const rows = await sheets.readRange(String(input.spreadsheet_id), String(input.range), render);
      let out = JSON.stringify(rows);
      if (out.length > 12000) out = out.slice(0, 12000) + "… (terpotong; persempit range)";
      return { result: out };
    }

    case "tulis_sheet":
      return { result: await tulisInputQris(job, run, input, ctx) };

    case "info_cashflow": {
      const bulan = Math.round(Number(input.bulan) || 0);
      if (!bulan) {
        const r = await sheets.resolveCashflowSpreadsheetId();
        return { result: { bulan_berjalan: cfg.currentMonthKey(), spreadsheet_id: r.id, sumber: r.source } };
      }
      const tahun = Math.round(Number(input.tahun)) || new Date().getFullYear();
      if (bulan < 1 || bulan > 12) throw new Error("bulan harus 1–12.");
      const title = `CASHFLOW DAN BIAYA ${cfg.MONTH_NAMES_ID[bulan - 1]} ${tahun}`;
      const id = await sheets.findSpreadsheetIdByTitle(title).catch(() => null);
      return { result: { judul: title, kandidat_spreadsheet_id: id || null, catatan: "Kandidat wajib dikonfirmasi Andre (tanya_andre) sebelum dipakai." } };
    }

    case "jam_wita":
      return { result: nowWita() };

    case "tanya_andre": {
      const pertanyaan = String(input.pertanyaan || "").trim().slice(0, 6000);
      const pilihan = (Array.isArray(input.pilihan) ? input.pilihan : []).map((x) => String(x).trim()).filter(Boolean).slice(0, 4);
      if (!pertanyaan || pilihan.length < 1) throw new Error("pertanyaan & pilihan wajib diisi.");
      if (run.dryRun) {
        const dry = pilihan.find((p) => /dry run|cek saja/i.test(p));
        const jawaban = dry || "Mode CEK SAJA dari tombol — tidak ditanyakan; jangan jalankan apa pun, lanjutkan jalur dry run.";
        run.qa.push({ pertanyaan, pilihan, jawaban, otomatis: true });
        return { result: { jawaban, otomatis: true } };
      }
      const jawaban = await ctx.ask(run, { pertanyaan, pilihan });
      run.qa.push({ pertanyaan, pilihan, jawaban });
      return { result: { jawaban } };
    }

    case "catat_progres": {
      const text = String(input.catatan || "").trim().slice(0, 500);
      if (text) {
        run.notes.push({ t: Date.now(), text });
        ctx.log(run, "📝 " + text, "ok");
      }
      return { result: { ok: true, jumlah_catatan: run.notes.length }, itemBoundary: true };
    }

    case "laporan_akhir": {
      run.final = {
        ringkasanId: String(input.ringkasan_id || "").trim(),
        ringkasanEn: String(input.ringkasan_en || "").trim(),
        butir: (Array.isArray(input.butir) ? input.butir : []).slice(0, 100).map((b) => ({
          bagian: String(b.bagian || "").slice(0, 200),
          status: ["BERHASIL", "DILEWATI", "GAGAL", "INFO"].includes(b.status) ? b.status : "INFO",
          keterangan: String(b.keterangan || "").slice(0, 600),
        })),
      };
      ctx.log(run, "📝 Menyusun laporan akhir…");
      return { result: { ok: true }, stop: true };
    }

    default:
      return null;
  }
}

/** Tulis INPUT QRIS dengan pengaman: hanya A:C, hanya baris kosong, hanya spreadsheet CASHFLOW. */
async function tulisInputQris(job, run, input, ctx) {
  if (job.sheetWrite !== "INPUT_QRIS") throw new Error("Skill ini tidak boleh menulis ke Google Sheets.");
  if (run.dryRun) throw new Error("Mode CEK SAJA — tidak boleh menulis ke sheet.");
  const id = String(input.spreadsheet_id || "").trim();
  const range = String(input.range || "").trim();
  const m = range.match(/^'INPUT QRIS'!A(\d+):C(\d+)$/);
  if (!m) throw new Error("Hanya range 'INPUT QRIS'!A<r>:C<r2> yang boleh ditulis.");
  const r1 = Number(m[1]);
  const r2 = Number(m[2]);
  const nilai = Array.isArray(input.nilai) ? input.nilai : [];
  if (r1 < 2 || r2 < r1 || r2 - r1 + 1 !== nilai.length) throw new Error("Jumlah baris nilai tidak sama dengan range.");
  for (const row of nilai) {
    if (!Array.isArray(row) || row.length !== 3) throw new Error("Tiap baris harus 3 nilai: [serial tanggal, nominal, outlet].");
    const [serial, nominal, outlet] = row.map((x) => String(x).trim());
    if (!/^\d{5}$/.test(serial)) throw new Error(`Serial tanggal tidak valid: ${serial}`);
    if (!/^\d+$/.test(nominal)) throw new Error(`Nominal harus angka bulat tanpa titik: ${nominal}`);
    if (!["MAUMBI", "PERKAMIL"].includes(outlet)) throw new Error(`Outlet harus MAUMBI atau PERKAMIL: ${outlet}`);
  }
  // Spreadsheet harus CASHFLOW DAN BIAYA … dan punya sheet INPUT QRIS.
  const meta = await driveMeta(id).catch(() => null);
  if (!meta || !/^CASHFLOW DAN BIAYA /i.test(meta.name || "")) throw new Error("Spreadsheet tujuan bukan 'CASHFLOW DAN BIAYA …'.");
  // Jangan menimpa baris yang sudah terisi.
  const existing = await sheets.readRange(id, range, "FORMATTED_VALUE");
  if (existing.some((r) => (r || []).some((c) => String(c == null ? "" : c).trim() !== ""))) {
    throw new Error("Range tujuan tidak kosong — baris INPUT QRIS yang sudah ada tidak boleh ditimpa. Baca ulang lalu pilih baris kosong.");
  }
  await sheets.batchWrite(id, [{ range, values: nilai.map((r) => r.map((x) => String(x).trim())) }]);
  record(run, ctx, `🧾 Tulis ${meta.name} ${range}: ${nilai.map((r) => r.join(" · ")).join(" | ")}`);
  return { ok: true, ditulis: nilai.length, range };
}

// ---------------- Laporan ----------------

function counts(run) {
  const c = { catatan: run.notes.length, aksi: run.actions.length, berhasil: 0, dilewati: 0, gagal: 0 };
  for (const b of (run.final && run.final.butir) || []) {
    if (b.status === "BERHASIL") c.berhasil++;
    else if (b.status === "DILEWATI") c.dilewati++;
    else if (b.status === "GAGAL") c.gagal++;
  }
  return c;
}

function buildReport(job, run) {
  const statusId = { done: "Selesai", cancelled: "Dihentikan", error: "Berhenti karena error", need_login: "Perlu login Smartlink" }[run.phase] || run.phase;
  const statusEn = { done: "Finished", cancelled: "Stopped", error: "Stopped on error", need_login: "Smartlink login required" }[run.phase] || run.phase;
  const waktu = cfg.formatBusinessDateTime(new Date()) + " " + cfg.tzLabel();
  const f = run.final || { ringkasanId: "", ringkasanEn: "", butir: [] };
  const L = [];
  L.push(`LAPORAN ${job.title.toUpperCase()} — ${waktu}`);
  L.push(`Mode: ${run.dryRun ? "Cek saja" : "Jalankan"}${run.param && run.param.tanggal ? ` · Tanggal ${run.param.tanggal}` : ""} · Status: ${statusId}`);
  if (run.error) L.push(`Catatan: ${run.error}`);
  if (f.ringkasanId) L.push("", f.ringkasanId);
  if (f.butir.length) {
    L.push("", "Rincian:");
    f.butir.forEach((b, i) => L.push(`  ${i + 1}. [${b.status}] ${b.bagian}${b.keterangan ? " — " + b.keterangan : ""}`));
  } else if (run.notes.length) {
    L.push("", "Catatan progres:");
    run.notes.forEach((n, i) => L.push(`  ${i + 1}. ${n.text}`));
  }
  L.push("", "— English —", `${job.title} report — ${waktu} · Status: ${statusEn}`);
  if (f.ringkasanEn) L.push("", f.ringkasanEn);
  return {
    phase: run.phase,
    dryRun: run.dryRun,
    job: job.key,
    judul: job.title,
    waktu,
    error: run.error,
    ringkasanId: f.ringkasanId,
    ringkasanEn: f.ringkasanEn,
    butir: f.butir,
    catatan: run.notes.map((n) => n.text),
    tanya: run.qa.map((q) => ({ pertanyaan: q.pertanyaan, jawaban: q.jawaban, otomatis: !!q.otomatis })),
    aksi: run.actions.map((a) => a.text),
    biayaAi: { usd: Math.round(run.costUsd * 1000) / 1000, langkah: run.usage.calls, sesi: run.episodes },
    teks: L.join("\n"),
  };
}

module.exports = {
  JOBS, systemPrompt, kickoffText, tools, handle, counts, buildReport,
  driveBytes, driveMeta, dashUrl, nowWita, DASH_VIEW, GAMBAR_VIEW,
};
