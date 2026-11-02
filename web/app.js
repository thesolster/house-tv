/* House TV: the house guide channel.
 * Top half: a live preview of whatever you're on, and what it is.
 * Bottom half: a guide where every row is a channel (your shows, the town, tonight,
 * Regular's channels, apps, inputs).
 * Runs inside the House TV Android shell (window.HouseTV) or in a browser with sample data. */
(function () {
  "use strict";

  var PAGE_VERSION = "page 26";
  var SANTA_CRUZ = { lat: 36.9741, lon: -122.0308, tz: "America/Los_Angeles" };
  var TIDE_STATION = "9413745"; // NOAA, Santa Cruz
  var IDLE_MS = 5 * 60 * 1000;
  var STATION_AFTER_MS = 15 * 60 * 1000;
  var REGULAR_TV = ["https://regular-tv-channels.vercel.app", "https://tv.regular.sc"];
  var REGULAR_FEED = ["https://regular.sc/api/channel-feed", "https://regular-agent.vercel.app/api/channel-feed"];
  var STATION_PAGE = REGULAR_TV[0] + "/tv/town";

  var PREFERRED = [
    "com.netflix.ninja", "com.amazon.firetv.youtube", "com.google.android.youtube.tv",
    "com.amazon.firebat", "com.disney.disneyplus", "com.hulu.plus", "com.wbd.stream",
    "com.hbo.hbonow", "com.apple.atve.amazon.appletv", "com.peacocktv.peacockandroid",
    "com.spotify.tv.android", "com.plexapp.android", "tv.pluto.android"
  ];
  var HIDDEN = [
    "com.amazon.tv.launcher", "com.amazon.tv.settings.v2", "com.amazon.venezia",
    "com.amazon.device.software.ota", "com.amazon.tv.oobe", "com.amazon.tv.legal.notices",
    "com.amazon.avod", "com.amazon.tv.livetv", "com.amazon.ssm", "com.amazon.tv.ime"
  ];

  /* ---------- bridge ---------- */

  var bridge = window.HouseTV || {
    apps: function () {
      return JSON.stringify([
        { pkg: "com.netflix.ninja", label: "Netflix" }, { pkg: "com.amazon.firetv.youtube", label: "YouTube" },
        { pkg: "com.amazon.avod", label: "Prime Video" }, { pkg: "com.hbo.hbonow", label: "HBO Max" },
        { pkg: "com.spotify.tv.android", label: "Spotify" }
      ]);
    },
    icon: function () { return ""; },
    launch: function (pkg) { toast("Would open " + pkg); return "ok"; },
    inputs: function () { return JSON.stringify([{ id: "hdmi1", label: "HDMI 1" }, { id: "hdmi2", label: "HDMI 2" }, { id: "tuner", label: "Antenna" }]); },
    openInput: function (id) { toast("Would switch to " + id); return "ok"; },
    settings: function () { toast("Would open settings"); return "ok"; },
    version: function () { return "browser"; },
    recent: function () { return JSON.stringify([{ pkg: "com.netflix.ninja", label: "Netflix" }, { pkg: "com.amazon.firetv.youtube", label: "YouTube" }]); },
    nowPlaying: function () { return JSON.stringify({ access: true, pkg: "com.hbo.hbonow", app: "HBO Max", title: "Amour Fou", subtitle: "The Sopranos", state: "paused", position: 1796988, duration: 3300000 }); },
    media: function (a) { toast("Would " + a); return "ok"; },
    history: function () {
      return JSON.stringify({ items: [
        { pkg: "com.hbo.hbonow", app: "HBO Max", title: "Amour Fou", subtitle: "The Sopranos", position: 1796988, duration: 3300000, at: Date.now() - 3600000 },
        { pkg: "com.netflix.ninja", app: "Netflix", title: "Chapter Four", subtitle: "Stranger Things", position: 900000, duration: 3000000, at: Date.now() - 86400000 * 2 }
      ] });
    },
    openUrl: function (u) { toast("Would open " + u); return "ok"; },
    view: function (u) { toast("Would show " + u); return "ok"; },
    status: function () { return JSON.stringify({ usage: true, nowPlaying: true, remote: "http://192.168.4.38:8765/?t=preview" }); }
  };
  var inShell = !!window.HouseTV;

  function call(name) {
    try {
      if (!bridge[name]) return "missing";
      return bridge[name].apply(bridge, Array.prototype.slice.call(arguments, 1));
    } catch (e) { return "error: " + e.message; }
  }
  function json(name, fallback) {
    try { return JSON.parse(call(name) || "null") || fallback; } catch (e) { return fallback; }
  }

  /* ---------- fit the 1920x1080 stage to the screen ---------- */

  var stage = document.getElementById("stage");
  var lastFit = "";
  function fit() {
    var de = document.documentElement;
    var w = de.clientWidth || window.innerWidth, h = de.clientHeight || window.innerHeight;
    if (!w || !h) return;
    var key = w + "x" + h;
    if (key === lastFit) return;
    lastFit = key;
    var s = Math.min(w / 1920, h / 1080);
    stage.style.transform = "scale(" + s + ")";
    stage.style.left = ((w - 1920 * s) / 2) + "px";
    stage.style.top = ((h - 1080 * s) / 2) + "px";
  }
  window.addEventListener("resize", fit);
  window.addEventListener("load", fit);
  setInterval(fit, 2000);
  fit();

  // Reload when the page changes, so the TV updates without anyone touching it.
  var fingerprint = null;
  function checkForUpdate() {
    if (location.protocol === "file:") return;
    Promise.all(["app.js", "style.css", "index.html", "skins/guide.css", "skins/seventies.css", "skins/teletext.css", "skins/surf.css", "view.css"].map(function (f) {
      return fetch(f + "?v=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.text(); });
    })).then(function (parts) {
      var text = parts.join("|"), hash = 0;
      for (var i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
      if (fingerprint === null) fingerprint = hash;
      else if (hash !== fingerprint) location.reload();
    }).catch(function () {});
  }
  checkForUpdate();
  setInterval(checkForUpdate, 2 * 60 * 1000);

  setTimeout(function () {
    setText("build", PAGE_VERSION + " · app " + (inShell ? call("version") : "browser"));
  }, 1500);

  /* ---------- settings: theme, note, extra ticker lines ---------- */

  var settings = { theme: "", note: "", lines: [], preview: "live" };

  // Choices made on this TV (Channel 99 Settings). The house file sets the defaults.
  var prefs = loadPrefs();
  function loadPrefs() {
    var p = {};
    try { p = JSON.parse(localStorage.getItem("house-prefs") || "{}") || {}; } catch (e) {}
    try { var old = localStorage.getItem("house-skin"); if (old && !p.skin) p.skin = old; } catch (e) {}
    return p;
  }
  function savePrefs() { try { localStorage.setItem("house-prefs", JSON.stringify(prefs)); } catch (e) {} }
  function pref(key, fallback) { return prefs[key] || fallback; }
  function applyPrefs() {
    document.body.classList.toggle("no-ticker", pref("ticker", "on") === "off");
    var showNote = pref("note", "show") === "show" && settings.note;
    setText("note", showNote ? "♥ " + settings.note : "");
    setText("ambient-note", showNote ? "♥ " + settings.note : "");
  }
  function loadSettings() {
    return getJSON("ticker.json?t=" + Date.now()).then(function (j) {
      settings.theme = j.theme === "retro" ? "guide" : (j.theme || "modern");
      settings.note = j.note || "";
      settings.lines = (j.lines || []).filter(Boolean);
      settings.preview = j.preview || "live";
      applySkin(pref("skin", settings.theme));
      applyPrefs();
      tick();
      buildTicker();
    }).catch(function () {});
  }

  /* ---------- skins ---------- */

  var SKINS = [
    { id: "guide", name: "Guide", about: "1988 cable guide channel, blue and yellow", clock: "vcr", colors: ["#0b0d3a", "#ffd23f", "#7dff8a"] },
    { id: "seventies", name: "Seventies", about: "Wood panel, mustard and orange, sunset stripes", clock: "vcr", colors: ["#3b200c", "#ffb000", "#e2562a"] },
    { id: "teletext", name: "Teletext", about: "Ceefax pages: black, eight colors, blocky", clock: "24", colors: ["#000000", "#ffff00", "#00ffff"] },
    { id: "surf", name: "Surf", about: "Santa Cruz surf poster: sand, ocean, sunset", clock: "plain", colors: ["#f3e6cc", "#0f6e7a", "#e8573c"] },
    { id: "modern", name: "Modern", about: "Clean and dark", clock: "plain", colors: ["#12100e", "#f2a65a", "#f4ede4"] }
  ];
  var skin = SKINS[4];
  function chosenSkin() { return pref("skin", ""); }
  function applySkin(id) {
    var found = SKINS.filter(function (k) { return k.id === id; })[0] || SKINS[4];
    skin = found;
    SKINS.forEach(function (k) { document.body.classList.toggle("skin-" + k.id, k.id === found.id); });
    tick();
  }
  function pickSkin(id) {
    prefs.skin = id;
    savePrefs();
    applySkin(id);
    buildGuide();
    toast("Skin: " + skin.name);
  }

  /* ---------- clock ---------- */

  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function fmtTime(d) { var h = d.getHours() % 12 || 12, m = d.getMinutes(); return h + ":" + (m < 10 ? "0" : "") + m; }
  function fmtShortTime(x) { var d = new Date(x); return fmtTime(d) + (d.getHours() < 12 ? "am" : "pm"); }
  function tick() {
    var d = new Date(), t = fmtTime(d);
    var mode = skin ? skin.clock : "plain";
    var hh = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    setText("clock", mode === "vcr" ? (d.getHours() < 12 ? "AM " : "PM ") + t : mode === "24" ? hh : t);
    setText("ambient-clock", t);
    var date = DAYS[d.getDay()] + ", " + MONTHS[d.getMonth()] + " " + d.getDate();
    setText("date", date);
    setText("ambient-date", date);
  }
  setInterval(tick, 10000);
  tick();

  /* ---------- weather and tides ---------- */

  var WMO = { 0: "clear", 1: "mostly clear", 2: "partly cloudy", 3: "cloudy", 45: "foggy", 48: "foggy", 51: "drizzly", 53: "drizzly", 55: "drizzly",
    61: "light rain", 63: "rain", 65: "heavy rain", 80: "showers", 81: "showers", 82: "heavy showers", 95: "thunderstorms" };
  var conditions = { weather: null, tides: [] };

  function loadWeather() {
    var url = "https://api.open-meteo.com/v1/forecast?latitude=" + SANTA_CRUZ.lat + "&longitude=" + SANTA_CRUZ.lon +
      "&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,sunset,sunrise" +
      "&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=" + encodeURIComponent(SANTA_CRUZ.tz) + "&forecast_days=2";
    return getJSON(url).then(function (j) {
      conditions.weather = {
        temp: Math.round(j.current.temperature_2m), sky: WMO[j.current.weather_code] || "", wind: Math.round(j.current.wind_speed_10m),
        hi: Math.round(j.daily.temperature_2m_max[0]), lo: Math.round(j.daily.temperature_2m_min[0]),
        sunset: j.daily.sunset[0], sunrise: j.daily.sunrise[1], tomorrowHi: Math.round(j.daily.temperature_2m_max[1])
      };
    }).catch(function () {});
  }
  function ymd(d) { return d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0"); }
  function loadTides() {
    var url = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&application=house_tv&begin_date=" + ymd(new Date()) +
      "&range=48&datum=MLLW&station=" + TIDE_STATION + "&time_zone=lst_ldt&units=english&interval=hilo&format=json";
    return getJSON(url).then(function (j) {
      var now = Date.now();
      conditions.tides = (j.predictions || []).map(function (p) {
        return { at: new Date(p.t.replace(" ", "T")), high: p.type === "H", ft: parseFloat(p.v) };
      }).filter(function (p) { return p.at.getTime() > now; }).slice(0, 2);
    }).catch(function () {});
  }
  function weatherLine() {
    var w = conditions.weather;
    if (!w) return "";
    var later = new Date(w.sunset) > new Date() ? "Sunset " + fmtShortTime(w.sunset) : "Tomorrow " + w.tomorrowHi + "°";
    return w.temp + "° " + w.sky + "\n" + later;
  }
  function refreshConditions() {
    Promise.all([loadWeather(), loadTides()]).then(function () {
      var line = weatherLine();
      var el = document.getElementById("weather");
      el.innerHTML = line.split("\n").map(esc).join("<br>");
      setText("ambient-summary", line.replace("\n", " · "));
      buildTicker();
    });
  }

  /* ---------- Regular: the town station and channel feed ---------- */

  var town = { events: [], alerts: [], photos: [], radio: [], ticker: [], channels: [], stations: [] };
  var radioCfg = [];
  function loadRadio() {
    return getJSON("radio.json?t=" + Date.now()).then(function (j) { radioCfg = j.stations || []; buildGuide(); }).catch(function () {});
  }

  function firstJSON(urls) {
    var i = 0;
    function next() {
      if (i >= urls.length) return Promise.reject(new Error("no source"));
      return getJSON(urls[i++]).catch(next);
    }
    return next();
  }

  function spotLines(spot) {
    var out = [];
    (spot.parts || []).forEach(function (p) {
      if (p.kind === "event") out.push({ t: p.title, s: (p.now ? "On now" : p.time || "") + (p.place ? " · " + p.place : ""), now: !!p.now, photo: p.photo && p.photo.url });
      else if (p.kind === "list") (p.rows || []).slice(0, 3).forEach(function (r) { out.push({ t: r.main, s: [r.left, r.sub].filter(Boolean).join(" · ") }); });
      else if (p.kind === "message") out.push({ t: p.text, s: p.sub || "" });
      else if (p.kind === "stats") out.push({ t: p.title, s: (p.tiles || []).slice(0, 3).map(function (x) { return x.label + " " + x.value; }).join(" · ") });
      else if (p.kind === "bulletin") out.push({ t: p.title, s: p.at || "" });
      else if (p.kind === "flyer") out.push({ t: p.title, s: p.when || "", photo: p.url });
    });
    return out;
  }

  function loadTown() {
    var station = firstJSON(REGULAR_TV.map(function (b) { return b + "/api/town/station"; })).then(function (st) {
      var events = [], alerts = [], photos = [], seen = {}, chans = [], byId = {};
      (st.spots || []).forEach(function (spot) {
        var first = (spot.parts || [])[0];
        if (first && first.kind === "bumper" && /^bump-/.test(spot.id || "")) {
          var id = spot.id.replace(/^bump-/, "");
          if (!byId[id]) {
            byId[id] = { id: id, name: first.name, about: first.about || "", color: (spot.channel && spot.channel.color) || "#5bc4e3",
              photo: first.photo && first.photo.url, credit: first.photo && first.photo.credit, url: REGULAR_TV[0] + "/tv/town/" + id, items: [] };
            chans.push(byId[id]);
          }
          if (first.photo && first.photo.url && !seen[first.photo.url]) {
            seen[first.photo.url] = 1;
            photos.push({ url: first.photo.url, credit: first.photo.credit || "" });
          }
          return;
        }
        (spot.parts || []).forEach(function (p) {
          if (p.kind === "event") events.push({ title: p.title, place: p.place, time: p.time, now: !!p.now, photo: p.photo && p.photo.url, credit: p.photo && p.photo.credit, url: p.ref && p.ref.u });
          else if (p.kind === "message" && p.text) alerts.push(p.text + (p.sub ? " · " + p.sub : ""));
        });
        var ch = byId[spot.channel_id];
        if (ch) ch.items = ch.items.concat(spotLines(spot));
      });
      // Spots can arrive before their bumper; sweep once more so every channel gets its items.
      (st.spots || []).forEach(function (spot) {
        var ch = byId[spot.channel_id];
        if (ch && !ch.items.length && !/^bump-/.test(spot.id || "")) ch.items = spotLines(spot);
      });
      town.events = events;
      town.alerts = alerts;
      if (photos.length) town.photos = photos;
      town.ticker = st.town_ticker === false ? [] : (st.town || []);
      if (chans.length) town.channels = chans;
    }).catch(function () {});
    var feed = firstJSON(REGULAR_FEED).then(function (f) {
      town.stations = f.radio || [];
      town.radio = (f.radio || []).filter(function (r) { return r.on && r.on.title; }).map(function (r) {
        return "On " + r.station + ": " + r.on.title + (r.on.host ? " with " + r.on.host : "") + (r.on.until ? " until " + r.on.until : "");
      });
    }).catch(function () {});
    return Promise.all([station, feed]).then(function () { buildTicker(); buildGuide(); });
  }

  var liveItems = [];
  function loadLive() {
    return getJSON("live.json?t=" + Date.now()).then(function (j) { liveItems = j.items || []; buildGuide(); }).catch(function () {});
  }

  /* ---------- ticker ---------- */

  function whenLabel(iso) {
    var d = new Date(iso), now = new Date();
    if (isNaN(d)) return "";
    var allDay = d.getHours() === 0 && d.getMinutes() === 0;
    var sameDay = d.toDateString() === now.toDateString();
    var tmrw = new Date(now.getTime() + 86400000).toDateString() === d.toDateString();
    if (sameDay && !allDay && d <= now) return "On now";
    var t = allDay ? "" : fmtShortTime(d);
    if (sameDay) return t || "Today";
    if (tmrw) return "Tomorrow" + (t ? " " + t : "");
    return DAYS[d.getDay()].slice(0, 3) + (t ? " " + t : "");
  }

  var strip = document.getElementById("strip");
  var tickerX = 0, stripWidth = 0;
  function buildTicker() {
    var items = [];
    town.alerts.forEach(function (a) { items.push("<i>Heads up</i> " + esc(a)); });
    town.ticker.forEach(function (t) { items.push("<i>" + esc(whenLabel(t.when)) + "</i> " + esc(t.title) + (t.place ? " · " + esc(t.place) : "")); });
    town.radio.forEach(function (r) { items.push("<i>Radio</i> " + esc(r)); });
    var w = conditions.weather;
    if (w) {
      items.push("<i>Now</i> " + w.temp + "° " + esc(w.sky) + ", wind " + w.wind + " mph");
      items.push("<i>Today</i> high " + w.hi + "°, low " + w.lo + "°");
      if (new Date(w.sunset) > new Date()) items.push("<i>Sunset</i> " + fmtShortTime(w.sunset));
    }
    conditions.tides.forEach(function (t) { items.push("<i>" + (t.high ? "High tide" : "Low tide") + "</i> " + fmtShortTime(t.at) + ", " + t.ft.toFixed(1) + " ft"); });
    settings.lines.forEach(function (l) { items.push(esc(l)); });
    if (!items.length) items.push("Santa Cruz");
    var html = items.map(function (s) { return "<span>" + s + "</span><span>·</span>"; }).join("");
    strip.innerHTML = html + html;
    stripWidth = strip.scrollWidth / 2;
  }
  var lastFrame = 0;
  function runTicker(ts) {
    if (lastFrame) {
      tickerX -= Math.min(ts - lastFrame, 100) * 0.09;
      if (stripWidth && -tickerX >= stripWidth) tickerX += stripWidth;
      strip.style.transform = "translateX(" + tickerX + "px)";
    }
    lastFrame = ts;
    requestAnimationFrame(runTicker);
  }
  requestAnimationFrame(runTicker);

  /* ---------- now playing + phone remote ---------- */

  var np = {};
  var lastRadioState = "";
  function refreshNowPlaying() {
    np = json("nowPlaying", {});
    var box = document.getElementById("np");
    var rs = json("radioStatus", {});
    if (rs.state === "playing" || rs.state === "connecting") {
      var live = town.stations.filter(function (r) { return rs.station && rs.station.indexOf(r.station) === 0; })[0] || {};
      box.classList.remove("hidden");
      setText("np-app", (rs.state === "playing" ? "On the radio · " : "Tuning in · ") + rs.station);
      setText("np-title", (live.on && live.on.title) || "Live");
      document.getElementById("np-fill").style.width = "100%";
      return;
    }
    if (rs.state === "failed" && lastRadioState !== "failed") toast("Couldn't tune in " + rs.station + " (" + (rs.error || "no stream") + ")");
    lastRadioState = rs.state;
    if (!np.title && !np.app) { box.classList.add("hidden"); return; }
    box.classList.remove("hidden");
    setText("np-app", (np.state === "playing" ? "Now playing · " : np.state === "paused" ? "Paused · " : "") + (np.app || ""));
    setText("np-title", [np.subtitle, np.title].filter(Boolean).join(" · "));
    document.getElementById("np-fill").style.width = (np.duration > 0 ? Math.min(100, 100 * np.position / np.duration) : 0) + "%";
  }
  var remoteUrl = "";
  function refreshRemote() {
    var st = json("status", {});
    var box = document.getElementById("remote");
    if (!st.remote || typeof qrcode === "undefined") { box.classList.add("hidden"); return; }
    if (st.remote === remoteUrl) return;
    remoteUrl = st.remote;
    var qr = qrcode(0, "M");
    qr.addData(remoteUrl);
    qr.make();
    document.getElementById("qr").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    box.classList.remove("hidden");
  }

  /* ---------- the guide ---------- */

  function ago(ms) {
    var m = Math.round((Date.now() - ms) / 60000);
    if (m < 2) return "just now";
    if (m < 60) return m + " min ago";
    var h = Math.round(m / 60);
    if (h < 24) return h + (h === 1 ? " hour ago" : " hours ago");
    var d = Math.round(h / 24);
    return d === 1 ? "yesterday" : d + " days ago";
  }
  function sortApps(list) {
    var seen = {};
    list = list.filter(function (a) { if (seen[a.pkg] || HIDDEN.indexOf(a.pkg) >= 0) return false; seen[a.pkg] = 1; return true; });
    return list.sort(function (a, b) {
      var ia = PREFERRED.indexOf(a.pkg), ib = PREFERRED.indexOf(b.pkg);
      if (ia >= 0 || ib >= 0) return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
      return a.label.localeCompare(b.label);
    });
  }
  var artCache = {};
  function art(pkg) { if (!(pkg in artCache)) artCache[pkg] = call("icon", pkg) || ""; return artCache[pkg]; }
  function appPreview(pkg, label, kicker) {
    var a = art(pkg);
    if (a && a.indexOf("banner:") === 0) return { type: "banner", src: a.slice(7) };
    if (a && a.indexOf("icon:") === 0) return { type: "banner", src: a.slice(5) };
    return { type: "card", kicker: kicker || "App", title: label };
  }

  // All of Regular's channels (station first), for flipping with ◀ ▶ while watching.
  function channelList() {
    return [{ name: "Santa Cruz", url: STATION_PAGE }].concat(town.channels.map(function (c) { return { name: c.name, url: c.url }; }));
  }
  function watchChannel(i) {
    var list = channelList();
    var r = bridge.watch ? call("watch", JSON.stringify(list), i) : call("view", list[i].url);
    if (r !== "ok") toast("Couldn't open " + list[i].name);
  }
  function livePreview(url, photo, credit) {
    return pref("preview", settings.preview) === "live" && inShell ? { type: "live", url: url, photo: photo, credit: credit } : { type: "photo", url: photo, credit: credit };
  }

  // History is per episode; channels want one tile per show, newest first.
  function byShow(items) {
    var seen = {}, out = [];
    items.slice().sort(function (a, b) { return (b.at || 0) - (a.at || 0); }).forEach(function (w) {
      var key = w.pkg + "|" + (w.subtitle || w.title);
      if (seen[key]) return;
      seen[key] = 1;
      out.push(w);
    });
    return out;
  }

  var rows = [];
  function buildGuide() {
    var out = [];

    // 02 Your shows: what you watched, then the apps you've used
    var shows = [];
    byShow(json("history", {}).items || []).slice(0, 8).forEach(function (w) {
      var show = w.subtitle || w.title, ep = w.subtitle ? w.title : "";
      shows.push({
        t: show, s: [ep, w.app, ago(w.at)].filter(Boolean).join(" · "),
        kicker: (w.app || "") + " · " + ago(w.at), title: show, sub: (ep ? ep + " · " : "") + "Opens " + (w.app || "the app"),
        preview: appPreview(w.pkg, show, w.app),
        act: function () {
          var r = bridge.resume ? call("resume", w.pkg, "", "") : call("launch", w.pkg);
          if (r === "resumed") toast("Picking up " + show);
          else if (r === "app" || r === "ok") toast("Opening " + (w.app || "the app") + " · " + show + " is under Continue Watching");
          else toast("Couldn't open " + (w.app || "the app"));
        }
      });
    });
    json("recent", []).filter(function (a) { return HIDDEN.indexOf(a.pkg) < 0; }).slice(0, 6).forEach(function (a) {
      shows.push({ t: a.label, s: "Recent app", kicker: "Recent app", title: a.label, sub: "Opens " + a.label, preview: appPreview(a.pkg, a.label), act: function () { launch(a); } });
    });
    if (!shows.length) shows.push({ t: "Nothing yet", s: "Watch something and it shows up here", title: "Your shows", sub: "Watch something and it shows up here", preview: { type: "card", kicker: "Your shows", title: "Nothing yet" } });
    out.push({ num: "02", name: "Your shows", color: "#ffd23f", cells: shows });

    // 03 Santa Cruz: the whole town in one channel. The station, then each of
    // Regular's channels, then the cams. ◀ ▶ moves between them; OK plays one.
    var photo0 = town.photos[0] || {};
    var sc = [{ t: "Santa Cruz right now", s: "All of the town's channels, mixed", now: true, kicker: "Regular TV · all channels", title: "Santa Cruz right now",
      sub: "The whole town's channels, mixed by time of day", preview: livePreview(STATION_PAGE, photo0.url, photo0.credit), act: function () { watchChannel(0); } }];
    var lastStation = radioStation();
    sc.push({ t: "Town + radio", s: "The town on screen, " + (lastStation ? lastStation.name : "local radio") + " playing", now: true,
      kicker: "Regular TV + radio", title: "Town + radio", sub: "Watch the town with " + (lastStation ? lastStation.name : "local radio") + " on. ▲ ▼ town · ◀ ▶ station",
      preview: livePreview(STATION_PAGE, photo0.url, photo0.credit), act: function () { enterTune(null, 0); } });
    town.channels.forEach(function (ch, i) {
      var first = ch.items[0];
      var sub = ch.id === "tonight" && town.events.length
        ? town.events.length + " on tonight · " + town.events[0].title + (town.events[0].now ? " on now" : "")
        : first ? first.t + (first.s ? " · " + first.s : "") : ch.about;
      sc.push({ t: ch.name, s: sub, kicker: "Regular TV · " + ch.name, title: ch.name, sub: ch.about,
        preview: livePreview(ch.url, ch.photo, ch.credit), act: function () { watchChannel(i + 1); } });
    });
    liveItems.forEach(function (it) {
      sc.push({ t: it.title, s: it.sub || "Live cam", now: true, kicker: "Live cam", title: it.title, sub: it.sub || "",
        preview: { type: "card", kicker: "Live cam", title: it.title },
        act: function () {
          var r = it.kind === "youtube" ? call("openUrl", it.url, "") : call("view", it.url);
          if (r !== "ok") toast("Couldn't open " + it.title);
        } });
    });
    out.push({ num: "03", name: "Santa Cruz", color: "#5bc4e3", cells: sc });

    // 88 and up: one channel per radio station, in radio.json order.
    // OK plays (OK again stops). Each row also has "Town + radio" and, where Regular knows it, what's next.
    var rs = json("radioStatus", {});
    var radioOn = rs.state === "playing" || rs.state === "connecting";
    radioCfg.forEach(function (cfg, i) {
      var live = town.stations.filter(function (r) { return r.station === cfg.code; })[0] || {};
      var on = live.on || {}, next = live.next || {};
      var playing = radioOn && rs.station === cfg.name;
      var cardTitle = on.title || cfg.about;
      if (cfg.soon) {
        // Paid streams (KPIG): a placeholder until subscribing from Settings exists.
        out.push({ num: String(88 + i), name: cfg.name, color: "#7d7268", cells: [{
          t: "Coming soon", s: "Subscribe from Settings, coming soon", kicker: cfg.area + " · Coming soon", title: "Coming soon",
          sub: cfg.name + " streams for subscribers. Signing in from Settings is on the way.",
          preview: { type: "card", kicker: cfg.name + " · " + cfg.area, title: "Coming soon" },
          act: function () { toast(cfg.name + " is coming soon"); } }] });
        return;
      }
      var cells = [{
        t: playing ? "■ Stop" : "▶ Listen" + (on.title ? ": " + on.title : ""),
        s: playing ? (rs.state === "playing" ? "Playing now" : "Tuning in…") : on.title ? [on.host ? "with " + on.host : "", on.until ? "until " + on.until : ""].filter(Boolean).join(" · ") : cfg.area + " · " + cfg.about,
        now: true, kicker: cfg.area + " · " + (playing ? (rs.state === "playing" ? "Playing now" : "Tuning in…") : "Radio"),
        title: on.title || cfg.name, sub: on.title ? cfg.name + (on.host ? " · with " + on.host : "") : cfg.about,
        preview: { type: "card", kicker: cfg.name + " · " + cfg.area, title: cardTitle }, act: function () { toggleRadio(cfg); }
      }, {
        t: "Town + radio", s: "The town on screen, " + cfg.name + " playing", kicker: "Regular TV + " + cfg.name, title: "Town + radio",
        sub: "Watch the town with " + cfg.name + " on. ▲ ▼ town · ◀ ▶ station",
        preview: livePreview(STATION_PAGE, (town.photos[0] || {}).url), act: function () { enterTune(cfg, 0); }
      }];
      if (next.title) cells.push({ t: "Next: " + next.title, s: next.at ? "at " + next.at : "", kicker: cfg.name + " · Up next", title: next.title, sub: next.at ? "at " + next.at : "",
        preview: { type: "card", kicker: cfg.name + " · Up next", title: next.title }, act: function () { toggleRadio(cfg); } });
      if (cfg.playlist) cells.push({ t: "Playlist", s: "What's been playing", kicker: cfg.name, title: "Playlist", sub: "What's been playing on " + cfg.name,
        preview: { type: "card", kicker: cfg.name, title: "Playlist" }, act: function () { call("view", cfg.playlist); } });
      out.push({ num: String(88 + i), name: cfg.name, color: playing ? "#ff5a36" : "#7dff8a", cells: cells });
    });

    // 99 Settings: how this TV looks and behaves. OK cycles each one; saved on this TV.
    out.push({ num: String(88 + radioCfg.length), name: "Settings", color: "#ff7aa2", cells: settingCells() });

    // Keep focus on the same channel if it still exists
    var keepNum = rows[focus.r] ? rows[focus.r].num : null;
    rows = out.filter(function (r) { return r.cells.length; });
    var again = keepNum ? rows.map(function (r) { return r.num; }).indexOf(keepNum) : -1;
    focus.r = again >= 0 ? again : Math.min(focus.r, rows.length - 1);
    focus.c = Math.min(focus.c, rows[focus.r].cells.length - 1);
    renderGuide();
  }

  function launch(a) { if (call("launch", a.pkg) !== "ok") toast("Couldn't open " + a.label); }

  // Stations that don't publish a stream get looked up in the radio-browser.info directory.
  var RB = ["https://de1.api.radio-browser.info", "https://nl1.api.radio-browser.info", "https://at1.api.radio-browser.info"];
  var foundStreams = {};
  function findStreams(cfg) {
    if (!cfg.find) return Promise.resolve([]);
    if (foundStreams[cfg.code]) return Promise.resolve(foundStreams[cfg.code]);
    var q = "/json/stations/search?name=" + encodeURIComponent(cfg.find) + "&countrycode=US&hidebroken=true&order=votes&reverse=true&limit=8";
    return firstJSON(RB.map(function (b) { return b + q; })).then(function (list) {
      var want = cfg.find.toUpperCase();
      var urls = (list || []).filter(function (st) { return (st.name || "").toUpperCase().indexOf(want) >= 0 && st.lastcheckok !== 0; })
        .map(function (st) { return st.url_resolved || st.url; }).filter(Boolean);
      foundStreams[cfg.code] = urls;
      return urls;
    }).catch(function () { return []; });
  }

  function toggleRadio(cfg) {
    if (!bridge.radioPlay) { toast("Radio needs the newest app update"); return; }
    var rs = json("radioStatus", {});
    if (rs.station === cfg.name && (rs.state === "playing" || rs.state === "connecting")) {
      call("radioStop");
      toast(cfg.name + " off");
      setTimeout(buildGuide, 400);
      return;
    }
    toast("Tuning in " + cfg.name + "…");
    findStreams(cfg).then(function (extra) {
      var all = [];
      (cfg.streams || []).concat(extra).forEach(function (u) { if (all.indexOf(u) < 0) all.push(u); });
      if (!all.length) { toast("Couldn't find a stream for " + cfg.name); return; }
      call("radioPlay", cfg.name, JSON.stringify(all));
      prefs.radio = cfg.code; savePrefs();
      if (tune.on) renderTuneBar();
      setTimeout(buildGuide, 400);
      setTimeout(function () { buildGuide(); refreshNowPlaying(); }, 4000);
    });
  }

  // Each setting: a name, its choices, what each choice means, and how to apply it.
  var SETTINGS = [
    { key: "skin", name: "Skin", choices: function () { return SKINS.map(function (k) { return k.id; }); },
      label: function (v) { return (SKINS.filter(function (k) { return k.id === v; })[0] || {}).name || v; },
      about: function (v) { return (SKINS.filter(function (k) { return k.id === v; })[0] || {}).about || ""; },
      current: function () { return skin.id; }, set: function (v) { pickSkin(v); } },
    { key: "preview", name: "Little TV", choices: function () { return ["live", "stills"]; },
      label: function (v) { return v === "live" ? "Live channels" : "Photos only"; },
      about: function (v) { return v === "live" ? "Regular channels play live in the little TV" : "Lighter on the TV: photos instead of live channels"; },
      current: function () { return pref("preview", settings.preview); } },
    { key: "idle", name: "When idle", choices: function () { return ["town", "radio", "clock", "off"]; },
      label: function (v) { return v === "town" ? "Clock, then town" : v === "radio" ? "Town + radio" : v === "clock" ? "Clock only" : "Stay on the guide"; },
      about: function (v) { return v === "town" ? "Big clock after 5 minutes, Regular's town station after 15" : v === "radio" ? "After 15 minutes: the town on screen with your last radio station playing" : v === "clock" ? "Big clock after 5 minutes" : "Never change on its own"; },
      current: function () { return pref("idle", "town"); } },
    { key: "ticker", name: "Ticker", choices: function () { return ["on", "off"]; },
      label: function (v) { return v === "on" ? "On" : "Off"; },
      about: function (v) { return v === "on" ? "Town news crawl along the bottom" : "No crawl along the bottom"; },
      current: function () { return pref("ticker", "on"); } },
    { key: "note", name: "House note", choices: function () { return ["show", "hide"]; },
      label: function (v) { return v === "show" ? "Show" : "Hide"; },
      about: function () { return settings.note ? "“" + settings.note + "”" : "No note set"; },
      current: function () { return pref("note", "show"); } }
  ];

  function settingCells() {
    return SETTINGS.map(function (st) {
      var v = st.current(), label = st.label(v);
      var k = st.key === "skin" ? SKINS.filter(function (x) { return x.id === v; })[0] : null;
      return {
        t: st.name + ": " + label, s: st.about(v), kicker: "Settings · OK to change", title: st.name + ": " + label, sub: st.about(v),
        preview: k ? { type: "swatch", colors: k.colors, title: k.name } : { type: "card", kicker: "Settings · " + st.name, title: label },
        act: function () {
          var list = st.choices(), next = list[(list.indexOf(st.current()) + 1) % list.length];
          if (st.set) st.set(next);
          else { prefs[st.key] = next; savePrefs(); applyPrefs(); wake(); toast(st.name + ": " + st.label(next)); }
          buildGuide();
        }
      };
    });
  }

  var focus = { r: 0, c: 0 };
  var VISIBLE_ROWS = 5, ROW_H = 76;
  var rowsEl = document.getElementById("guide-rows");

  function renderGuide() {
    rowsEl.innerHTML = "";
    rows.forEach(function (row, ri) {
      var r = document.createElement("div");
      r.className = "g-row";
      var chan = document.createElement("div");
      chan.className = "g-chan";
      chan.style.borderLeftColor = row.color;
      chan.innerHTML = '<span class="g-num"></span><span class="g-name"></span>';
      chan.querySelector(".g-num").textContent = row.num;
      chan.querySelector(".g-name").textContent = row.name;
      var track = document.createElement("div");
      track.className = "g-track";
      var cells = document.createElement("div");
      cells.className = "g-cells";
      row.cells.forEach(function (c) {
        var el = document.createElement("div");
        el.className = "g-cell" + (c.now ? " now" : "");
        el.innerHTML = '<div class="t"></div><div class="s"></div>';
        el.querySelector(".t").textContent = c.t;
        el.querySelector(".s").textContent = c.s || "";
        cells.appendChild(el);
      });
      track.appendChild(cells);
      r.appendChild(chan);
      r.appendChild(track);
      rowsEl.appendChild(r);
      row.el = r;
      row.cellsEl = cells;
    });
    paint();
  }

  var rowStart = 0;
  function paint() {
    rows.forEach(function (row, ri) {
      var active = ri === focus.r;
      row.el.classList.toggle("active", active);
      var kids = row.cellsEl.children, idx = active ? focus.c : (row.lastC || 0);
      for (var i = 0; i < kids.length; i++) kids[i].classList.toggle("focus", active && i === focus.c);
      // Slide the row sideways: keep the focused cell in view
      var cellW = 366, trackW = 1800 - 266;
      var offset = Math.max(0, (idx + 1) * cellW - trackW + 20);
      row.cellsEl.style.transform = "translateX(" + (-offset) + "px)";
      if (active) row.lastC = focus.c;
    });
    // Slide the guide up/down: keep the focused row in the window
    if (focus.r < rowStart) rowStart = focus.r;
    if (focus.r >= rowStart + VISIBLE_ROWS) rowStart = focus.r - VISIBLE_ROWS + 1;
    rowsEl.style.transform = "translateY(" + (-rowStart * ROW_H) + "px)";
    highlight();
  }

  function cur() { return rows[focus.r] && rows[focus.r].cells[focus.c]; }

  function highlight() {
    var row = rows[focus.r], c = cur();
    if (!row || !c) return;
    setText("hl-kicker", row.num + " · " + (c.kicker || row.name));
    setText("hl-title", c.title || c.t);
    setText("hl-sub", c.sub || c.s || "");
    var n = parseInt(row.num, 10);
    var verb = row.name === "Settings" ? "change" : n === 95 ? "switch" : (n >= 88 && n < 99) ? "listen" : (n >= 20 && n <= 39) ? "open" : "watch";
    setText("hl-hint", c.act ? "OK ▸ " + verb : "");
    var chEl = document.getElementById("pv-ch");
    var chHtml = '<span class="ch-n">CHANNEL ' + parseInt(row.num, 10) + '</span><span class="ch-nm">' + esc(row.name.toUpperCase()) + "</span>";
    if (chEl.innerHTML !== chHtml) chEl.innerHTML = chHtml;
    renderStrip(row);
    showPreview(c.preview || { type: "card", kicker: row.name, title: c.title || c.t });
  }

  // The strip under the big picture: this channel's shows around the one you're on.
  function renderStrip(row) {
    var el = document.getElementById("view-strip");
    if (!el) return;
    var start = Math.max(0, Math.min(focus.c - 1, row.cells.length - 5));
    var html = '<div class="vs-chan">' + esc(row.num + " " + row.name) + "</div>";
    row.cells.slice(start, start + 5).forEach(function (c, i) {
      html += '<div class="vs-cell' + (start + i === focus.c ? " on" : "") + '"><div class="t">' + esc(c.t) + '</div><div class="s">' + esc(c.s || "") + "</div></div>";
    });
    el.innerHTML = html;
  }

  /* ---------- Town + radio: the town on screen, a radio station underneath ---------- */

  var tune = { on: false, ch: 0, barTimer: null };
  function radioByName(name) { return radioCfg.filter(function (c) { return c.name === name; })[0]; }
  function radioStation() {
    if (tune.on && tune.picked) return tune.picked;   // the one you just flipped to, while it tunes in
    var rs = json("radioStatus", {});
    if ((rs.state === "playing" || rs.state === "connecting") && radioByName(rs.station)) return radioByName(rs.station);
    var code = pref("radio", "");
    return radioCfg.filter(function (c) { return c.code === code; })[0] || radioCfg[0];
  }
  function tuneChannels() { return channelList(); }

  function enterTune(cfg, ch) {
    var station = cfg || radioStation();
    var rs = json("radioStatus", {});
    var playing = (rs.state === "playing" || rs.state === "connecting") && station && rs.station === station.name;
    if (station && !playing) toggleRadio(station);
    tune.on = true;
    tune.picked = station;
    tune.ch = ch || 0;
    closeDrawer();
    document.body.classList.add("tune");
    showTuneKeys();
    setTuneChannel(tune.ch);
    renderTuneBar();
    clearInterval(tune.barTimer);
    tune.barTimer = setInterval(renderTuneBar, 15000);
  }
  function exitTune() {
    tune.on = false;
    tune.picked = null;
    clearInterval(tune.barTimer);
    document.body.classList.remove("tune");
    highlight();   // put the little TV back to whatever the guide is on
  }
  function setTuneChannel(i) {
    var list = tuneChannels();
    tune.ch = (i + list.length) % list.length;
    pvLiveUrl = list[tune.ch].url;
    pv.live.src = list[tune.ch].url;
    only("live");
    flashTune(list[tune.ch].name);
    renderTuneBar();
  }
  function stepStation(dir) {
    if (!radioCfg.length) return;
    var cur = radioStation(), idx = Math.max(0, radioCfg.indexOf(cur));
    var next = cur, tries = 0;
    do { idx = (idx + dir + radioCfg.length) % radioCfg.length; next = radioCfg[idx]; } while (next.soon && ++tries < radioCfg.length);
    tune.picked = next;
    var rs = json("radioStatus", {});
    if (!(rs.station === next.name && (rs.state === "playing" || rs.state === "connecting"))) toggleRadio(next);
    flashTune(next.name);
    renderTuneBar(next);
  }
  function showTuneKeys() {
    document.body.classList.add("tune-keys-on");
    clearTimeout(tune.keysTimer);
    tune.keysTimer = setTimeout(function () { document.body.classList.remove("tune-keys-on"); }, 4000);
  }
  function flashTune(text) {
    showTuneKeys();
    var el = document.getElementById("tune-flash");
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove("show"); }, 1800);
  }
  function renderTuneBar(forced) {
    if (!tune.on) return;
    var st = forced || radioStation();
    var rs = json("radioStatus", {});
    var live = st ? (town.stations.filter(function (r) { return r.station === st.code; })[0] || {}) : {};
    var on = live.on || {}, next = live.next || {};
    var state = rs.state === "playing" && st && rs.station === st.name ? "On the radio" : rs.state === "failed" ? "Couldn't tune in" : "Tuning in";
    setText("tb-kicker", state === "On the radio" ? "" : state);
    setText("tb-station", st ? st.name : "Radio");
    setText("tb-show", on.title || (st ? st.area : ""));
    setText("tb-sub", on.until ? "until " + on.until : "");
  }

  /* ---------- the preview window ---------- */

  var pvTimer = null, pvLiveUrl = "";
  var pv = {
    photo: document.getElementById("pv-photo"),
    live: document.getElementById("pv-live"),
    card: document.getElementById("pv-card"),
    banner: document.getElementById("pv-banner")
  };
  function only(which) { Object.keys(pv).forEach(function (k) { pv[k].classList.toggle("on", k === which); }); }

  function showPreview(p) {
    if (tune && tune.on) return;
    clearTimeout(pvTimer);
    setText("pv-credit", p.credit || "");
    if (p.type === "live") {
      if (pvLiveUrl === p.url && pv.live.classList.contains("on")) return;
      // Show the channel's photo right away; start the live channel once you've stayed a moment.
      if (p.photo) { setPhoto(p.photo); only("photo"); } else { cardPreview("Regular TV", ""); }
      pvTimer = setTimeout(function () {
        if (pvLiveUrl !== p.url) { pvLiveUrl = p.url; pv.live.src = p.url; }
        pv.live.onload = function () { only("live"); setText("pv-credit", ""); };
        setTimeout(function () { if (pvLiveUrl === p.url) { only("live"); setText("pv-credit", ""); } }, 2500);
      }, 900);
      return;
    }
    if (pvLiveUrl) { pvLiveUrl = ""; pv.live.src = "about:blank"; }
    if (p.type === "photo" && p.url) { setPhoto(p.url); only("photo"); }
    else if (p.type === "banner" && p.src) { pv.banner.src = p.src; only("banner"); }
    else if (p.type === "swatch") {
      // A skin's three colors as stripes, with its name on top
      var c = p.colors;
      pv.card.style.background = "linear-gradient(180deg," + c[0] + " 0 68%," + c[1] + " 68% 84%," + c[2] + " 84% 100%)";
      pv.card.style.justifyContent = "flex-start";
      pv.card.style.paddingTop = "96px";
      cardPreview("Skin", p.title);
      document.getElementById("pv-card-title").style.color = c[1];
      document.getElementById("pv-card-kicker").style.color = c[2];
      return;
    }
    else cardPreview(p.kicker || "", p.title || "");
  }
  function setPhoto(url) { pv.photo.style.backgroundImage = "url('" + String(url).replace(/'/g, "%27") + "')"; }
  function cardPreview(kicker, title) { setText("pv-card-kicker", kicker); setText("pv-card-title", title); only("card"); }
  // Swatches paint the card; reset it whenever we leave one
  var _showPreview = showPreview;
  showPreview = function (p) {
    if (p.type !== "swatch") {
      pv.card.style.background = ""; pv.card.style.justifyContent = ""; pv.card.style.paddingTop = "";
      document.getElementById("pv-card-title").style.color = ""; document.getElementById("pv-card-kicker").style.color = "";
    }
    _showPreview(p);
  };

  /* ---------- the app drawer: ◀ past the first show on any channel ---------- */

  var drawer = { open: false, items: [], i: 0 };

  function drawerItems() {
    // Most-used first (the TV's recent list), then the usual suspects, then A-Z.
    var recentOrder = json("recent", []).map(function (a) { return a.pkg; });
    var apps = sortApps(json("apps", [])).sort(function (a, b) {
      var ra = recentOrder.indexOf(a.pkg), rb = recentOrder.indexOf(b.pkg);
      if (ra >= 0 || rb >= 0) return (ra < 0 ? 999 : ra) - (rb < 0 ? 999 : rb);
      return 0;
    });
    var items = apps.map(function (a) {
      return { kind: "app", label: a.label, art: art(a.pkg), act: function () { launch(a); } };
    });
    json("inputs", []).forEach(function (inp) {
      items.push({ kind: "input", label: inp.label, act: function () { var r = call("openInput", inp.id); if (r !== "ok") toast("Couldn't switch to " + inp.label); } });
    });
    items.push({ kind: "input", label: "Fire TV settings", act: function () { if (call("settings") !== "ok") toast("Couldn't open settings"); } });
    return items;
  }

  function openDrawer() {
    drawer.items = drawerItems();
    drawer.i = 0;
    drawer.open = true;
    renderDrawer();
    document.body.classList.add("drawer-open");
  }
  function closeDrawer() {
    drawer.open = false;
    document.body.classList.remove("drawer-open");
  }
  function renderDrawer() {
    var el = document.getElementById("drawer-grid");
    var html = "", sawInput = false;
    drawer.items.forEach(function (it, i) {
      if (it.kind === "input" && !sawInput) { sawInput = true; html += '<div class="dr-label">Inputs</div>'; }
      var img = it.art && it.art.indexOf("banner:") === 0 ? it.art.slice(7) : it.art && it.art.indexOf("icon:") === 0 ? it.art.slice(5) : "";
      var banner = it.art && it.art.indexOf("banner:") === 0;
      html += '<div class="dr-item ' + it.kind + (banner ? " banner" : "") + (i === drawer.i ? " focus" : "") + '" data-i="' + i + '">' +
        (img ? '<img src="' + img + '" alt="">' : "") + (banner ? "" : '<span>' + esc(it.label) + "</span>") + "</div>";
    });
    el.innerHTML = html;
    var f = el.querySelector(".dr-item.focus");
    if (f) {
      // keep the focused tile in view
      var top = f.offsetTop, h = f.offsetHeight, view = el.parentNode.clientHeight;
      var shift = Math.max(0, top + h - view + 40);
      el.style.transform = "translateY(" + (-shift) + "px)";
    }
    var it = drawer.items[drawer.i];
    setText("drawer-name", it ? it.label : "");
  }
  // Arrow moves follow where the tiles actually sit (Inputs start on their own row).
  function drawerMove(dx, dy) {
    var els = Array.prototype.slice.call(document.querySelectorAll("#drawer-grid .dr-item"));
    var cur = els[drawer.i];
    if (!cur) return false;
    var x = cur.offsetLeft, y = cur.offsetTop, best = -1, bestD = Infinity;
    els.forEach(function (el, i) {
      if (i === drawer.i) return;
      var ex = el.offsetLeft, ey = el.offsetTop;
      if (dx && (ey !== y || (dx > 0 ? ex <= x : ex >= x))) return;
      if (dy && (dy > 0 ? ey <= y : ey >= y)) return;
      var d = dx ? Math.abs(ex - x) : Math.abs(ey - y) * 10 + Math.abs(ex - x);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best < 0) return false;
    drawer.i = best;
    renderDrawer();
    return true;
  }

  /* ---------- keys ---------- */

  function move(dr, dc) {
    if (!rows.length) return;
    if (dr) {
      var nr = focus.r + dr;
      if (nr < 0 || nr >= rows.length) return;
      focus.r = nr;
      focus.c = Math.min(rows[nr].lastC || 0, rows[nr].cells.length - 1);
    } else {
      var nc = focus.c + dc;
      if (nc < 0 || nc >= rows[focus.r].cells.length) return;
      focus.c = nc;
    }
    paint();
  }

  // "Inside the preview": the picture goes big, the guide steps aside.
  var viewMode = false;
  function setView(on) {
    viewMode = on;
    document.body.classList.toggle("view", on);
  }

  document.addEventListener("keydown", function (e) {
    if (wake()) { e.preventDefault(); return; }
    var k = e.key || e.keyCode;
    if (tune.on) {
      switch (k) {
        case "ArrowUp": case 38: setTuneChannel(tune.ch - 1); break;
        case "ArrowDown": case 40: setTuneChannel(tune.ch + 1); break;
        case "ArrowLeft": case 37: stepStation(-1); break;
        case "ArrowRight": case 39: stepStation(1); break;
        case "Enter": case 13: case " ": document.body.classList.toggle("tune-quiet"); break;   // hide/show the bar
        case "Escape": case "Backspace": case "GoBack": case 27: case 8: exitTune(); break;
        default: return;
      }
      e.preventDefault();
      return;
    }
    if (drawer.open) {
      switch (k) {
        case "ArrowLeft": case 37: drawerMove(-1, 0); break;
        case "ArrowRight": case 39: if (!drawerMove(1, 0)) closeDrawer(); break;   // past the right edge: back to the guide
        case "ArrowUp": case 38: drawerMove(0, -1); break;
        case "ArrowDown": case 40: drawerMove(0, 1); break;
        case "Enter": case 13: case " ": var it = drawer.items[drawer.i]; closeDrawer(); if (it) it.act(); break;
        case "Escape": case "Backspace": case "GoBack": case 27: case 8: closeDrawer(); break;
        default: return;
      }
      e.preventDefault();
      return;
    }
    switch (k) {
      case "ArrowLeft": case 37:
        if (focus.c === 0 && !viewMode) openDrawer();   // ◀ past the first show: apps
        else move(0, -1);
        break;
      case "ArrowRight": case 39: move(0, 1); break;
      case "ArrowUp": case 38:
        if (!viewMode && focus.r === 0) setView(true);   // up from the top row: step into the picture
        else move(-1, 0);
        break;
      case "ArrowDown": case 40: move(1, 0); break;
      case "Enter": case 13: case " ": var c = cur(); if (c && c.act) c.act(); break;
      case "Escape": case "Backspace": case "GoBack": case 27: case 8:
        if (viewMode) setView(false); else return;
        break;
      default: return;
    }
    e.preventDefault();
  });

  /* ---------- idle ---------- */

  var idleTimer, stationTimer;
  function wake() {
    var wasIdle = document.body.classList.contains("idle");
    document.body.classList.remove("idle");
    clearTimeout(idleTimer);
    clearTimeout(stationTimer);
    var idle = pref("idle", "town");
    if (idle !== "off") idleTimer = setTimeout(function () { document.body.classList.add("idle"); }, IDLE_MS);
    if (inShell && (idle === "town" || idle === "radio") && !tune.on) {
      stationTimer = setTimeout(function () {
        if (json("nowPlaying", {}).state === "playing") return;
        if (idle === "radio") { document.body.classList.remove("idle"); enterTune(null, 0); }
        else call("view", STATION_PAGE);
      }, STATION_AFTER_MS);
    }
    return wasIdle;
  }

  // Called by the Android shell (and the phone remote).
  window.houseSkin = function (id) { if (SKINS.some(function (k) { return k.id === id; })) pickSkin(id); };
  window.houseBack = function () {
    if (wake()) return;
    if (tune.on) { exitTune(); return; }
    if (drawer.open) { closeDrawer(); return; }
    if (viewMode) { setView(false); return; }
    focus.r = 0; focus.c = 0; paint();
  };
  window.houseHome = function () { wake(); if (tune.on) exitTune(); closeDrawer(); setView(false); focus.r = 0; focus.c = 0; paint(); };
  window.houseResume = function () { wake(); artCache = {}; buildGuide(); tick(); refreshNowPlaying(); };

  /* ---------- helpers ---------- */

  function getJSON(url) {
    return fetch(url, { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  }
  function setText(id, s) { var el = document.getElementById(id); if (el && el.textContent !== s) el.textContent = s; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  var toastTimer;
  function toast(msg) {
    var el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 2600);
  }

  /* ---------- start ---------- */

  applySkin(chosenSkin() || "guide");
  applyPrefs();
  wake();
  buildGuide();
  loadSettings();
  refreshConditions();
  loadTown();
  loadLive();
  loadRadio();
  refreshNowPlaying();
  refreshRemote();
  setInterval(refreshConditions, 15 * 60 * 1000);
  setInterval(loadSettings, 10 * 60 * 1000);
  setInterval(loadTown, 10 * 60 * 1000);
  setInterval(refreshNowPlaying, 5000);
  setInterval(refreshRemote, 60 * 1000);
  setInterval(function () { if (!document.body.classList.contains("idle")) buildGuide(); }, 2 * 60 * 1000);
})();
