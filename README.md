# House TV

Our own home screen for the Fire TV in the house (Insignia Fire TV Edition, Fire OS 7).

- `web/` — the home screen itself. Plain HTML/CSS/JS, served at https://house-tv.vercel.app. Push a change and the TV picks it up next time the screen loads. `web/ticker.json` holds extra ticker lines.
- `app/` — a thin Android shell: a full-screen WebView plus a `window.HouseTV` bridge to list and open apps, list and switch HDMI/antenna inputs, and open Settings. A copy of `web/` ships inside it for when the internet is out.
- GitHub Actions builds the APK on every push and publishes it to https://house-tv.vercel.app/get.

## Install on the TV
1. Fire TV: Downloader app → enter `house-tv.vercel.app/get` → Install.
2. It shows up in Your Apps as **Home**. Move it to the front of the row.

## One-time setup (Recent row + Now playing)
From a computer on the same wifi, with ADB debugging on (Settings → My Fire TV → Developer options):

```
adb connect <TV IP>
adb shell appops set com.thesolster.housetv GET_USAGE_STATS allow
adb shell cmd notification allow_listener com.thesolster.housetv/com.thesolster.housetv.NowPlayingListener
```

## Phone remote
The TV runs a small web server on the house wifi (port 8765). Scan the QR on the home screen; the link carries a token, nothing else gets in. Nothing goes through the cloud.

## Signing
`signing/house-tv.jks` (password `housetv`) is a fixed key so new builds install over old ones. It's a home toy in a private repo; don't reuse the key for anything public.
