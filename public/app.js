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
      const cls = !isHeader && numericCols.includes(j) ? ' class="num"' : "";
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
      renderSheetTable($("#table-pendapatan"), data.pendapatan, { colCount: 3, numericCols: [1, 2], dateCol: -1 });
      renderSheetTable($("#table-kontrol"), data.kontrolKas, { colCount: 2, numericCols: [1], dateCol: -1 });
    }
  } catch (e) {
    $("#table-kas").innerHTML = `<p class="error">${e.message}</p>`;
  }
}

$("#btn-refresh").addEventListener("click", loadDashboard);

$("#btn-sync").addEventListener("click", async () => {
  const btn = $("#btn-sync");
  const out = $("#sync-result");
  btn.disabled = true;
  btn.textContent = "⏳ Menjalankan…";
  try {
    const r = await api("/api/sync", { method: "POST" });
    showLog(out, ["✔ UPDATE HARIAN SELESAI — " + r.tanggal, ...r.steps.map((s) => "  • " + s)].join("\n"));
    await loadDashboard();
  } catch (e) {
    showLog(out, "✘ GAGAL: " + e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "▶ Jalankan Update Harian";
  }
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
function closeImageModal() {
  const modal = $("#img-modal");
  const img = $("#img-modal-img");
  modal.classList.add("hidden");
  if (img.dataset.url) {
    URL.revokeObjectURL(img.dataset.url);
    img.removeAttribute("src");
    delete img.dataset.url;
  }
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
  if (!OPTIONS) OPTIONS = await api("/api/biaya/options");
  return OPTIONS;
}

function biayaRowHtml(entry) {
  const o = OPTIONS;
  const ketOpts = o.daftarBiaya
    .map((d) => `<option value="${d.keterangan}"${d.keterangan === entry.keterangan ? " selected" : ""}>${d.keterangan}</option>`)
    .join("");
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
    <td><select class="f-keterangan"><option value="">— pilih —</option>${ketOpts}</select></td>
    <td><input type="number" class="f-nominal" value="${entry.nominal ?? ""}" min="1"></td>
    <td><input type="date" class="f-tanggal" value="${entry.tanggal || ""}"></td>
    <td><select class="f-outlet">${outletOpts}</select></td>
    <td><select class="f-status">${statusOpts}</select></td>
    <td><select class="f-sumber">${sdOpts}</select></td>
    <td><small>otomatis</small></td>
    <td><small>${sumber}${badge}${escapeHtml(entry.catatan || "")}</small></td>
    <td><button class="btn-mini" title="Hapus baris">✕</button></td>`;
}

function addBiayaRow(entry) {
  const tbody = $("#biaya-table tbody");
  const tr = document.createElement("tr");
  tr.innerHTML = biayaRowHtml(entry);
  tr.querySelector(".btn-mini").addEventListener("click", () => tr.remove());
  tr.querySelector(".f-keterangan").addEventListener("change", (ev) => {
    const found = OPTIONS.daftarBiaya.find((d) => d.keterangan === ev.target.value);
    tr.querySelector(".subjek").textContent = found ? found.subjek : "";
    // Rekomendasi outlet otomatis (hanya bila outlet masih kosong); aturan dari server.
    const outletSel = tr.querySelector(".f-outlet");
    const rec = (OPTIONS.outletRecommendations || {})[ev.target.value.trim().toLowerCase()];
    if (rec && !outletSel.value) outletSel.value = rec;
  });
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

// ================= Input Kas =================
function initKasCard(card) {
  const jenis = card.dataset.jenis;
  const body = document.createElement("div");
  body.innerHTML = `
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
      preview.classList.add("hidden");
      clearFileInput(fileInput);
      loadDashboard();
    } catch (e) {
      showLog(resultEl, "✘ " + e.message, true);
    }
  });
}

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
const MB_SUBJEK_COL = 1; // SUBJEK BIAYA
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
          if (col === MB_SUBJEK_COL) {
            const yellow = c.trim().toLowerCase() === "setoran owner" ? " mb-subjek-yellow" : "";
            return `<td class="mb-subjek${yellow}">${escapeHtml(c)}</td>`;
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
            return `<td>${escapeHtml(c)} <button class="mb-copy" data-kode="${escapeHtml(c)}" title="Salin kode">⧉ Salin</button></td>`;
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

async function loadMonBiaya() {
  const el = $("#monbiaya-table");
  el.innerHTML = "Memuat…";
  try {
    MONBIAYA = await api("/api/monbiaya/list");
    MONBIAYA_LOADED = true;
    renderMonBiaya();
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

async function mbCopy(btn) {
  const text = btn.dataset.kode || "";
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    const old = btn.textContent;
    btn.textContent = "✓ Tersalin";
    setTimeout(() => (btn.textContent = old), 1200);
  } catch {
    showLog($("#monbiaya-result"), "✘ Gagal menyalin kode.", true);
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
  else if (t.classList.contains("mb-copy")) mbCopy(t);
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

$("#btn-monbiaya-refresh").addEventListener("click", loadMonBiaya);

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
$("#btn-monbiaya-export-so").addEventListener("click", (e) => mbExport("/api/monbiaya/export-setoran", e.currentTarget));

// ================= Init =================
initDropzone($("#dz-biaya"), $("#biaya-files"), $("#dz-biaya-count"));
initDropzone($("#dz-qris"), $("#qris-files"), $("#dz-qris-count"));
initDropzone($("#dz-qbank"), $("#qbank-files"), $("#dz-qbank-count"));
loadStatus();
loadDashboard();
