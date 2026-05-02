# xclip

> Tek tıkla browser'dan video ve GIF indir. Açık kaynak, harici servis yok, MIT lisanslı.

A lightweight, privacy-respecting browser extension that adds a one-click
download button to videos on X (formerly Twitter). All processing happens
locally — no third-party services, no telemetry, no API keys.

---

## ⚖️ Disclaimer

**This tool is provided for personal and educational use only.**

- This project is **not affiliated with, endorsed by, or sponsored by** X Corp.,
  Twitter, or any of their subsidiaries. "X" and "Twitter" are trademarks
  of their respective owners; references in this project are nominative
  (descriptive of the platform the extension works with).
- The extension does **not bypass DRM, encryption, or paywalls**. It reads
  publicly accessible video URLs from the platform's own API responses
  that the user's browser already receives in the normal course of
  loading the page.
- **Users are solely responsible** for ensuring their use of this tool
  complies with the platform's Terms of Service and applicable copyright,
  privacy, and other laws in their jurisdiction.
- **Do not use this tool** to download, redistribute, or otherwise infringe
  on copyrighted content owned by others without permission.
- The software is provided **"as is", without warranty of any kind**.
  See [LICENSE](./LICENSE) for full terms.

If you are a rights holder and have a concern about this project, please
open an issue and we'll respond promptly.

---

## ✨ Features

- One-click download button injected into the action bar of any video
  tweet (next to reply / repost / like).
- Highest-bitrate MP4 variant is automatically selected.
- Animated GIFs are supported.
- Customizable filename template with tokens: `{screenName}`,
  `{tweetText}`, `{tweetId}`, `{ext}`.
- Download history with quick links back to the original post.
- Fully local — no servers, no API keys, no tracking. Source is small
  enough that you can read it end-to-end in 15 minutes.

---

## 🚀 Installation

> **Note:** This extension is not on the Chrome Web Store. Install it as
> an unpacked extension via developer mode.

1. Download / clone this repository.
2. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked**.
5. Select the project folder (the one with `manifest.json`).
6. Open or refresh any X.com tab. The download button appears in each
   tweet that contains a video.

> 💡 If you have an X.com tab open before installing, **refresh it**
> (`Ctrl+Shift+R`) so the content script can attach.

---

## 🎯 Usage

When viewing a tweet that contains a video or GIF:

1. Look for the **↓ download button** in the action bar (next to reply,
   repost, like, share).
2. Click it. The file saves to your default downloads folder.

Open the extension popup (toolbar icon) for:
- **History** — recent downloads with one-click links to the original post.
- **Settings** — customize the filename template, toggle notifications.
- **About** — quick reference and troubleshooting.

### Filename template

Default: `{screenName}_{tweetText}_{tweetId}.mp4`

Available tokens:

| Token            | Description                                      |
| ---------------- | ------------------------------------------------ |
| `{screenName}`   | The author's handle (without `@`).               |
| `{tweetText}`    | First ~60 chars of the tweet text. URLs stripped, special chars sanitized. Empty if no text. |
| `{tweetId}`      | Numeric tweet ID — guaranteed to be present.     |
| `{ext}`          | File extension (`mp4`).                          |

Empty `{tweetText}` is automatically removed (you won't get
`user__123.mp4` — collapses to `user_123.mp4`).

---

## 🛠 How it works

X's web app loads tweet content via GraphQL API responses. Each video
in those responses comes with a structured `video_info.variants[]`
array containing direct MP4 URLs at multiple bitrates:

```jsonc
{
  "extended_entities": {
    "media": [{
      "type": "video",
      "video_info": {
        "variants": [
          { "content_type": "video/mp4", "bitrate": 832000, "url": "https://video.twimg.com/..." },
          { "content_type": "video/mp4", "bitrate": 2176000, "url": "https://video.twimg.com/..." }
        ]
      }
    }]
  }
}
```

xclip uses two content scripts working together:

1. **`inject.js`** runs in the **MAIN world** (page's own JS context)
   and monkey-patches `fetch` and `XMLHttpRequest` to read responses
   from API endpoints (GraphQL, `/i/api/`, etc.). It walks the response
   object, finds tweet entries with `extended_entities.media[]`, picks
   the highest-bitrate MP4 variant for each, and posts a message back
   to the isolated content script.
2. **`content.js`** runs in the **isolated world**, maintains a map of
   `tweetId → mediaUrl`, and injects download buttons into each tweet's
   action bar. On click, it forwards the URL to the background
   service worker, which calls `chrome.downloads.download()`.

No external API calls. No video re-uploading. The extension only
*observes* what your browser was already going to receive.

---

## 🐛 Troubleshooting

### Button doesn't appear

- Make sure the page was opened **after** installing the extension. If
  you had X.com open during install, refresh it (`Ctrl+Shift+R`).
- Check `chrome://extensions` for any errors on the xclip card.
- Open DevTools console on x.com and run:
  ```js
  __xclip.diagnose()
  ```
  This logs info about every tweet on the page (whether the button
  was injected, whether the URL was captured, etc.).

### Button is dim / semi-transparent

The video URL hasn't been captured from an API response yet. This can
happen if the tweet was loaded from cache before the inject script
attached. **Refresh the page** — the URL is captured the moment the
tweet's API call fires.

### Verbose debug logging

```js
__xclip.debug(true)   // turn on (refresh page after)
__xclip.debug(false)  // turn off
```

### Download starts but fails

- Some tweets are protected (private accounts you don't follow,
  age-gated, region-blocked). The MP4 URL itself may 401/403 in those
  cases — the platform restricts access, not the extension.
- Live streams use HLS without an MP4 variant; xclip can't download
  these by design (no MP4 in the API response).

---

## 🔒 Privacy

- **No telemetry, no analytics, no tracking.** Read the source.
- **No external network requests.** xclip never sends data anywhere
  except the platform's own video CDN (`video.twimg.com`) for the
  download itself, which is the same request your browser would make
  if you played the video.
- **All data stays in your browser.** Download history is stored in
  `chrome.storage.local` and never leaves your machine.

---

## 📦 Project structure

```
xclip/
├── manifest.json        # MV3 manifest
├── inject.js            # MAIN world: API response interceptor
├── content.js           # isolated world: button injection
├── background.js        # service worker: chrome.downloads + storage
├── style.css            # button styling
├── popup.html           # extension popup
├── popup.css
├── popup.js
├── assets/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── LICENSE              # MIT
└── README.md
```

No build step, no dependencies, no package manager. Vanilla JS.

---

## 🤝 Contributing

Issues and PRs welcome. Please keep the project's principles intact:

- **No external services.** No analytics, no telemetry, no third-party
  APIs that handle user data.
- **No hidden behavior.** Anything the extension does should be
  understandable from reading the source.
- **Defensive against X DOM changes.** When the platform changes its
  DOM (and they will), the extension should fail gracefully — buttons
  should either work or quietly not appear, never crash the page.

---

## 📜 License

[MIT](./LICENSE) © Umit Havare

---

## 🇹🇷 Türkçe

xclip, X (eski adıyla Twitter) üzerinde gördüğün video ve GIF'leri
tek tıkla indiren açık kaynaklı bir tarayıcı eklentisi. Hiçbir harici
servise istek atmaz, sıfır telemetri.

### Kurulum

1. Bu repo'yu indir.
2. `chrome://extensions` aç, sağ üstten **Geliştirici Modu**'nu aç.
3. **Paketlenmemiş öğe yükle** → bu klasörü seç.
4. X.com'a git veya açık sekmeyi yenile (`Ctrl+Shift+R`).

### Kullanım

Video içeren bir tweet'in altındaki aksiyon barında yeni bir **↓**
butonu çıkar. Tıkla, video indirilenler klasörüne kaydolur.

Eklenti popup'ından dosya adı şablonunu özelleştirebilirsin — varsayılan
`{screenName}_{tweetText}_{tweetId}.mp4`. Tweet text yoksa otomatik atlanır.

### Sorumluluk reddi

Bu araç **yalnızca kişisel ve eğitim amaçlı** kullanım için sağlanmıştır.

- Bu proje X Corp. ile **bağlantılı, ortak, sponsorlu değildir**. "X" ve
  "Twitter" ilgili sahiplerinin tescilli markalarıdır; bu projede
  geçen bahisler tanımlayıcı niteliktedir.
- Eklenti DRM, şifreleme veya paywall **aşmaz**. Sadece tarayıcının
  zaten aldığı API yanıtlarındaki public video URL'lerini okur.
- Bu aracı kullanan kişi, kendi ülkesindeki telif, gizlilik ve
  platform Hizmet Şartları uyumundan tek başına sorumludur.
- Başkalarına ait telifli içeriği izinsiz indirmek/yaymak için
  kullanma.
- Yazılım "olduğu gibi", herhangi bir garanti olmaksızın sağlanır.

Eğer bir hak sahibi olarak bu projeyle ilgili bir endişen varsa,
issue açman yeterli — hızlıca yanıtlarız.
