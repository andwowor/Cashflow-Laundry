"use strict";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const fmtRp = (n) =>
  n === "" || n === null || n === undefined || isNaN(Number(n))
    ? String(n ?? "")
    : "Rp" + Number(n).toLocaleString("id-ID");

async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  if (res.status === 401) {
    window.location = "/login";
    throw new Error("Sesi berakhir, silakan login ulang.");
  }
  const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ===== Upload: drag & drop, tempel (paste), pilih file =====
const DROPZONES = [];
let lastZone = null;

function renamePasted(file) {
  const ext = ((file.type || "image/png").split("/")[1] || "png").replace("jpeg", "jpg");
  const ts = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14);
  return new File([file], `tempel-${ts}-${Math.floor(Math.random() * 1000)}.${ext}`, {
    type: file.type || "image/png",
  });
}

function clipboardImages(e) {
  const items = (e.clipboardData && e.clipboardData.items) || [];
  const out = [];
  for (const it of items) {
    if (it.kind === "file" && it.type && it.type.startsWith("image/")) {
      const f = it.getAsFile();
      if (f) out.push(renamePasted(f));
    }
  }
  return out;
}

/** Tambahkan file gambar ke input (akumulasi — cocok untuk pengisian masal). */
function addInputFiles(input, files) {
  const dt = new DataTransfer();
  for (const f of input.files) dt.items.add(f); // pertahankan yang sudah ada
  for (const f of files) {
    if (f.type && !f.type.startsWith("image/")) continue;
    dt.items.add(f);
  }
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Kosongkan input file + perbarui tampilan hitungannya. */
function clearFileInput(input) {
  if (!input) return;
  input.value = "";
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function initDropzone(zone, input, countEl) {
  if (!zone || !input) return;
  zone.setAttribute("tabindex", "0");
  const entry = { zone, input };
  DROPZONES.push(entry);

  const update = () => {
    if (!countEl) return;
    const n = input.files ? input.files.length : 0;
    if (!n) {
      countEl.innerHTML = "";
      return;
    }
    const label = n === 1 ? "1 file: " + escapeHtml(input.files[0].name) : n + " file dipilih";
    countEl.innerHTML = `${label} &nbsp;<a href="#" class="dz-clear">✕ kosongkan</a>`;
    const clr = countEl.querySelector(".dz-clear");
    if (clr) clr.addEventListener("click", (ev) => { ev.preventDefault(); clearFileInput(input); });
  };
  input.addEventListener("change", update);

  zone.addEventListener("focusin", () => { lastZone = entry; zone.classList.add("focused"); });
  zone.addEventListener("focusout", () => zone.classList.remove("focused"));
  zone.addEventListener("mousedown", () => { lastZone = entry; });

  ["dragenter", "dragover"].forEach((ev) =>
    zone.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.add("drag");
    })
  );
  ["dragleave", "dragend"].forEach((ev) =>
    zone.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (ev === "dragleave" && zone.contains(e.relatedTarget)) return;
      zone.classList.remove("drag");
    })
  );
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    zone.classList.remove("drag");
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length) addInputFiles(input, files);
  });
}

// Tempel (Ctrl/Cmd+V) gambar -> dropzone yang sedang/terakhir difokuskan.
document.addEventListener("paste", (e) => {
  const imgs = clipboardImages(e);
  if (!imgs.length) return;
  let entry = null;
  let node = e.target;
  while (node && node.nodeType === 1 && !entry) {
    entry = DROPZONES.find((d) => d.zone === node) || null;
    node = node.parentNode;
  }
  if (!entry) entry = lastZone;
  if (!entry) return;
  // Jangan rebut paste saat user sedang mengetik di input teks/textarea lain.
  const ae = document.activeElement;
  if (ae && (ae.tagName === "TEXTAREA" || (ae.tagName === "INPUT" && ae.type !== "file")) && !entry.zone.contains(ae)) return;
  e.preventDefault();
  addInputFiles(entry.input, imgs);
});

function showLog(el, text, isError = false) {
  el.classList.remove("hidden");
  el.classList.toggle("error", isError);
  el.textContent = text;
}

// ================= Tabs =================
$$(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    $$(".tab").forEach((b) => b.classList.remove("active"));
    $$(".panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    $("#tab-" + btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "monbiaya" && !MONBIAYA_LOADED) loadMonBiaya();
    if (btn.dataset.tab === "monbiaya" || btn.dataset.tab === "smartlink" || btn.dataset.tab === "kas") kfPoll();
    if (btn.dataset.tab === "smartlink" && !SMART_LOADED) loadSmart();
    if (btn.dataset.tab === "riwayat" && !RB_LOADED) rbOpen();
    if (btn.dataset.tab === "proyeksi") loadProyeksi(); // selalu segarkan saat dibuka
    if (btn.dataset.tab === "kassewa") loadKasSewa(); // selalu segarkan saat dibuka
    if (btn.dataset.tab === "gajikasbon") gkBukaSub(); // muat sub menu yang sedang aktif
    if (btn.dataset.tab === "daftarbiaya" && !DB_LOADED) loadDaftarBiaya();
    if (btn.dataset.tab === "deposit" && !DEP_LOADED) loadDeposit();
    if (btn.dataset.tab === "aliran" && !AL_LOADED) alOpen();
    if (btn.dataset.tab === "biaya") ensureManualBiaya();
  });
});

// ================= Logout =================
$("#btn-logout").addEventListener("click", async () => {
  try {
    await fetch("/api/logout", { method: "POST" });
  } catch {}
  window.location = "/login";
});

// ================= Status =================
let STATUS = null;
async function loadStatus() {
  try {
    STATUS = await api("/api/status");
    $("#status-line").textContent =
      `${STATUS.monthKey} · hari ini ${STATUS.today} (${STATUS.timezone}) · AI: ${STATUS.model}`;
    $("#bulan-label").textContent = STATUS.cashflow ? `— ${STATUS.cashflow.title}` : "";
    renderSettings();
    renderKasUploads(STATUS.uploads);
    appCheckVersion(true); // beri tahu sendiri bila ada pembaruan (tanpa menunggu diminta)
  } catch (e) {
    $("#status-line").textContent = "Gagal memuat status: " + e.message;
  }
}

function renderSettings() {
  if (!STATUS) return;
  const cf = STATUS.cashflow
    ? `<b>${STATUS.cashflow.title}</b> <small>(${STATUS.cashflow.source})</small>`
    : `<span style="color:#b3402f">${STATUS.cashflowError || "belum ditemukan"}</span>`;
  $("#settings-info").innerHTML = `
    <table>
      <tr><th>Bulan berjalan</th><td>${STATUS.monthKey}</td></tr>
      <tr><th>Zona waktu</th><td>${STATUS.timezone}</td></tr>
      <tr><th>Model AI</th><td>${STATUS.model}</td></tr>
      <tr><th>Service account</th><td><code>${STATUS.serviceAccountEmail || "-"}</code><br>
        <small>Bagikan kedua spreadsheet ke email ini sebagai Editor.</small></td></tr>
      <tr><th>BIAYA &amp; KAS LAUNDRY</th><td><code>${STATUS.biayaKasSpreadsheetId}</code></td></tr>
      <tr><th>CASHFLOW bulan ini</th><td>${cf}</td></tr>
    </table>`;
}

$("#btn-save-cashflow").addEventListener("click", async () => {
  const out = $("#settings-result");
  try {
    const data = await api("/api/config/cashflow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ link: $("#cashflow-link").value }),
    });
    showLog(out, `✔ Tersimpan: ${data.title} untuk ${data.monthKey}`);
    await loadStatus();
    await loadDashboard();
  } catch (e) {
    showLog(out, "✘ " + e.message, true);
  }
});

// ================= Monitoring =================
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// Nilai dianggap negatif bila (setelah buang "Rp"/spasi) diawali "-", "−", atau "(".
function isNegativeValue(s) {
  const t = String(s == null ? "" : s).trim().replace(/^rp\s*/i, "");
  return /^[-−(]/.test(t);
}

function renderSheetTable(el, rows, opts = {}) {
  if (!rows || rows.length === 0) {
    el.innerHTML = `<p class="error">Data tidak tersedia.</p>`;
    return;
  }
  const today = opts.today || "";
  const colCount = opts.colCount || 3;
  const numericCols = opts.numericCols || [1]; // kolom angka (rata kanan)
  const headerFallback = opts.headerFallback || {}; // judul cadangan bila header sheet kosong
  const dateCol = opts.dateCol ?? 2; // kolom tanggal untuk sorotan "hari ini"
  const redNegative = !!opts.redNegative; // warnai merah nilai negatif pada kolom angka

  const html = ["<table><tbody>"];
  rows.forEach((r, i) => {
    const isHeader = i === 0;
    const isToday = !isHeader && String(r[dateCol] ?? "").trim() === today;
    html.push(`<tr${isToday ? ' class="today"' : ""}>`);
    for (let j = 0; j < colCount; j++) {
      const tag = isHeader ? "th" : "td";
      let val = r[j];
      if (val === undefined || val === null) val = "";
      if (isHeader && val === "" && headerFallback[j]) val = headerFallback[j];
      let cls = "";
      if (!isHeader && numericCols.includes(j)) {
        cls = ` class="num${redNegative && isNegativeValue(val) ? " num-neg" : ""}"`;
      }
      html.push(`<${tag}${cls}>${escapeHtml(val)}</${tag}>`);
    }
    html.push("</tr>");
  });
  html.push("</tbody></table>");
  el.innerHTML = html.join("");
}

async function loadDashboard() {
  try {
    const data = await api("/api/dashboard");
    $("#last-sync").innerHTML = data.lastSync
      ? `Update harian terakhir: <b>${escapeHtml(data.lastSync.display)}</b>`
      : "Update harian terakhir: <i>belum pernah dijalankan</i>";
    renderSheetTable($("#table-kas"), data.kas, {
      today: data.today,
      colCount: 4,
      numericCols: [1, 3],
      headerFallback: { 3: "SELISIH" },
    });
    if (data.cashflowError) {
      const err = `<p class="error">${escapeHtml(data.cashflowError)}</p>`;
      $("#table-ilh").innerHTML = err;
      $("#table-pendapatan").innerHTML = err;
      $("#table-kontrol").innerHTML = err;
    } else {
      renderSheetTable($("#table-ilh"), data.laporanHarian, { today: data.today, colCount: 3, numericCols: [1] });
      renderSheetTable($("#table-pendapatan"), data.pendapatan, { colCount: 3, numericCols: [1, 2], dateCol: -1, redNegative: true });
      renderSheetTable($("#table-kontrol"), data.kontrolKas, { colCount: 2, numericCols: [1], dateCol: -1 });
    }
  } catch (e) {
    $("#table-kas").innerHTML = `<p class="error">${e.message}</p>`;
  }
}

$("#btn-refresh").addEventListener("click", loadDashboard);

async function runSync(flags) {
  const btn = $("#btn-sync");
  const out = $("#sync-result");
  btn.disabled = true;
  btn.textContent = "⏳ Menjalankan…";
  try {
    const r = await api("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(flags || {}),
    });
    showLog(out, ["✔ UPDATE HARIAN SELESAI — " + r.tanggal, ...r.steps.map((s) => "  • " + s)].join("\n"));
    await loadDashboard();
  } catch (e) {
    showLog(out, "✘ GAGAL: " + e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "▶ UPDATE";
  }
}

function closeSetorModal() {
  $("#setor-modal").classList.add("hidden");
}

async function openSetorModal() {
  const list = $("#setor-list");
  list.innerHTML = `<p class="loading">Membaca sisa saldo deposit…</p>`;
  $("#setor-modal").classList.remove("hidden");
  let totals = { MAUMBI: 0, PERKAMIL: 0 };
  try {
    const r = await api("/api/deposit/outlet-totals");
    totals = r.totals || totals;
  } catch (e) {
    /* tetap tampilkan pertanyaan walau total gagal dibaca */
  }
  const row = (key, label) => `
    <div class="setor-row">
      <div><b>${label}</b><div class="hint">Sisa saldo deposit: ${fmtRp(totals[key] || 0)}</div></div>
      <div class="setor-opts">
        <label><input type="radio" name="setor-${key}" value="ya"> Sudah disetor</label>
        <label><input type="radio" name="setor-${key}" value="belum" checked> Belum</label>
      </div>
    </div>`;
  list.innerHTML = row("MAUMBI", "Outlet MAUMBI") + row("PERKAMIL", "Outlet PERKAMIL");
}

$("#btn-sync").addEventListener("click", openSetorModal);
$("#btn-setor-cancel").addEventListener("click", closeSetorModal);
$("#setor-modal .img-modal-backdrop").addEventListener("click", closeSetorModal);
$("#btn-setor-go").addEventListener("click", () => {
  const confirmed = (key) => {
    const el = document.querySelector(`input[name="setor-${key}"]:checked`);
    return !!(el && el.value === "ya");
  };
  const flags = { depositMaumbi: confirmed("MAUMBI"), depositPerkamil: confirmed("PERKAMIL") };
  closeSetorModal();
  runSync(flags);
});

// ================= Pratinjau gambar (modal) =================
function openImageModal(file) {
  const modal = $("#img-modal");
  const img = $("#img-modal-img");
  if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
  const url = URL.createObjectURL(file);
  img.src = url;
  img.dataset.url = url;
  $("#img-modal-name").textContent = file.name || "bukti";
  modal.classList.remove("hidden");
}
/** Tampilkan gambar dari URL (mis. receipt dari Drive lewat /api/receipt/<id>). */
function openImageUrlModal(url, name) {
  const modal = $("#img-modal");
  const img = $("#img-modal-img");
  if (img.dataset.url) {
    URL.revokeObjectURL(img.dataset.url);
    delete img.dataset.url;
  }
  img.src = url;
  $("#img-modal-name").textContent = name || "receipt";
  modal.classList.remove("hidden");
}
function closeImageModal() {
  const modal = $("#img-modal");
  const img = $("#img-modal-img");
  modal.classList.add("hidden");
  if (img.dataset.url) {
    URL.revokeObjectURL(img.dataset.url);
    delete img.dataset.url;
  }
  img.removeAttribute("src"); // selalu bersihkan agar gambar lama tak sempat terlihat
}
$("#img-modal .img-modal-backdrop").addEventListener("click", closeImageModal);
$("#img-modal .img-modal-close").addEventListener("click", closeImageModal);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeImageModal();
});

// ================= Input Biaya =================
let OPTIONS = null;
let AI_SUGGESTIONS = null;
let BIAYA_FILES = []; // File yang diupload (untuk "lihat bukti" di pratinjau)

async function loadOptions() {
  if (!OPTIONS) {
    const [o] = await Promise.all([api("/api/biaya/options"), loadItemOpts()]);
    OPTIONS = o;
  }
  return OPTIONS;
}

// ===== ITEM BIAYA & SUB ITEM BIAYA (dropdown kolom I/J INPUT PENGGUNAAN BIAYA) =====
// Pilihan dibaca dari spreadsheet bulan berjalan. Sub-item meniru dropdown kolom J:
// hanya milik item yang dipilih; kosong bila item belum dipilih / tak punya sub-item.
let ITEM_OPTS = null;
async function loadItemOpts() {
  if (!ITEM_OPTS) {
    try {
      ITEM_OPTS = await api("/api/biaya/item-options");
    } catch (e) {
      ITEM_OPTS = { items: [], subs: {}, saran: {}, error: e.message };
    }
  }
  return ITEM_OPTS;
}
function itemSaran(keterangan) {
  const k = String(keterangan || "").trim().toLowerCase();
  return (ITEM_OPTS && ITEM_OPTS.saran && ITEM_OPTS.saran[k]) || null;
}
function fillItemSelect(sel, value) {
  const items = (ITEM_OPTS && ITEM_OPTS.items) || [];
  if (!items.length) {
    sel.innerHTML = `<option value="">(daftar item tidak tersedia)</option>`;
    sel.disabled = true;
    sel.title = (ITEM_OPTS && ITEM_OPTS.error) || "";
    return;
  }
  sel.disabled = false;
  sel.innerHTML = ['<option value="">— pilih item —</option>']
    .concat(items.map((it) => `<option value="${escapeHtml(it)}"${it === value ? " selected" : ""}>${escapeHtml(it)}</option>`))
    .join("");
}
function fillSubSelect(sel, item, value) {
  const subs = (item && ITEM_OPTS && ITEM_OPTS.subs && ITEM_OPTS.subs[item]) || [];
  sel.disabled = !item || !subs.length;
  if (!item) {
    sel.innerHTML = `<option value="">— pilih item dulu —</option>`;
    return;
  }
  if (!subs.length) {
    sel.innerHTML = `<option value="">(item ini tanpa sub-item)</option>`;
    return;
  }
  sel.innerHTML = ['<option value="">— pilih sub-item —</option>']
    .concat(subs.map((x) => `<option value="${escapeHtml(x)}"${x === value ? " selected" : ""}>${escapeHtml(x)}</option>`))
    .join("");
}
/**
 * Hubungkan sepasang dropdown item/sub-item. Saran dari keterangan hanya mengisi
 * selama user belum memilih sendiri; begitu dipilih manual, saran tidak menimpanya.
 */
function bindItemPair(itemSel, subSel, tagEl) {
  let manual = false;
  const markManual = () => {
    manual = true;
    if (tagEl) tagEl.classList.add("hidden");
  };
  itemSel.addEventListener("change", () => {
    markManual();
    fillSubSelect(subSel, itemSel.value, "");
  });
  subSel.addEventListener("change", markManual);
  return {
    applySaran(keterangan) {
      if (manual) return;
      const sr = itemSaran(keterangan);
      fillItemSelect(itemSel, sr ? sr.item : "");
      fillSubSelect(subSel, sr ? sr.item : "", sr ? sr.sub : "");
      if (tagEl) tagEl.classList.toggle("hidden", !sr);
    },
    reset() {
      manual = false;
    },
  };
}

// Datalist bersama untuk field KETERANGAN di pratinjau (ketik untuk mencari).
function ensureBiayaKetDatalist() {
  let dl = document.getElementById("dl-biaya-ket");
  if (!dl) {
    dl = document.createElement("datalist");
    dl.id = "dl-biaya-ket";
    document.body.appendChild(dl);
  }
  const opts = (OPTIONS && OPTIONS.daftarBiaya ? OPTIONS.daftarBiaya : [])
    .map((d) => `<option value="${escapeHtml(d.keterangan)}"></option>`)
    .join("");
  if (dl.innerHTML !== opts) dl.innerHTML = opts;
  return dl;
}

function biayaRowHtml(entry) {
  const o = OPTIONS;
  const sdOpts = ['<option value="">— pilih —</option>']
    .concat(o.sumberDana.map((s) => `<option${s === entry.sumberDana ? " selected" : ""}>${s}</option>`))
    .join("");
  const outletOpts = ['<option value="">— pilih —</option>']
    .concat(o.outlets.map((s) => `<option${s === entry.outlet ? " selected" : ""}>${s}</option>`))
    .join("");
  const statusOpts = o.status
    .map((s) => `<option${s === (entry.status || "BELUM INPUT") ? " selected" : ""}>${s}</option>`)
    .join("");
  const badge = entry.keyakinan ? `<span class="badge ${entry.keyakinan}">${entry.keyakinan}</span> ` : "";
  const sumber =
    entry.sumber && entry.fileIndex !== undefined && entry.fileIndex !== null
      ? `<a href="#" class="view-bukti" data-idx="${entry.fileIndex}">📎 ${escapeHtml(entry.sumber)}</a> · `
      : entry.sumber
      ? `<b>${escapeHtml(entry.sumber)}</b> · `
      : "";
  return `
    <td class="subjek">${entry.subjek || ""}</td>
    <td><input type="text" class="f-keterangan" list="dl-biaya-ket" value="${escapeHtml(entry.keterangan || "")}" placeholder="ketik untuk cari…" autocomplete="off"></td>
    <td><input type="number" class="f-nominal" value="${entry.nominal ?? ""}" min="1"></td>
    <td><input type="date" class="f-tanggal" value="${entry.tanggal || ""}"></td>
    <td><select class="f-outlet">${outletOpts}</select></td>
    <td><select class="f-status">${statusOpts}</select></td>
    <td><select class="f-sumber">${sdOpts}</select></td>
    <td><select class="f-item"></select><span class="saran-tag hidden">saran</span></td>
    <td><select class="f-subitem"></select></td>
    <td><small>otomatis</small></td>
    <td><small>${sumber}${badge}${escapeHtml(entry.catatan || "")}</small></td>
    <td><button class="btn-mini" title="Hapus baris">✕</button></td>`;
}

function addBiayaRow(entry) {
  ensureBiayaKetDatalist(); // pastikan daftar pilihan KETERANGAN siap sebelum input dirender
  const tbody = $("#biaya-table tbody");
  const tr = document.createElement("tr");
  tr.innerHTML = biayaRowHtml(entry);
  tr.querySelector(".btn-mini").addEventListener("click", () => tr.remove());
  const ketInput = tr.querySelector(".f-keterangan");
  const itemPair = bindItemPair(tr.querySelector(".f-item"), tr.querySelector(".f-subitem"), tr.querySelector(".saran-tag"));
  const syncKet = () => {
    // Cocokkan teks yang diketik/dipilih dgn daftar (tanpa peduli besar/kecil & spasi).
    const found = bmFindKeterangan(ketInput.value);
    itemPair.applySaran(found ? found.keterangan : ketInput.value);
    tr.querySelector(".subjek").textContent = found && found.subjek ? found.subjek : "";
    // Rekomendasi outlet otomatis (hanya bila outlet masih kosong); aturan dari server.
    const outletSel = tr.querySelector(".f-outlet");
    const rec = found ? (OPTIONS.outletRecommendations || {})[found.keterangan.trim().toLowerCase()] : null;
    if (rec && !outletSel.value) outletSel.value = rec;
  };
  ketInput.addEventListener("input", syncKet);
  ketInput.addEventListener("change", syncKet);
  itemPair.applySaran(ketInput.value); // isi awal dari keterangan hasil baca AI
  const viewLink = tr.querySelector(".view-bukti");
  if (viewLink) {
    viewLink.addEventListener("click", (ev) => {
      ev.preventDefault();
      const idx = Number(viewLink.dataset.idx);
      if (BIAYA_FILES[idx]) openImageModal(BIAYA_FILES[idx]);
    });
  }
  tbody.appendChild(tr);
}

$("#btn-biaya-analyze").addEventListener("click", async () => {
  const files = $("#biaya-files").files;
  const errEl = $("#biaya-error");
  errEl.classList.add("hidden");
  if (!files.length) {
    errEl.textContent = "Pilih dulu screenshot/bukti transfer.";
    errEl.classList.remove("hidden");
    return;
  }
  $("#biaya-loading").textContent =
    files.length > 1
      ? `Claude sedang membaca ${files.length} bukti…`
      : "Claude sedang membaca bukti…";
  $("#biaya-loading").classList.remove("hidden");
  $("#btn-biaya-analyze").disabled = true;
  try {
    await loadOptions();
    BIAYA_FILES = Array.from(files); // simpan untuk "lihat bukti" di pratinjau
    const fd = new FormData();
    for (const f of files) fd.append("files", f);
    const data = await api("/api/biaya/analyze", { method: "POST", body: fd });
    AI_SUGGESTIONS = data.entries;
    $("#biaya-table tbody").innerHTML = "";
    data.entries.forEach(addBiayaRow);
    $("#biaya-preview").classList.remove("hidden");
    $("#biaya-submit-result").classList.add("hidden");
    if (!data.entries.length) {
      $("#biaya-error").textContent = "Tidak ada transaksi yang terbaca dari bukti yang diupload.";
      $("#biaya-error").classList.remove("hidden");
    }
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove("hidden");
  } finally {
    $("#biaya-loading").classList.add("hidden");
    $("#btn-biaya-analyze").disabled = false;
  }
});

$("#btn-biaya-add").addEventListener("click", async () => {
  await loadOptions();
  addBiayaRow({ status: "BELUM INPUT", tanggal: new Date().toISOString().slice(0, 10) });
  $("#biaya-preview").classList.remove("hidden");
});

$("#btn-biaya-submit").addEventListener("click", async () => {
  const out = $("#biaya-submit-result");
  const rows = $$("#biaya-table tbody tr").map((tr) => ({
    keterangan: tr.querySelector(".f-keterangan").value,
    nominal: tr.querySelector(".f-nominal").value,
    tanggal: tr.querySelector(".f-tanggal").value,
    outlet: tr.querySelector(".f-outlet").value,
    status: tr.querySelector(".f-status").value,
    sumberDana: tr.querySelector(".f-sumber").value,
    itemBiaya: tr.querySelector(".f-item").value,
    subItemBiaya: tr.querySelector(".f-subitem").value,
  }));
  if (!rows.length) return showLog(out, "✘ Tidak ada baris.", true);
  $("#btn-biaya-submit").disabled = true;
  try {
    const r = await api("/api/biaya/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows, aiSuggestions: AI_SUGGESTIONS }),
    });
    showLog(out, `✔ ${r.jumlah} baris tersimpan di ${r.sheet} (baris ${r.barisAwal}–${r.barisAkhir}). AI sudah mencatat pilihan final untuk pembelajaran.`);
    $("#biaya-table tbody").innerHTML = "";
    clearFileInput($("#biaya-files"));
    AI_SUGGESTIONS = null;
  } catch (e) {
    showLog(out, "✘ " + e.message, true);
  } finally {
    $("#btn-biaya-submit").disabled = false;
  }
});

// ===== Input Biaya Manual (langsung ke INPUT PENGGUNAAN BIAYA) =====
let BM_FILLED = false;
let BM_ITEMS = null; // pasangan dropdown Item/Sub Item Biaya pada form manual
async function ensureManualBiaya() {
  await loadOptions();
  if (!BM_FILLED) {
    const o = OPTIONS;
    $("#dl-bm-keterangan").innerHTML = o.daftarBiaya
      .map((d) => `<option value="${escapeHtml(d.keterangan)}"></option>`)
      .join("");
    $("#bm-outlet").innerHTML = '<option value="">— pilih —</option>' + o.outlets.map((s) => `<option>${escapeHtml(s)}</option>`).join("");
    $("#bm-status").innerHTML = o.status.map((s) => `<option${s === "BELUM INPUT" ? " selected" : ""}>${escapeHtml(s)}</option>`).join("");
    $("#bm-sumber").innerHTML = '<option value="">— pilih —</option>' + o.sumberDana.map((s) => `<option>${escapeHtml(s)}</option>`).join("");
    BM_ITEMS = bindItemPair($("#bm-item"), $("#bm-subitem"), $("#bm-item-saran"));
    BM_ITEMS.applySaran($("#bm-keterangan").value);
    BM_FILLED = true;
  }
  const dt = $("#bm-tanggal");
  if (dt && !dt.value) dt.value = new Date().toISOString().slice(0, 10);
}

// Cari entri DAFTAR BIAYA yang cocok dengan teks (samakan tanpa peduli besar/kecil & spasi).
function bmFindKeterangan(text) {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return null;
  return (OPTIONS && OPTIONS.daftarBiaya ? OPTIONS.daftarBiaya : []).find((d) => d.keterangan.trim().toLowerCase() === t) || null;
}
function bmUpdateKeterangan() {
  const found = bmFindKeterangan($("#bm-keterangan").value);
  if (BM_ITEMS) BM_ITEMS.applySaran(found ? found.keterangan : $("#bm-keterangan").value);
  $("#bm-subjek-note").innerHTML = found && found.subjek ? `Subjek Biaya (otomatis): <b>${escapeHtml(found.subjek)}</b>` : "";
  if (found) {
    const rec = (OPTIONS.outletRecommendations || {})[found.keterangan.trim().toLowerCase()];
    if (rec && !$("#bm-outlet").value) $("#bm-outlet").value = rec;
  }
}
$("#bm-keterangan").addEventListener("input", bmUpdateKeterangan);
$("#bm-keterangan").addEventListener("change", bmUpdateKeterangan);

$("#btn-bm-submit").addEventListener("click", async () => {
  const out = $("#bm-result");
  const ket = bmFindKeterangan($("#bm-keterangan").value);
  if (!$("#bm-keterangan").value.trim()) return showLog(out, "✘ Ketik Keterangan lalu pilih dari daftar.", true);
  if (!ket) return showLog(out, "✘ Keterangan tidak ada di daftar. Ketik untuk mencari lalu pilih dari daftar yang muncul.", true);
  const row = {
    keterangan: ket.keterangan, // pakai teks persis dari daftar
    nominal: $("#bm-nominal").value,
    tanggal: $("#bm-tanggal").value,
    outlet: $("#bm-outlet").value,
    status: $("#bm-status").value,
    sumberDana: $("#bm-sumber").value,
    itemBiaya: $("#bm-item").value,
    subItemBiaya: $("#bm-subitem").value,
  };
  if (!row.nominal || Number(row.nominal) <= 0) return showLog(out, "✘ Nominal tidak valid.", true);
  if (!row.tanggal) return showLog(out, "✘ Pilih tanggal.", true);
  if (!row.outlet) return showLog(out, "✘ Pilih outlet.", true);
  const btn = $("#btn-bm-submit");
  btn.disabled = true;
  try {
    const r = await api("/api/biaya/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: [row] }),
    });
    showLog(out, `✔ Tersimpan di ${r.sheet} baris ${r.barisAwal}. ${escapeHtml(row.keterangan)} · ${fmtRp(row.nominal)} · ${escapeHtml(row.outlet)}.`);
    $("#bm-keterangan").value = "";
    $("#bm-nominal").value = "";
    $("#bm-subjek-note").innerHTML = "";
    if (BM_ITEMS) {
      BM_ITEMS.reset();
      BM_ITEMS.applySaran("");
    }
    loadSmart(); // perbarui daftar & notifikasi Lapor Smartlink (biaya baru bisa BELUM INPUT)
  } catch (e) {
    showLog(out, "✘ " + e.message, true);
  } finally {
    btn.disabled = false;
  }
});

// ================= Input Kas =================
function initKasCard(card) {
  const jenis = card.dataset.jenis;
  const body = document.createElement("div");
  body.innerHTML = `
    <div class="kas-last" data-key="${jenis}"></div>
    <div class="upload-row">
      <div class="dropzone kas-dz">
        <div class="dz-text">📎 <b>Tarik &amp; lepas</b>, <b>tempel (Ctrl/Cmd+V)</b>, atau pilih file:</div>
        <input type="file" accept="image/*" multiple class="kas-files">
        <div class="dz-count kas-count"></div>
      </div>
      <button class="btn-primary kas-analyze">🔍 Analisis</button>
    </div>
    <div class="loading hidden kas-loading">Claude sedang membaca screenshot…</div>
    <div class="error hidden kas-error"></div>
    <div class="kas-preview hidden">
      <div class="table-wrap"><table>
        <thead><tr><th>Tujuan</th><th>Sel</th><th>Nominal (Rp)</th><th>Catatan AI</th></tr></thead>
        <tbody></tbody>
      </table></div>
      <div class="actions"><button class="btn-primary kas-submit">✔ Konfirmasi &amp; Simpan</button></div>
    </div>
    <div class="result-log hidden kas-result"></div>`;
  card.appendChild(body);

  const fileInput = card.querySelector(".kas-files");
  initDropzone(card.querySelector(".kas-dz"), fileInput, card.querySelector(".kas-count"));
  const errEl = card.querySelector(".kas-error");
  const loadEl = card.querySelector(".kas-loading");
  const preview = card.querySelector(".kas-preview");
  const tbody = card.querySelector("tbody");
  const resultEl = card.querySelector(".kas-result");
  let items = [];

  card.querySelector(".kas-analyze").addEventListener("click", async () => {
    errEl.classList.add("hidden");
    if (!fileInput.files.length) {
      errEl.textContent = "Pilih dulu screenshot.";
      errEl.classList.remove("hidden");
      return;
    }
    loadEl.classList.remove("hidden");
    try {
      const fd = new FormData();
      fd.append("jenis", jenis);
      for (const f of fileInput.files) fd.append("files", f);
      const data = await api("/api/kas/analyze", { method: "POST", body: fd });
      items = data.items.filter((it) => it.valid);
      const invalid = data.items.filter((it) => !it.valid);
      tbody.innerHTML = "";
      items.forEach((it, i) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${it.label}</td>
          <td><code>${it.target}</code></td>
          <td><input type="number" value="${it.nominal}" data-i="${i}"></td>
          <td><small>${it.catatan || ""}</small></td>`;
        tbody.appendChild(tr);
      });
      if (invalid.length) {
        errEl.textContent = "Sebagian item tidak dikenali target selnya dan dilewati.";
        errEl.classList.remove("hidden");
      }
      preview.classList.toggle("hidden", items.length === 0);
      resultEl.classList.add("hidden");
      if (!items.length) {
        errEl.textContent = "Tidak ada nominal yang terbaca dari screenshot.";
        errEl.classList.remove("hidden");
      }
    } catch (e) {
      errEl.textContent = e.message;
      errEl.classList.remove("hidden");
    } finally {
      loadEl.classList.add("hidden");
    }
  });

  card.querySelector(".kas-submit").addEventListener("click", async () => {
    tbody.querySelectorAll("input[type=number]").forEach((inp) => {
      items[Number(inp.dataset.i)].nominal = Number(inp.value);
    });
    try {
      const r = await api("/api/kas/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jenis, items: items.map(({ key, nominal }) => ({ key, nominal })) }),
      });
      showLog(resultEl, ["✔ Tersimpan (" + r.tanggal + "):", ...r.written.map((w) => `  • ${w.label}: ${fmtRp(w.nominal)} → ${w.cell}`)].join("\n"));
      setKasLast(jenis, r.lastUpload);
      preview.classList.add("hidden");
      clearFileInput(fileInput);
      loadDashboard();
    } catch (e) {
      showLog(resultEl, "✘ " + e.message, true);
    }
  });
}

// Info "upload data terakhir" per bagian di tab Input Kas.
function setKasLast(key, info) {
  const el = document.querySelector(`.kas-last[data-key="${key}"]`);
  if (!el) return;
  // Merah bila upload terakhir bukan hari ini (atau belum pernah).
  el.classList.toggle("kas-last-old", !(info && info.today));
  el.innerHTML =
    info && info.display
      ? `🕒 Upload data terakhir: <b>${escapeHtml(info.display)}</b>`
      : `🕒 Upload data terakhir: <i>belum pernah</i>`;
}
function renderKasUploads(map) {
  ["bank", "aplikasi-outlet", "bank-aplikasi", "belum-settlement", "qris", "qrisbank"].forEach((k) =>
    setKasLast(k, map ? map[k] : null)
  );
}

// Kumpulan elemen tampilan sementara di tab Input Kas (6 bagian: 4 kartu kas +
// QRIS + transfer EDC). Dipakai tombol "Muat ulang" untuk mengembalikan tab ke
// kondisi bersih seperti halaman baru dibuka.
const kasPreviews = () => $$("#tab-kas .kas-preview, #qris-preview, #qbank-preview");
const kasFileInputs = () => $$("#tab-kas input[type=file]");

/** Ada pekerjaan yang belum disimpan (pratinjau terbuka / berkas sudah dipilih)? */
function kasHasPending() {
  return (
    kasPreviews().some((el) => !el.classList.contains("hidden")) ||
    kasFileInputs().some((inp) => inp.files && inp.files.length)
  );
}

/**
 * Muat ulang tab Input Kas: perbarui info "Upload data terakhir" (termasuk tanda
 * merah bila bukan hari ini) dan bersihkan pratinjau/pesan/berkas di semua bagian
 * — tanpa perlu me-refresh browser. Bila ada yang belum disimpan, minta konfirmasi.
 */
async function kasRefresh() {
  const btn = $("#btn-kas-refresh");
  if (kasHasPending() &&
      !window.confirm("Muat ulang akan mengosongkan pratinjau dan berkas yang belum disimpan di tab Input Kas. Lanjutkan?")) {
    return;
  }
  const prev = btn.textContent;
  btn.disabled = true;
  btn.textContent = "⟳ Memuat…";
  try {
    kasPreviews().forEach((el) => el.classList.add("hidden"));
    $$("#tab-kas .kas-error, #qris-error, #qbank-error").forEach((el) => el.classList.add("hidden"));
    $$("#tab-kas .kas-loading, #qris-loading, #qbank-loading").forEach((el) => el.classList.add("hidden"));
    $$("#tab-kas .kas-result, #qris-result, #qbank-result").forEach((el) => el.classList.add("hidden"));
    $$("#qris-table tbody, #qbank-table tbody").forEach((tb) => (tb.innerHTML = ""));
    $("#qbank-summary").innerHTML = "";
    kasFileInputs().forEach(clearFileInput);
    await loadStatus(); // sumber info "Upload data terakhir" per bagian
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
}
$("#btn-kas-refresh").addEventListener("click", kasRefresh);

$$(".kas-card").forEach(initKasCard);

// ================= Pendapatan EDC Harian (INPUT QRIS) =================
const QRIS_OUTLETS = ["MAUMBI", "PERKAMIL"];

function addQrisRow(entry) {
  const tbody = $("#qris-table tbody");
  const tr = document.createElement("tr");
  const outletOpts = ['<option value="">— pilih —</option>']
    .concat(QRIS_OUTLETS.map((o) => `<option${o === entry.outlet ? " selected" : ""}>${o}</option>`))
    .join("");
  tr.innerHTML = `
    <td><input type="date" class="q-tanggal" value="${entry.tanggal || ""}"></td>
    <td><input type="number" class="q-nominal" value="${entry.nominal ?? ""}" min="1"></td>
    <td><select class="q-outlet">${outletOpts}</select></td>
    <td><small>${escapeHtml(entry.catatan || "")}</small></td>
    <td><button class="btn-mini" title="Hapus baris">✕</button></td>`;
  tr.querySelector(".btn-mini").addEventListener("click", () => tr.remove());
  tbody.appendChild(tr);
}

$("#btn-qris-analyze").addEventListener("click", async () => {
  const files = $("#qris-files").files;
  const errEl = $("#qris-error");
  errEl.classList.add("hidden");
  if (!files.length) {
    errEl.textContent = "Pilih dulu screenshot pendapatan EDC.";
    errEl.classList.remove("hidden");
    return;
  }
  $("#qris-loading").classList.remove("hidden");
  $("#btn-qris-analyze").disabled = true;
  try {
    const fd = new FormData();
    for (const f of files) fd.append("files", f);
    const data = await api("/api/qris/analyze", { method: "POST", body: fd });
    $("#qris-table tbody").innerHTML = "";
    data.entries.forEach(addQrisRow);
    $("#qris-preview").classList.remove("hidden");
    $("#qris-result").classList.add("hidden");
    if (!data.entries.length) {
      errEl.textContent = "Tidak ada baris yang terbaca dari screenshot.";
      errEl.classList.remove("hidden");
    }
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove("hidden");
  } finally {
    $("#qris-loading").classList.add("hidden");
    $("#btn-qris-analyze").disabled = false;
  }
});

$("#btn-qris-add").addEventListener("click", () => {
  addQrisRow({ tanggal: new Date().toISOString().slice(0, 10) });
  $("#qris-preview").classList.remove("hidden");
});

$("#btn-qris-submit").addEventListener("click", async () => {
  const out = $("#qris-result");
  const rows = $$("#qris-table tbody tr").map((tr) => ({
    tanggal: tr.querySelector(".q-tanggal").value,
    nominal: tr.querySelector(".q-nominal").value,
    outlet: tr.querySelector(".q-outlet").value,
  }));
  if (!rows.length) return showLog(out, "✘ Tidak ada baris.", true);
  $("#btn-qris-submit").disabled = true;
  try {
    const r = await api("/api/qris/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows }),
    });
    showLog(out, `✔ ${r.jumlah} baris tersimpan di ${r.sheet} (baris ${r.barisAwal}–${r.barisAkhir}).`);
    setKasLast("qris", r.lastUpload);
    $("#qris-table tbody").innerHTML = "";
    clearFileInput($("#qris-files"));
    $("#qris-preview").classList.add("hidden");
  } catch (e) {
    showLog(out, "✘ " + e.message, true);
  } finally {
    $("#btn-qris-submit").disabled = false;
  }
});

// ================= Transfer Masuk Dana EDC (DATA QRIS) =================
let QBANK_DATEROWS = {};

function isoToDDMMYYYY(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

function renderQbankSummary() {
  // Kelompokkan baris tercentang per tanggal, hitung formula + baris tujuan.
  const groups = {};
  $$("#qbank-table tbody tr").forEach((tr) => {
    if (!tr.querySelector(".qb-include").checked) return;
    const iso = tr.querySelector(".qb-tanggal").value;
    const nom = Math.round(Number(tr.querySelector(".qb-nominal").value));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || !Number.isFinite(nom) || nom <= 0) return;
    (groups[iso] = groups[iso] || []).push(nom);
  });
  const keys = Object.keys(groups).sort();
  if (!keys.length) {
    $("#qbank-summary").innerHTML = `<p class="hint">Belum ada entri positif tercentang.</p>`;
    return;
  }
  const rows = keys.map((iso) => {
    const noms = groups[iso];
    const total = noms.reduce((a, b) => a + b, 0);
    const formula = noms.length === 1 ? String(noms[0]) : "=" + noms.join("+");
    const row = QBANK_DATEROWS[iso];
    const target = row ? `B${row}` : `<span style="color:#b3402f">tanggal tak ada di DATA QRIS</span>`;
    return `<tr><td>${isoToDDMMYYYY(iso)}</td><td>${target}</td><td><code>${escapeHtml(formula)}</code></td><td class="num">${fmtRp(total)}</td></tr>`;
  });
  $("#qbank-summary").innerHTML =
    `<table><thead><tr><th>Tanggal</th><th>Sel</th><th>Isi (formula)</th><th>Total</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

function addQbankRow(e) {
  const tbody = $("#qbank-table tbody");
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td style="text-align:center"><input type="checkbox" class="qb-include"${e.include ? " checked" : ""}></td>
    <td><input type="date" class="qb-tanggal" value="${e.tanggal || ""}"></td>
    <td><small>${escapeHtml(e.subjek || "")}</small></td>
    <td><input type="number" class="qb-nominal" value="${e.nominal ?? ""}"></td>
    <td style="text-align:center">${e.topup ? "✔" : "—"}</td>`;
  tr.querySelector(".qb-include").addEventListener("change", renderQbankSummary);
  tr.querySelector(".qb-tanggal").addEventListener("change", renderQbankSummary);
  tr.querySelector(".qb-nominal").addEventListener("input", renderQbankSummary);
  tbody.appendChild(tr);
}

$("#btn-qbank-analyze").addEventListener("click", async () => {
  const files = $("#qbank-files").files;
  const errEl = $("#qbank-error");
  errEl.classList.add("hidden");
  if (!files.length) {
    errEl.textContent = "Pilih dulu screenshot mutasi transfer EDC.";
    errEl.classList.remove("hidden");
    return;
  }
  $("#qbank-loading").classList.remove("hidden");
  $("#btn-qbank-analyze").disabled = true;
  try {
    const fd = new FormData();
    for (const f of files) fd.append("files", f);
    const data = await api("/api/qrisbank/analyze", { method: "POST", body: fd });
    QBANK_DATEROWS = data.dateRows || {};
    $("#qbank-table tbody").innerHTML = "";
    data.entries.forEach(addQbankRow);
    renderQbankSummary();
    $("#qbank-preview").classList.remove("hidden");
    $("#qbank-result").classList.add("hidden");
    if (!data.entries.length) {
      errEl.textContent = "Tidak ada transaksi yang terbaca dari screenshot.";
      errEl.classList.remove("hidden");
    }
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove("hidden");
  } finally {
    $("#qbank-loading").classList.add("hidden");
    $("#btn-qbank-analyze").disabled = false;
  }
});

$("#btn-qbank-submit").addEventListener("click", async () => {
  const out = $("#qbank-result");
  const entries = $$("#qbank-table tbody tr")
    .filter((tr) => tr.querySelector(".qb-include").checked)
    .map((tr) => ({
      tanggal: tr.querySelector(".qb-tanggal").value,
      nominal: tr.querySelector(".qb-nominal").value,
    }));
  if (!entries.length) return showLog(out, "✘ Centang minimal satu entri positif.", true);
  $("#btn-qbank-submit").disabled = true;
  try {
    const r = await api("/api/qrisbank/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries }),
    });
    const lines = ["✔ Tersimpan ke " + r.sheet + ":", ...r.written.map((w) => `  • ${w.tanggal} → ${w.sheet || "B" + w.row} = ${escapeHtml(w.formula)} (${fmtRp(w.total)})`)];
    if (r.skipped && r.skipped.length) lines.push(`⚠ Dilewati (tanggal tak ditemukan): ${r.skipped.map((s) => s.tanggal).join(", ")}`);
    showLog(out, lines.join("\n"));
    setKasLast("qrisbank", r.lastUpload);
    $("#qbank-table tbody").innerHTML = "";
    $("#qbank-summary").innerHTML = "";
    clearFileInput($("#qbank-files"));
    $("#qbank-preview").classList.add("hidden");
    loadDashboard();
  } catch (e) {
    showLog(out, "✘ " + e.message, true);
  } finally {
    $("#btn-qbank-submit").disabled = false;
  }
});

// ================= Monitoring Biaya =================
let MONBIAYA = null;
let MONBIAYA_LOADED = false;
const MB_NOMOR_COL = 0; // NOMOR (bisa diklik bila ada receipt)
const MB_SUBJEK_COL = 1; // SUBJEK BIAYA
const MB_KETERANGAN_COL = 2; // KETERANGAN
const MB_TANGGAL_COL = 4; // TANGGAL
const MB_STATUS_COL = 10; // STATUS LAPOR APLIKASI
const MB_KODE_COL = 11; // KODE TRANSAKSI
const MB_VERIF_COL = 12; // VERIFIKASI OWNER
const MB_KOREKSI_COL = 13; // KETERANGAN KOREKSI (alasan penolakan)

// Baris "siap" = kedua kolom sudah centang hijau (bisa diexport, tanggal tidak merah).
function mbRowReady(status, verif) {
  return status === "SUDAH INPUT" && verif === "SUDAH VERIFIKASI OWNER";
}
// Perbarui tanda merah kolom tanggal sesuai status/verifikasi terkini pada baris.
function mbRefreshRow(tr) {
  if (!tr) return;
  const s = tr.querySelector(".mb-status");
  const v = tr.querySelector(".mb-verif");
  const tgl = tr.querySelector(".mb-tgl");
  if (tgl) tgl.classList.toggle("mb-tgl-red", !mbRowReady(s && s.dataset.val, v && v.dataset.val));
}
const MB_HIDDEN = new Set([8, 9]); // POS BIAYA APLIKASI & ITEM BIAYA: tidak ditampilkan

function mbUpdateCount() {
  const n = $$("#monbiaya-table .mb-check:checked").length;
  $("#monbiaya-count").textContent = `${n} dipilih`;
}

// Label tampilan tombol status: "SUDAH ..." -> centang hijau (✓). Nilai asli tetap dipakai.
function mbLabel(val) {
  if (val === "SUDAH INPUT" || val === "SUDAH VERIFIKASI OWNER") return "✓";
  return val || "—";
}

function renderMonBiaya() {
  const el = $("#monbiaya-table");
  if (!MONBIAYA || !MONBIAYA.rows.length) {
    el.innerHTML = `<p class="hint">Tidak ada biaya yang menunggu (semua sudah input &amp; terverifikasi). 🎉</p>`;
    mbUpdateCount();
    return;
  }
  const heads = ['<th><input type="checkbox" id="mb-checkall" title="Pilih semua"></th>']
    .concat(MONBIAYA.headers.map((h, i) => (MB_HIDDEN.has(i) ? "" : `<th>${escapeHtml(h)}</th>`)))
    .join("");
  const body = MONBIAYA.rows
    .map((r) => {
      const ready = mbRowReady(r.status, r.verifikasi);
      const tds = r.cells
        .map((c, col) => {
          if (MB_HIDDEN.has(col)) return ""; // kolom disembunyikan
          if (col === MB_NOMOR_COL) {
            // Ada foto receipt di Drive -> nomor jadi bisa diklik untuk melihatnya.
            if (!r.receipt) return `<td class="mb-nomor">${escapeHtml(c)}</td>`;
            return (
              `<td class="mb-nomor mb-has-receipt" data-receipt="${escapeHtml(r.receipt.id)}"` +
              ` data-receipt-name="${escapeHtml(r.receipt.name)}"` +
              ` title="Klik untuk melihat receipt: ${escapeHtml(r.receipt.name)}">📎 ${escapeHtml(c)}</td>`
            );
          }
          if (col === MB_SUBJEK_COL) {
            const yellow = c.trim().toLowerCase() === "setoran owner" ? " mb-subjek-yellow" : "";
            const copy = c ? " mb-copy" : "";
            const attr = c ? ` data-copy="${escapeHtml(c)}" title="Klik untuk menyalin"` : "";
            return `<td class="mb-subjek${yellow}${copy}"${attr}>${escapeHtml(c)}</td>`;
          }
          if (col === MB_KETERANGAN_COL) {
            if (!c) return `<td></td>`;
            return `<td class="mb-copy" data-copy="${escapeHtml(c)}" title="Klik untuk menyalin">${escapeHtml(c)}</td>`;
          }
          if (col === MB_TANGGAL_COL) {
            return `<td class="mb-tgl${ready ? "" : " mb-tgl-red"}">${escapeHtml(c)}</td>`;
          }
          if (col === MB_STATUS_COL) {
            return `<td><button class="mb-btn mb-status" data-row="${r.row}" data-val="${escapeHtml(c)}" title="${escapeHtml(c || "(kosong)")}">${escapeHtml(mbLabel(c))}</button></td>`;
          }
          if (col === MB_VERIF_COL) {
            return `<td><button class="mb-btn mb-verif" data-row="${r.row}" data-val="${escapeHtml(c)}" title="${escapeHtml(c || "(kosong)")}">${escapeHtml(mbLabel(c))}</button></td>`;
          }
          if (col === MB_KODE_COL) {
            return `<td class="mb-kode" data-kode="${escapeHtml(c)}" title="Klik untuk menyalin">${escapeHtml(c)}</td>`;
          }
          if (col === MB_KOREKSI_COL) {
            return `<td><input type="text" class="mb-koreksi" data-row="${r.row}" value="${escapeHtml(c)}" placeholder="alasan penolakan…"><button class="mb-koreksi-save" data-row="${r.row}">Simpan</button></td>`;
          }
          return `<td>${escapeHtml(c)}</td>`;
        })
        .join("");
      return `<tr><td style="text-align:center"><input type="checkbox" class="mb-check" data-row="${r.row}"></td>${tds}</tr>`;
    })
    .join("");
  el.innerHTML = `<table id="monbiaya-grid"><thead><tr>${heads}</tr></thead><tbody>${body}</tbody></table>`;
  mbUpdateCount();
}

// Tanda notifikasi merah pada judul tab (mis. jumlah biaya yang masih tertampil).
function updateTabBadge(tabName, count) {
  const btn = document.querySelector(`.tab[data-tab="${tabName}"]`);
  if (!btn) return;
  let b = btn.querySelector(".tab-badge");
  if (count > 0) {
    if (!b) {
      b = document.createElement("span");
      b.className = "tab-badge";
      btn.appendChild(b);
    }
    b.textContent = count > 99 ? "99+" : String(count);
  } else if (b) {
    b.remove();
  }
}

async function loadMonBiaya(refresh) {
  const el = $("#monbiaya-table");
  el.innerHTML = "Memuat…";
  try {
    MONBIAYA = await api("/api/monbiaya/list" + (refresh ? "?refresh=1" : ""));
    MONBIAYA_LOADED = true;
    renderMonBiaya();
    updateTabBadge("monbiaya", (MONBIAYA.rows || []).length);
    // Folder receipt di Drive tak terbaca -> beri tahu (daftar tetap tampil).
    if (MONBIAYA.receiptError) {
      showLog(
        $("#monbiaya-result"),
        "⚠ Folder receipt di Google Drive tidak bisa dibaca, jadi nomor tidak bisa diklik: " +
          MONBIAYA.receiptError +
          "\nBagikan folder receipt ke email service account (lihat tab Pengaturan) sebagai Viewer.",
        true
      );
    }
  } catch (e) {
    el.innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`;
  }
}

async function mbCycleStatus(btn, field) {
  const opts = field === "status" ? MONBIAYA.statusOptions : MONBIAYA.verifOptions;
  const cur = btn.dataset.val || "";
  const idx = opts.indexOf(cur);
  const next = opts[(idx + 1) % opts.length];
  const prevLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = "…";
  try {
    await api("/api/monbiaya/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ row: Number(btn.dataset.row), field, value: next }),
    });
    btn.dataset.val = next;
    btn.textContent = mbLabel(next);
    btn.title = next || "(kosong)";
    mbRefreshRow(btn.closest("tr")); // perbarui tanda merah kolom tanggal
  } catch (e) {
    btn.textContent = prevLabel;
    btn.classList.add("err");
    setTimeout(() => btn.classList.remove("err"), 1500);
    const isProtected = /protected/i.test(e.message || "");
    const kolom = field === "verifikasi" ? "VERIFIKASI OWNER (kolom M)" : "STATUS LAPOR APLIKASI (kolom K)";
    showLog(
      $("#monbiaya-result"),
      isProtected
        ? `✘ Tidak bisa mengubah ${kolom} — sel DIPROTEKSI di sheet BIAYA. Tambahkan service account ke daftar editor yang diizinkan pada proteksi kolom itu (Data → Lindungi sheet dan rentang), lalu coba lagi.`
        : `✘ Gagal mengubah ${kolom}: ${e.message}`,
      true
    );
  } finally {
    btn.disabled = false;
  }
}

async function mbCopy(el) {
  // Sel KODE memakai data-kode; sel SUBJEK/KETERANGAN memakai data-copy.
  const isKode = el.dataset.kode != null;
  const text = el.dataset.copy != null ? el.dataset.copy : el.dataset.kode || "";
  const label = isKode ? "Kode" : "Teks";
  try {
    await copyTextToClipboard(text);
    el.classList.add("copied");
    setTimeout(() => el.classList.remove("copied"), 900);
    showLog($("#monbiaya-result"), `✔ ${label} disalin: "${text}"`);
  } catch {
    showLog($("#monbiaya-result"), `✘ Gagal menyalin ${label.toLowerCase()}.`, true);
  }
}

async function mbSaveKoreksi(row, inputEl, btn) {
  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = "…";
  try {
    const r = await api("/api/monbiaya/koreksi", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ row, text: inputEl.value }),
    });
    if (r.verifikasi) {
      const tr = inputEl.closest("tr");
      const vbtn = tr && tr.querySelector(".mb-verif");
      if (vbtn) {
        vbtn.dataset.val = r.verifikasi;
        vbtn.textContent = mbLabel(r.verifikasi);
        vbtn.title = r.verifikasi;
      }
      mbRefreshRow(inputEl.closest("tr")); // koreksi -> SALAH INPUT -> tanggal merah
    }
    showLog($("#monbiaya-result"), `✔ Keterangan koreksi disimpan${r.verifikasi ? " · Verifikasi Owner → SALAH INPUT" : ""}.`);
  } catch (e) {
    showLog($("#monbiaya-result"), "✘ Gagal simpan koreksi: " + e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
}

// Event delegation untuk tabel monitoring biaya.
$("#monbiaya-table").addEventListener("click", (e) => {
  const t = e.target;
  if (t.classList.contains("mb-status")) mbCycleStatus(t, "status");
  else if (t.classList.contains("mb-verif")) mbCycleStatus(t, "verifikasi");
  else if (t.classList.contains("mb-has-receipt")) openImageUrlModal(`/api/receipt/${encodeURIComponent(t.dataset.receipt)}`, t.dataset.receiptName);
  else if (t.classList.contains("mb-kode") || t.classList.contains("mb-copy")) mbCopy(t);
  else if (t.classList.contains("mb-koreksi-save")) {
    const tr = t.closest("tr");
    const inp = tr && tr.querySelector(".mb-koreksi");
    if (inp) mbSaveKoreksi(Number(t.dataset.row), inp, t);
  }
});
$("#monbiaya-table").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.classList.contains("mb-koreksi")) {
    e.preventDefault();
    const tr = e.target.closest("tr");
    const btn = tr && tr.querySelector(".mb-koreksi-save");
    if (btn) mbSaveKoreksi(Number(e.target.dataset.row), e.target, btn);
  }
});
$("#monbiaya-table").addEventListener("change", (e) => {
  if (e.target.id === "mb-checkall") {
    $$("#monbiaya-table .mb-check").forEach((c) => (c.checked = e.target.checked));
  }
  if (e.target.classList.contains("mb-check") || e.target.id === "mb-checkall") mbUpdateCount();
});

$("#btn-monbiaya-refresh").addEventListener("click", () => loadMonBiaya(true));

// ================= Robot Smartlink otomatis (skill) =================
// Tombol di menu Monitoring Biaya, Lapor Smartlink, dan Input Kas menjalankan skill
// Smartlink milik Andre di server (robot browser + Claude). Tiap menu punya panel
// sendiri: progres langsung (langkah, layar terakhir, log), kartu pertanyaan saat
// robot menunggu jawaban (pengganti AskUserQuestion), lalu laporan akhir.
let KF = null; // status terakhir dari server
let KF_TIMER = null;
let KF_WAS_ACTIVE = null; // job yang tadinya berjalan
const KF_VIEW = {}; // per kotak: run riwayat yang sedang dilihat (null = terbaru)

const KF_BOXES = [
  { key: "mb", jobs: ["biaya", "setoran"], panel: "#kf-panel", show: "#kf-show", busy: "#kf-busy", msg: "#kf-msg", tab: "monbiaya" },
  { key: "sl", jobs: ["input_setoran", "input_biaya"], panel: "#kfl-panel", show: "#kfl-show", busy: "#kfl-busy", msg: "#kfl-msg", tab: "smartlink" },
  { key: "kas", jobs: ["input_kas", "settlement"], panel: "#kfk-panel", show: "#kfk-show", busy: "#kfk-busy", msg: "#kfk-msg", tab: "kas" },
];
const KF_JOBS = {
  biaya: { title: "Konfirmasi Biaya Outlet", menu: "Monitoring Biaya" },
  setoran: { title: "Konfirmasi Setoran Owner", menu: "Monitoring Biaya" },
  input_setoran: { title: "Input Setoran Owner", menu: "Lapor Smartlink" },
  input_biaya: { title: "Input Biaya ke Smartlink", menu: "Lapor Smartlink" },
  input_kas: { title: "Input Kas Harian", menu: "Input Kas" },
  settlement: { title: "Settlement QRIS", menu: "Input Kas" },
};
const kfBoxOf = (job) => KF_BOXES.find((b) => b.jobs.includes(job));

const KF_ALASAN = {
  TIDAK_ADA_PASANGAN: "tidak ada pasangan di dashboard",
  AMBIGU: "ambigu — lebih dari satu baris cocok",
  SUMBER_BANK: "sumber dana bank, bukan kas tunai",
  SUDAH_TERVERIFIKASI: "baris dashboard sudah terverifikasi",
  TANPA_KETERANGAN: "tanpa keterangan di Smartlink",
  TANPA_KODE: "kode transaksi kosong di dashboard",
  GAGAL_VERIFIKASI: "gagal menandai ✓ di dashboard",
  GAGAL_SETUJUI: "gagal menyetujui di Smartlink",
  LAINNYA: "lainnya",
};

function kfDur(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m} mnt ${s} dtk` : `${s} dtk`;
}
function kfTgl(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : escapeHtml(iso || "—");
}
function kfWaktu(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
function kfCost(usd) {
  return usd == null ? "" : `$${Number(usd).toFixed(2)}`;
}
function kfMsg(box, text, isError) {
  const el = $(box.msg);
  if (el) showLog(el, text, isError);
}

function kfSchedule() {
  clearTimeout(KF_TIMER);
  if (KF && KF.active) KF_TIMER = setTimeout(kfPoll, document.hidden ? 5000 : 2000);
}

async function kfPoll() {
  try {
    KF = await api("/api/konfirmasi/status");
  } catch {
    kfSchedule();
    return;
  }
  if (KF.active) {
    const b = kfBoxOf(KF.activeJob);
    if (b) KF_VIEW[b.key] = null; // proses baru → tampilkan yang sedang berjalan
  }
  kfRender();
  // Proses selesai → muat ulang data menu terkait agar hasilnya langsung terlihat.
  if (KF_WAS_ACTIVE && !KF.active) {
    const b = kfBoxOf(KF_WAS_ACTIVE);
    if (b && b.key === "mb" && MONBIAYA_LOADED) loadMonBiaya();
    if (b && b.key === "sl" && SMART_LOADED) loadSmart();
    if (b && b.key === "kas") loadStatus();
  }
  KF_WAS_ACTIVE = KF.active ? KF.activeJob : null;
  kfSchedule();
}

function kfTabIndicator(k) {
  // Tanda dibuat lewat CSS (::after), bukan elemen teks: skill mencari tombol tab
  // dengan innerText persis (mis. 'Input Kas'), termasuk di tab dashboard milik robot.
  for (const box of KF_BOXES) {
    const btn = document.querySelector(`.tab[data-tab="${box.tab}"]`);
    if (!btn) continue;
    const mine = k.active && box.jobs.includes(k.activeJob);
    const waiting = mine && k.run && k.run.phase === "waiting";
    btn.classList.toggle("kf-robot-on", mine && !waiting);
    btn.classList.toggle("kf-robot-wait", waiting);
    btn.title = waiting ? "Robot menunggu jawaban Anda" : mine ? "Robot Smartlink sedang berjalan" : "";
  }
}

function kfLatest(k, jobs) {
  let best = null;
  for (const j of jobs) {
    const r = k.runs && k.runs[j];
    if (r && (!best || Date.parse(r.startedAt) > Date.parse(best.startedAt))) best = r;
  }
  return best;
}

function kfRender() {
  const k = KF;
  if (!k) return;
  const active = k.active;
  $$(".kf-start").forEach((b) => (b.disabled = active));
  $("#btn-kf-login").disabled = active;
  $("#btn-kf-login").textContent = k.login && k.login.open ? "✔ Selesai login (tutup jendela)" : "🔑 Login Smartlink";
  kfTabIndicator(k);
  kfRenderAkun(k.akun);

  for (const box of KF_BOXES) {
    const mine = active && box.jobs.includes(k.activeJob);
    $$(`.kf-stop-btn[data-box="${box.key}"]`).forEach((b) => b.classList.toggle("hidden", !mine));
    const busy = $(box.busy);
    if (busy) {
      const other = active && !mine;
      busy.classList.toggle("hidden", !other);
      if (other) {
        const j = KF_JOBS[k.activeJob] || { title: k.activeJob, menu: "?" };
        busy.textContent = `🤖 Robot sedang menjalankan “${j.title}” (menu ${j.menu}). Tombol di sini aktif lagi setelah selesai.`;
      }
    }
    const panel = $(box.panel);
    const view = KF_VIEW[box.key];
    const run = mine && !view ? k.run : view || kfLatest(k, box.jobs);
    const loginNote = box.key === "mb" && k.login && k.login.open;
    if (!run && !loginNote) {
      panel.classList.add("hidden");
      continue;
    }
    panel.classList.remove("hidden");
    panel._kfRun = run;
    if (mine && !view) kfRenderProgress(panel, run, k);
    else if (run && run.job && run.job !== "biaya") kfRenderGeneric(panel, run, k, box);
    else kfRenderResult(panel, run, k, box);
  }
}

// ---------- Tampilan "dalam progress" ----------
function kfRenderProgress(panel, run, k) {
  if (panel.dataset.kind !== "progress" || panel.dataset.runId !== run.id) {
    panel.dataset.kind = "progress";
    panel.dataset.runId = run.id;
    panel.dataset.shotAt = "";
    panel.innerHTML = `
      <div class="kf-progress">
        <div class="kf-jobtitle"></div>
        <div class="kf-status"><span class="kf-spin"></span><b class="kf-phase"></b><span class="kf-elapsed hint"></span></div>
        <div class="kf-question hidden"></div>
        <div class="kf-step"></div>
        <div class="kf-stats"></div>
        <div class="kf-live">
          <figure class="kf-shot">
            <img alt="Layar yang sedang dilihat robot" class="hidden" />
            <div class="kf-shot-empty hint">Menunggu layar pertama dari Smartlink…</div>
            <figcaption class="hint">Layar yang sedang dilihat robot · klik untuk memperbesar</figcaption>
          </figure>
          <ol class="kf-log"></ol>
        </div>
      </div>`;
    panel.querySelector(".kf-shot img").addEventListener("click", (e) => openImageUrlModal(e.target.src, "Layar robot"));
  }
  const title = run.jobTitle || (KF_JOBS[run.job] || {}).title || "Robot Smartlink";
  panel.querySelector(".kf-jobtitle").textContent = `🤖 ${title}${run.param && run.param.tanggal ? ` · tanggal ${kfTgl(run.param.tanggal)}` : ""}`;
  const waiting = run.phase === "waiting";
  panel.querySelector(".kf-spin").classList.toggle("kf-spin-wait", waiting);
  panel.querySelector(".kf-phase").textContent = waiting
    ? "Menunggu jawaban Anda"
    : (run.phase === "starting" ? "Menyiapkan" : "Sedang berjalan") + (run.dryRun ? " — CEK SAJA" : "") + "…";
  panel.querySelector(".kf-elapsed").textContent = " · " + kfDur(run.elapsedSec);
  panel.querySelector(".kf-step").textContent = run.step || "";
  kfRenderQuestion(panel.querySelector(".kf-question"), run.question);

  const c = run.counts || {};
  let chips;
  if (run.job === "biaya" || !run.job) {
    chips = run.dryRun
      ? [`🟢 ${c.cocok || 0} cocok`, `⏭ ${c.dilewati || 0} dilewati`]
      : [`✅ ${c.disetujui || 0} disetujui`, `⏭ ${c.dilewati || 0} dilewati`];
    if (c.sudah) chips.push(`☑ ${c.sudah} sudah disetujui`);
  } else {
    chips = [`📝 ${c.catatan || 0} item tercatat`];
    if (c.aksi) chips.push(`📤 ${c.aksi} aksi`);
  }
  chips.push(`🧠 ${run.calls || 0} langkah AI`, `💲 ${kfCost(run.costUsd)}`);
  panel.querySelector(".kf-stats").innerHTML = chips.map((t) => `<span class="kf-chip">${escapeHtml(t)}</span>`).join("");

  if (k.screenAt && String(k.screenAt) !== panel.dataset.shotAt) {
    panel.dataset.shotAt = String(k.screenAt);
    const img = panel.querySelector(".kf-shot img");
    img.src = `/api/konfirmasi/screen?t=${k.screenAt}`;
    img.classList.remove("hidden");
    panel.querySelector(".kf-shot-empty").classList.add("hidden");
  }
  kfFillLog(panel.querySelector(".kf-log"), run.log);
}

function kfRenderQuestion(el, q) {
  if (!q) {
    el.classList.add("hidden");
    el.dataset.qid = "";
    el.innerHTML = "";
    return;
  }
  if (el.dataset.qid === q.id) return; // jangan gambar ulang (posisi gulir & tombol tetap)
  el.dataset.qid = q.id;
  el.classList.remove("hidden");
  el.innerHTML = `
    <div class="kf-q-head">✋ Robot menunggu jawaban Anda</div>
    <div class="kf-q-text">${escapeHtml(q.pertanyaan)}</div>
    <div class="actions">${q.pilihan
      .map((p, i) => `<button class="${i === 0 ? "btn-primary" : "btn-ghost"} kf-answer" data-qid="${escapeHtml(q.id)}" data-val="${escapeHtml(p)}">${escapeHtml(p)}</button>`)
      .join("")}</div>
    <p class="hint">Pilihan pertama adalah rekomendasi robot. Robot menunggu paling lama 30 menit.</p>`;
}

function kfFillLog(ol, log) {
  const items = (log || []).slice(-80);
  const sig = items.length + ":" + (items.length ? items[items.length - 1].t : 0);
  if (ol.dataset.sig === sig) return;
  ol.dataset.sig = sig;
  ol.innerHTML = items
    .slice()
    .reverse()
    .map((e) => {
      const jam = new Date(e.t).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      return `<li class="kf-log-${escapeHtml(e.kind)}"><span class="kf-log-t">${jam}</span>${escapeHtml(e.text)}</li>`;
    })
    .join("");
}

// ---------- Laporan Konfirmasi Biaya Outlet ----------
function kfItemRows(list, withAlasan) {
  return list
    .map(
      (i, n) => `<tr>
        <td>${n + 1}</td>
        <td>${escapeHtml(i.keterangan || "(tanpa keterangan)")}</td>
        <td class="num">${fmtRp(i.nominal)}</td>
        <td>${kfTgl(i.tanggal)}</td>
        <td>${escapeHtml(i.outlet || "")}</td>
        <td>${escapeHtml(i.nomor || "—")}</td>
        ${withAlasan
          ? `<td>${escapeHtml(KF_ALASAN[i.alasan] || i.alasanLabel || i.alasan || "")}${i.catatan ? `<div class="hint">${escapeHtml(i.catatan)}</div>` : ""}</td>`
          : `<td class="kf-kode">${escapeHtml(i.kode || "—")}${i.peringatan ? `<div class="kf-warn">⚠ ${escapeHtml(i.peringatan)}</div>` : ""}</td>`}
      </tr>`
    )
    .join("");
}
function kfTable(title, list, withAlasan, cls = "") {
  if (!list || !list.length) return "";
  const last = withAlasan ? "Alasan" : "Kode transaksi";
  return `<h4 class="kf-h ${cls}">${title} (${list.length})</h4>
    <div class="table-wrap"><table class="kf-table"><thead><tr><th>#</th><th>Keterangan</th><th>Nominal</th>
    <th>Tanggal</th><th>Outlet</th><th>NOMOR</th><th>${last}</th></tr></thead>
    <tbody>${kfItemRows(list, withAlasan)}</tbody></table></div>`;
}
function kfDashRows(list) {
  return list
    .map((r) => `<li>${escapeHtml(r.nomor)} · ${escapeHtml(r.keterangan)} · ${fmtRp(r.nominal)} · ${kfTgl(r.tanggal)} · ${escapeHtml(r.outlet)}</li>`)
    .join("");
}

function kfBanner(run, k, counts, title) {
  const c = counts || {};
  const phase = run.phase;
  if (phase === "done") {
    if (run.job === "biaya" || !run.job) {
      return ["ok", run.dryRun
        ? `✅ Cek selesai — ${c.cocok || 0} cocok (akan disetujui bila dijalankan), ${c.dilewati || 0} dilewati`
        : `✅ Selesai — ${c.disetujui || 0} disetujui, ${c.dilewati || 0} dilewati`];
    }
    return ["ok", `✅ ${title} selesai${run.dryRun ? " (cek saja)" : ""} — ${c.berhasil || 0} berhasil, ${c.dilewati || 0} dilewati, ${c.gagal || 0} gagal`];
  }
  if (phase === "need_login") {
    return ["warn", k.akun && k.akun.tersimpan
      ? "🔑 Login otomatis ke Smartlink gagal (kata sandi berubah, atau Smartlink meminta kode OTP). Perbarui akun di “Login otomatis Smartlink” (menu Monitoring Biaya), atau klik “Login Smartlink” untuk masuk manual, lalu jalankan lagi."
      : "🔑 Smartlink meminta login. Simpan akun di “Login otomatis Smartlink” (menu Monitoring Biaya, sekali saja), lalu jalankan lagi."];
  }
  if (phase === "cancelled") return ["warn", `■ ${title} dihentikan`];
  return ["err", `✘ ${title} berhenti karena error: ${run.error || "tidak diketahui"}`];
}

function kfMeta(run) {
  const meta = [
    run.dryRun ? "Mode: cek saja" : "Mode: jalankan",
    kfWaktu(run.startedAt),
    "durasi " + kfDur(run.elapsedSec),
    `${run.calls || 0} langkah AI`,
    "perkiraan biaya AI " + kfCost(run.costUsd),
  ];
  if (run.param && run.param.tanggal) meta.splice(1, 0, "tanggal " + kfTgl(run.param.tanggal));
  return meta.join(" · ");
}

function kfHistoryHtml(k, box) {
  const list = (k.history || []).filter((h) => box.jobs.includes(h.job || "biaya"));
  if (list.length < 2) return "";
  return `<details class="kf-details kf-history"><summary>Riwayat proses (${list.length})</summary><ul class="kf-list">${list
    .map((h) => {
      const c = h.counts || {};
      const st = { done: "selesai", cancelled: "dihentikan", error: "error", need_login: "perlu login" }[h.phase] || h.phase;
      const what = (h.job || "biaya") === "biaya"
        ? `${h.mode === "cek" ? `${c.cocok || 0} cocok` : `${c.disetujui || 0} disetujui`}, ${c.dilewati || 0} dilewati`
        : `${c.berhasil || 0} berhasil, ${c.dilewati || 0} dilewati`;
      return `<li><a href="#" class="kf-hist" data-box="${box.key}" data-id="${escapeHtml(h.id)}">${escapeHtml(kfWaktu(h.startedAt))}</a> · ${escapeHtml(h.jobTitle || "")} · ${h.mode === "cek" ? "cek saja" : "jalankan"} · ${escapeHtml(st)} · ${escapeHtml(what)}</li>`;
    })
    .join("")}</ul></details>`;
}

function kfRenderResult(panel, run, k, box) {
  panel.dataset.kind = "result";
  panel.dataset.runId = run ? run.id : "";
  let html = "";
  if (k.login && k.login.open && box.key === "mb") {
    html += `<div class="kf-note">🔑 Jendela Chrome untuk login Smartlink sudah terbuka di komputer yang menjalankan dashboard.
      Masuk sebagai <b>owner</b> di jendela itu, lalu klik <b>✔ Selesai login</b>. Login tersimpan untuk proses berikutnya.</div>`;
  }
  if (run) {
    const rep = run.report || {};
    const [cls, banner] = kfBanner(run, k, run.counts, "Konfirmasi Biaya Outlet");
    html += `<div class="kf-banner kf-${cls}">${escapeHtml(banner)}</div>
      <p class="hint kf-meta">${escapeHtml(kfMeta(run))}${KF_VIEW[box.key] ? ` · <a href="#" class="kf-back" data-box="${box.key}">← kembali ke yang terbaru</a>` : ""}</p>`;

    if (run.dryRun) html += kfTable("Cocok — akan disetujui bila dijalankan", rep.cocok, false, "kf-h-ok");
    else html += kfTable("Disetujui", rep.disetujui, false, "kf-h-ok");
    html += kfTable("Dilewati", rep.dilewati, true, "kf-h-warn");
    html += kfTable("Sudah disetujui sebelumnya", rep.sudah, false);
    if (rep.perluCek && rep.perluCek.length) {
      html += kfTable("⚠ Sudah ✓ di dashboard tapi belum disetujui di Smartlink — dicoba lagi otomatis di proses berikutnya", rep.perluCek, false, "kf-h-warn");
    }
    const d = rep.dashboard || {};
    const kpis = [];
    kpis.push(`<div class="kf-kpi"><b>${rep.sisaMenungguSmartlink == null ? "?" : rep.sisaMenungguSmartlink}</b><span>sisa “Menunggu konfirmasi” di Smartlink</span></div>`);
    if (!d.error && d.belumAkhir != null) {
      kpis.push(`<div class="kf-kpi"><b>${d.belumAkhir}</b><span>sisa baris “—” di dashboard${d.belumAwal != null ? ` (awal ${d.belumAwal})` : ""}</span></div>`);
      kpis.push(`<div class="kf-kpi"><b>${d.terverifikasi}</b><span>baris terverifikasi ✓</span></div>`);
    }
    if (run.report) html += `<div class="kf-kpis">${kpis.join("")}</div>`;
    if (d.error) html += `<p class="error">Sisa baris dashboard gagal dibaca: ${escapeHtml(d.error)}</p>`;
    if (d.sisa && d.sisa.length) {
      html += `<details class="kf-details"><summary>Sisa baris “—” di dashboard (${d.sisa.length})</summary><ul class="kf-list">${kfDashRows(d.sisa)}</ul></details>`;
    }
    if (d.setoranOwner && d.setoranOwner.length) {
      html += `<details class="kf-details"><summary>Setoran Owner — bukan pengeluaran, tidak muncul di Biaya Outlet (${d.setoranOwner.length})</summary><ul class="kf-list">${kfDashRows(d.setoranOwner)}</ul></details>`;
    }
    if (rep.ringkasanId || rep.ringkasanEn) {
      html += `<div class="kf-summary">${rep.ringkasanId ? `<p><b>Ringkasan:</b> ${escapeHtml(rep.ringkasanId)}</p>` : ""}${rep.ringkasanEn ? `<p lang="en"><b>Summary:</b> ${escapeHtml(rep.ringkasanEn)}</p>` : ""}</div>`;
    }
    html += `<div class="actions">
        ${rep.teks ? `<button class="btn-ghost kf-copy">📋 Salin laporan (Indonesia + English)</button>` : ""}
      </div>
      <details class="kf-details"><summary>Log proses</summary><ol class="kf-log kf-log-static"></ol></details>`;
  }
  html += kfHistoryHtml(k, box);
  panel.innerHTML = html;
  if (run) {
    const ol = panel.querySelector(".kf-log-static");
    if (ol) kfFillLog(ol, run.log);
  }
}

// ---------- Laporan skill lain (umum) ----------
const KF_STATUS_LABEL = { BERHASIL: "✅ berhasil", DILEWATI: "⏭ dilewati", GAGAL: "✘ gagal", INFO: "ℹ info" };

function kfRenderGeneric(panel, run, k, box) {
  panel.dataset.kind = "result";
  panel.dataset.runId = run.id;
  const rep = run.report || {};
  const title = run.jobTitle || (KF_JOBS[run.job] || {}).title || "Robot Smartlink";
  const [cls, banner] = kfBanner(run, k, run.counts, title);
  let html = `<div class="kf-banner kf-${cls}">${escapeHtml(banner)}</div>
    <p class="hint kf-meta">${escapeHtml(kfMeta(run))}${KF_VIEW[box.key] ? ` · <a href="#" class="kf-back" data-box="${box.key}">← kembali ke yang terbaru</a>` : ""}</p>`;
  const butir = rep.butir || [];
  if (butir.length) {
    html += `<div class="table-wrap"><table class="kf-table"><thead><tr><th>#</th><th>Item / bagian</th><th>Status</th><th>Keterangan</th></tr></thead><tbody>${butir
      .map((b, i) => `<tr class="kf-st-${escapeHtml(b.status)}"><td>${i + 1}</td><td>${escapeHtml(b.bagian)}</td><td class="kf-st">${escapeHtml(KF_STATUS_LABEL[b.status] || b.status)}</td><td>${escapeHtml(b.keterangan)}</td></tr>`)
      .join("")}</tbody></table></div>`;
  }
  if (rep.ringkasanId || rep.ringkasanEn) {
    html += `<div class="kf-summary">${rep.ringkasanId ? `<div class="kf-pre">${escapeHtml(rep.ringkasanId)}</div>` : ""}${rep.ringkasanEn ? `<div class="kf-pre" lang="en">${escapeHtml(rep.ringkasanEn)}</div>` : ""}</div>`;
  } else if (rep.catatan && rep.catatan.length) {
    html += `<h4 class="kf-h">Catatan progres (${rep.catatan.length})</h4><ol class="kf-list">${rep.catatan.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ol>`;
  }
  if (rep.tanya && rep.tanya.length) {
    html += `<details class="kf-details"><summary>Pertanyaan &amp; jawaban (${rep.tanya.length})</summary><ul class="kf-list">${rep.tanya
      .map((q) => `<li><div class="kf-pre kf-pre-sm">${escapeHtml(q.pertanyaan)}</div><b>→ ${escapeHtml(q.jawaban)}</b>${q.otomatis ? " <span class=\"hint\">(otomatis, mode cek saja)</span>" : ""}</li>`)
      .join("")}</ul></details>`;
  }
  if (rep.aksi && rep.aksi.length) {
    html += `<details class="kf-details"><summary>Aksi penting oleh robot (${rep.aksi.length})</summary><ul class="kf-list">${rep.aksi.map((a) => `<li>${escapeHtml(a)}</li>`).join("")}</ul></details>`;
  }
  if (rep.catatan && rep.catatan.length && (rep.ringkasanId || rep.ringkasanEn)) {
    html += `<details class="kf-details"><summary>Catatan progres (${rep.catatan.length})</summary><ol class="kf-list">${rep.catatan.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ol></details>`;
  }
  html += `<div class="actions">${rep.teks ? `<button class="btn-ghost kf-copy">📋 Salin laporan (Indonesia + English)</button>` : ""}</div>
    <details class="kf-details"><summary>Log proses</summary><ol class="kf-log kf-log-static"></ol></details>`;
  html += kfHistoryHtml(k, box);
  panel.innerHTML = html;
  const ol = panel.querySelector(".kf-log-static");
  if (ol) kfFillLog(ol, run.log);
}

// ---------- Akun login otomatis ----------
let KF_AKUN_INIT = false;
function kfRenderAkun(a) {
  if (!a) return;
  const det = $("#kf-akun");
  $("#kf-akun-status").textContent = a.tersimpan ? `✔ tersimpan (${a.email})` : "belum diisi";
  $("#kf-akun-status").className = a.tersimpan ? "kf-akun-ok" : "kf-akun-no";
  $("#btn-kf-akun-del").classList.toggle("hidden", !a.tersimpan);
  $("#kf-akun-pass").placeholder = a.tersimpan ? "Kata sandi baru (kosongkan bila tidak berubah)" : "Kata sandi Smartlink";
  // Belum ada akun → buka formulirnya sekali agar langsung terlihat.
  if (!KF_AKUN_INIT) {
    KF_AKUN_INIT = true;
    if (!a.tersimpan) det.open = true;
  }
}

$("#btn-kf-akun-save").addEventListener("click", async () => {
  const btn = $("#btn-kf-akun-save");
  btn.disabled = true;
  try {
    const r = await api("/api/konfirmasi/akun", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: $("#kf-akun-email").value, password: $("#kf-akun-pass").value }),
    });
    $("#kf-akun-pass").value = "";
    $("#kf-akun-email").value = "";
    if (KF) KF.akun = r.akun;
    kfRenderAkun(r.akun);
    $("#kf-akun").open = false;
    showLog($("#monbiaya-result"), "✔ Akun Smartlink tersimpan di komputer ini. Robot akan login sendiri bila diperlukan.");
  } catch (e) {
    showLog($("#monbiaya-result"), "✘ " + e.message, true);
  } finally {
    btn.disabled = false;
  }
});
$("#btn-kf-akun-del").addEventListener("click", async () => {
  if (!confirm("Hapus akun Smartlink yang tersimpan? Robot tidak bisa login sendiri lagi sampai akun diisi ulang.")) return;
  try {
    const r = await api("/api/konfirmasi/akun", { method: "DELETE" });
    if (KF) KF.akun = r.akun;
    kfRenderAkun(r.akun);
    showLog($("#monbiaya-result"), "✔ Akun Smartlink dihapus dari komputer ini.");
  } catch (e) {
    showLog($("#monbiaya-result"), "✘ " + e.message, true);
  }
});

// ---------- Memulai, menjawab, menghentikan ----------
const KF_RENCANA_NOTE =
  "\n\nRobot akan menampilkan RENCANA di panel ini dan menunggu Anda memilih “Jalankan semua” sebelum menyimpan / menyetujui apa pun.";
function kfConfirmText(job, dry, tanggal) {
  const title = (KF_JOBS[job] || {}).title || job;
  if (dry) {
    return job === "biaya"
      ? "Cek saja (tanpa menyetujui)?\n\nRobot membuka Smartlink, membaca setiap biaya “Menunggu konfirmasi”, lalu mencocokkannya dengan Monitoring Biaya. " +
          "Tidak ada yang disetujui dan tidak ada ✓ yang ditulis."
      : `Cek saja — ${title}?\n\nRobot hanya membaca data & menyusun rencana sesuai skill. Tidak ada yang disimpan, diunggah-simpan, disetujui, atau ditulis.`;
  }
  if (job === "biaya") {
    const belum = MONBIAYA && MONBIAYA.rows ? MONBIAYA.rows.filter((r) => !r.verifikasi).length : "?";
    return `Jalankan Konfirmasi Biaya Smartlink untuk seluruh antrean?\n\n` +
      `• Baris Monitoring Biaya yang belum diverifikasi (—): ${belum}. Jumlah antrean di Smartlink dihitung robot saat berjalan.\n` +
      `• Disetujui HANYA bila kelima kolom sama persis: keterangan, nominal, tanggal Waktu pemakaian, outlet, dan sumber dana KAS TUNAI — ` +
      `serta baris dashboard belum ✓. Robot memberi ✓ Verifikasi Owner dulu, lalu menyetujui dengan kode transaksi sebagai catatan.\n` +
      `• Yang tidak cocok / ambigu / ragu dilewati. Robot TIDAK PERNAH menekan “Tolak”.\n` +
      `• Persetujuan di Smartlink tidak bisa dibatalkan.\n\nLanjutkan?`;
  }
  const what = {
    setoran: "Robot membaca antrean Setoran Owner (Verifikasi Owner —) dan kartu Setoran Kas Outlet di Smartlink, lalu menyetujui setoran yang cocok (catatan = kode transaksi), menginput Pengambilan Prive, dan memberi ✓ Verifikasi Owner. Robot tidak pernah menekan Tolak.",
    input_setoran: "Robot memindahkan baris Setoran Owner ✘ di Lapor Smartlink menjadi entri Pengambilan Prive di Smartlink, lalu menandainya ✓.",
    input_biaya: "Robot memindahkan baris biaya ✘ (bukan Setoran Owner) di Lapor Smartlink menjadi Tambah Biaya di Biaya Outlet Smartlink, lalu menandainya ✓.",
    input_kas: "Robot mengambil 4 screenshot m-banking dari Drive serta screenshot Kas Laci, Kas Bank & Kas Mesin EDC dari Smartlink, lalu mengisi Input Kas bagian 1–4 (Analisis → Konfirmasi & Simpan).",
    settlement: `Robot mencatat daftar settlement ke INPUT QRIS, men-submit mutasi Drive ke DATA QRIS (bagian 6), lalu Buat Settlement per tanggal di Smartlink — ${tanggal ? `untuk tanggal ${tanggal}` : "untuk semua tanggal"}.`,
  }[job] || "";
  return `Jalankan ${title}?\n\n${what}${KF_RENCANA_NOTE}`;
}

async function kfStart(job, dryRun) {
  const box = kfBoxOf(job);
  const tanggal = job === "settlement" ? ($("#kfk-tanggal").value || "") : "";
  if (!confirm(kfConfirmText(job, dryRun, tanggal))) return;
  $$(".kf-start").forEach((b) => (b.disabled = true));
  try {
    await api("/api/konfirmasi/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job, dryRun, showBrowser: !!(box && $(box.show) && $(box.show).checked), tanggal: tanggal || undefined }),
    });
    if (box) {
      KF_VIEW[box.key] = null;
      $(box.panel).dataset.kind = "";
      $(box.msg).classList.add("hidden");
    }
  } catch (e) {
    if (box) kfMsg(box, "✘ Tidak bisa memulai: " + e.message, true);
  } finally {
    kfPoll();
  }
}

document.addEventListener("click", async (e) => {
  const t = e.target.closest("button, a");
  if (!t) return;
  if (t.classList.contains("kf-start")) {
    kfStart(t.dataset.job, t.dataset.dry === "1");
  } else if (t.classList.contains("kf-stop-btn")) {
    if (!confirm("Hentikan proses robot? Yang sudah dikerjakan tetap tercatat di laporan.")) return;
    try {
      await api("/api/konfirmasi/stop", { method: "POST" });
    } catch (err) {
      const box = KF_BOXES.find((b) => b.key === t.dataset.box);
      if (box) kfMsg(box, "✘ " + err.message, true);
    }
    kfPoll();
  } else if (t.classList.contains("kf-answer")) {
    const card = t.closest(".kf-question");
    Array.from(card.querySelectorAll(".kf-answer")).forEach((b) => (b.disabled = true));
    try {
      await api("/api/konfirmasi/jawab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: t.dataset.qid, jawaban: t.dataset.val }),
      });
      card.innerHTML = `<div class="kf-q-head">✔ Jawaban terkirim: ${escapeHtml(t.dataset.val)}</div>`;
    } catch (err) {
      Array.from(card.querySelectorAll(".kf-answer")).forEach((b) => (b.disabled = false));
      alert("Gagal mengirim jawaban: " + err.message);
    }
    kfPoll();
  } else if (t.classList.contains("kf-copy")) {
    const panel = t.closest(".kf-panel");
    const run = panel && panel._kfRun;
    const teks = run && run.report && run.report.teks;
    if (!teks) return;
    try {
      await copyTextToClipboard(teks);
      t.textContent = "✔ Laporan disalin";
      setTimeout(() => (t.textContent = "📋 Salin laporan (Indonesia + English)"), 1500);
    } catch {
      alert("Gagal menyalin laporan.");
    }
  } else if (t.classList.contains("kf-hist")) {
    e.preventDefault();
    try {
      const r = await api(`/api/konfirmasi/history/${encodeURIComponent(t.dataset.id)}`);
      const latest = KF && kfLatest(KF, (KF_BOXES.find((b) => b.key === t.dataset.box) || { jobs: [] }).jobs);
      KF_VIEW[t.dataset.box] = latest && latest.id === r.run.id ? null : r.run;
      kfRender();
    } catch (err) {
      alert(err.message);
    }
  } else if (t.classList.contains("kf-back")) {
    e.preventDefault();
    KF_VIEW[t.dataset.box] = null;
    kfRender();
  }
});

$("#btn-kf-login").addEventListener("click", async () => {
  const btn = $("#btn-kf-login");
  const closing = KF && KF.login && KF.login.open;
  btn.disabled = true;
  btn.textContent = closing ? "Menutup…" : "Membuka Chrome…";
  const box = KF_BOXES[0];
  try {
    await api(closing ? "/api/konfirmasi/login/close" : "/api/konfirmasi/login", { method: "POST" });
    kfMsg(box, closing
      ? "✔ Jendela login ditutup. Login Smartlink tersimpan untuk robot."
      : "✔ Jendela Chrome Smartlink terbuka di komputer yang menjalankan dashboard. Login sebagai owner, lalu klik “✔ Selesai login”.");
  } catch (e) {
    kfMsg(box, "✘ " + e.message, true);
  } finally {
    btn.disabled = false;
    kfPoll();
  }
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && KF && KF.active) kfPoll();
});

// Parse daftar NOMOR: dukung satuan ("35, 802") dan rentang ("769-804"), boleh dicampur.
function parseNomorList(input) {
  const out = [];
  String(input || "")
    .replace(/\n/g, ",")
    .split(",")
    .forEach((seg) => {
      const part = seg.trim();
      if (!part) return;
      const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
      if (m) {
        let a = parseInt(m[1], 10);
        let b = parseInt(m[2], 10);
        if (a > b) [a, b] = [b, a];
        if (b - a > 5000) return; // jaga-jaga rentang tak masuk akal
        for (let n = a; n <= b; n++) out.push(String(n));
      } else {
        part.split(/\s+/).forEach((t) => {
          if (t) out.push(t);
        });
      }
    });
  return Array.from(new Set(out));
}

async function mbNomorAction(endpoint, verb) {
  const out = $("#monbiaya-result");
  const input = $("#monbiaya-nomor").value;
  const nomors = parseNomorList(input);
  if (!nomors.length) return showLog(out, "✘ Masukkan NOMOR atau rentang (mis. 35, 769-804).", true);
  try {
    const r = await api(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nomors }),
    });
    const n = r.removed ?? r.hidden ?? nomors.length;
    showLog(out, `✔ ${n} baris ${verb} (input: ${input.trim()}).`);
    $("#monbiaya-nomor").value = "";
    await loadMonBiaya();
  } catch (e) {
    showLog(out, "✘ " + e.message, true);
  }
}

$("#btn-monbiaya-hide").addEventListener("click", () => mbNomorAction("/api/monbiaya/hide", "disembunyikan"));
$("#btn-monbiaya-unhide").addEventListener("click", () => mbNomorAction("/api/monbiaya/unhide", "dimunculkan kembali"));

async function mbExport(endpoint, btn) {
  const out = $("#monbiaya-result");
  const rows = $$("#monbiaya-table .mb-check:checked").map((c) => Number(c.dataset.row));
  if (!rows.length) return showLog(out, "✘ Centang minimal satu baris untuk diexport.", true);
  btn.disabled = true;
  try {
    const r = await api(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows }),
    });
    let msg = `✔ ${r.jumlah} baris diexport ke ${r.sheet} (baris ${r.barisAwal}–${r.barisAkhir}).`;
    if (r.skipped) msg += ` ${r.skipped} baris non-Setoran Owner dilewati.`;
    showLog(out, msg);
    await loadMonBiaya();
  } catch (e) {
    showLog(out, "✘ " + e.message, true);
  } finally {
    btn.disabled = false;
  }
}

$("#btn-monbiaya-export").addEventListener("click", (e) => mbExport("/api/monbiaya/export", e.currentTarget));
$("#btn-monbiaya-export-so").addEventListener("click", (e) => mbExportSetoran(e.currentTarget));

// ===== Export Setoran Owner + KATEGORI BIAYA (dropdown kolom K sheet TRANSAKSI) =====
let KAT_PREVIEW = null;

function katCloseModal() {
  $("#kat-modal").classList.add("hidden");
}

// Tampilkan CAKUPAN kategori terpilih di bawah dropdown-nya.
function katShowHint(sel) {
  const opt = sel.selectedOptions[0];
  const el = sel.closest("td").querySelector(".kat-hint");
  if (el) el.textContent = (opt && opt.dataset.hint) || "";
}

function katRenderModal(p) {
  const opts = p.options || [];
  const optionsHtml = (selected) =>
    ['<option value="">— tanpa kategori —</option>']
      .concat(
        opts.map(
          (o) =>
            `<option value="${escapeHtml(o.value)}" data-hint="${escapeHtml(o.hint || "")}"` +
            `${o.value === selected ? " selected" : ""}>${escapeHtml(o.value)}</option>`
        )
      )
      .join("");
  const body = (p.rows || [])
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.nomor)}</td><td>${escapeHtml(r.tanggal)}</td>` +
        `<td>${escapeHtml(r.keterangan || "—")}</td><td class="num">${fmtRp(r.nominal)}</td>` +
        `<td class="kat-cell"><select class="kat-sel" data-row="${r.row}">${optionsHtml(r.saran)}</select>` +
        `${r.saran ? '<span class="kat-saran">saran</span>' : ""}<div class="kat-hint"></div></td></tr>`
    )
    .join("");
  $("#kat-list").innerHTML =
    `<div class="table-wrap"><table><thead><tr><th>NOMOR</th><th>TANGGAL</th><th>KETERANGAN</th>` +
    `<th>NOMINAL</th><th>KATEGORI BIAYA</th></tr></thead><tbody>${body}</tbody></table></div>`;
  $$("#kat-list .kat-sel").forEach((sel) => {
    katShowHint(sel);
    sel.addEventListener("change", () => {
      katShowHint(sel);
      const tag = sel.closest("td").querySelector(".kat-saran");
      if (tag) tag.remove(); // sudah dipilih sendiri, bukan saran lagi
    });
  });
  $("#kat-skip").textContent = p.skipped ? `${p.skipped} baris non-Setoran Owner dilewati.` : "";
  $("#kat-error").classList.add("hidden");
  $("#kat-modal").classList.remove("hidden");
}

async function mbExportSetoran(btn) {
  const out = $("#monbiaya-result");
  const rows = $$("#monbiaya-table .mb-check:checked").map((c) => Number(c.dataset.row));
  if (!rows.length) return showLog(out, "✘ Centang minimal satu baris untuk diexport.", true);
  btn.disabled = true;
  try {
    KAT_PREVIEW = await api("/api/monbiaya/setoran-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows }),
    });
    katRenderModal(KAT_PREVIEW);
  } catch (e) {
    showLog(out, "✘ " + e.message, true);
  } finally {
    btn.disabled = false;
  }
}

$("#btn-kat-go").addEventListener("click", async () => {
  if (!KAT_PREVIEW) return;
  const go = $("#btn-kat-go");
  const err = $("#kat-error");
  const kategori = {};
  $$("#kat-list .kat-sel").forEach((sel) => {
    if (sel.value) kategori[sel.dataset.row] = sel.value;
  });
  go.disabled = true;
  err.classList.add("hidden");
  try {
    const r = await api("/api/monbiaya/export-setoran", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: KAT_PREVIEW.rows.map((x) => x.row), kategori }),
    });
    katCloseModal();
    let msg = `✔ ${r.jumlah} baris diexport ke ${r.sheet} (baris ${r.barisAwal}–${r.barisAkhir}).`;
    msg += r.kategoriDiisi
      ? ` KATEGORI BIAYA dipilih dari dropdown untuk ${r.kategoriDiisi} baris.`
      : " KATEGORI BIAYA dikosongkan.";
    if (KAT_PREVIEW.skipped) msg += ` ${KAT_PREVIEW.skipped} baris non-Setoran Owner dilewati.`;
    showLog($("#monbiaya-result"), msg);
    KAT_PREVIEW = null;
    await loadMonBiaya();
  } catch (e) {
    err.textContent = "✘ " + e.message;
    err.classList.remove("hidden");
  } finally {
    go.disabled = false;
  }
});
$("#btn-kat-cancel").addEventListener("click", katCloseModal);
$("#btn-kat-close").addEventListener("click", katCloseModal);
$("#kat-modal .img-modal-backdrop").addEventListener("click", katCloseModal);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") katCloseModal();
});

// ================= Lapor Smartlink (sheet INPUT PENGGUNAAN BIAYA) =================
let SMART = null;
let SMART_LOADED = false;
let SMART_EDIT = null; // nomor baris yang sedang diedit
const SMART_CHECKED = new Set(); // nomor baris tercentang (untuk disembunyikan)

// Indeks kolom A..H pada cells[].
const SL_COL = { subjek: 0, keterangan: 1, nominal: 2, tanggal: 3, outlet: 4, status: 5, sumberDana: 6, kode: 7, item: 8, subItem: 9 };

async function copyTextToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      /* izin clipboard ditolak → pakai cara lama di bawah */
    }
  }
  {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}

// Tombol status: ✘ merah (BELUM INPUT) / ✓ hijau (SUDAH INPUT). Simbol mewakili
// nilai dropdown, nilai aslinya tetap ditulis di sheet.
function slStatusBtn(r) {
  const sudah = r.status === "SUDAH INPUT";
  return `<button class="sl-status ${sudah ? "sl-ok" : "sl-no"}" data-row="${r.row}" data-val="${escapeHtml(r.status)}" title="${escapeHtml(r.status || "(kosong)")} — klik untuk ubah">${sudah ? "✓" : "✘"}</button>`;
}

function slViewRow(r) {
  const c = r.cells;
  return [
    `<td>${escapeHtml(c[SL_COL.subjek])}</td>`,
    `<td class="sl-ket" data-text="${escapeHtml(c[SL_COL.keterangan])}" title="Klik untuk menyalin">${escapeHtml(c[SL_COL.keterangan])}</td>`,
    `<td class="num sl-nom" data-text="${escapeHtml(c[SL_COL.nominal])}" title="Klik untuk menyalin">${escapeHtml(c[SL_COL.nominal])}</td>`,
    `<td>${escapeHtml(c[SL_COL.tanggal])}</td>`,
    `<td>${escapeHtml(c[SL_COL.outlet])}</td>`,
    `<td style="text-align:center">${slStatusBtn(r)}</td>`,
    `<td>${escapeHtml(c[SL_COL.sumberDana])}</td>`,
    `<td>${escapeHtml(c[SL_COL.kode])}</td>`,
    `<td>${escapeHtml(c[SL_COL.item] || "")}</td>`,
    `<td>${escapeHtml(c[SL_COL.subItem] || "")}</td>`,
    `<td><button class="sl-edit" data-row="${r.row}" title="Edit baris">✎</button></td>`,
  ].join("");
}

function slEditRow(r) {
  const c = r.cells;
  const e = r.edit;
  const ketOpts = ['<option value="">— pilih —</option>']
    .concat((SMART.daftarBiaya || []).map((d) => `<option${d.keterangan === e.keterangan ? " selected" : ""}>${escapeHtml(d.keterangan)}</option>`))
    .join("");
  const sumberOpts = ['<option value="">—</option>']
    .concat((SMART.sumberDana || []).map((s) => `<option${s === e.sumberDana ? " selected" : ""}>${escapeHtml(s)}</option>`))
    .join("");
  return [
    `<td>${escapeHtml(c[SL_COL.subjek])}</td>`,
    `<td><select class="sl-f-ket">${ketOpts}</select></td>`,
    `<td><input type="number" class="sl-f-nom" min="1" value="${escapeHtml(e.nominal)}"></td>`,
    `<td><input type="date" class="sl-f-tgl" value="${escapeHtml(e.tanggalIso)}"></td>`,
    `<td>${escapeHtml(c[SL_COL.outlet])}</td>`,
    `<td style="text-align:center">${escapeHtml(c[SL_COL.status])}</td>`,
    `<td><select class="sl-f-sumber">${sumberOpts}</select></td>`,
    `<td>${escapeHtml(c[SL_COL.kode])}</td>`,
    `<td>${escapeHtml(c[SL_COL.item] || "")}</td>`,
    `<td>${escapeHtml(c[SL_COL.subItem] || "")}</td>`,
    `<td><button class="sl-save" data-row="${r.row}">💾 Simpan</button> <button class="sl-cancel" data-row="${r.row}">Batal</button></td>`,
  ].join("");
}

function slUpdateCount() {
  $("#sl-count").textContent = `${SMART_CHECKED.size} dipilih`;
}

function renderSmart() {
  const el = $("#sl-table");
  if (!SMART || !SMART.rows.length) {
    el.innerHTML = `<p class="hint">Tidak ada biaya berstatus BELUM INPUT. 🎉</p>`;
    slUpdateCount();
    return;
  }
  const heads = ['<th><input type="checkbox" id="sl-checkall" title="Pilih semua"></th>']
    .concat(SMART.headers.map((h) => `<th>${escapeHtml(h)}</th>`))
    .concat(["<th>Edit</th>"])
    .join("");
  const body = SMART.rows
    .map((r) => {
      const editing = SMART_EDIT === r.row;
      const checked = SMART_CHECKED.has(r.row) ? " checked" : "";
      const inner = editing ? slEditRow(r) : slViewRow(r);
      return `<tr data-row="${r.row}"><td style="text-align:center"><input type="checkbox" class="sl-check" data-row="${r.row}"${checked}></td>${inner}</tr>`;
    })
    .join("");
  el.innerHTML = `<table id="sl-grid"><thead><tr>${heads}</tr></thead><tbody>${body}</tbody></table>`;
  slUpdateCount();
}

async function loadSmart() {
  const el = $("#sl-table");
  el.innerHTML = "Memuat…";
  SMART_EDIT = null;
  try {
    SMART = await api("/api/moninput/list");
    SMART_LOADED = true;
    // Buang centang untuk baris yang sudah tidak ada lagi di daftar.
    const valid = new Set(SMART.rows.map((r) => r.row));
    for (const n of Array.from(SMART_CHECKED)) if (!valid.has(n)) SMART_CHECKED.delete(n);
    renderSmart();
    updateTabBadge("smartlink", (SMART.rows || []).length);
  } catch (e) {
    el.innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`;
  }
}

async function slToggleStatus(btn) {
  const row = Number(btn.dataset.row);
  const cur = btn.dataset.val || "BELUM INPUT";
  const next = cur === "SUDAH INPUT" ? "BELUM INPUT" : "SUDAH INPUT";
  const prev = btn.textContent;
  btn.disabled = true;
  btn.textContent = "…";
  try {
    await api("/api/moninput/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ row, value: next }),
    });
    const r = SMART.rows.find((x) => x.row === row);
    if (r) {
      r.status = next;
      r.cells[SL_COL.status] = next;
    }
    const sudah = next === "SUDAH INPUT";
    btn.dataset.val = next;
    btn.textContent = sudah ? "✓" : "✘";
    btn.className = `sl-status ${sudah ? "sl-ok" : "sl-no"}`;
    btn.title = next + " — klik untuk ubah";
  } catch (e) {
    btn.textContent = prev;
    showLog($("#sl-result"), "✘ Gagal mengubah status: " + e.message, true);
  } finally {
    btn.disabled = false;
  }
}

// Salin teks sel (dipakai kolom KETERANGAN & NOMINAL).
async function slCopyCell(td) {
  const text = td.dataset.text || "";
  try {
    await copyTextToClipboard(text);
    td.classList.add("copied");
    setTimeout(() => td.classList.remove("copied"), 900);
    showLog($("#sl-result"), `✔ Disalin: "${text}"`);
  } catch {
    showLog($("#sl-result"), "✘ Gagal menyalin teks.", true);
  }
}

async function slSave(row) {
  const tr = $(`#sl-grid tr[data-row="${row}"]`);
  if (!tr) return;
  const keterangan = tr.querySelector(".sl-f-ket").value;
  const nominal = tr.querySelector(".sl-f-nom").value;
  const tanggalIso = tr.querySelector(".sl-f-tgl").value;
  const sumberDana = tr.querySelector(".sl-f-sumber").value;
  const btn = tr.querySelector(".sl-save");
  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = "…";
  try {
    await api("/api/moninput/edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ row, keterangan, nominal, tanggalIso, sumberDana }),
    });
    SMART_EDIT = null;
    await loadSmart(); // muat ulang agar SUBJEK (formula) & format nominal/tanggal ikut diperbarui
    showLog($("#sl-result"), `✔ Baris ${row} diperbarui.`);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = prev;
    showLog($("#sl-result"), "✘ Gagal menyimpan: " + e.message, true);
  }
}

async function slHide() {
  const rows = Array.from(SMART_CHECKED);
  if (!rows.length) return showLog($("#sl-result"), "✘ Centang minimal satu baris untuk disembunyikan.", true);
  const btn = $("#btn-sl-hide");
  btn.disabled = true;
  try {
    const r = await api("/api/moninput/hide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows }),
    });
    SMART_CHECKED.clear();
    await loadSmart();
    showLog($("#sl-result"), `✔ ${r.hidden} baris disembunyikan dari daftar.`);
  } catch (e) {
    showLog($("#sl-result"), "✘ " + e.message, true);
  } finally {
    btn.disabled = false;
  }
}

$("#sl-table").addEventListener("click", (e) => {
  const t = e.target;
  if (t.classList.contains("sl-status")) slToggleStatus(t);
  else if (t.classList.contains("sl-edit")) {
    SMART_EDIT = Number(t.dataset.row);
    renderSmart();
  } else if (t.classList.contains("sl-save")) slSave(Number(t.dataset.row));
  else if (t.classList.contains("sl-cancel")) {
    SMART_EDIT = null;
    renderSmart();
  } else if (t.classList.contains("sl-ket") || t.classList.contains("sl-nom")) slCopyCell(t);
});
$("#sl-table").addEventListener("change", (e) => {
  if (e.target.id === "sl-checkall") {
    SMART.rows.forEach((r) => {
      if (e.target.checked) SMART_CHECKED.add(r.row);
      else SMART_CHECKED.delete(r.row);
    });
    $$("#sl-table .sl-check").forEach((c) => (c.checked = e.target.checked));
    slUpdateCount();
  } else if (e.target.classList.contains("sl-check")) {
    const row = Number(e.target.dataset.row);
    if (e.target.checked) SMART_CHECKED.add(row);
    else SMART_CHECKED.delete(row);
    slUpdateCount();
  }
});
$("#btn-sl-refresh").addEventListener("click", loadSmart);
$("#btn-sl-hide").addEventListener("click", slHide);

// ================= Input Setoran Kas =================
$("#btn-setoran-submit").addEventListener("click", async () => {
  const out = $("#setoran-result");
  const tanggal = $("#setoran-tanggal").value;
  const nominal = $("#setoran-nominal").value;
  const outlet = $("#setoran-outlet").value;
  if (!tanggal) return showLog(out, "✘ Pilih tanggal.", true);
  if (!nominal || Number(nominal) <= 0) return showLog(out, "✘ Nominal tidak valid.", true);
  if (!outlet) return showLog(out, "✘ Pilih outlet.", true);
  const btn = $("#btn-setoran-submit");
  btn.disabled = true;
  try {
    const r = await api("/api/setoran/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tanggal, nominal, outlet }),
    });
    showLog(out, `✔ Setoran ${fmtRp(r.nominal)} (${r.tanggal}, ${r.outlet}) ditulis ke ${r.sheet} sel ${r.cell}.`);
    $("#setoran-nominal").value = "";
  } catch (e) {
    showLog(out, "✘ " + e.message, true);
  } finally {
    btn.disabled = false;
  }
});

// ================= Upload Data Transaksi =================
$("#btn-trx-analyze").addEventListener("click", async () => {
  const errEl = $("#trx-error");
  errEl.classList.add("hidden");
  const file = $("#trx-file").files[0];
  if (!file) {
    errEl.textContent = "Pilih file ekspor (.xlsx) dulu.";
    errEl.classList.remove("hidden");
    return;
  }
  $("#trx-loading").classList.remove("hidden");
  $("#btn-trx-analyze").disabled = true;
  try {
    const fd = new FormData();
    fd.append("file", file);
    const d = await api("/api/transaksi/analyze", { method: "POST", body: fd });
    const sel = $("#trx-sheet");
    sel.innerHTML = (d.sheets || [])
      .map((s) => `<option${s === d.resolved ? " selected" : ""}>${escapeHtml(s)}</option>`)
      .join("");
    if (!d.sheets || !d.sheets.length) {
      sel.innerHTML = `<option value="">(tidak ada sheet DAFTAR PELUNASAN)</option>`;
    }
    const resolvedNote = d.resolved
      ? `Sheet tujuan terdeteksi: <b>${escapeHtml(d.resolved)}</b>.`
      : `<span style="color:#b3402f">Sheet bulan ${escapeHtml(d.monthKey)} belum terdeteksi — pilih manual di bawah.</span>`;
    $("#trx-info").innerHTML = `Terbaca <b>${d.jumlah}</b> baris data (mulai baris 28). ${resolvedNote} Akan ditulis mulai baris 4.`;
    $("#trx-preview").classList.remove("hidden");
    $("#trx-result").classList.add("hidden");
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove("hidden");
  } finally {
    $("#trx-loading").classList.add("hidden");
    $("#btn-trx-analyze").disabled = false;
  }
});

$("#btn-trx-submit").addEventListener("click", async () => {
  const out = $("#trx-result");
  const file = $("#trx-file").files[0];
  const sheet = $("#trx-sheet").value;
  if (!file) return showLog(out, "✘ File tidak ada, pilih lagi.", true);
  if (!sheet) return showLog(out, "✘ Pilih sheet tujuan.", true);
  const btn = $("#btn-trx-submit");
  btn.disabled = true;
  try {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("sheet", sheet);
    const r = await api("/api/transaksi/submit", { method: "POST", body: fd });
    let msg = `✔ ${r.jumlah} baris ditulis ke "${r.sheet}" (baris ${r.barisAwal}–${r.barisAkhir}).`;
    if (r.dibersihkan) msg += ` ${r.dibersihkan} baris sisa lama dibersihkan.`;
    showLog(out, msg);
  } catch (e) {
    showLog(out, "✘ " + e.message, true);
  } finally {
    btn.disabled = false;
  }
});

// ================= Upload File: sub menu =================
$$("#tab-transaksi .subtab").forEach((b) =>
  b.addEventListener("click", () => {
    $$("#tab-transaksi .subtab").forEach((x) => x.classList.toggle("active", x === b));
    $$("#tab-transaksi .subpanel").forEach((p) => p.classList.toggle("active", p.id === "sub-" + b.dataset.sub));
    if (b.dataset.sub === "transaksiharian") thLoad();
  })
);

// ================= Upload Transaksi Harian (sama dengan Dashboard Internal) =================
// Sama dengan menu Upload Transaksi Harian di Dashboard Internal (aturan baca
// nota disalin apa adanya), tanpa login: server menulis langsung ke sheet
// TRANSAKSI HARIAN memakai service account dashboard ini.

/** fetch JSON yang membawa kode error (mis. NO_ACCESS) ke pemanggil. */
async function thApi(path, opts = {}) {
  const res = await fetch(path, opts);
  if (res.status === 401) {
    window.location = "/login";
    throw new Error("Sesi berakhir, silakan login ulang.");
  }
  const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!res.ok || data.ok === false) {
    const e = new Error(data.error || `HTTP ${res.status}`);
    Object.assign(e, { code: data.code, serviceAccount: data.serviceAccount, spreadsheetUrl: data.spreadsheetUrl });
    throw e;
  }
  return data;
}

function thTampilAkses(e) {
  const el = $("#th-akses");
  if (!e || e.code !== "NO_ACCESS") {
    el.classList.add("hidden");
    el.innerHTML = "";
    return false;
  }
  el.classList.remove("hidden");
  el.innerHTML = `<div class="th-notice th-err">🔑 <div>
      <b>Dashboard belum punya akses ke spreadsheet PERFORMA PEGAWAI CO CLEAN LAUNDRY</b> (tempat sheet TRANSAKSI HARIAN).
      Lakukan sekali saja: buka <a href="${escapeHtml(e.spreadsheetUrl || "#")}" target="_blank" rel="noopener">spreadsheet itu</a>
      → <b>Bagikan</b> → tambahkan <code class="th-email">${escapeHtml(e.serviceAccount || "email service account dashboard")}</code>
      sebagai <b>Editor</b>, lalu klik <button id="btn-th-cek" class="btn-ghost btn-th-kecil">⟳ Cek lagi</button></div></div>`;
  $("#btn-th-cek").addEventListener("click", thLoad);
  return true;
}

async function thLoad() {
  await thLoadInfo();
  thLoadPerlu();
  thLoadKamus();
}

// ----- Klarifikasi nota "perlu dicek" -----
let TH_PESAN = {}; // pesan hasil simpan per nota (tetap tampil setelah daftar digambar ulang)
let TH_DATA = {}; // data nota perlu dicek yang sedang tampil
let TH_SEMUA = false; // tampilkan semua nota (bukan hanya 30 pertama)
let TH_LIST = []; // daftar terakhir (untuk tombol "tampilkan semua")
const TH_MAKS = 30;
let TH_WAKTU = "";

function thPlaceholder(catatan) {
  const m = String(catatan || "").match(/satuan belum dikenali:\s*([^•]+)/);
  if (m) {
    const kata = m[1].split(",")[0].trim().replace(/^\d+\s*/, "");
    return `mis. ${kata} = nama barang yang benar`;
  }
  return "jumlah pcs sebenarnya, mis. 10 pcs";
}

function thRenderPerlu(list, waktu) {
  const card = $("#th-perlu-card");
  const box = $("#th-perlu-list");
  if (!list || !list.length) {
    card.classList.add("hidden");
    box.innerHTML = "";
    return;
  }
  const belum = list.filter((n) => !n.selesai).length;
  const w = waktu == null ? TH_WAKTU : waktu;
  $("#th-perlu-judul").innerHTML = belum
    ? `⚠️ ${belum} nota perlu dicek${w ? ` <small class="hint">(upload ${escapeHtml(w)})</small>` : ""}`
    : `✅ Semua nota sudah diklarifikasi${w ? ` <small class="hint">(upload ${escapeHtml(w)})</small>` : ""}`;
  card.classList.remove("hidden");
  TH_DATA = {};
  TH_LIST = list;
  TH_WAKTU = waktu == null ? TH_WAKTU : waktu;
  list.forEach((n) => (TH_DATA[n.nota] = n));
  // Yang belum beres di atas; tampil 30 dulu supaya halaman tidak terlalu panjang.
  const urut = list.filter((n) => !n.selesai).concat(list.filter((n) => n.selesai));
  const tampil = TH_SEMUA ? urut : urut.slice(0, TH_MAKS);
  const sisa = urut.length - tampil.length;
  box.innerHTML = tampil
    .map((n) => {
      const ket = n.keterangan
        ? `<div class="th-ket">${escapeHtml(n.keterangan)}</div>`
        : `<div class="th-ket th-ket-kosong">(keterangan kosong)</div>`;
      const pesan = TH_PESAN[n.nota];
      const pesanHtml = pesan ? `<div class="th-kl-hasil ${pesan.ok ? "ok" : "err"}">${escapeHtml(pesan.teks)}</div>` : "";
      const form = n.selesai
        ? `<div class="th-kl-hasil ok">✓ Beres — sekarang ${escapeHtml(String(n.totalPcs))} pcs${
            n.totalPcsAwal != null && n.totalPcsAwal !== n.totalPcs ? ` (sebelumnya ${escapeHtml(String(n.totalPcsAwal))})` : ""
          }.</div>${pesan && pesan.ok ? pesanHtml : n.hasil ? `<div class="th-kl-hasil">${escapeHtml(n.hasil)}</div>` : ""}`
        : `<div class="th-kl-row">
             <input type="text" class="th-kl-input" maxlength="300" placeholder="${escapeHtml(thPlaceholder(n.catatan))}"
               value="${escapeHtml(n.klarifikasi || "")}" aria-label="Klarifikasi nota ${escapeHtml(n.nota)}" />
             <button class="btn-primary th-kl-btn">Simpan</button>
           </div>${pesanHtml}${
             n.catatanSekarang && n.catatanSekarang !== n.catatan ? `<div class="th-kl-hasil err">Masih perlu dicek: ${escapeHtml(n.catatanSekarang)}</div>` : ""
           }`;
      return `<div class="th-item th-kl${n.selesai ? " th-kl-ok" : ""}" data-nota="${escapeHtml(n.nota)}">
        <div class="th-kl-info">
          <div class="th-t1">${escapeHtml(n.nota)}</div>
          <div class="th-t2">${escapeHtml(n.customer || "—")} • ${escapeHtml(n.catatan || "")}</div>
          ${ket}
        </div>
        <div class="th-kl-form">${form}</div>
      </div>`;
    })
    .join("") + (sisa > 0 ? `<button id="btn-th-semua" class="btn-ghost">Tampilkan ${sisa} nota lainnya</button>` : "");
}

async function thLoadPerlu() {
  try {
    const r = await thApi("/api/transaksi-harian/perlu-dicek");
    thRenderPerlu(r.perluDicek, r.waktu);
  } catch {
    /* daftar lokal; abaikan bila gagal */
  }
}

async function thSimpanKlarifikasi(item) {
  const nota = item.dataset.nota;
  const inp = item.querySelector(".th-kl-input");
  const btn = item.querySelector(".th-kl-btn");
  const teks = inp.value.trim();
  if (!teks) {
    TH_PESAN[nota] = { ok: false, teks: "Tulis klarifikasinya dahulu." };
    inp.focus();
    thTampilPesan(item, TH_PESAN[nota]);
    return;
  }
  btn.disabled = true;
  inp.disabled = true;
  btn.textContent = "Menyimpan…";
  try {
    const n = TH_DATA[nota] || {};
    const res = await thApi("/api/transaksi-harian/klarifikasi", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nota, klarifikasi: teks, catatan: n.catatan || "", keterangan: n.keterangan || "", customer: n.customer || "" }),
    });
    const dipelajari = res.aturan.map((a) => a.penjelasan).join("; ");
    const lain = (res.ditulis || []).filter((x) => x !== nota).length;
    let teksHasil = `✓ Tersimpan: ${dipelajari}.`;
    if (lain) teksHasil += ` Ikut diperbarui: ${lain} nota lain.`;
    if (!res.adaData) teksHasil += " Berlaku mulai upload berikutnya (upload ulang file yang sama untuk memperbarui nota ini).";
    TH_PESAN[nota] = { ok: true, teks: teksHasil };
    if (res.adaData) thRenderPerlu(res.perluDicek, null);
    else thTampilPesan(item, TH_PESAN[nota]);
    thLoadKamus();
  } catch (e) {
    TH_PESAN[nota] = { ok: false, teks: "✘ " + e.message };
    thTampilPesan(item, TH_PESAN[nota]);
  } finally {
    if (document.body.contains(btn)) {
      btn.disabled = false;
      inp.disabled = false;
      btn.textContent = "Simpan";
    }
  }
}

function thTampilPesan(item, pesan) {
  let el = item.querySelector(".th-kl-pesan");
  if (!el) {
    el = document.createElement("div");
    el.className = "th-kl-hasil th-kl-pesan";
    item.querySelector(".th-kl-form").appendChild(el);
  }
  el.classList.toggle("ok", !!pesan.ok);
  el.classList.toggle("err", !pesan.ok);
  el.textContent = pesan.teks;
}

$("#th-perlu-list").addEventListener("click", (ev) => {
  if (ev.target.closest("#btn-th-semua")) {
    TH_SEMUA = true;
    thRenderPerlu(TH_LIST, null);
    return;
  }
  const btn = ev.target.closest(".th-kl-btn");
  if (btn) thSimpanKlarifikasi(btn.closest(".th-kl"));
});
$("#th-perlu-list").addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && ev.target.classList.contains("th-kl-input")) {
    ev.preventDefault();
    thSimpanKlarifikasi(ev.target.closest(".th-kl"));
  }
});

async function thLoadKamus() {
  const box = $("#th-kamus-list");
  try {
    const r = await thApi("/api/transaksi-harian/kamus");
    thRenderKamus(r.aturan || []);
  } catch (e) {
    box.innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`;
  }
}

function thRenderKamus(list) {
  $("#th-kamus-n").textContent = list.length ? `(${list.length} aturan)` : "(belum ada)";
  $("#th-kamus-list").innerHTML = list.length
    ? list
        .map(
          (a) => `<div class="th-kamus-item">
            <div><div>${escapeHtml(a.penjelasan)}</div>
              <div class="th-t2">${escapeHtml(a.waktu || "")}${a.nota ? " · dari nota " + escapeHtml(a.nota) : ""}${
                a.klarifikasi ? ` · “${escapeHtml(a.klarifikasi)}”` : ""
              }</div></div>
            <button class="btn-ghost btn-th-kecil th-kamus-hapus" data-baris="${a.baris}">Hapus</button>
          </div>`
        )
        .join("")
    : `<p class="hint">Belum ada aturan. Aturan muncul di sini setelah Anda mengisi klarifikasi nota yang perlu dicek.</p>`;
}

$("#th-kamus-list").addEventListener("click", async (ev) => {
  const btn = ev.target.closest(".th-kamus-hapus");
  if (!btn) return;
  const teks = btn.parentElement.querySelector("div > div").textContent;
  if (!window.confirm(`Hapus aturan ini?\n${teks}`)) return;
  btn.disabled = true;
  try {
    const r = await thApi("/api/transaksi-harian/kamus/hapus", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baris: Number(btn.dataset.baris) }),
    });
    thRenderKamus(r.aturan || []);
    thRenderPerlu(r.perluDicek, null);
  } catch (e) {
    btn.disabled = false;
    window.alert(e.message);
  }
});

async function thLoadInfo() {
  try {
    const r = await thApi("/api/transaksi-harian/info");
    thTampilAkses(null);
    $("#th-info").innerHTML = `<div class="th-notice">📦 <div><b>${escapeHtml(String(r.jumlah))} nota</b> tersimpan di database.${
      r.lastUpload ? " Upload terakhir: " + escapeHtml(r.lastUpload) : ""
    }</div></div>`;
  } catch (e) {
    if (!thTampilAkses(e)) $("#th-info").innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`;
    else $("#th-info").innerHTML = "";
  }
}

$("#btn-th-upload").addEventListener("click", async () => {
  const input = $("#th-file");
  const file = input.files && input.files[0];
  const hasil = $("#th-hasil");
  if (!file) {
    hasil.innerHTML = `<div class="th-notice th-err">✘ <div>Pilih file .xlsx dahulu.</div></div>`;
    return;
  }
  const btn = $("#btn-th-upload");
  btn.disabled = true;
  $("#th-loading").classList.remove("hidden");
  hasil.innerHTML = "";
  try {
    const fd = new FormData();
    fd.append("file", file, file.name);
    const res = await thApi("/api/transaksi-harian/upload", { method: "POST", body: fd });
    let html = `<div class="th-notice">✅ <div>${escapeHtml(res.message)}${
      res.aturanDipakai ? ` <span class="hint">(${res.aturanDipakai} aturan kamus klarifikasi dipakai)</span>` : ""
    }</div></div>`;
    html += `<p class="th-ok">Transaksi harian terproses ✅</p>`;
    hasil.innerHTML = html;
    // Nota yang keterangannya belum terbaca penuh — tampil dengan kotak klarifikasi.
    TH_PESAN = {};
    TH_SEMUA = false;
    thRenderPerlu((res.perluDicek || []).map((n) => ({ ...n, catatanSekarang: n.catatan, totalPcsAwal: n.totalPcs })), "");
    clearFileInput(input);
    thLoadInfo();
  } catch (e) {
    if (thTampilAkses(e)) hasil.innerHTML = "";
    else hasil.innerHTML = `<div class="th-notice th-err">✘ <div>${escapeHtml(e.message)}</div></div>`;
  } finally {
    btn.disabled = false;
    $("#th-loading").classList.add("hidden");
  }
});

// ================= Riwayat Biaya per Bulan =================
let RB = null;
let RB_LOADED = false;
const RB_MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

function rbDefaultYM() {
  const t = (STATUS && STATUS.today) || "";
  const m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return { month: Number(m[2]), year: Number(m[3]) };
  const d = new Date();
  return { month: d.getMonth() + 1, year: d.getFullYear() };
}

function rbInitSelectors() {
  const ms = $("#rb-month");
  if (ms && !ms.options.length) {
    ms.innerHTML = RB_MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join("");
  }
  const ys = $("#rb-year");
  if (ys && !ys.options.length) {
    const def = rbDefaultYM();
    const top = Math.max(def.year, new Date().getFullYear());
    const years = [];
    for (let y = top; y >= 2025; y--) years.push(y);
    ys.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join("");
  }
}

// Kunci tanggal = angka yyyymmdd (dipakai backend untuk urut & filter).
function rbIsoToKey(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? Number(`${m[1]}${m[2]}${m[3]}`) : 0;
}
function rbKeyToIso(key) {
  const s = String(key);
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : "";
}
function rbKeyLabel(key) {
  const s = String(key);
  if (s.length !== 8) return "";
  const mo = Number(s.slice(4, 6));
  return `${Number(s.slice(6, 8))} ${RB_MONTHS[mo - 1] || mo} ${s.slice(0, 4)}`;
}

function rbRender() {
  if (!RB) return;
  const fs = $("#rb-subjek").value;
  const fk = $("#rb-ket").value;
  const satu = Number($("#rb-tanggal").value) || 0; // filter 1 tanggal
  let lo = rbIsoToKey($("#rb-dari").value);
  let hi = rbIsoToKey($("#rb-sampai").value);
  if (lo && hi && lo > hi) [lo, hi] = [hi, lo]; // toleran bila Dari/Sampai terbalik

  const rows = RB.rows.filter((r) => {
    if (fs && r.subjek !== fs) return false;
    if (fk && r.keterangan !== fk) return false;
    // k = 0 berarti tanggal tak terbaca → baris itu dikecualikan bila filter tanggal aktif.
    const k = Number(r.tglKey) > 0 ? Number(r.tglKey) : 0;
    if (satu) return k === satu;
    if (lo && (!k || k < lo)) return false;
    if (hi && (!k || k > hi)) return false;
    return true;
  });
  const total = rows.reduce((s, r) => s + (Number(r.nominal) || 0), 0);

  let tglDesc = "";
  if (satu) tglDesc = ` &nbsp;·&nbsp; tanggal: <b>${escapeHtml(rbKeyLabel(satu))}</b>`;
  else if (lo || hi) {
    tglDesc =
      ` &nbsp;·&nbsp; rentang: <b>${escapeHtml(lo ? rbKeyLabel(lo) : "awal bulan")} – ` +
      `${escapeHtml(hi ? rbKeyLabel(hi) : "akhir bulan")}</b>`;
  }

  $("#rb-total").classList.remove("hidden");
  $("#rb-total").innerHTML =
    `Total biaya (${rows.length} baris): <b>${fmtRp(total)}</b>` +
    tglDesc +
    (RB.spreadsheetTitle ? ` &nbsp;·&nbsp; sumber: ${escapeHtml(RB.spreadsheetTitle)}` : "");

  const el = $("#rb-table");
  if (!rows.length) {
    el.innerHTML = `<p class="hint">Tidak ada biaya untuk pilihan ini.</p>`;
    return;
  }
  const heads = RB.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
  const body = rows
    .map((r) => `<tr>${r.cells.map((c, i) => `<td${i === 2 ? ' class="num"' : ""}>${escapeHtml(c)}</td>`).join("")}</tr>`)
    .join("");
  el.innerHTML = `<table id="rb-grid"><thead><tr>${heads}</tr></thead><tbody>${body}</tbody></table>`;
}

async function rbLoad() {
  rbInitSelectors();
  const month = Number($("#rb-month").value);
  const year = Number($("#rb-year").value);
  const el = $("#rb-table");
  el.innerHTML = "Memuat…";
  $("#rb-result").classList.add("hidden");
  const btn = $("#btn-rb-load");
  btn.disabled = true;
  try {
    RB = await api(`/api/riwayat-biaya?year=${year}&month=${month}`);
    const subjOpts = ['<option value="">— semua subjek —</option>']
      .concat(RB.subjekOptions.map((s) => `<option>${escapeHtml(s)}</option>`))
      .join("");
    const ketOpts = ['<option value="">— semua keterangan —</option>']
      .concat(RB.keteranganOptions.map((s) => `<option>${escapeHtml(s)}</option>`))
      .join("");
    $("#rb-subjek").innerHTML = subjOpts;
    $("#rb-ket").innerHTML = ketOpts;

    // Filter tanggal: dropdown 1 tanggal + batas rentang, dari tanggal yang ada di data.
    const dk = RB.dateKeys || [];
    $("#rb-tanggal").innerHTML = ['<option value="">— semua tanggal —</option>']
      .concat(dk.map((k) => `<option value="${k}">${escapeHtml(rbKeyLabel(k))}</option>`))
      .join("");
    const dari = $("#rb-dari");
    const sampai = $("#rb-sampai");
    dari.value = "";
    sampai.value = "";
    const minIso = dk.length ? rbKeyToIso(dk[0]) : "";
    const maxIso = dk.length ? rbKeyToIso(dk[dk.length - 1]) : "";
    dari.min = sampai.min = minIso;
    dari.max = sampai.max = maxIso;

    $("#rb-filters").style.display = "flex";
    $("#rb-filters-tgl").style.display = "flex";
    rbRender();
  } catch (e) {
    $("#rb-filters").style.display = "none";
    $("#rb-filters-tgl").style.display = "none";
    $("#rb-total").classList.add("hidden");
    el.innerHTML = "";
    showLog($("#rb-result"), "✘ " + e.message, true);
  } finally {
    btn.disabled = false;
  }
}

function rbOpen() {
  rbInitSelectors();
  const ym = rbDefaultYM();
  if ($("#rb-month")) $("#rb-month").value = String(ym.month);
  if ($("#rb-year")) $("#rb-year").value = String(ym.year);
  RB_LOADED = true;
  rbLoad();
}

$("#btn-rb-load").addEventListener("click", rbLoad);
$("#rb-subjek").addEventListener("change", rbRender);
$("#rb-ket").addEventListener("change", rbRender);

// Filter tanggal & rentang saling meniadakan agar tidak membingungkan:
// memilih 1 tanggal mengosongkan rentang, dan sebaliknya.
$("#rb-tanggal").addEventListener("change", () => {
  if ($("#rb-tanggal").value) {
    $("#rb-dari").value = "";
    $("#rb-sampai").value = "";
  }
  rbRender();
});
const rbRangeChanged = () => {
  if ($("#rb-dari").value || $("#rb-sampai").value) $("#rb-tanggal").value = "";
  rbRender();
};
$("#rb-dari").addEventListener("change", rbRangeChanged);
$("#rb-sampai").addEventListener("change", rbRangeChanged);

$("#btn-rb-reset").addEventListener("click", () => {
  $("#rb-subjek").value = "";
  $("#rb-ket").value = "";
  $("#rb-tanggal").value = "";
  $("#rb-dari").value = "";
  $("#rb-sampai").value = "";
  rbRender();
});

// ================= Daftar Biaya Baru (sheet DAFTAR BIAYA) =================
let DB = null;
let DB_LOADED = false;

function dbTokens(s) {
  return String(s || "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
}

// Peringkat POS BIAYA berdasarkan kemiripan KETERANGAN BIAYA + frekuensi.
function dbRankPos(keterangan) {
  const kt = new Set(dbTokens(keterangan));
  const score = {};
  const freq = {};
  for (const r of DB.rows) {
    if (!r.posBiaya) continue;
    freq[r.posBiaya] = (freq[r.posBiaya] || 0) + 1;
    if (kt.size) {
      let overlap = 0;
      for (const t of dbTokens(r.keterangan)) if (kt.has(t)) overlap++;
      if (overlap) score[r.posBiaya] = (score[r.posBiaya] || 0) + overlap;
    }
  }
  return DB.posBiayaList.slice().sort(
    (a, b) => (score[b] || 0) - (score[a] || 0) || (freq[b] || 0) - (freq[a] || 0) || a.localeCompare(b, "id")
  );
}

// Peringkat nilai child berdasarkan seberapa sering muncul bersama nilai parent.
function dbRankBy(parentField, parentValue, childField, childList) {
  const cnt = {};
  if (parentValue) {
    for (const r of DB.rows) {
      if (r[parentField] === parentValue && r[childField]) cnt[r[childField]] = (cnt[r[childField]] || 0) + 1;
    }
  }
  return childList.slice().sort((a, b) => (cnt[b] || 0) - (cnt[a] || 0) || a.localeCompare(b, "id"));
}

function dbSetDatalist(id, values) {
  $(id).innerHTML = values.map((v) => `<option value="${escapeHtml(v)}"></option>`).join("");
}

// Isi datalist sesuai peringkat; bila input kosong (atau force), isi rekomendasi teratas.
function dbRecommendPos(force) {
  const ranked = dbRankPos($("#db-keterangan").value);
  dbSetDatalist("#dl-db-pos", ranked);
  if (ranked.length && (force || !$("#db-pos").value.trim())) $("#db-pos").value = ranked[0];
}
function dbRecommendPosApl(force) {
  const ranked = dbRankBy("posBiaya", $("#db-pos").value.trim(), "posAplikasi", DB.posAplikasiList);
  dbSetDatalist("#dl-db-posapl", ranked);
  if (ranked.length && (force || !$("#db-posapl").value.trim())) $("#db-posapl").value = ranked[0];
}
function dbRecommendItem(force) {
  const ranked = dbRankBy("posAplikasi", $("#db-posapl").value.trim(), "itemAplikasi", DB.itemAplikasiList);
  dbSetDatalist("#dl-db-item", ranked);
  if (ranked.length && (force || !$("#db-item").value.trim())) $("#db-item").value = ranked[0];
}

async function loadDaftarBiaya() {
  DB_LOADED = true;
  $("#db-loading").classList.remove("hidden");
  $("#db-form").classList.add("hidden");
  $("#db-error").classList.add("hidden");
  try {
    DB = await api("/api/daftarbiaya/options");
    dbSetDatalist("#dl-db-pos", DB.posBiayaList);
    dbSetDatalist("#dl-db-posapl", DB.posAplikasiList);
    dbSetDatalist("#dl-db-item", DB.itemAplikasiList);
    $("#db-loading").classList.add("hidden");
    $("#db-form").classList.remove("hidden");
  } catch (e) {
    $("#db-loading").classList.add("hidden");
    $("#db-error").textContent = e.message;
    $("#db-error").classList.remove("hidden");
    DB_LOADED = false; // izinkan coba lagi saat tab dibuka ulang
  }
}

function dbPreview() {
  if (!DB) return;
  const out = $("#db-preview");
  const v = {
    keterangan: $("#db-keterangan").value.trim(),
    pos: $("#db-pos").value.trim(),
    posapl: $("#db-posapl").value.trim(),
    item: $("#db-item").value.trim(),
  };
  if (!v.keterangan || !v.pos || !v.posapl || !v.item) {
    out.classList.remove("hidden");
    out.innerHTML = `<p class="error">Lengkapi semua kolom dulu: Keterangan Biaya, Pos Biaya, Pos Biaya Aplikasi, dan Item Biaya.</p>`;
    return;
  }
  const h = DB.headers;
  out.classList.remove("hidden");
  out.innerHTML =
    `<div class="table-wrap"><table><tbody>
      <tr><th>Kolom</th><th>Akan diisi</th></tr>
      <tr><td>C — ${escapeHtml(h.keterangan)}</td><td>${escapeHtml(v.keterangan)}</td></tr>
      <tr><td>D — ${escapeHtml(h.posBiaya)}</td><td>${escapeHtml(v.pos)}</td></tr>
      <tr><td>E — ${escapeHtml(h.posAplikasi)}</td><td>${escapeHtml(v.posapl)}</td></tr>
      <tr><td>F — ${escapeHtml(h.itemAplikasi)}</td><td>${escapeHtml(v.item)}</td></tr>
      <tr><td>G — ${escapeHtml(h.kode)}</td><td><i>otomatis (formula disalin)</i></td></tr>
    </tbody></table></div>
    <p class="hint">Akan ditulis ke <b>${escapeHtml(DB.sheet)}</b> sekitar <b>baris ${DB.nextRow}</b>
      (dicek ulang saat menyimpan).</p>
    <div class="actions"><button id="btn-db-submit" class="btn-primary">💾 Simpan ke DAFTAR BIAYA</button></div>`;
  $("#btn-db-submit").addEventListener("click", dbSubmit);
}

async function dbSubmit() {
  const btn = $("#btn-db-submit");
  const out = $("#db-result");
  const body = {
    keterangan: $("#db-keterangan").value.trim(),
    posBiaya: $("#db-pos").value.trim(),
    posAplikasi: $("#db-posapl").value.trim(),
    itemAplikasi: $("#db-item").value.trim(),
  };
  btn.disabled = true;
  try {
    const r = await api("/api/daftarbiaya/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    let msg = `✔ Tersimpan ke "${r.sheet}" baris ${r.row}: ${r.keterangan} · ${r.posBiaya} · ${r.posAplikasi} · ${r.itemAplikasi}.`;
    msg += `\n  Kode Transaksi: ${r.kode || "(kosong)"} — ${r.kodeStatus}`;
    showLog(out, msg);
    // reset form & muat ulang data agar baris baru ikut jadi bahan rekomendasi.
    $("#db-keterangan").value = "";
    $("#db-pos").value = "";
    $("#db-posapl").value = "";
    $("#db-item").value = "";
    $("#db-preview").classList.add("hidden");
    DB_LOADED = false;
    await loadDaftarBiaya();
  } catch (e) {
    showLog(out, "✘ " + e.message, true);
  } finally {
    btn.disabled = false;
  }
}

$("#db-keterangan").addEventListener("input", () => dbRecommendPos(false));
$("#db-pos").addEventListener("change", () => dbRecommendPosApl(false));
$("#db-posapl").addEventListener("change", () => dbRecommendItem(false));
$("#tab-daftarbiaya").addEventListener("click", (e) => {
  const t = e.target;
  if (!t.classList.contains("db-rec")) return;
  if (t.dataset.for === "pos") dbRecommendPos(true);
  else if (t.dataset.for === "posapl") dbRecommendPosApl(true);
  else if (t.dataset.for === "item") dbRecommendItem(true);
});
$("#btn-db-preview").addEventListener("click", dbPreview);

// ================= Deposit Pelanggan (sheet DEPOSIT) =================
let DEP = null;
let DEP_LOADED = false;

function depShowBalance() {
  const nama = $("#dep-cust").value;
  const el = $("#dep-balance");
  const trxEl = $("#dep-trx");
  if (!nama || !DEP) {
    el.classList.add("hidden");
    trxEl.classList.add("hidden");
    return;
  }
  const c = DEP.customers.find((x) => x.nama === nama);
  el.classList.remove("hidden");
  const saldo = c ? c.saldo : 0;
  const neg = saldo < 0;
  el.innerHTML =
    `Saldo deposit <b>${escapeHtml(nama)}</b>: <b style="color:${neg ? "var(--err)" : "var(--teal-dark)"}">${fmtRp(saldo)}</b>` +
    ` <span class="hint">· ${c ? c.transaksi : 0} transaksi</span>`;

  // Daftar transaksi deposit pelanggan (urut sheet) + saldo berjalan.
  const list = (DEP.transactions || []).filter((t) => t.nama === nama);
  if (!list.length) {
    trxEl.classList.remove("hidden");
    trxEl.innerHTML = `<p class="hint">Belum ada transaksi deposit untuk pelanggan ini.</p>`;
    return;
  }
  let run = 0;
  const body = list
    .map((t) => {
      run += Number(t.jumlah) || 0;
      const jNeg = Number(t.jumlah) < 0;
      const jenis = jNeg ? "Pemakaian" : "Penambahan";
      return (
        `<tr>` +
        `<td>${escapeHtml(t.tanggal || "")}</td>` +
        `<td>${escapeHtml(t.outlet || "")}</td>` +
        `<td>${escapeHtml(jenis)}</td>` +
        `<td class="num" style="color:${jNeg ? "var(--err)" : "var(--teal-dark)"};font-weight:700">${fmtRp(t.jumlah)}</td>` +
        `<td class="num">${fmtRp(run)}</td>` +
        `</tr>`
      );
    })
    .join("");
  trxEl.classList.remove("hidden");
  trxEl.innerHTML =
    `<h3 style="margin:6px 0 8px">Daftar Transaksi Deposit — ${escapeHtml(nama)}</h3>` +
    `<div class="table-wrap"><table id="dep-trx-grid"><thead><tr>` +
    `<th>Tanggal</th><th>Outlet</th><th>Jenis</th><th>Jumlah</th><th>Saldo Berjalan</th>` +
    `</tr></thead><tbody>${body}</tbody></table></div>`;
}

async function loadDeposit() {
  DEP_LOADED = true;
  $("#dep-error").classList.add("hidden");
  try {
    DEP = await api("/api/deposit/summary");
    const opts = ['<option value="">— pilih —</option>']
      .concat(DEP.customers.map((c) => `<option value="${escapeHtml(c.nama)}">${escapeHtml(c.nama)}</option>`))
      .join("");
    $("#dep-cust").innerHTML = opts;
    $("#dl-dep-cust").innerHTML = DEP.customers.map((c) => `<option value="${escapeHtml(c.nama)}"></option>`).join("");
    $("#dep-outlet").innerHTML = ['<option value="">— pilih —</option>']
      .concat(DEP.outlets.map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`))
      .join("");
    const dt = $("#dep-tanggal");
    if (dt && !dt.value) dt.value = (STATUS && STATUS.today ? isoFromDDMMYYYY(STATUS.today) : "") || new Date().toISOString().slice(0, 10);
    depShowBalance();
  } catch (e) {
    $("#dep-error").textContent = e.message;
    $("#dep-error").classList.remove("hidden");
    DEP_LOADED = false;
  }
}

function isoFromDDMMYYYY(s) {
  const m = String(s || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

function depPreview() {
  const out = $("#dep-preview");
  const nama = $("#dep-nama").value.trim();
  const tanggal = $("#dep-tanggal").value;
  const outlet = $("#dep-outlet").value;
  const jenis = $("#dep-jenis").value;
  const nominal = Math.abs(Number($("#dep-nominal").value));
  out.classList.remove("hidden");
  if (!nama || !tanggal || !outlet || !jenis || !Number.isFinite(nominal) || nominal <= 0) {
    out.innerHTML = `<p class="error">Lengkapi semua: Nama, Tanggal, Outlet, Jenis (PEMAKAIAN/PENAMBAHAN), dan Nominal.</p>`;
    return;
  }
  const signed = jenis === "PEMAKAIAN" ? -nominal : nominal;
  const warna = signed < 0 ? "var(--err)" : "var(--teal-dark)";
  const h = DEP ? DEP.headers : { jumlah: "JUMLAH DEPOSIT" };
  const cur = DEP && DEP.customers.find((x) => x.nama === nama);
  const saldoStr = cur ? `${fmtRp(cur.saldo)} → <b>${fmtRp(cur.saldo + signed)}</b>` : `${fmtRp(signed)}`;
  out.innerHTML =
    `<div class="table-wrap"><table><tbody>
      <tr><th>Kolom</th><th>Akan diisi</th></tr>
      <tr><td>Nama Pelanggan</td><td>${escapeHtml(nama)}</td></tr>
      <tr><td>Tanggal</td><td>${escapeHtml(tanggal.split("-").reverse().join("/"))}</td></tr>
      <tr><td>Outlet</td><td>${escapeHtml(outlet)}</td></tr>
      <tr><td>${escapeHtml(h.jumlah)}</td><td style="color:${warna};font-weight:700">${fmtRp(signed)} <span class="hint">(${jenis === "PEMAKAIAN" ? "PEMAKAIAN −" : "PENAMBAHAN +"})</span></td></tr>
    </tbody></table></div>
    <p class="hint">Perkiraan saldo ${escapeHtml(nama)}: ${saldoStr}. Ditulis ke <b>${escapeHtml(DEP ? DEP.sheet : "DEPOSIT")}</b> sekitar <b>baris ${DEP ? DEP.nextRow : "?"}</b> (dicek ulang saat menyimpan).</p>
    <div class="actions"><button id="btn-dep-submit" class="btn-primary">💾 Simpan ke DEPOSIT</button></div>`;
  $("#btn-dep-submit").addEventListener("click", depSubmit);
}

async function depSubmit() {
  const btn = $("#btn-dep-submit");
  const out = $("#dep-result");
  const body = {
    nama: $("#dep-nama").value.trim(),
    tanggal: $("#dep-tanggal").value,
    outlet: $("#dep-outlet").value,
    jenis: $("#dep-jenis").value,
    nominal: Math.abs(Number($("#dep-nominal").value)),
  };
  btn.disabled = true;
  try {
    const r = await api("/api/deposit/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    showLog(
      out,
      `✔ Tercatat di "${r.sheet}" baris ${r.row}: ${r.nama} · ${r.tanggal} · ${r.outlet} · ${fmtRp(r.nominal)} (${r.jenis}).` +
        (r.saldo != null ? `\n  Saldo ${r.nama} sekarang: ${fmtRp(r.saldo)}.` : "")
    );
    $("#dep-nominal").value = "";
    $("#dep-jenis").value = "";
    $("#dep-preview").classList.add("hidden");
    DEP_LOADED = false;
    await loadDeposit();
  } catch (e) {
    showLog(out, "✘ " + e.message, true);
  } finally {
    btn.disabled = false;
  }
}

$("#dep-cust").addEventListener("change", () => {
  depShowBalance();
  if ($("#dep-cust").value && !$("#dep-nama").value.trim()) $("#dep-nama").value = $("#dep-cust").value;
});
$("#btn-dep-preview").addEventListener("click", depPreview);

// ================= Diagnostik baris blok REKAP =================
$("#btn-rekap-blocks").addEventListener("click", async () => {
  const out = $("#rekap-blocks-result");
  const btn = $("#btn-rekap-blocks");
  btn.disabled = true;
  out.innerHTML = `<p class="loading">Membaca sheet REKAP…</p>`;
  try {
    const r = await api("/api/rekap/blocks");
    const HI = new Set(["MEI", "JUNI"]); // disorot
    const parts = (r.rekap || []).map((s) => {
      const rows = s.blocks
        .map((b) => {
          const L = b.labels || {};
          const hi = HI.has(b.month) ? ' style="background:var(--gold-soft);font-weight:700"' : "";
          return (
            `<tr${hi}><td>${escapeHtml(b.month)}</td>` +
            `<td class="num">${b.blockStart}–${b.blockEnd}</td>` +
            `<td class="num">${L["KAS TUNAI APLIKASI"] || "-"}</td>` +
            `<td class="num">${L["KAS TUNAI LAPOR"] || "-"}</td>` +
            `<td class="num">${L["SETORAN KAS"] || "-"}</td>` +
            `<td class="num">${L["SELISIH"] || "-"}</td></tr>`
          );
        })
        .join("");
      return (
        `<h4 style="margin:14px 0 6px">${escapeHtml(s.sheet)}</h4>` +
        `<div class="table-wrap"><table><thead><tr>` +
        `<th>Bulan</th><th>Baris blok</th><th>KAS TUNAI APLIKASI</th><th>KAS TUNAI LAPOR</th><th>SETORAN KAS</th><th>SELISIH</th>` +
        `</tr></thead><tbody>${rows || '<tr><td colspan="6">Tidak ada blok bulan terdeteksi.</td></tr>'}</tbody></table></div>`
      );
    });
    out.innerHTML = parts.join("") || `<p class="hint">Sheet REKAP tidak ditemukan.</p>`;
  } catch (e) {
    out.innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`;
  } finally {
    btn.disabled = false;
  }
});

// ================= Versi & Pembaruan Aplikasi =================
let APPVER = null;

function renderAppVersion() {
  const el = $("#app-version");
  const btn = $("#btn-app-update");
  if (!APPVER) {
    el.textContent = "Versi aplikasi tidak terbaca.";
    btn.classList.add("hidden");
    return;
  }
  if (!APPVER.ok) {
    el.innerHTML = `<span style="color:#b3402f">${escapeHtml(APPVER.error || "Versi tidak terbaca.")}</span>`;
    btn.classList.add("hidden");
    return;
  }
  const tgl = APPVER.date ? new Date(APPVER.date).toLocaleString("id-ID") : "-";
  let html =
    `Versi terpasang: <b>${escapeHtml(APPVER.commit)}</b> · ${escapeHtml(tgl)}` +
    `<br><small>${escapeHtml(APPVER.subject || "")}</small>`;
  if (APPVER.dirty) html += `<br><small>Ada berkas aplikasi yang diubah di komputer ini — tetap aman diperbarui; bila bertabrakan, pembaruan ditolak dengan pesan jelas.</small>`;
  if (APPVER.error) html += `<br><small style="color:#b3402f">${escapeHtml(APPVER.error)}</small>`;
  if (APPVER.updateAvailable) {
    html += `<br><b style="color:#b3402f">Tersedia pembaruan: ${APPVER.behind} perubahan baru.</b>`;
  } else if (APPVER.checked) {
    html += `<br><small>Sudah versi terbaru.</small>`;
  }
  el.innerHTML = html;
  btn.classList.toggle("hidden", !APPVER.updateAvailable);
  updateTabBadge("pengaturan", APPVER.updateAvailable ? 1 : 0);
}

async function appCheckVersion(check) {
  try {
    APPVER = await api("/api/app/version" + (check ? "?check=1" : ""));
  } catch (e) {
    APPVER = { ok: false, error: e.message };
  }
  renderAppVersion();
}

/** Tunggu server hidup kembali setelah restart, lalu muat ulang halaman. */
async function appWaitAndReload(out) {
  const deadline = Date.now() + 90000;
  await new Promise((r) => setTimeout(r, 3000));
  while (Date.now() < deadline) {
    try {
      const r = await fetch("/api/app/version", { cache: "no-store" });
      if (r.ok) {
        showLog(out, "✔ Aplikasi sudah berjalan kembali. Memuat ulang halaman…");
        setTimeout(() => window.location.reload(), 900);
        return;
      }
    } catch {
      /* server sedang restart — coba lagi */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  showLog(out, "⚠ Aplikasi belum merespons. Muat ulang halaman ini secara manual sebentar lagi.", true);
}

$("#btn-app-check").addEventListener("click", async () => {
  const btn = $("#btn-app-check");
  btn.disabled = true;
  $("#app-version").textContent = "Memeriksa pembaruan…";
  try {
    await appCheckVersion(true);
  } finally {
    btn.disabled = false;
  }
});

$("#btn-app-update").addEventListener("click", async () => {
  const out = $("#app-update-result");
  const btn = $("#btn-app-update");
  btn.disabled = true;
  showLog(out, "Mengambil pembaruan…");
  try {
    const r = await api("/api/app/update", { method: "POST" });
    if (r.error) {
      showLog(out, "✘ " + r.error, true);
      btn.disabled = false;
      return;
    }
    const log = (r.steps || []).map((s) => "• " + s).join("\n");
    if (!r.changed) {
      showLog(out, (log ? log + "\n" : "") + "✔ " + (r.message || "Sudah versi terbaru."));
      btn.disabled = false;
      await appCheckVersion(true);
      return;
    }
    showLog(out, `${log}\n✔ Diperbarui ke ${r.commit || ""} ${r.subject || ""}`.trim());
    if (r.restarted) await appWaitAndReload(out);
    else btn.disabled = false;
  } catch (e) {
    showLog(out, "✘ " + e.message, true);
    btn.disabled = false;
  }
});

// ================= Link Online (Cloudflare Tunnel) =================
function tunnelManualHint() {
  return (
    `<details class="hint" style="margin-top:10px">` +
    `<summary>Cara menyalakan manual lewat terminal</summary>` +
    `<pre class="code-block">cd ~/Cashflow-Laundry\n` +
    `pm2 start server.js --name laundry\n` +
    `pm2 start cloudflared --name tunnel -- tunnel --url http://localhost:3000\n` +
    `pm2 save\n` +
    `pm2 logs tunnel --nostream --lines 100 | grep trycloudflare</pre></details>`
  );
}

async function tunnelCopy(link, url) {
  try {
    await copyTextToClipboard(url);
    link.classList.add("copied");
    link.textContent = "✓ Tersalin!";
    setTimeout(() => {
      link.classList.remove("copied");
      link.textContent = url;
    }, 1400);
  } catch (e) {
    link.textContent = "Gagal menyalin — salin manual";
    setTimeout(() => (link.textContent = url), 1600);
  }
}

function renderTunnelUrl(out, url, started) {
  out.innerHTML =
    `<div class="tunnel-box">` +
    `<p class="hint">${started ? "✔ Tunnel dinyalakan." : "✔ Tunnel sedang online."} ` +
    `Klik alamat di bawah untuk menyalin.</p>` +
    `<div class="tunnel-url-row">` +
    `<a class="tunnel-url" href="#" title="Klik untuk menyalin">${escapeHtml(url)}</a>` +
    `<a class="btn-ghost tunnel-open" href="${escapeHtml(url)}" target="_blank" rel="noopener">Buka ↗</a>` +
    `</div>` +
    `<p class="hint">Alamat ini berubah tiap kali tunnel dinyalakan ulang — selalu pakai yang terbaru.</p>` +
    `</div>`;
  const link = out.querySelector(".tunnel-url");
  link.addEventListener("click", (e) => {
    e.preventDefault();
    tunnelCopy(link, url);
  });
}

$("#btn-tunnel").addEventListener("click", async () => {
  const out = $("#tunnel-result");
  const btn = $("#btn-tunnel");
  btn.disabled = true;
  out.innerHTML = `<p class="loading">Mengecek tunnel…</p>`;
  try {
    let r = await api("/api/tunnel");
    if (!(r.running && r.url)) {
      out.innerHTML = `<p class="loading">Tunnel belum aktif — menyalakan… (±10–25 detik, mohon tunggu)</p>`;
      r = await api("/api/tunnel/start", { method: "POST" });
    }
    if (r.url) {
      renderTunnelUrl(out, r.url, !!r.started);
    } else if (r.code === "NO_PM2") {
      out.innerHTML = `<p class="error">${escapeHtml(r.error || "pm2 tidak ditemukan.")}</p>` + tunnelManualHint();
    } else {
      out.innerHTML =
        `<p class="error">${escapeHtml(r.error || "Tunnel belum menghasilkan URL. Coba lagi sebentar.")}</p>` +
        tunnelManualHint();
    }
  } catch (e) {
    out.innerHTML = `<p class="error">${escapeHtml(e.message)}</p>` + tunnelManualHint();
  } finally {
    btn.disabled = false;
  }
});

// ================= Aliran Kas per Outlet =================
let AL = null;
let AL_LOADED = false;
const AL_MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

function alFmt(v) {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  return isNaN(n) ? String(v) : n.toLocaleString("id-ID");
}

function alInitSelectors() {
  const ym = rbDefaultYM(); // {month, year} dari STATUS hari ini
  const ms = $("#al-month");
  if (ms && !ms.options.length) {
    ms.innerHTML = AL_MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join("");
  }
  const ys = $("#al-year");
  if (ys && !ys.options.length) {
    const top = Math.max(ym.year, 2026);
    const years = [];
    for (let y = top; y >= 2026; y--) years.push(y);
    ys.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join("");
  }
  // default = bulan berjalan (minimal Maret 2026)
  let m = ym.month, y = ym.year;
  if (y < 2026 || (y === 2026 && m < 3)) { m = 3; y = 2026; }
  $("#al-month").value = String(m);
  $("#al-year").value = String(y);
}

function alRenderTable() {
  const el = $("#al-table");
  if (!AL || !AL.days.length) {
    el.innerHTML = `<p class="hint">Tidak ada data tanggal yang sudah terealisasi untuk pilihan ini.</p>`;
    return;
  }
  // filter satu tanggal (opsional)
  const sel = $("#al-day").value;
  const days = sel ? AL.days.filter((d) => String(d) === sel) : AL.days.slice();
  const dayIdx = days.map((d) => AL.days.indexOf(d));

  const head =
    `<th class="al-metric">TANGGAL</th>` + days.map((d) => `<th class="num">${d}</th>`).join("");
  const banks = AL.ajTrfBanks || {};
  const body = AL.metrics
    .map((m) => {
      const cls = m.highlight ? ' class="al-bold"' : "";
      const tds = dayIdx
        .map((i, j) => {
          const v = m.values[i];
          // Pendapatan Antar Jemput Transfer: bila ada nama bank untuk tanggal
          // itu, nilainya bisa diklik untuk menampilkan/menyembunyikan banknya.
          if (m.key === "aj_trf") {
            const bank = banks[days[j]];
            if (bank) {
              return (
                `<td class="num al-ajtrf" title="Klik untuk melihat nama bank">` +
                `${alFmt(v)}<span class="al-bank hidden">${escapeHtml(bank)}</span></td>`
              );
            }
          }
          if (m.highlight) {
            const n = Number(v);
            let style = "";
            if (v !== null && v !== "" && !isNaN(n)) {
              style = n < 0 ? ' style="color:var(--err);font-weight:800"' : n > 0 ? ' style="background:var(--gold-soft);font-weight:800"' : ' style="font-weight:800"';
            }
            return `<td class="num"${style}>${alFmt(v)}</td>`;
          }
          return `<td class="num">${alFmt(v)}</td>`;
        })
        .join("");
      return `<tr${cls}><td class="al-metric">${escapeHtml(m.label)}${m.found ? "" : ' <span class="hint">(tdk ada)</span>'}</td>${tds}</tr>`;
    })
    .join("");
  const notes = (AL.notes) || {};
  const noteRow =
    `<tr class="al-noterow"><td class="al-metric">Penyebab Selisih &amp; Konklusi <small>(ketik)</small></td>` +
    days
      .map((d) => `<td><textarea class="al-note" data-day="${d}" rows="1" placeholder="catatan…">${escapeHtml(notes[d] || "")}</textarea></td>`)
      .join("") +
    `</tr>`;
  el.innerHTML = `<table id="al-grid"><thead><tr>${head}</tr></thead><tbody>${body}${noteRow}</tbody></table>`;
  el.querySelectorAll("textarea.al-note").forEach(alAutoGrow); // sesuaikan tinggi ke isi (wrap ke bawah)
}

// Tinggikan textarea mengikuti isi (wrap text turun ke bawah, lebar tetap).
function alAutoGrow(t) {
  t.style.height = "auto";
  t.style.height = t.scrollHeight + 2 + "px";
}

async function alLoad() {
  alInitSelectors();
  const outlet = $("#al-outlet").value;
  const month = Number($("#al-month").value);
  const year = Number($("#al-year").value);
  const el = $("#al-table");
  el.innerHTML = "Memuat…";
  $("#al-result").classList.add("hidden");
  $("#al-datebox").style.display = "none";
  const btn = $("#btn-al-load");
  btn.disabled = true;
  try {
    AL = await api(`/api/aliran?outlet=${encodeURIComponent(outlet)}&year=${year}&month=${month}`);
    // dropdown tanggal
    const dopt = ['<option value="">Semua tanggal</option>']
      .concat(AL.days.map((d) => `<option value="${d}">Tanggal ${d}</option>`))
      .join("");
    $("#al-day").innerHTML = dopt;
    $("#al-day").value = "";
    $("#al-datebox").style.display = AL.days.length ? "flex" : "none";
    alRenderTable();
  } catch (e) {
    AL = null;
    el.innerHTML = "";
    $("#al-datebox").style.display = "none";
    showLog($("#al-result"), "✘ " + e.message, true);
  } finally {
    btn.disabled = false;
  }
}

function alOpen() {
  alInitSelectors();
  AL_LOADED = true;
  alLoad();
}

$("#btn-al-load").addEventListener("click", alLoad);
$("#al-day").addEventListener("change", alRenderTable);
// Klik nilai Pendapatan Antar Jemput Transfer -> tampilkan/sembunyikan nama bank.
$("#al-table").addEventListener("click", (e) => {
  const td = e.target.closest && e.target.closest("td.al-ajtrf");
  if (!td) return;
  const span = td.querySelector(".al-bank");
  if (span) span.classList.toggle("hidden");
});
$("#al-table").addEventListener("input", (e) => {
  if (e.target.classList.contains("al-note")) alAutoGrow(e.target);
});
$("#al-table").addEventListener("change", async (e) => {
  const t = e.target;
  if (!t.classList.contains("al-note") || !AL) return;
  const day = Number(t.dataset.day);
  const text = t.value;
  try {
    await api("/api/aliran/note", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outlet: AL.outlet, year: AL.year, month: AL.month, day, text }),
    });
    AL.notes = AL.notes || {};
    if (text.trim() === "") delete AL.notes[day];
    else AL.notes[day] = text;
    t.classList.add("al-note-saved");
    setTimeout(() => t.classList.remove("al-note-saved"), 900);
  } catch (err) {
    showLog($("#al-result"), "✘ Gagal simpan catatan: " + err.message, true);
  }
});

// ================= Proyeksi Biaya =================
// Seluruh isi sheet PROYEKSI BIAYA (CASHFLOW bulan berjalan). Hanya sel angka di
// kolom bulan berjalan (mis. NOVEMBER) yang bukan formula yang bisa diedit;
// server memvalidasi ulang setiap penyimpanan lalu mengirim tabel terbaru
// (TOTAL & angka formula ikut diperbarui).
let PB = null;
let PB_LOADED = false;
let PB_BUSY = false;

function pbFmtInput(n) {
  return n == null ? "" : Number(n).toLocaleString("id-ID", { maximumFractionDigits: 6 });
}

// "1.250.000", "Rp 1.250.000", "1250000", "-50.000", "12,5" → angka; "" → null; lainnya → NaN.
function pbParse(v) {
  let s = String(v == null ? "" : v).replace(/rp/gi, "").replace(/\s+/g, "").replace(/−/g, "-");
  if (s === "") return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.startsWith("-")) { neg = !neg; s = s.slice(1); }
  if (!/^\d{1,3}(\.\d{3})*(,\d+)?$|^\d+(,\d+)?$/.test(s)) return NaN;
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return neg ? -n : n;
}

async function loadProyeksi() {
  const out = $("#pb-result");
  const tbl = $("#pb-table");
  if (PB_BUSY || tbl.querySelector(".pb-editing")) return; // jangan ganggu yang sedang diedit
  if (!PB) tbl.innerHTML = '<p class="hint" style="padding:12px;margin:0">Memuat sheet PROYEKSI BIAYA…</p>';
  $("#btn-pb-load").disabled = true;
  try {
    PB = await api("/api/proyeksi");
    PB_LOADED = true;
    out.classList.add("hidden");
    pbRender();
    pbUndoMuat();
  } catch (e) {
    showLog(out, "✘ " + e.message, true);
    if (!PB) tbl.innerHTML = "";
  } finally {
    $("#btn-pb-load").disabled = false;
  }
}

function pbRender(saved, sorot) {
  const d = PB;
  if (!d) return;
  $("#pb-bulan").textContent = d.monthName || "bulan berjalan";
  $$(".pb-bulan-ini").forEach((x) => (x.textContent = d.monthName || "berjalan"));
  const link = $("#pb-open");
  link.href = d.spreadsheet.url;
  link.classList.remove("hidden");
  const kol = d.editCols.map((e) => `${e.group ? e.group + " › " : ""}${e.header} (kolom ${e.letter})`).join(", ");
  $("#pb-meta").textContent = `${d.spreadsheet.title} · dimuat ${d.loadedAt}` + (kol ? ` · bisa diedit: ${kol}` : "");
  if (!d.editCols.length) {
    showLog($("#pb-result"), `⚠ Kolom ${d.monthName} tidak ditemukan di baris judul sheet — tabel hanya bisa dilihat.`, true);
  }

  const editSet = new Set(d.editCols.map((e) => e.col));
  // Kolom yang tidak ditampilkan (LOKASI, KET) — ditentukan server dari baris judul.
  const hide = new Set(d.hiddenCols || []);
  const span = {};
  const skip = new Set();
  d.merges.forEach((m) => {
    const vis = [];
    for (let c = m.c; c < m.c + m.cs; c++) if (!hide.has(c)) vis.push(c);
    if (!vis.length) return;
    // Isi sel gabungan diambil dari sel kiri-atas, ditampilkan di kolom terlihat pertama.
    span[m.r + "," + vis[0]] = { rs: m.rs, cs: vis.length, src: m.c };
    for (let r = m.r; r < m.r + m.rs; r++)
      for (const c of vis) if (r !== m.r || c !== vis[0]) skip.add(r + "," + c);
  });
  const hdrN = Math.max(d.headerRow, d.frozenRows || 0);
  const nCols = d.lastCol - [...hide].filter((c) => c < d.lastCol).length;
  let head = "";
  let body = "";
  d.rows.forEach((row, r) => {
    const isHead = r < hdrN;
    const tag = isHead ? "th" : "td";
    const filled = row.filter((x) => x.v !== "").length;
    const rowHasMerge = d.merges.some((m) => m.r <= r && r < m.r + m.rs);
    if (isHead && filled === 1 && row[0].v !== "" && !rowHasMerge) {
      head += `<tr><th class="pb-title" colspan="${nCols}">${escapeHtml(row[0].v)}</th></tr>`;
      return;
    }
    const label = String(row[0].v || "").trim().toUpperCase();
    let tr = "";
    row.forEach((own, c) => {
      const key = r + "," + c;
      if (hide.has(c) || skip.has(key)) return;
      const m = span[key];
      const cell = m ? row[m.src] : own;
      const attrs = [];
      const cls = [];
      if (m && m.rs > 1) attrs.push(`rowspan="${m.rs}"`);
      if (m && m.cs > 1) { attrs.push(`colspan="${m.cs}"`); if (isHead) cls.push("pb-group"); }
      if (c === 0) cls.push("pb-sticky");
      const editCol = editSet.has(c);
      let html = escapeHtml(cell.v);
      if (isHead) {
        if (editCol && r === d.headerRow - 1) { cls.push("pb-hedit"); html += ' <span aria-hidden="true">✎</span>'; }
      } else {
        if (typeof cell.n === "number" && c > 0) cls.push("num");
        if (typeof cell.n === "number" && cell.n < 0) cls.push("neg");
        if (editCol) cls.push("pb-col-edit");
        if (cell.k === "f" || cell.k === "a") {
          const tip = cell.k === "f" ? "Otomatis dari formula: " + cell.fx : "Otomatis: hasil rumus array di sel lain";
          attrs.push(`title="${escapeHtml(tip)}"`);
          if (editCol) { cls.push("pb-fx"); html = `<span class="pb-f">ƒ</span>${html}`; }
        }
        if (cell.err) { cls.push("neg"); attrs.push(`title="${escapeHtml(cell.err)}"`); }
        if (cell.e) {
          cls.push("pb-edit");
          if ((saved && saved.r === r + 1 && saved.c === c + 1) || (sorot && sorot.has(`${r + 1},${c + 1}`))) cls.push("pb-saved");
          attrs.push(`data-r="${r + 1}" data-c="${c + 1}" tabindex="0" title="Klik untuk mengubah"`);
          html = `<span class="pb-val">${html || '<span class="pb-empty">kosong</span>'}</span>`;
        }
      }
      if (cls.length) attrs.push(`class="${cls.join(" ")}"`);
      tr += `<${tag} ${attrs.join(" ")}>${html}</${tag}>`;
    });
    const trCls = !isHead && /^TOTAL\b/.test(label) ? ' class="pb-total"' : "";
    if (isHead) head += `<tr>${tr}</tr>`;
    else body += `<tr${trCls}>${tr}</tr>`;
  });
  $("#pb-table").innerHTML = `<table id="pb-grid"><thead>${head}</thead><tbody>${body}</tbody></table>`;
  if (sorot && sorot.size) setTimeout(() => $$("#pb-grid td.pb-saved").forEach((x) => x.classList.remove("pb-saved")), 4000);
  if (saved) {
    const td = $(`#pb-grid td.pb-edit[data-r="${saved.r}"][data-c="${saved.c}"]`);
    setTimeout(() => td && td.classList.remove("pb-saved"), 1800);
    // Lanjut ke sel berikutnya di kolom yang sama (Enter untuk mengedit).
    if (saved.next) {
      const nx = $$(`#pb-grid td.pb-edit[data-c="${saved.c}"]`).find((x) => Number(x.dataset.r) > saved.r);
      if (nx) nx.focus();
    }
  }
}

function pbStartEdit(td) {
  if (!PB || PB_BUSY || td.classList.contains("pb-editing")) return;
  const r = Number(td.dataset.r);
  const c = Number(td.dataset.c);
  const cell = PB.rows[r - 1][c - 1];
  const out = $("#pb-result");
  td.classList.add("pb-editing");
  td.innerHTML = '<input class="pb-input" type="text" inputmode="decimal" autocomplete="off" aria-label="Nominal baru" />';
  const inp = td.querySelector("input");
  inp.value = pbFmtInput(typeof cell.n === "number" ? cell.n : null);
  inp.focus();
  inp.select();
  let done = false;
  const finish = async (mode) => {
    if (done) return;
    if (mode === "cancel") { done = true; pbRender(); return; }
    const v = pbParse(inp.value);
    if (Number.isNaN(v)) {
      showLog(out, "✘ Nominal tidak valid. Tulis angka saja, mis. 1.250.000 (boleh dikosongkan).", true);
      if (mode === "blur") { done = true; pbRender(); return; }
      inp.classList.add("pb-bad");
      inp.focus();
      return;
    }
    done = true;
    const lama = typeof cell.n === "number" ? cell.n : null;
    if ((v == null && lama == null) || (v != null && lama != null && Math.abs(v - lama) < 1e-9)) {
      pbRender(mode === "enter" ? { r, c, next: true } : null);
      return;
    }
    await pbSave(r, c, v, lama, td, mode === "enter");
  };
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); finish("enter"); }
    else if (e.key === "Escape") { e.preventDefault(); finish("cancel"); }
  });
  inp.addEventListener("input", () => inp.classList.remove("pb-bad"));
  inp.addEventListener("blur", () => finish("blur"));
}

async function pbSave(r, c, nilai, lama, td, next) {
  const out = $("#pb-result");
  PB_BUSY = true;
  td.innerHTML = '<span class="pb-saving">menyimpan…</span>';
  try {
    const res = await fetch("/api/proyeksi/simpan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ row: r, col: c, nilai, lama, label: PB.rows[r - 1][0].v, token: PB.spreadsheet.id }),
    });
    if (res.status === 401) { window.location = "/login"; return; }
    const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
    if (!res.ok || !data.ok) {
      if (data.data) PB = data.data;
      pbRender();
      showLog(out, "✘ " + (data.error || `HTTP ${res.status}`), true);
      return;
    }
    PB = data.data;
    pbRender({ r, c, next });
    if (PBX) pbxPratinjau(true);
    const s = data.saved;
    showLog(
      out,
      `✔ Tersimpan di spreadsheet: ${s.group ? s.group + " › " : ""}${s.header} › ${s.label} (sel ${s.a1}): ` +
        `${s.lama || "kosong"} → ${s.baru || "kosong"}. TOTAL & angka otomatis sudah diperbarui.`
    );
  } catch (e) {
    pbRender();
    showLog(out, "✘ Gagal menyimpan: " + e.message, true);
  } finally {
    PB_BUSY = false;
  }
}

$("#btn-pb-load").addEventListener("click", () => loadProyeksi());
$("#pb-table").addEventListener("click", (ev) => {
  const td = ev.target.closest("td.pb-edit");
  if (td) pbStartEdit(td);
});
$("#pb-table").addEventListener("keydown", (ev) => {
  const td = ev.target.closest && ev.target.closest("td.pb-edit");
  if (!td || ev.target !== td) return;
  if (ev.key === "Enter" || ev.key === "F2") { ev.preventDefault(); pbStartEdit(td); }
});

// ----- Proyeksi Biaya › isi otomatis dari berkas proyeksi (.xlsx) -----
let PBX = null; // pratinjau berkas yang sedang ditampilkan

const PBX_STATUS = {
  tulis: "akan diisi",
  sama: "sudah sama",
  formula: "otomatis (formula)",
  "tidak-ada": "tidak ada di berkas",
  galat: "tidak bisa dihitung",
  kosong: "kosong di berkas",
  "tidak-bisa": "bukan angka",
};

function pbxRp(n) {
  return n == null ? "" : Math.round(n).toLocaleString("id-ID");
}

async function pbxPost(path, opts) {
  const res = await fetch(path, opts);
  if (res.status === 401) {
    window.location = "/login";
    throw new Error("Sesi berakhir, silakan login ulang.");
  }
  const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!res.ok || data.ok === false) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data.data || null;
    throw err;
  }
  return data;
}

function pbxCell(it) {
  if (!it) return '<td class="pbx-skip">—</td>';
  const tag = (t) => `<span class="pbx-tag">${escapeHtml(t)}</span>`;
  const lama = escapeHtml(it.lamaTeks || "kosong");
  const diBerkas = it.berkas != null ? ` title="Di berkas: ${escapeHtml(pbxRp(it.berkas))}"` : "";
  switch (it.status) {
    case "tulis":
      return `<td class="num pbx-tulis"><span class="pbx-lama">${lama}</span> → <b>${escapeHtml(pbxRp(it.baru))}</b></td>`;
    case "sama":
      return `<td class="num pbx-sama">${escapeHtml(pbxRp(it.baru))} ${tag("sama")}</td>`;
    case "formula":
      return `<td class="num pbx-fx"${diBerkas}><span class="pb-f">ƒ</span>${escapeHtml(it.lamaTeks)} ${tag("otomatis")}</td>`;
    case "galat":
      return `<td class="num pbx-err" title="${escapeHtml(it.galat || "")}">⚠ ${escapeHtml(it.galat || "galat")}</td>`;
    default:
      return `<td class="num pbx-skip">${escapeHtml(it.lamaTeks)} ${tag(PBX_STATUS[it.status] || it.status)}</td>`;
  }
}

function pbxRender() {
  const box = $("#pb-prev");
  const p = PBX;
  if (!p) { box.innerHTML = ""; return; }
  const sel = $("#pb-skenario");
  if (p.skenarioList && p.skenarioList.length) {
    sel.innerHTML = p.skenarioList
      .map((s) => `<option value="${escapeHtml(s)}"${s === p.skenario ? " selected" : ""}>${escapeHtml(s.charAt(0) + s.slice(1).toLowerCase())}</option>`)
      .join("");
  }
  const outs = p.outlets.map((o) => o.outlet);
  const labels = [];
  const by = {};
  p.items.forEach((it) => {
    if (!by[it.label]) { by[it.label] = {}; labels.push(it.label); }
    by[it.label][it.outlet] = it;
  });
  const sumber = p.outlets
    .map((o) => {
      let s = `<div><b>${escapeHtml(o.outlet)}</b> (kolom ${escapeHtml(o.kolomSheet)}) ← `;
      s += o.kolomBerkas
        ? `sheet “${escapeHtml(o.sheetBerkas)}”, kolom ${escapeHtml(o.kolomBerkas)} (${escapeHtml(o.judulBerkas)})`
        : `<span class="pbx-warn">tidak ada data</span>`;
      s += "</div>";
      o.catatan.forEach((c) => (s += `<div class="pbx-warn">⚠ ${escapeHtml(c)}</div>`));
      if (o.ekstra.length) s += `<div class="pbx-warn">⚠ Komponen di berkas yang tidak ada di sheet (tidak diisi): ${escapeHtml(o.ekstra.join(", "))}</div>`;
      return s;
    })
    .join("");
  const r = p.ringkas;
  const rows = labels.map((l) => `<tr><td class="pb-sticky">${escapeHtml(l)}</td>${outs.map((o) => pbxCell(by[l][o])).join("")}</tr>`).join("");
  box.innerHTML = `
    <div class="pbx-card">
      <div class="pbx-info">
        <div>Berkas: <b>${escapeHtml(p.berkas)}</b> · bulan <b>${escapeHtml(p.bulan.label)}</b> (kolom “${escapeHtml(p.bulan.singkat)}” di berkas) · skenario <b>${escapeHtml(p.skenario)}</b></div>
        ${sumber}
      </div>
      <div class="pbx-ringkas">
        <span class="pbx-chip pbx-tulis">${r.tulis} sel akan diisi</span>
        <span class="pbx-chip">${r.sama} sudah sama</span>
        <span class="pbx-chip pbx-fx">${r.formula} otomatis (formula) dilewati</span>
        ${r.lain ? `<span class="pbx-chip pbx-skip">${r.lain} lainnya dilewati</span>` : ""}
      </div>
      <div class="table-wrap"><table id="pbx-grid"><thead><tr><th class="pb-sticky">Komponen</th>${outs
        .map((o) => `<th>${escapeHtml(o)} · sekarang → dari berkas</th>`)
        .join("")}</tr></thead><tbody>${rows}</tbody></table></div>
      <p class="hint">Nominal dibulatkan ke rupiah terdekat. Sel bertanda <b>ƒ</b> dihitung otomatis oleh formula
        spreadsheet, jadi tidak diubah (arahkan kursor untuk melihat angka di berkas).</p>
      <div class="upload-row">
        <button id="btn-pbx-simpan" class="btn-primary"${r.tulis ? "" : " disabled"}>✔ Simpan ke spreadsheet (${r.tulis} sel)</button>
        <button id="btn-pbx-batal" class="btn-ghost">Batal</button>
      </div>
    </div>`;
}

function pbxSibuk(on, teks) {
  $("#btn-pb-baca").disabled = on;
  $("#pb-skenario").disabled = on;
  const s = $("#btn-pbx-simpan");
  if (s && on) s.disabled = true;
  const l = $("#pb-loading");
  if (teks) l.textContent = teks;
  l.classList.toggle("hidden", !on);
}

async function pbxBaca() {
  const input = $("#pb-file");
  const file = input.files && input.files[0];
  const out = $("#pb-result");
  if (!file) { showLog(out, "✘ Pilih berkas proyeksi (.xlsx) dahulu.", true); return; }
  pbxSibuk(true, "Membaca & menghitung ulang formula berkas…");
  $("#pb-prev").innerHTML = "";
  PBX = null;
  try {
    const fd = new FormData();
    fd.append("file", file, file.name);
    fd.append("skenario", $("#pb-skenario").value);
    PBX = await pbxPost("/api/proyeksi/berkas", { method: "POST", body: fd });
    out.classList.add("hidden");
    pbxRender();
  } catch (e) {
    showLog(out, "✘ " + e.message, true);
  } finally {
    pbxSibuk(false);
  }
}

async function pbxPratinjau(diam) {
  if (!PBX) return;
  const out = $("#pb-result");
  if (!diam) pbxSibuk(true, "Menyusun pratinjau…");
  try {
    PBX = await pbxPost("/api/proyeksi/berkas/pratinjau", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: PBX.id, skenario: $("#pb-skenario").value }),
    });
    pbxRender();
  } catch (e) {
    if (e.status === 410) { PBX = null; pbxRender(); }
    showLog(out, "✘ " + e.message, true);
  } finally {
    if (!diam) pbxSibuk(false);
  }
}

async function pbxSimpan() {
  if (!PBX) return;
  const out = $("#pb-result");
  const dilihat = PBX.items.filter((it) => it.status === "tulis").map((it) => ({ a1: it.a1, lama: it.lama }));
  pbxSibuk(true, `Menyimpan ${dilihat.length} sel ke spreadsheet…`);
  try {
    const res = await pbxPost("/api/proyeksi/berkas/terapkan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: PBX.id, skenario: PBX.skenario, dilihat }),
    });
    const berkas = PBX.berkas;
    PBX = null;
    pbxRender();
    clearFileInput($("#pb-file"));
    PB = res.data;
    pbRender(null, new Set(res.ditulis.map((x) => pbA1Key(x.a1))));
    PB_UNDO = res.undo || null;
    pbUndoRender();
    let msg = `✔ ${res.ditulis.length} sel kolom ${res.bulan.nama} terisi dari ${berkas} (skenario ${res.skenario}). TOTAL & angka otomatis sudah diperbarui.`;
    if (res.dilewati.length) {
      msg += `\n⚠ ${res.dilewati.length} sel dilewati:\n` + res.dilewati.map((x) => `  • ${x.outlet} › ${x.label} (${x.a1}): ${x.alasan}`).join("\n");
    }
    showLog(out, msg, false);
  } catch (e) {
    showLog(out, "✘ " + e.message, true);
    if (e.status === 410) { PBX = null; pbxRender(); }
    else if (PBX) pbxPratinjau(true);
  } finally {
    pbxSibuk(false);
  }
}

$("#btn-pb-baca").addEventListener("click", pbxBaca);
$("#pb-skenario").addEventListener("change", () => { if (PBX) pbxPratinjau(); });
$("#pb-prev").addEventListener("click", (ev) => {
  if (ev.target.closest("#btn-pbx-simpan")) pbxSimpan();
  else if (ev.target.closest("#btn-pbx-batal")) { PBX = null; pbxRender(); clearFileInput($("#pb-file")); }
});

// ----- Undo: kembalikan angka lama sebelum isi dari berkas -----
let PB_UNDO = null;

// "C15" → "15,3" (baris,kolom 1-based) untuk menyorot sel di tabel.
function pbA1Key(a1) {
  const m = String(a1).match(/^([A-Z]+)(\d+)$/);
  const c = [...m[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  return `${m[2]},${c}`;
}

function pbUndoRender() {
  const box = $("#pb-undo");
  const u = PB_UNDO;
  if (!u) { box.innerHTML = ""; return; }
  box.innerHTML = `<div class="pb-undo-box">
      <div>Isi dari berkas terakhir: <b>${escapeHtml(u.berkas)}</b> (skenario ${escapeHtml(u.skenario)}) ·
        ${escapeHtml(u.waktu)} · <b>${u.jumlah} sel</b> diubah.</div>
      <button id="btn-pb-undo" class="btn-ghost">↶ Undo — kembalikan angka lama</button>
    </div>`;
}

async function pbUndoMuat() {
  try {
    const r = await api("/api/proyeksi/berkas/undo");
    PB_UNDO = r.undo || null;
    pbUndoRender();
  } catch {
    /* status undo tidak penting untuk menampilkan tabel */
  }
}

async function pbUndo() {
  const u = PB_UNDO;
  if (!u || PB_BUSY) return;
  if (!window.confirm(`Kembalikan ${u.jumlah} sel ke angka sebelum upload ${u.berkas}?`)) return;
  const out = $("#pb-result");
  const btn = $("#btn-pb-undo");
  btn.disabled = true;
  btn.textContent = "Mengembalikan angka lama…";
  PB_BUSY = true;
  try {
    const res = await pbxPost("/api/proyeksi/berkas/undo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: u.id }),
    });
    PB = res.data;
    pbRender(null, new Set(res.dikembalikan.map((x) => pbA1Key(x.a1))));
    PB_UNDO = res.undo || null;
    pbUndoRender();
    let msg = `↶ ${res.dikembalikan.length} sel dikembalikan ke angka sebelum upload ${res.berkas}. TOTAL & angka otomatis sudah diperbarui.`;
    if (res.dilewati.length) {
      msg += `\n⚠ ${res.dilewati.length} sel tidak dikembalikan:\n` + res.dilewati.map((x) => `  • ${x.outlet} › ${x.label} (${x.a1}): ${x.alasan}`).join("\n");
    }
    showLog(out, msg, false);
    if (PBX) pbxPratinjau(true);
  } catch (e) {
    showLog(out, "✘ " + e.message, true);
    pbUndoMuat();
  } finally {
    PB_BUSY = false;
  }
}

$("#pb-undo").addEventListener("click", (ev) => {
  if (ev.target.closest("#btn-pb-undo")) pbUndo();
});

// ================= Kas Sewa Gedung =================
// Sheet KAS SEWA GEDUNG (CASHFLOW bulan berjalan): saldo, riwayat pergerakan, input transaksi.
let KS = null;
let KS_BUSY = false;
let KS_SOROT = null; // baris yang baru disimpan (disorot di riwayat)
const KS_BULAN_PENDEK = ["Jan", "Feb", "Mar", "Apr", "Mei", "Juni", "Juli", "Agustus", "September", "Okt", "Nov", "Des"];
const KS_BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

function ksRp(n, tanda) {
  const v = Math.round(Number(n) || 0);
  const t = "Rp" + Math.abs(v).toLocaleString("id-ID");
  if (v < 0) return "−" + t;
  return (tanda && v > 0 ? "+" : "") + t;
}

function ksNominal() {
  const d = String($("#ks-nominal").value || "").replace(/\D/g, "");
  return d ? Number(d) : 0;
}

async function loadKasSewa() {
  if (KS_BUSY) return;
  if (!KS) $("#ks-saldo").innerHTML = '<p class="hint">Memuat sheet KAS SEWA GEDUNG…</p>';
  $("#btn-ks-load").disabled = true;
  try {
    KS = await api("/api/kassewa");
    ksRender();
  } catch (e) {
    $("#ks-saldo").innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`;
  } finally {
    $("#btn-ks-load").disabled = false;
  }
}

function ksRender() {
  const d = KS;
  if (!d) return;
  $("#ks-open").href = d.spreadsheet.url;
  $("#ks-open").classList.remove("hidden");
  $("#ks-meta").textContent = `${d.spreadsheet.title} · ${d.jumlah} transaksi · dimuat ${d.dimuat}`;
  $("#ks-warn").innerHTML = (d.peringatan || []).map((w) => `<div class="th-notice th-err">⚠️ <div>${escapeHtml(w)}</div></div>`).join("");
  const t = d.terakhir;
  $("#ks-saldo").innerHTML = `
    <div class="ks-kartu ks-utama">
      <div class="ks-label">Saldo terkini</div>
      <div class="ks-angka ${d.saldo < 0 ? "neg" : ""}">${ksRp(d.saldo)}</div>
      <div class="ks-sub">${t ? "per " + escapeHtml(t.tanggalTeks || "-") : "belum ada transaksi"}</div>
    </div>
    <div class="ks-kartu"><div class="ks-label">Total masuk</div><div class="ks-angka pos">${ksRp(d.masuk, true)}</div></div>
    <div class="ks-kartu"><div class="ks-label">Total keluar</div><div class="ks-angka neg">${ksRp(d.keluar)}</div></div>
    <div class="ks-kartu"><div class="ks-label">Transaksi terakhir</div>${
      t
        ? `<div class="ks-sub">${escapeHtml(t.tanggalTeks)} · ${escapeHtml(t.keterangan || "-")}</div>
           <div class="ks-angka kecil ${t.nominal < 0 ? "neg" : "pos"}">${ksRp(t.nominal, true)}</div>`
        : '<div class="ks-sub">-</div>'
    }</div>`;
  // saran keterangan
  $("#dl-ks-ket").innerHTML = (d.saran || []).map((k) => `<option value="${escapeHtml(k)}"></option>`).join("");
  if (!$("#ks-tanggal").value) $("#ks-tanggal").value = d.hariIni;
  // pilihan bulan riwayat
  const sel = $("#ks-bulan");
  const pilih = sel.value;
  const bulan = [...new Set(d.transaksi.map((x) => (x.tanggal || "").slice(0, 7)).filter(Boolean))].sort().reverse();
  sel.innerHTML =
    '<option value="">Semua bulan</option>' +
    bulan.map((b) => `<option value="${b}">${KS_BULAN[Number(b.slice(5, 7)) - 1]} ${b.slice(0, 4)}</option>`).join("");
  if (bulan.includes(pilih)) sel.value = pilih;
  ksRenderCepat();
  ksPreview();
  ksRenderRiwayat();
}

function ksRenderCepat() {
  const iso = $("#ks-tanggal").value || (KS && KS.hariIni) || "";
  const m = iso.match(/^(\d{4})-(\d{2})/);
  if (!m) { $("#ks-cepat").innerHTML = ""; return; }
  const teks = `Tabungan Sewa Gedung ${KS_BULAN_PENDEK[Number(m[2]) - 1]} ${m[1]}`;
  $("#ks-cepat").innerHTML = `<span class="hint">Isi cepat:</span>
    <button type="button" class="ks-chip" data-jenis="masuk" data-ket="${escapeHtml(teks)}">${escapeHtml(teks)}</button>
    <button type="button" class="ks-chip" data-jenis="keluar" data-ket="Biaya admin">Biaya admin</button>`;
}

function ksJenis() {
  const r = document.querySelector('input[name="ks-jenis"]:checked');
  return r ? r.value : "masuk";
}

function ksPreview() {
  const el = $("#ks-preview");
  const n = ksNominal();
  if (!KS || !n) { el.textContent = ""; return; }
  const nilai = ksJenis() === "masuk" ? n : -n;
  const setelah = KS.saldo + nilai;
  el.innerHTML = `Akan dicatat <b class="${nilai < 0 ? "neg" : "pos"}">${ksRp(nilai, true)}</b> di kolom <b>${escapeHtml($("#ks-outlet").value)}</b> ·
    saldo menjadi <b class="${setelah < 0 ? "neg" : ""}">${ksRp(setelah)}</b>`;
}

function ksRenderRiwayat() {
  const d = KS;
  if (!d) return;
  const bln = $("#ks-bulan").value;
  const jenis = $("#ks-fjenis").value;
  const cari = $("#ks-cari").value.trim().toLowerCase();
  const list = d.transaksi.filter(
    (t) =>
      (!bln || (t.tanggal || "").startsWith(bln)) &&
      (!jenis || (jenis === "masuk" ? t.nominal > 0 : t.nominal < 0)) &&
      (!cari || `${t.keterangan} ${t.status} ${t.outlet}`.toLowerCase().includes(cari))
  );
  const masuk = list.filter((t) => t.nominal > 0).reduce((a, t) => a + t.nominal, 0);
  const keluar = list.filter((t) => t.nominal < 0).reduce((a, t) => a + t.nominal, 0);
  const rk = $("#ks-ringkas");
  rk.classList.remove("hidden");
  rk.innerHTML = `<b>${list.length}</b> transaksi · masuk <b class="pos">${ksRp(masuk, true)}</b> · keluar <b class="neg">${ksRp(keluar)}</b> ·
    selisih <b>${ksRp(masuk + keluar, true)}</b>`;
  if (!list.length) {
    $("#ks-table").innerHTML = '<p class="hint" style="padding:12px;margin:0">Tidak ada transaksi yang cocok.</p>';
    return;
  }
  const rows = list
    .map(
      (t) => `<tr class="${KS_SOROT === t.row ? "ks-baru" : ""}" data-row="${t.row}">
        <td class="ks-tgl">${escapeHtml(t.tanggalTeks || "-")}</td>
        <td class="ks-ket">${escapeHtml(t.keterangan || "-")}</td>
        <td>${escapeHtml(t.outlet)}</td>
        <td class="num pos">${t.nominal > 0 ? ksRp(t.nominal) : ""}</td>
        <td class="num neg">${t.nominal < 0 ? ksRp(t.nominal) : ""}</td>
        <td class="num ${t.saldoSetelah < 0 ? "neg" : ""}">${ksRp(t.saldoSetelah)}</td>
        <td class="ks-status">${t.status ? `<span class="ks-tag">${escapeHtml(t.status)}</span>` : ""}</td>
      </tr>`
    )
    .join("");
  $("#ks-table").innerHTML = `<table id="ks-grid"><thead><tr>
      <th>Tanggal</th><th>Keterangan</th><th>Outlet</th><th class="num">Masuk</th><th class="num">Keluar</th>
      <th class="num">Saldo</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`;
}

async function ksPost(path, body) {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (res.status === 401) { window.location = "/login"; throw new Error("Sesi berakhir, silakan login ulang."); }
  const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!res.ok || data.ok === false) {
    const e = new Error(data.error || `HTTP ${res.status}`);
    e.data = data.data || null;
    throw e;
  }
  return data;
}

async function ksSimpan() {
  const out = $("#ks-result");
  if (!KS) return;
  const nominal = ksNominal();
  const ket = $("#ks-ket").value.trim();
  if (!$("#ks-tanggal").value) return showLog(out, "✘ Isi tanggal transaksi.", true);
  if (!nominal) return showLog(out, "✘ Isi nominal, mis. 3.500.000", true);
  if (!ket) return showLog(out, "✘ Isi keterangan transaksi.", true);
  const btn = $("#btn-ks-simpan");
  btn.disabled = true;
  btn.textContent = "Menyimpan…";
  KS_BUSY = true;
  try {
    const r = await ksPost("/api/kassewa/simpan", {
      tanggal: $("#ks-tanggal").value,
      jenis: ksJenis(),
      outlet: $("#ks-outlet").value,
      nominal,
      keterangan: ket,
      token: KS.spreadsheet.id,
    });
    KS = r.data;
    KS_SOROT = r.tersimpan.row;
    ksRender();
    const t = r.tersimpan;
    showLog(out, `✔ Tersimpan di sheet KAS SEWA GEDUNG baris ${t.row}: ${t.tanggalTeks} · ${t.keterangan} · ${ksRp(t.nominal, true)} (${t.outlet}). Saldo sekarang ${ksRp(t.saldoSetelah)}.`);
    $("#ks-batal-box").innerHTML = `<button id="btn-ks-batal" class="btn-ghost" data-row="${t.row}" data-kunci="${t.kunci}">↶ Batalkan transaksi ini</button>`;
    $("#ks-nominal").value = "";
    $("#ks-ket").value = "";
    ksPreview();
    const tr = document.querySelector(`#ks-grid tr[data-row="${t.row}"]`);
    if (tr) setTimeout(() => tr.classList.remove("ks-baru"), 4000);
  } catch (e) {
    if (e.data) { KS = e.data; ksRender(); }
    showLog(out, "✘ " + e.message, true);
  } finally {
    KS_BUSY = false;
    btn.disabled = false;
    btn.textContent = "Simpan transaksi";
  }
}

async function ksBatal(btn) {
  if (!KS || KS_BUSY) return;
  if (!window.confirm("Batalkan transaksi yang baru disimpan? Barisnya akan dikosongkan lagi di sheet.")) return;
  const out = $("#ks-result");
  btn.disabled = true;
  KS_BUSY = true;
  try {
    const r = await ksPost("/api/kassewa/batalkan", { row: Number(btn.dataset.row), kunci: btn.dataset.kunci, token: KS.spreadsheet.id });
    KS = r.data;
    KS_SOROT = null;
    ksRender();
    $("#ks-batal-box").innerHTML = "";
    showLog(out, `↶ Transaksi "${r.dibatalkan.keterangan}" (${ksRp(r.dibatalkan.nominal, true)}) dibatalkan — baris ${r.dibatalkan.row} dikosongkan. Saldo sekarang ${ksRp(KS.saldo)}.`);
  } catch (e) {
    if (e.data) { KS = e.data; ksRender(); }
    btn.disabled = false;
    showLog(out, "✘ " + e.message, true);
  } finally {
    KS_BUSY = false;
  }
}

$("#btn-ks-load").addEventListener("click", loadKasSewa);
$("#btn-ks-simpan").addEventListener("click", ksSimpan);
$("#ks-batal-box").addEventListener("click", (ev) => {
  const b = ev.target.closest("#btn-ks-batal");
  if (b) ksBatal(b);
});
$("#ks-nominal").addEventListener("input", (ev) => {
  const d = ev.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  ev.target.value = d ? Number(d).toLocaleString("id-ID") : "";
  ksPreview();
});
$("#ks-outlet").addEventListener("change", ksPreview);
$$('input[name="ks-jenis"]').forEach((r) => r.addEventListener("change", ksPreview));
$("#ks-tanggal").addEventListener("change", ksRenderCepat);
$("#ks-cepat").addEventListener("click", (ev) => {
  const c = ev.target.closest(".ks-chip");
  if (!c) return;
  $("#ks-ket").value = c.dataset.ket;
  const r = document.querySelector(`input[name="ks-jenis"][value="${c.dataset.jenis}"]`);
  if (r) r.checked = true;
  ksPreview();
  $("#ks-nominal").focus();
});
["#ks-bulan", "#ks-fjenis"].forEach((s) => $(s).addEventListener("change", ksRenderRiwayat));
$("#ks-cari").addEventListener("input", ksRenderRiwayat);

// ================= Gaji & Kasbon › Gaji Bulan Ini =================
// Sheet GAJI BULAN INI + KONTROL KAS (CASHFLOW bulan berjalan), hanya baca.
let GJ = null;
const GJ_PENDAPATAN = [
  ["gajiPokok", "Gaji pokok"], ["lembur", "Lembur"], ["uangMakan", "Uang makan"], ["thr", "THR"], ["bonus", "Bonus"],
  ["bonusReferal", "Bonus referal"], ["tunjanganLain", "Tunjangan lain"],
];
const GJ_POTONGAN = [
  ["potLembur", "Potongan lembur"], ["potKetidakhadiran", "Potongan ketidakhadiran"], ["potKasbon", "Potongan kasbon"],
  ["potKerugian", "Potongan kerugian"], ["potLain", "Potongan lain-lain"],
];

function gjRp(n) {
  const v = Math.round(Number(n) || 0);
  return (v < 0 ? "−" : "") + "Rp" + Math.abs(v).toLocaleString("id-ID");
}

async function loadGaji() {
  $("#btn-gj-load").disabled = true;
  if (!GJ) $("#gj-ringkas").innerHTML = '<p class="hint">Memuat sheet GAJI BULAN INI…</p>';
  try {
    GJ = await api("/api/gaji");
    gjRender();
  } catch (e) {
    $("#gj-ringkas").innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`;
  } finally {
    $("#btn-gj-load").disabled = false;
  }
}

function gjRender() {
  const d = GJ;
  if (!d) return;
  $("#gj-open").href = d.spreadsheet.url;
  $("#gj-open").classList.remove("hidden");
  $("#gj-meta").textContent = `${d.spreadsheet.title} · dimuat ${d.dimuat}` + (d.updateHarian ? ` · saldo kas dari update harian ${d.updateHarian}` : "");
  const r = d.ringkas;
  const kurang = d.status.filter((s) => !s.cukup);
  $("#gj-ringkas").innerHTML = `
    <div class="ks-kartu ks-utama"><div class="ks-label">Total gaji dibayar (THP)</div>
      <div class="ks-angka">${gjRp(r.totalThp)}</div><div class="ks-sub">${r.dibayar} dari ${r.jumlahPegawai} pegawai</div></div>
    <div class="ks-kartu"><div class="ks-label">Total pendapatan</div><div class="ks-angka">${gjRp(r.totalPendapatan)}</div></div>
    <div class="ks-kartu"><div class="ks-label">Total potongan</div><div class="ks-angka neg">${gjRp(-r.totalPotongan)}</div></div>
    <div class="ks-kartu"><div class="ks-label">Status saldo kas</div>${
      kurang.length
        ? `<div class="ks-angka neg kecil">Kurang di ${kurang.length} rekening</div><div class="ks-sub">${escapeHtml(kurang.map((s) => s.nama).join(", "))}</div>`
        : '<div class="ks-angka pos kecil">Semua cukup ✓</div><div class="ks-sub">saldo cukup untuk semua gaji</div>'
    }</div>`;

  // Tabel status saldo kas
  const baris = d.status
    .map((s) => {
      const sub = s.rincian
        ? s.rincian.map((x) => `${escapeHtml(x.nama)}: ${gjRp(x.saldo)}`).join(" · ")
        : s.pegawai.length
          ? "Gaji: " + escapeHtml(s.pegawai.join(", "))
          : "tidak ada gaji lewat rekening ini";
      return `<tr class="${s.cukup ? "" : "gj-kurang"}">
        <td class="gj-rek"><b>${escapeHtml(s.nama)}</b><div class="gj-kecil">${sub}${s.rincian && s.pegawai.length ? "<br>Gaji tunai: " + escapeHtml(s.pegawai.join(", ")) : ""}</div></td>
        <td class="num" data-label="Saldo terkini">${gjRp(s.saldo)}</td>
        <td class="num" data-label="Saldo minimum">${s.saldoMinimum ? gjRp(-s.saldoMinimum) : "–"}</td>
        <td class="num" data-label="Return investasi">${s.returnInvestasi ? gjRp(-s.returnInvestasi) : "–"}</td>
        <td class="num" data-label="Kebutuhan gaji">${s.kebutuhan ? gjRp(-s.kebutuhan) : "–"}</td>
        <td class="num gj-sisa ${s.sisa < 0 ? "neg" : "pos"}" data-label="Sisa setelah gaji">${gjRp(s.sisa)}</td>
        <td data-label="Status">${s.cukup ? '<span class="gj-chip ok">Cukup</span>' : `<span class="gj-chip kurang">Kurang ${gjRp(-s.sisa)}</span>`}</td>
      </tr>`;
    })
    .join("");
  const t = d.total;
  $("#gj-status").innerHTML = `<table id="gj-grid-status"><thead><tr>
      <th>Rekening / kas</th><th class="num">Saldo terkini</th><th class="num">Saldo minimum</th><th class="num">Return investasi</th>
      <th class="num">Kebutuhan gaji</th><th class="num">Sisa setelah gaji</th><th>Status</th></tr></thead>
    <tbody>${baris}</tbody>
    <tfoot><tr><td class="gj-rek"><b>TOTAL</b></td><td class="num" data-label="Saldo terkini">${gjRp(t.saldo)}</td>
      <td class="num" data-label="Saldo minimum">${gjRp(-t.saldoMinimum)}</td>
      <td class="num" data-label="Return investasi">${t.returnInvestasi ? gjRp(-t.returnInvestasi) : "–"}</td>
      <td class="num" data-label="Kebutuhan gaji">${gjRp(-t.kebutuhan)}</td>
      <td class="num gj-sisa ${t.sisa < 0 ? "neg" : "pos"}" data-label="Sisa setelah gaji">${gjRp(t.sisa)}</td><td class="gj-kosong"></td></tr></tfoot></table>`;
  $("#gj-catatan").innerHTML = (d.catatan || []).map((c) => `<div class="th-notice th-err">⚠️ <div>${escapeHtml(c)}</div></div>`).join("");

  // Kartu per pegawai: yang dibayar dulu, lalu yang tidak ada gaji bulan ini.
  const urut = d.pegawai.filter((p) => p.aktif).concat(d.pegawai.filter((p) => !p.aktif));
  const daftar = (list, p) =>
    list
      .map(([k, label]) => {
        const v = p[k] || 0;
        const extra = k === "lembur" && p.jamLembur ? ` <span class="gj-kecil">(${Number(p.jamLembur).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jam)</span>` : "";
        return `<div class="gj-baris${v ? "" : " nol"}"><span>${label}${extra}</span><span>${v ? gjRp(v) : "–"}</span></div>`;
      })
      .join("");
  $("#gj-pegawai").innerHTML = urut
    .map(
      (p) => `<div class="gj-kartu${p.aktif ? "" : " nonaktif"}">
        <div class="gj-kepala">
          <div class="gj-id"><div class="gj-nama">${escapeHtml(p.nama)}</div>
            <div class="gj-bank">${escapeHtml(p.bank || "-")}${p.rekening ? ` · <span class="gj-norek">${escapeHtml(p.rekening)}</span>
              <button type="button" class="gj-salin" data-salin="${escapeHtml(p.rekening)}" title="Salin nomor rekening">Salin</button>` : ""}</div></div>
          <div class="gj-thp"><div class="ks-label">THP</div><div class="gj-thp-angka">${gjRp(p.thp)}</div></div>
        </div>
        ${
          p.aktif
            ? `<div class="gj-rinci">
                <div><div class="gj-sub">Pendapatan</div>${daftar(GJ_PENDAPATAN, p)}
                  <div class="gj-baris tot"><span>Total</span><span>${gjRp(p.totalPendapatan)}</span></div></div>
                <div><div class="gj-sub">Potongan</div>${daftar(GJ_POTONGAN, p)}
                  <div class="gj-baris tot"><span>Total</span><span>${p.totalPotongan ? gjRp(-p.totalPotongan) : "–"}</span></div></div>
              </div>`
            : '<div class="gj-kecil" style="margin-top:8px">Tidak ada gaji bulan ini.</div>'
        }
        <div class="gj-kaki">Sisa kasbon: <b>${gjRp(p.sisaKasbon || 0)}</b></div>
      </div>`
    )
    .join("");
}

$("#btn-gj-load").addEventListener("click", loadGaji);

// Sub menu Gaji & Kasbon
function gkBukaSub() {
  const aktif = $("#tab-gajikasbon .subtab.active");
  if (aktif && aktif.dataset.sub === "gajibulanini") loadGaji();
  if (aktif && aktif.dataset.sub === "kasbon") loadKasbon();
}
$$("#tab-gajikasbon .subtab").forEach((b) =>
  b.addEventListener("click", () => {
    $$("#tab-gajikasbon .subtab").forEach((x) => x.classList.toggle("active", x === b));
    $$("#tab-gajikasbon .subpanel").forEach((p) => p.classList.toggle("active", p.id === "sub-" + b.dataset.sub));
    gkBukaSub();
  })
);
$("#gj-pegawai").addEventListener("click", async (ev) => {
  const b = ev.target.closest(".gj-salin");
  if (!b) return;
  try {
    await copyTextToClipboard(b.dataset.salin);
    b.textContent = "Tersalin ✓";
    setTimeout(() => (b.textContent = "Salin"), 1500);
  } catch {
    b.textContent = "Gagal";
  }
});

// ================= Gaji & Kasbon › Kasbon =================
// Sheet KASBON (CASHFLOW bulan berjalan). Cicilan = rumus POTONGAN KASBON di GAJI BULAN DEPAN;
// sheet KASBON tidak diubah sehingga kolom SISA (H) tetap benar.
let KB = null;
let KB_BUKA = null; // baris KASBON yang form cicilannya terbuka
let KB_BUSY = false;

function kbRp(n) {
  const v = Math.round(Number(n) || 0);
  return (v < 0 ? "−" : "") + "Rp" + Math.abs(v).toLocaleString("id-ID");
}
const kbNol = (n) => (Number(n) ? kbRp(n) : "–");

async function loadKasbon() {
  if (KB_BUSY) return;
  $("#btn-kb-load").disabled = true;
  if (!KB) $("#kb-ringkas").innerHTML = '<p class="hint">Memuat sheet KASBON…</p>';
  try {
    KB = await api("/api/kasbon");
    kbRender();
  } catch (e) {
    $("#kb-ringkas").innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`;
  } finally {
    $("#btn-kb-load").disabled = false;
  }
}

function kbPotongInfo(b) {
  const g = b.gbd;
  if (!g) return '<span class="kb-tag abu">tidak terhubung ke GAJI BULAN DEPAN</span>';
  if (g.galat) return `<span class="kb-tag merah">galat ${escapeHtml(g.galat)}</span>`;
  if (g.mode === "cicil") return `<span class="kb-tag emas">dicicil maks. ${kbRp(g.cicilan)}/bln</span>`;
  if (g.mode === "manual") return `<span class="kb-tag emas" title="${escapeHtml(g.rumus)}">manual: ditunda ${kbRp(g.ditunda)}</span>`;
  if (g.mode === "khusus") return `<span class="kb-tag emas" title="${escapeHtml(g.rumus)}">rumus khusus</span>`;
  return b.rencanaDepan ? '<span class="kb-tag hijau">potong penuh</span>' : "";
}

function kbRender() {
  const d = KB;
  if (!d) return;
  $("#kb-open").href = d.spreadsheet.url;
  $("#kb-open").classList.remove("hidden");
  $("#kb-meta").textContent = `${d.spreadsheet.title} · dimuat ${d.dimuat}`;
  const r = d.ringkas;
  $("#kb-ringkas").innerHTML = `
    <div class="ks-kartu ks-utama"><div class="ks-label">Total kasbon belum lunas</div>
      <div class="ks-angka">${kbRp(r.totalKasbon)}</div><div class="ks-sub">${r.jumlahBerkasbon} pegawai</div></div>
    <div class="ks-kartu"><div class="ks-label">Kasbon baru bulan ini</div><div class="ks-angka">${kbRp(r.baru)}</div></div>
    <div class="ks-kartu"><div class="ks-label">Dibayar bulan ini</div><div class="ks-angka pos">${kbRp(r.dibayar)}</div></div>
    <div class="ks-kartu"><div class="ks-label">Dipotong dari gaji bulan depan</div><div class="ks-angka">${kbRp(r.dipotongDepan)}</div>
      <div class="ks-sub">${r.cicilan ? `${r.cicilan} pegawai dicicil` : "semua potong penuh"}</div></div>`;
  $("#kb-catatan").innerHTML = (d.catatan || []).map((c) => `<div class="th-notice th-err">⚠️ <div>${escapeHtml(c)}</div></div>`).join("");

  const tampil = d.baris.filter((b) => b.adaKasbon || b.peringatan || (b.gbd && b.gbd.mode !== "penuh"));
  const tanpa = d.baris.filter((b) => !tampil.includes(b));
  $("#kb-tanpa").textContent = tanpa.length ? `Tanpa kasbon: ${tanpa.map((b) => b.nama).join(", ")}.` : "";
  if (!tampil.length) {
    $("#kb-table").innerHTML = '<p class="hint" style="padding:12px;margin:0">Tidak ada kasbon bulan ini.</p>';
    return;
  }
  const rows = tampil
    .map((b) => {
      const g = b.gbd;
      const form =
        KB_BUKA === b.baris && g
          ? `<tr class="kb-form-row" data-baris="${b.baris}"><td colspan="9">${kbFormHtml(b)}</td></tr>`
          : "";
      const v = (x) => `<span class="kb-v">${x}</span>`;
      const tombol = g && !g.galat && (b.rencanaDepan || g.mode !== "penuh")
        ? `<div><button type="button" class="btn-ghost kb-atur" data-baris="${b.baris}">${KB_BUKA === b.baris ? "Tutup" : "Atur cicilan"}</button></div>`
        : "";
      return `<tr data-baris="${b.baris}" class="${b.peringatan ? "kb-cek" : ""}">
        <td class="kb-nama"><b>${escapeHtml(b.nama)}</b>${g && g.pegawai ? `<div class="gj-kecil">${escapeHtml(g.pegawai)}</div>` : ""}${
          b.peringatan ? `<div class="kb-warn">⚠️ ${escapeHtml(b.peringatan)}</div>` : ""
        }</td>
        <td class="num" data-label="Sisa bulan lalu (D)">${v(kbNol(b.sisaLalu))}</td>
        <td class="num" data-label="Rencana potong bulan ini (E)">${v(b.rencanaKosong ? '<span class="gj-kecil">kosong</span>' : kbNol(b.rencana))}</td>
        <td class="num" data-label="Dibayar (F)">${v(kbNol(b.dibayar) + (b.dibayar && b.tanggalBayar ? `<div class="gj-kecil">${escapeHtml(b.tanggalBayar)}</div>` : ""))}</td>
        <td class="num" data-label="Sisa (H)">${v(`<b>${kbNol(b.sisa)}</b>`)}</td>
        <td class="num" data-label="Kasbon baru bulan ini (B)">${v(kbNol(b.baru))}</td>
        <td class="num" data-label="Rencana potong bulan depan (C)">${v(`<b>${kbNol(b.rencanaDepan)}</b>`)}</td>
        <td class="num" data-label="Dipotong dari gaji bulan depan">${v((b.dipotongDepan != null ? kbNol(b.dipotongDepan) : "–") + `<div>${kbPotongInfo(b)}</div>` + tombol)}</td>
        <td class="num" data-label="Sisa dibawa ke bulan berikutnya">${v(b.sisaSetelahDepan != null ? kbNol(b.sisaSetelahDepan) : "–")}</td>
      </tr>${form}`;
    })
    .join("");
  const t = (k) => tampil.reduce((a, b) => a + (Number(b[k]) || 0), 0);
  $("#kb-table").innerHTML = `<table id="kb-grid"><thead><tr>
      <th>Pegawai</th><th class="num">Sisa bulan lalu<br><small>D</small></th><th class="num">Rencana potong bulan ini<br><small>E</small></th>
      <th class="num">Dibayar<br><small>F</small></th><th class="num">Sisa<br><small>H = E − F</small></th>
      <th class="num">Kasbon baru<br><small>B</small></th><th class="num">Rencana potong bulan depan<br><small>C = B + H</small></th>
      <th class="num">Dipotong dari gaji bulan depan<br><small>GAJI BULAN DEPAN</small></th><th class="num">Sisa dibawa<br><small>C − potongan</small></th>
    </tr></thead><tbody>${rows}</tbody>
    <tfoot><tr><td class="kb-nama"><b>TOTAL</b></td><td class="num" data-label="Sisa bulan lalu (D)">${kbNol(t("sisaLalu"))}</td>
      <td class="num" data-label="Rencana potong bulan ini (E)">${kbNol(t("rencana"))}</td><td class="num" data-label="Dibayar (F)">${kbNol(t("dibayar"))}</td>
      <td class="num" data-label="Sisa (H)">${kbNol(t("sisa"))}</td><td class="num" data-label="Kasbon baru bulan ini (B)">${kbNol(t("baru"))}</td>
      <td class="num" data-label="Rencana potong bulan depan (C)">${kbNol(t("rencanaDepan"))}</td>
      <td class="num" data-label="Dipotong dari gaji bulan depan">${kbNol(t("dipotongDepan"))}</td>
      <td class="num" data-label="Sisa dibawa ke bulan berikutnya">${kbNol(t("sisaSetelahDepan"))}</td></tr></tfoot></table>`;
  if (KB_BUKA != null) kbPratinjau();
}

function kbFormHtml(b) {
  const g = b.gbd;
  const cicil = g.mode === "cicil";
  return `<div class="kb-form">
    <div class="kb-form-judul">Potongan kasbon <b>${escapeHtml(b.nama)}</b> dari gaji bulan depan (${escapeHtml(g.pegawai)})</div>
    <label class="kb-opsi"><input type="radio" name="kb-mode" value="penuh"${cicil ? "" : " checked"} />
      Potong penuh <span class="gj-kecil">(${kbRp(b.rencanaDepan)} — seluruh rencana potong bulan depan)</span></label>
    <label class="kb-opsi"><input type="radio" name="kb-mode" value="cicil"${cicil ? " checked" : ""} /> Dicicil, maks.
      <input type="text" id="kb-cicilan" inputmode="numeric" autocomplete="off" placeholder="mis. 500.000" value="${cicil ? Number(g.cicilan).toLocaleString("id-ID") : ""}" /> per bulan</label>
    ${g.mode === "manual" || g.mode === "khusus" ? `<div class="gj-kecil">Rumus sekarang: <code>${escapeHtml(g.rumus)}</code> — akan diganti.</div>` : ""}
    <div id="kb-pratinjau" class="kb-pratinjau"></div>
    <div class="upload-row" style="margin:6px 0 0">
      <button type="button" class="btn-primary" id="btn-kb-simpan" data-baris="${b.baris}">Simpan</button>
      <button type="button" class="btn-ghost" id="btn-kb-batal">Batal</button>
    </div>
  </div>`;
}

function kbCicilanInput() {
  const el = $("#kb-cicilan");
  const dgt = el ? String(el.value || "").replace(/\D/g, "") : "";
  return dgt ? Number(dgt) : 0;
}

function kbPratinjau() {
  const b = KB && KB.baris.find((x) => x.baris === KB_BUKA);
  const el = $("#kb-pratinjau");
  if (!b || !el) return;
  const mode = (document.querySelector('input[name="kb-mode"]:checked') || {}).value;
  const c = b.rencanaDepan;
  let potong = c;
  if (mode === "cicil") {
    const x = kbCicilanInput();
    if (!x) { el.innerHTML = "Isi nominal cicilan per bulan."; return; }
    potong = Math.min(c, x);
  }
  el.innerHTML = `Bulan depan dipotong <b>${kbRp(potong)}</b> dari gaji; sisa <b>${kbRp(c - potong)}</b> tetap tercatat di KASBON dan dibawa ke bulan berikutnya.` +
    (mode === "cicil" ? ` <span class="gj-kecil">Cicilan berlaku terus setiap bulan sampai diubah kembali ke potong penuh.</span>` : "");
}

async function kbSimpan(baris) {
  const b = KB && KB.baris.find((x) => x.baris === baris);
  if (!b || KB_BUSY) return;
  const out = $("#kb-result");
  const mode = (document.querySelector('input[name="kb-mode"]:checked') || {}).value;
  const cicilan = kbCicilanInput();
  if (mode === "cicil" && !cicilan) return showLog(out, "✘ Isi nominal cicilan per bulan, mis. 500.000", true);
  const btn = $("#btn-kb-simpan");
  btn.disabled = true;
  btn.textContent = "Menyimpan…";
  KB_BUSY = true;
  try {
    const res = await fetch("/api/kasbon/cicilan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baris, subjek: b.subjek, mode, cicilan, token: KB.spreadsheet.id }),
    });
    if (res.status === 401) { window.location = "/login"; return; }
    const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
    if (!res.ok || !data.ok) {
      if (data.data) { KB = Object.assign({}, KB, data.data); kbRender(); }
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    KB = data.data;
    KB_BUKA = null;
    kbRender();
    const s = data.disimpan;
    showLog(
      out,
      `✔ ${s.nama}: ${s.mode === "cicil" ? `dicicil maks. ${kbRp(s.cicilan)} per bulan` : "potong penuh"}. ` +
        `Bulan depan dipotong ${kbRp(s.dipotongDepan)}, sisa ${kbRp(s.sisaSetelahDepan)} dibawa ke bulan berikutnya.\n` +
        `Diubah: ${s.sel} ${s.rumusLama} → ${s.rumusBaru}. Sheet KASBON tidak diubah.`
    );
  } catch (e) {
    showLog(out, "✘ " + e.message, true);
    if (document.body.contains(btn)) { btn.disabled = false; btn.textContent = "Simpan"; }
  } finally {
    KB_BUSY = false;
  }
}

$("#btn-kb-load").addEventListener("click", () => { KB_BUKA = null; loadKasbon(); });
$("#kb-table").addEventListener("click", (ev) => {
  const atur = ev.target.closest(".kb-atur");
  if (atur) {
    const n = Number(atur.dataset.baris);
    KB_BUKA = KB_BUKA === n ? null : n;
    kbRender();
    const inp = $("#kb-cicilan");
    if (inp && KB_BUKA != null) inp.closest(".kb-form").scrollIntoView({ block: "nearest" });
    return;
  }
  if (ev.target.closest("#btn-kb-batal")) { KB_BUKA = null; kbRender(); return; }
  const simpan = ev.target.closest("#btn-kb-simpan");
  if (simpan) kbSimpan(Number(simpan.dataset.baris));
});
$("#kb-table").addEventListener("input", (ev) => {
  if (ev.target.id === "kb-cicilan") {
    const dgt = ev.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
    ev.target.value = dgt ? Number(dgt).toLocaleString("id-ID") : "";
    const r = document.querySelector('input[name="kb-mode"][value="cicil"]');
    if (r && dgt) r.checked = true;
  }
  kbPratinjau();
});
$("#kb-table").addEventListener("change", kbPratinjau);

// ================= Init =================
{
  const st = $("#setoran-tanggal");
  if (st && !st.value) st.value = new Date().toISOString().slice(0, 10); // default hari ini
}
initDropzone($("#dz-biaya"), $("#biaya-files"), $("#dz-biaya-count"));
initDropzone($("#dz-qris"), $("#qris-files"), $("#dz-qris-count"));
initDropzone($("#dz-qbank"), $("#qbank-files"), $("#dz-qbank-count"));
loadStatus();
loadDashboard();
// Muat daftar Monitoring Biaya & Lapor Smartlink di latar agar tanda notifikasi
// merah pada judul tab langsung tampil tanpa harus membuka tabnya dulu.
loadMonBiaya();
loadSmart();
kfPoll(); // status Konfirmasi Biaya Smartlink (tanda 🤖 di tab bila sedang berjalan)

// Daftarkan service worker agar dashboard bisa di-install lewat Chrome (PWA).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
