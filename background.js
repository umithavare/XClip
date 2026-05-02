/**
 * xclip - Background Service Worker
 *
 * - Content script'ten gelen indirme isteklerini chrome.downloads API ile yürütür
 * - Son indirmeleri chrome.storage.local'da tutar (popup tarafından gösteriliyor)
 * - Hata durumlarında bildirim gösterir
 */

const STORAGE_KEY_HISTORY = "xclip_download_history";
const STORAGE_KEY_SETTINGS = "xclip_settings";
const HISTORY_LIMIT = 50;

const DEFAULT_SETTINGS = {
  showNotifications: true,
  filenameTemplate: "{screenName}_{tweetText}_{tweetId}.mp4",
};

// Geriye dönük uyumluluk: önceki sürümlerin default template'leri ve
// storage key'leri. onInstalled'da bunları yeni hâle migrate ediyoruz.
const LEGACY_DEFAULT_TEMPLATES = [
  "x_{screenName}_{tweetId}.mp4",
  "x_{screenName}_{tweetText}_{tweetId}.mp4",
];
const LEGACY_STORAGE_KEYS = {
  history: "xvd_download_history",
  settings: "xvd_settings",
};

// ---- Utilities ----------------------------------------------------------

function sanitizeFilenamePart(s) {
  if (!s) return "";
  return String(s)
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

/**
 * Tweet metnini dosya adı için temizler:
 *  - URL'leri çıkarır (t.co shortener garbage)
 *  - Mention/hashtag'ları korur ama sembol haline temizler
 *  - Newline ve fazla boşlukları tek boşluğa indirir
 *  - Forbidden chars'ı atar
 *  - Maksimum N karaktere kırpar
 *  - Sonu boşluk/işaretle bitiyorsa trim
 */
function sanitizeTweetText(text, maxLen = 60) {
  if (!text || typeof text !== "string") return "";
  let s = text;
  // URL'leri çıkar (t.co dahil tüm http/https linkleri)
  s = s.replace(/https?:\/\/\S+/gi, "");
  // HTML entity'leri (genelde olmuyor ama olur ya)
  s = s.replace(/&amp;/g, "&").replace(/&lt;/g, "").replace(/&gt;/g, "");
  // Newline → boşluk
  s = s.replace(/[\r\n\t]+/g, " ");
  // Forbidden filesystem chars
  s = s.replace(/[\\/:*?"<>|]/g, "");
  // Birden fazla boşluk → tek boşluk
  s = s.replace(/\s+/g, " ").trim();
  // Sonra _ ile değiştir
  s = s.replace(/\s/g, "_");
  // Çoklu underscore'ları sıkıştır
  s = s.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  // Maksimum uzunluk
  if (s.length > maxLen) s = s.slice(0, maxLen).replace(/_+$/, "");
  return s;
}

function buildFilename(template, ctx) {
  const screenName = sanitizeFilenamePart(ctx.screenName) || "user";
  const tweetId = sanitizeFilenamePart(ctx.tweetId) || "unknown";
  const tweetText = sanitizeTweetText(ctx.tweetText); // boş olabilir
  const ext = ctx.mediaType === "gif" ? "mp4" : "mp4"; // GIF de mp4 olarak servis

  let name = template
    .replace(/\{screenName\}/g, screenName)
    .replace(/\{tweetText\}/g, tweetText)
    .replace(/\{tweetId\}/g, tweetId)
    .replace(/\{ext\}/g, ext);

  // tweetText boşsa ortaya çıkan ardışık underscore'ları sıkıştır:
  //   "x_user__123.mp4" → "x_user_123.mp4"
  // Uzantıdan önceki kısmı al, _ collapse et, sonra uzantıyı geri yapıştır
  const dot = name.lastIndexOf(".");
  if (dot > 0) {
    const base = name.slice(0, dot).replace(/_+/g, "_").replace(/^_+|_+$/g, "");
    const extPart = name.slice(dot);
    name = base + extPart;
  } else {
    name = name.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
    name += "." + ext;
  }

  if (!/\.[a-z0-9]{2,4}$/i.test(name)) name += "." + ext;
  return name;
}

async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY_SETTINGS], (result) => {
      resolve({ ...DEFAULT_SETTINGS, ...(result[STORAGE_KEY_SETTINGS] || {}) });
    });
  });
}

async function pushHistory(entry) {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY_HISTORY], (result) => {
      const history = Array.isArray(result[STORAGE_KEY_HISTORY])
        ? result[STORAGE_KEY_HISTORY]
        : [];
      history.unshift(entry);
      if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT;
      chrome.storage.local.set({ [STORAGE_KEY_HISTORY]: history }, resolve);
    });
  });
}

function notify(title, message) {
  try {
    chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("assets/icon128.png"),
      title,
      message,
    });
  } catch (_) {
    /* yut */
  }
}

// ---- Download handler ---------------------------------------------------

async function handleDownload(request, sendResponse) {
  if (!request || !request.url) {
    sendResponse({ success: false, error: "URL eksik" });
    return;
  }

  const settings = await getSettings();
  const filename = buildFilename(settings.filenameTemplate, {
    screenName: request.screenName,
    tweetId: request.tweetId,
    tweetText: request.tweetText,
    mediaType: request.mediaType,
  });

  try {
    chrome.downloads.download(
      {
        url: request.url,
        filename,
        saveAs: false,
      },
      (downloadId) => {
        if (chrome.runtime.lastError || !downloadId) {
          const err =
            chrome.runtime.lastError?.message || "İndirme başlatılamadı";
          if (settings.showNotifications) {
            notify("İndirme başarısız", err);
          }
          sendResponse({ success: false, error: err });
          return;
        }

        pushHistory({
          downloadId,
          tweetId: request.tweetId,
          screenName: request.screenName,
          tweetText: request.tweetText || null,
          mediaType: request.mediaType || "video",
          filename,
          url: request.url,
          thumbnailUrl: request.thumbnailUrl || null,
          startedAt: Date.now(),
        });

        sendResponse({ success: true, downloadId, filename });
      }
    );
  } catch (e) {
    sendResponse({ success: false, error: e.message || String(e) });
  }
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (!request || !request.action) return false;

  if (request.action === "downloadVideo") {
    // sendResponse asenkron çağrılacak
    handleDownload(request, sendResponse);
    return true;
  }

  if (request.action === "getHistory") {
    chrome.storage.local.get([STORAGE_KEY_HISTORY], (result) => {
      sendResponse({
        success: true,
        history: result[STORAGE_KEY_HISTORY] || [],
      });
    });
    return true;
  }

  if (request.action === "clearHistory") {
    chrome.storage.local.set({ [STORAGE_KEY_HISTORY]: [] }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === "getSettings") {
    getSettings().then((s) => sendResponse({ success: true, settings: s }));
    return true;
  }

  if (request.action === "updateSettings") {
    chrome.storage.local.set(
      {
        [STORAGE_KEY_SETTINGS]: {
          ...DEFAULT_SETTINGS,
          ...(request.settings || {}),
        },
      },
      () => sendResponse({ success: true })
    );
    return true;
  }

  return false;
});

// İlk kurulum / yükseltme: varsayılan ayarları yaz, eski (legacy) verileri
// yeni storage key'lerine taşı, ve eski default template kullanılıyorsa
// yeni default'a geçir.
chrome.runtime.onInstalled.addListener(async () => {
  const all = await new Promise((r) =>
    chrome.storage.local.get(
      [
        STORAGE_KEY_SETTINGS,
        STORAGE_KEY_HISTORY,
        LEGACY_STORAGE_KEYS.settings,
        LEGACY_STORAGE_KEYS.history,
      ],
      r
    )
  );

  const updates = {};
  const removes = [];

  // Settings migration
  let settings = all[STORAGE_KEY_SETTINGS];
  if (!settings && all[LEGACY_STORAGE_KEYS.settings]) {
    settings = all[LEGACY_STORAGE_KEYS.settings];
    removes.push(LEGACY_STORAGE_KEYS.settings);
    console.log("[xclip] Eski ayarlar yeni key'e taşındı");
  }
  if (!settings) {
    settings = DEFAULT_SETTINGS;
  } else if (LEGACY_DEFAULT_TEMPLATES.includes(settings.filenameTemplate)) {
    // Kullanıcı eski default'u hiç değiştirmemiş — yeni default'a geçir
    settings = { ...settings, filenameTemplate: DEFAULT_SETTINGS.filenameTemplate };
    console.log(
      "[xclip] Default template güncellendi:",
      DEFAULT_SETTINGS.filenameTemplate
    );
  }
  updates[STORAGE_KEY_SETTINGS] = settings;

  // History migration
  if (!all[STORAGE_KEY_HISTORY] && all[LEGACY_STORAGE_KEYS.history]) {
    updates[STORAGE_KEY_HISTORY] = all[LEGACY_STORAGE_KEYS.history];
    removes.push(LEGACY_STORAGE_KEYS.history);
    console.log("[xclip] Eski geçmiş yeni key'e taşındı");
  }

  await new Promise((r) => chrome.storage.local.set(updates, r));
  if (removes.length) {
    await new Promise((r) => chrome.storage.local.remove(removes, r));
  }
});
