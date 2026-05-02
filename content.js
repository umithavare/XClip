/**
* xclip - Content Script v2 (Isolated World)
 *
 * v1'den farkları:
 *  1. Doğru aksiyon barını bul: birden çok role="group" varsa, içinde
 *     reply/like/retweet test-id'si olan grubu seçer.
 *  2. PROCESSED işareti, buton GERÇEKTEN enjekte edildikten sonra konur;
 *     video sonradan yüklenirse tekrar denenir.
 *  3. Wrapper, X'in flex layout'una uyacak şekilde flex: 1 ile gelir.
 *  4. Debug logging — `localStorage.setItem("xclip_debug", "1")` ile aktifleşir.
 *  5. Fallback: aksiyon barı bulunamasa bile videonun üzerine overlay
 *     buton koyulur.
 *  6. URL haritası yoksa kullanıcıya net mesaj verilir.
 */

(() => {
  "use strict";

  const MESSAGE_TYPE = "XCLIP_MEDIA";
  const PROCESSED_ATTR = "data-xclip-injected";
  const VIDEO_PROCESSED_ATTR = "data-xclip-overlay";
  const BTN_CLASS = "xclip-download-btn";
  const READY_CLASS = "xclip-ready";
  const LOG_PREFIX = "[xclip]";

  // Debug mode: localStorage'da xclip_debug=1 ise logla
  const DEBUG = (() => {
    try {
      return localStorage.getItem("xclip_debug") === "1";
    } catch (_) {
      return false;
    }
  })();

  function log(...args) {
    if (DEBUG) console.log(LOG_PREFIX, ...args);
  }
  function warn(...args) {
    console.warn(LOG_PREFIX, ...args);
  }

  /** Map<tweetId, { url, mediaType, screenName, thumbnailUrl, ... }> */
  const videoMap = new Map();

  log("Content script yüklendi. URL:", location.href);

  // ============================================================
  // 1) Page-world'den medya bilgilerini topla
  // ============================================================
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.type !== MESSAGE_TYPE) return;
    if (!data.tweetId || !data.url) return;

    const wasNew = !videoMap.has(data.tweetId);
    videoMap.set(data.tweetId, {
      url: data.url,
      mediaType: data.mediaType || "video",
      screenName: data.screenName || null,
      tweetText: data.tweetText || null,
      thumbnailUrl: data.thumbnailUrl || null,
      bitrate: data.bitrate || 0,
      durationMillis: data.durationMillis || null,
    });

    if (wasNew) log("Medya bulundu:", data.tweetId, "→", data.url);
    markReadyIfButtonExists(data.tweetId);
  });

  function markReadyIfButtonExists(tweetId) {
    const btns = document.querySelectorAll(
      `.${BTN_CLASS}[data-tweet-id="${cssEscape(tweetId)}"]`
    );
    btns.forEach((b) => b.classList.add(READY_CLASS));
  }

  function cssEscape(s) {
    if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(s);
    return String(s).replace(/"/g, '\\"');
  }

  // ============================================================
  // 2) Tweet ID + screenName çıkarımı
  // ============================================================
  function getTweetIdFromArticle(article) {
    const links = article.querySelectorAll('a[href*="/status/"]');
    for (const a of links) {
      const m = a.getAttribute("href").match(/\/status\/(\d+)/);
      if (m) return m[1];
    }
    return null;
  }

  function getScreenNameFromArticle(article) {
    const links = article.querySelectorAll('a[href*="/status/"]');
    for (const a of links) {
      const m = a.getAttribute("href").match(/^\/([^\/]+)\/status\//);
      if (m && m[1] !== "i") return m[1];
    }
    return null;
  }

  function articleHasVideo(article) {
    if (article.querySelector('[data-testid="videoPlayer"]')) return true;
    if (article.querySelector('[data-testid="videoComponent"]')) return true;
    if (article.querySelector("video")) return true;
    if (article.querySelector('[data-testid="previewInterstitial"]')) return true;
    return false;
  }

  // ============================================================
  // 3) Aksiyon barı bulma — KRİTİK düzeltme
  //    Bir tweet'te birden çok role="group" olabilir; biz aksiyon
  //    test-id'si içereni seçiyoruz.
  // ============================================================
  function findActionBar(article) {
    const groups = article.querySelectorAll('[role="group"]');

    for (const g of groups) {
      if (
        g.querySelector('[data-testid="reply"]') ||
        g.querySelector('[data-testid="like"]') ||
        g.querySelector('[data-testid="retweet"]') ||
        g.querySelector('[data-testid="unlike"]') ||
        g.querySelector('[data-testid="unretweet"]')
      ) {
        return g;
      }
    }
    return null;
  }

  // ============================================================
  // 4) Buton oluşturma
  // ============================================================
  const DOWNLOAD_SVG = `
<svg viewBox="0 0 24 24" aria-hidden="true">
  <g><path d="M12 17.59 6.7 12.3l1.42-1.42L11 13.76V4h2v9.76l2.88-2.88 1.42 1.42L12 17.59zM5 20v-2h14v2H5z"></path></g>
</svg>`.trim();

  function buildActionBarButton(tweetId, actionBar) {
    // Referans olarak like/reply butonunun wrapper'ını al, layout'unu kopyala
    const referenceBtn =
      actionBar.querySelector('[data-testid="like"]') ||
      actionBar.querySelector('[data-testid="unlike"]') ||
      actionBar.querySelector('[data-testid="reply"]');
    const referenceWrapper =
      referenceBtn?.parentElement?.parentElement ||
      referenceBtn?.parentElement;

    const wrapper = document.createElement("div");
    wrapper.className = "xclip-download-btn-wrapper";
    if (referenceWrapper) {
      const cs = window.getComputedStyle(referenceWrapper);
      wrapper.style.flex = cs.flex || "1 1 0%";
      wrapper.style.display = cs.display || "flex";
      wrapper.style.alignItems = cs.alignItems || "center";
      wrapper.style.justifyContent = cs.justifyContent || "flex-start";
      wrapper.style.minWidth = "0";
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = BTN_CLASS;
    btn.setAttribute("aria-label", "Videoyu indir");
    btn.setAttribute("data-tweet-id", tweetId);
    btn.innerHTML = DOWNLOAD_SVG;

    if (videoMap.has(tweetId)) btn.classList.add(READY_CLASS);

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      handleDownloadClick(btn, tweetId);
    });

    wrapper.appendChild(btn);
    return wrapper;
  }

  function buildOverlayButton(tweetId) {
    const wrapper = document.createElement("div");
    wrapper.className = "xclip-overlay-wrapper";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = BTN_CLASS + " xclip-overlay-btn";
    btn.setAttribute("aria-label", "Videoyu indir");
    btn.setAttribute("data-tweet-id", tweetId);
    btn.innerHTML = DOWNLOAD_SVG;

    if (videoMap.has(tweetId)) btn.classList.add(READY_CLASS);

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      handleDownloadClick(btn, tweetId);
    });

    wrapper.appendChild(btn);
    return wrapper;
  }

  function flashButton(btn, state, durationMs = 1500) {
    btn.classList.remove("xclip-success", "xclip-error", "xclip-loading");
    btn.classList.add(state);
    if (state !== "xclip-loading") {
      setTimeout(() => btn.classList.remove(state), durationMs);
    }
  }

  function getTweetTextFromArticle(article) {
    if (!article) return null;
    const el = article.querySelector('[data-testid="tweetText"]');
    if (!el) return null;
    // textContent newline'ları korur, biz sonra bg'de temizleyeceğiz
    return el.textContent || null;
  }

  function handleDownloadClick(btn, tweetId) {
    const article = btn.closest("article");
    const screenName = article ? getScreenNameFromArticle(article) : null;
    const info = videoMap.get(tweetId);

    if (!info) {
      flashButton(btn, "xclip-error");
      btn.title =
        "Video URL'si yakalanmadı. Sayfayı yenileyip tekrar dene (Ctrl+Shift+R).";
      warn(
        "Tweet için URL yok:",
        tweetId,
        "— sayfa eklenti yüklenmeden önce açılmış olabilir. Sayfayı yenile."
      );
      return;
    }

    log("İndirme başlıyor:", tweetId, info.url);
    flashButton(btn, "xclip-loading", 30000);

    // Tweet text: API'den gelmediyse DOM'dan dene
    const tweetText = info.tweetText || getTweetTextFromArticle(article);

    chrome.runtime.sendMessage(
      {
        action: "downloadVideo",
        tweetId,
        url: info.url,
        screenName: info.screenName || screenName,
        tweetText: tweetText,
        mediaType: info.mediaType,
        thumbnailUrl: info.thumbnailUrl,
      },
      (response) => {
        if (chrome.runtime.lastError || !response || !response.success) {
          flashButton(btn, "xclip-error");
          const err =
            chrome.runtime.lastError?.message ||
            response?.error ||
            "bilinmeyen hata";
          btn.title = "İndirme başlatılamadı: " + err;
          warn("İndirme hatası:", err);
          return;
        }
        flashButton(btn, "xclip-success");
        btn.title = "Video indiriliyor: " + response.filename;
      }
    );
  }

  // ============================================================
  // 5) Tweet'lere buton enjeksiyonu
  // ============================================================
  function injectButtons() {
    // Hem data-testid="tweet" hem de fallback olarak role="article"
    const tweets = document.querySelectorAll(
      'article[data-testid="tweet"], article[role="article"]'
    );

    let injected = 0;

    tweets.forEach((article) => {
      if (article.hasAttribute(PROCESSED_ATTR)) return;

      // KRİTİK: video yoksa atla AMA processed işaretleme — sonradan gelebilir
      if (!articleHasVideo(article)) return;

      const tweetId = getTweetIdFromArticle(article);
      if (!tweetId) return;

      const actionBar = findActionBar(article);

      if (actionBar) {
        if (actionBar.querySelector(`.${BTN_CLASS}`)) {
          article.setAttribute(PROCESSED_ATTR, "true");
          return;
        }

        const wrapper = buildActionBarButton(tweetId, actionBar);

        // X'in son child'ı genelde "share" butonu — onun ÖNÜNE ekle
        const last = actionBar.lastElementChild;
        if (last) {
          actionBar.insertBefore(wrapper, last);
        } else {
          actionBar.appendChild(wrapper);
        }

        article.setAttribute(PROCESSED_ATTR, "true");
        injected++;
        log(`Action bar butonu eklendi: tweet=${tweetId}`);
      } else {
        // Fallback: video container'ın üzerine overlay buton
        const videoContainer =
          article.querySelector('[data-testid="videoPlayer"]') ||
          article.querySelector('[data-testid="videoComponent"]') ||
          article.querySelector("video")?.parentElement;

        if (
          videoContainer &&
          !videoContainer.hasAttribute(VIDEO_PROCESSED_ATTR)
        ) {
          videoContainer.setAttribute(VIDEO_PROCESSED_ATTR, "true");
          const cs = window.getComputedStyle(videoContainer);
          if (cs.position === "static") {
            videoContainer.style.position = "relative";
          }
          videoContainer.appendChild(buildOverlayButton(tweetId));
          article.setAttribute(PROCESSED_ATTR, "true");
          injected++;
          log(`Overlay buton eklendi (action bar yok): tweet=${tweetId}`);
        }
      }
    });

    if (DEBUG && injected > 0) {
      log(`Tarama: ${injected} buton eklendi (toplam ${tweets.length} tweet)`);
    }
  }

  // ============================================================
  // 6) MutationObserver + periyodik güvenlik taraması
  // ============================================================
  let scheduled = false;
  function scheduleInject() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      try {
        injectButtons();
      } catch (e) {
        warn("injectButtons hata:", e);
      }
    }, 100);
  }

  const observer = new MutationObserver(scheduleInject);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // İlk tarama
  injectButtons();
  // Güvenlik ağı: her 2 saniyede bir tara (lazy-loaded videolar için)
  setInterval(injectButtons, 2000);

  // SPA navigasyon dedektörü
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      log("URL değişti:", lastUrl);
      scheduleInject();
    }
  }, 500);

  // Console'dan manuel debug için global API
  window.__xclip = {
    map: videoMap,
    inject: injectButtons,
    debug: (on) => {
      if (on) localStorage.setItem("xclip_debug", "1");
      else localStorage.removeItem("xclip_debug");
      console.log(LOG_PREFIX, "debug:", on ? "ON (sayfayı yenile)" : "OFF");
    },
    diagnose: () => {
      const articles = document.querySelectorAll('article[data-testid="tweet"]');
      console.group(LOG_PREFIX + " Tanı");
      console.log("Article sayısı:", articles.length);
      articles.forEach((a, i) => {
        const id = getTweetIdFromArticle(a);
        const hasVideo = articleHasVideo(a);
        const actionBar = findActionBar(a);
        const groupCount = a.querySelectorAll('[role="group"]').length;
        console.log(
          `[${i}] tweet=${id} video=${hasVideo} actionBarBulundu=${!!actionBar} ` +
            `roleGroupSayısı=${groupCount} mapDeUrlVar=${videoMap.has(id)}`
        );
      });
      console.log("videoMap:", Object.fromEntries(videoMap));
      console.groupEnd();
    },
  };
  log("Hazır. Debug için console'da: __xclip.diagnose()");
})();
