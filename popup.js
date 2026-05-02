/**
* xclip - Popup Logic
 */

(() => {
  "use strict";

  // ---- Helpers ---------------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function send(action, payload = {}) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action, ...payload }, (resp) =>
        resolve(resp || { success: false })
      );
    });
  }

  function fmtTime(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    const now = Date.now();
    const diff = (now - ts) / 1000;
    if (diff < 60) return "az önce";
    if (diff < 3600) return Math.floor(diff / 60) + " dk önce";
    if (diff < 86400) return Math.floor(diff / 3600) + " sa önce";
    return d.toLocaleDateString("tr-TR");
  }

  function escapeHtml(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // ---- Tab switching ---------------------------------------------------
  function setupTabs() {
    $$(".tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        const target = tab.getAttribute("data-tab");
        $$(".tab").forEach((t) => t.classList.toggle("active", t === tab));
        $$(".tab-panel").forEach((p) =>
          p.classList.toggle("active", p.getAttribute("data-panel") === target)
        );
      });
    });
  }

  // ---- Version from manifest -------------------------------------------
  function setupVersion() {
    try {
      const manifest = chrome.runtime.getManifest();
      $("#version").textContent = "v" + manifest.version;
    } catch (_) {}
  }

  // ---- History ---------------------------------------------------------
  async function renderHistory() {
    const resp = await send("getHistory");
    const list = $("#history-list");
    const history = resp?.history || [];

    list.innerHTML = "";

    if (history.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📥</div>
          <p>Henüz indirme yok</p>
          <small>Twitter/X'te bir video gördüğünde, kalp/yorum butonlarının yanındaki <strong>↓</strong> ikonuna tıkla.</small>
        </div>`;
      return;
    }

    for (const item of history) {
      const tweetUrl =
        item.screenName && item.tweetId
          ? `https://x.com/${encodeURIComponent(item.screenName)}/status/${encodeURIComponent(item.tweetId)}`
          : null;

      const node = document.createElement("div");
      node.className = "history-item";
      node.innerHTML = `
        <div class="history-thumb">
          ${
            item.thumbnailUrl
              ? `<img src="${escapeHtml(item.thumbnailUrl)}" alt="" loading="lazy" />`
              : (item.mediaType === "gif" ? "🎞️" : "🎬")
          }
        </div>
        <div class="history-meta">
          <span class="title">${escapeHtml(item.filename || "video.mp4")}</span>
          <span class="sub">
            ${item.screenName ? "@" + escapeHtml(item.screenName) + " · " : ""}${fmtTime(item.startedAt)}
          </span>
        </div>
        <div class="history-actions">
          ${
            tweetUrl
              ? `<button class="icon-btn open-tweet" title="Tweet'i aç" data-url="${escapeHtml(tweetUrl)}">
                  <svg viewBox="0 0 24 24"><path d="M14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7zM19 19H5V5h7V3H5c-1.11 0-2 .89-2 2v14c0 1.11.89 2 2 2h14c1.11 0 2-.89 2-2v-7h-2v7z"/></svg>
                </button>`
              : ""
          }
          <button class="icon-btn show-download" title="İndirileni göster" data-id="${item.downloadId || ""}">
            <svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
          </button>
        </div>`;
      list.appendChild(node);
    }

    // Action handlers
    $$(".open-tweet", list).forEach((b) =>
      b.addEventListener("click", () => {
        const url = b.getAttribute("data-url");
        if (url) chrome.tabs.create({ url });
      })
    );
    $$(".show-download", list).forEach((b) =>
      b.addEventListener("click", () => {
        const id = parseInt(b.getAttribute("data-id"), 10);
        if (id && chrome.downloads && chrome.downloads.show) {
          chrome.downloads.show(id);
        }
      })
    );
  }

  function setupHistory() {
    $("#clear-history").addEventListener("click", async () => {
      if (!confirm("Geçmiş silinsin mi?")) return;
      await send("clearHistory");
      renderHistory();
    });
    renderHistory();
  }

  // ---- Settings --------------------------------------------------------
  async function loadSettings() {
    const resp = await send("getSettings");
    const s = resp.settings || {};
    $("#setting-notifications").checked = !!s.showNotifications;
    $("#setting-template").value =
      s.filenameTemplate || "{screenName}_{tweetText}_{tweetId}.mp4";
  }

  function setupSettings() {
    $("#save-settings").addEventListener("click", async () => {
      const settings = {
        showNotifications: $("#setting-notifications").checked,
        filenameTemplate:
          $("#setting-template").value.trim() ||
          "{screenName}_{tweetText}_{tweetId}.mp4",
      };
      await send("updateSettings", { settings });
      const fb = $("#save-feedback");
      fb.textContent = "Kaydedildi ✓";
      fb.classList.add("show");
      setTimeout(() => fb.classList.remove("show"), 1500);
    });

    loadSettings();
  }

  // ---- Init ------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    setupVersion();
    setupTabs();
    setupHistory();
    setupSettings();
  });
})();
