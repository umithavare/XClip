/**
* xclip - Page World Inject Script
 *
 * Bu script Twitter/X sayfasının asıl JS context'inde çalışır (MAIN world).
 * Görevi: fetch ve XMLHttpRequest çağrılarını monkey-patch ederek
 * Twitter'ın GraphQL/API yanıtlarını yakalamak ve içlerinden
 * video URL'lerini çıkarıp content script'e iletmek.
 *
 * Twitter API yanıtlarındaki video formatı:
 *   tweet.legacy.extended_entities.media[].video_info.variants[]
 *   => { content_type: "video/mp4", bitrate: 832000, url: "https://video.twimg.com/..." }
 *
 * En yüksek bitrate'li MP4 variant'ını seçip tweet ID'siyle eşleştiriyoruz.
 */

(function () {
  "use strict";

  if (window.__xclipInjected) return;
  window.__xclipInjected = true;

  const MESSAGE_TYPE = "XCLIP_MEDIA";

  // Tweet API'larından geçen URL desenleri
  const API_URL_PATTERN = /(graphql|\/2\/timeline|\/2\/search|\/i\/api|TweetDetail|HomeTimeline|UserTweets|UserMedia|Bookmarks|Likes|TweetResultByRestId)/i;

  function postMedia(tweetId, mediaInfo) {
    if (!tweetId || !mediaInfo) return;
    try {
      window.postMessage(
        {
          type: MESSAGE_TYPE,
          tweetId: String(tweetId),
          ...mediaInfo,
        },
        window.location.origin
      );
    } catch (_) {
      /* sessizce yut */
    }
  }

  function pickBestVariant(variants) {
    if (!Array.isArray(variants)) return null;
    const mp4s = variants
      .filter((v) => v && v.content_type === "video/mp4" && typeof v.url === "string")
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
    return mp4s[0] || null;
  }

  function extractFromMedia(media) {
    // media.video_info.variants[] formatı
    if (!media || !media.video_info || !media.video_info.variants) return null;

    const best = pickBestVariant(media.video_info.variants);
    if (!best) return null;

    const isGif = media.type === "animated_gif";
    const aspectRatio = media.video_info.aspect_ratio || null;
    const durationMillis = media.video_info.duration_millis || null;
    const thumb = media.media_url_https || media.media_url || null;

    return {
      url: best.url,
      bitrate: best.bitrate || 0,
      mediaType: isGif ? "gif" : "video",
      aspectRatio,
      durationMillis,
      thumbnailUrl: thumb,
    };
  }

  /**
   * Yanıt objesini özyinelemeli olarak gez. Tweet objelerinde
   * extended_entities.media[] arıyoruz ve tweet ID ile eşleştiriyoruz.
   */
  function walk(node, depth = 0, seen = new WeakSet()) {
    if (!node || typeof node !== "object" || depth > 25) return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1, seen);
      return;
    }

    // Tweet objelerinin içinde extended_entities veya legacy.extended_entities olabilir
    const idStr =
      node.id_str ||
      (node.legacy && node.legacy.id_str) ||
      (node.tweet && node.tweet.legacy && node.tweet.legacy.id_str) ||
      node.rest_id;

    const ext =
      node.extended_entities ||
      (node.legacy && node.legacy.extended_entities) ||
      (node.tweet && node.tweet.legacy && node.tweet.legacy.extended_entities);

    if (idStr && ext && Array.isArray(ext.media)) {
      // Aynı tweette birden fazla video olabilir; ilk video/gif'i kullanıyoruz
      // (X UI'sinde nadir). Çoklu medya için ilerideki sürümde index ekleyebiliriz.
      const userScreenName =
        (node.core &&
          node.core.user_results &&
          node.core.user_results.result &&
          node.core.user_results.result.legacy &&
          node.core.user_results.result.legacy.screen_name) ||
        (node.user && node.user.screen_name) ||
        (node.legacy && node.legacy.user && node.legacy.user.screen_name) ||
        null;

      // Tweet text — 3 olası konum:
      //   legacy.full_text (normal tweetler)
      //   full_text         (bazı endpoint'lerde)
      //   note_tweet.note_tweet_results.result.text  (X Premium uzun tweet)
      const fullText =
        (node.note_tweet &&
          node.note_tweet.note_tweet_results &&
          node.note_tweet.note_tweet_results.result &&
          node.note_tweet.note_tweet_results.result.text) ||
        (node.legacy && node.legacy.full_text) ||
        node.full_text ||
        null;

      for (const media of ext.media) {
        const info = extractFromMedia(media);
        if (info) {
          postMedia(idStr, {
            ...info,
            screenName: userScreenName,
            tweetText: fullText,
          });
          break; // ilk medyayı bul, devam etme
        }
      }
    }

    // Çocukları gez
    for (const key in node) {
      if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
      const value = node[key];
      if (value && typeof value === "object") {
        walk(value, depth + 1, seen);
      }
    }
  }

  function safeParseAndWalk(text) {
    if (!text || typeof text !== "string") return;
    if (text.length > 10 * 1024 * 1024) return; // 10MB üzeri yanıtları atla
    try {
      const data = JSON.parse(text);
      walk(data);
    } catch (_) {
      /* JSON değilse atla */
    }
  }

  // ---- fetch patch ----
  const originalFetch = window.fetch;
  window.fetch = function patchedFetch(...args) {
    const reqUrl =
      typeof args[0] === "string"
        ? args[0]
        : args[0] && args[0].url
        ? args[0].url
        : "";

    const promise = originalFetch.apply(this, args);

    if (typeof reqUrl === "string" && API_URL_PATTERN.test(reqUrl)) {
      promise
        .then((response) => {
          // Klonu asenkron olarak işle, asıl yanıtı tüketme
          try {
            response
              .clone()
              .text()
              .then(safeParseAndWalk)
              .catch(() => {});
          } catch (_) {
            /* yut */
          }
          return response;
        })
        .catch(() => {});
    }

    return promise;
  };

  // ---- XMLHttpRequest patch ----
  const OriginalXHROpen = XMLHttpRequest.prototype.open;
  const OriginalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
    try {
      this.__xclip_url = url;
    } catch (_) {}
    return OriginalXHROpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function patchedSend() {
    try {
      const url = this.__xclip_url;
      if (typeof url === "string" && API_URL_PATTERN.test(url)) {
        this.addEventListener("load", function () {
          try {
            // responseType "" veya "text" ise responseText kullanılabilir
            if (this.responseType === "" || this.responseType === "text") {
              safeParseAndWalk(this.responseText);
            } else if (this.responseType === "json" && this.response) {
              walk(this.response);
            }
          } catch (_) {
            /* yut */
          }
        });
      }
    } catch (_) {}
    return OriginalXHRSend.apply(this, arguments);
  };
})();
