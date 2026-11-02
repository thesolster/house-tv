/* House TV: the house guide channel.
 * Top half: a live preview of whatever you're on, and what it is.
 * Bottom half: a guide where every row is a channel (your shows, the town, tonight,
 * Regular's channels, apps, inputs).
 * Runs inside the House TV Android shell (window.HouseTV) or in a browser with sample data. */
(function () {
  "use strict";

  var PAGE_VERSION = "page 14";
  var SANTA_CRUZ = { lat: 36.9741, lon: -122.0308, tz: "America/Los_Angeles" };
  var TIDE_STATION = "9413745"; // NOAA, Santa Cruz
  var IDLE_MS = 5 * 60 * 1000;
  var STATION_AFTER_MS = 15 * 60 * 1000;
  var REGULAR_TV = ["https://regular-tv-channels.vercel.app", "https://tv.regular.sc"];
  var REGULAR_FEED = ["https://regular.sc/api/channel-feed", "https://regular-agent.vercel.app/api/channel-feed"];
  var STATION_PAGE = REGULAR_TV[0] + "/tv/town";

  var PREFERRED = [
    "com.netflix.ninja", "com.amazon.firetv.youtube", "com.google.android.youtube.tv",
    "com.amazon.avod", "com.disney.disneyplus", "com.hulu.plus", "com.wbd.stream",
    "com.hbo.hbonow", "com.apple.atve.amazon.appletv", "com.peacocktv.peacockandroid",
    "com.spotify.tv.android", "com.plexapp.android", "tv.pluto.android"
  ];
  var HIDDEN = [
    "com.amazon.tv.launcher", "com.amazon.tv.settings.v2", "com.amazon.venezia",
    "com.amazon.device.software.ota", "com.amazon.tv.oobe", "com.amazon.tv.legal.notices"
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
  function loadSettings() {
    return getJSON("ticker.json?t=" + Date.now()).then(function (j) {
      settings.theme = j.theme === "retro" ? "guide" : (j.theme || "modern");
      settings.note = j.note || "";
      settings.lines = (j.lines || []).filter(Boolean);
      settings.preview = j.preview || "live";
      applySkin(chosenSkin() || settings.theme);
      setText("note", settings.note ? "♥ " + settings.note : "");
      setText("ambient-note", settings.note ? "♥ " + settings.note : "");
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
  function chosenSkin() { try { return localStorage.getItem("house-skin") || ""; } catch (e) { return ""; } }
  function applySkin(id) {
    var found = SKINS.filter(function (k) { return k.id === id; })[0] || SKINS[4];
    skin = found;
    SKINS.forEach(function (k) { document.body.classList.toggle("skin-" + k.id, k.id === found.id); });
    tick();
  }
  function pickSkin(id) {
    try { localStorage.setItem("house-skin", id); } catch (e) {}
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

  var town = { events: [], alerts: [], photos: [], radio: [], ticker: [], channels: [] };

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
  function refreshNowPlaying() {
    np = json("nowPlaying", {});
    var box = document.getElementById("np");
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
    return settings.preview === "live" && inShell ? { type: "live", url: url, photo: photo, credit: credit } : { type: "photo", url: photo, credit: credit };
  }

  var rows = [];
  function buildGuide() {
    var out = [];

    // 02 Your shows: what you watched, then the apps you've used
    var shows = [];
    (json("history", {}).items || []).slice(0, 8).forEach(function (w) {
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
    json("recent", []).slice(0, 6).forEach(function (a) {
      shows.push({ t: a.label, s: "Recent app", kicker: "Recent app", title: a.label, sub: "Opens " + a.label, preview: appPreview(a.pkg, a.label), act: function () { launch(a); } });
    });
    if (!shows.length) shows.push({ t: "Nothing yet", s: "Watch something and it shows up here", title: "Your shows", sub: "Watch something and it shows up here", preview: { type: "card", kicker: "Your shows", title: "Nothing yet" } });
    out.push({ num: "02", name: "Your shows", color: "#ffd23f", cells: shows });

    // 03 Santa Cruz: the town station and the cams
    var photo0 = town.photos[0] || {};
    var sc = [{ t: "Santa Cruz right now", s: "Regular TV · all channels", now: true, kicker: "Regular TV · Channel 1", title: "Santa Cruz right now",
      sub: "The whole town's channels, mixed by time of day", preview: livePreview(STATION_PAGE, photo0.url, photo0.credit), act: function () { watchChannel(0); } }];
    liveItems.forEach(function (it) {
      sc.push({ t: it.title, s: it.sub || "Live cam", now: true, kicker: "Live", title: it.title, sub: it.sub || "",
        preview: { type: "card", kicker: "Live cam", title: it.title },
        act: function () {
          var r = it.kind === "youtube" ? call("openUrl", it.url, "") : call("view", it.url);
          if (r !== "ok") toast("Couldn't open " + it.title);
        } });
    });
    out.push({ num: "03", name: "Santa Cruz", color: "#5bc4e3", cells: sc });

    // 04 Tonight
    if (town.events.length) {
      out.push({ num: "04", name: "Tonight", color: "#ec5b70", cells: town.events.slice(0, 10).map(function (e) {
        return { t: e.title, s: (e.now ? "On now" : e.time || "Tonight") + (e.place ? " · " + e.place : ""), now: e.now,
          kicker: e.now ? "On now" : e.time || "Tonight", title: e.title, sub: e.place || "",
          preview: e.photo ? { type: "photo", url: e.photo, credit: e.credit } : { type: "card", kicker: "Tonight", title: e.title },
          act: function () { if (e.url && call("view", e.url) !== "ok") toast("Couldn't open " + (e.place || "it")); } };
      }) });
    }

    // 05+ Regular's channels, one row each
    var rowNum = 5;
    town.channels.forEach(function (ch, i) {
      if (ch.id === "tonight" && town.events.length) return; // already channel 04
      var num = String(rowNum++).padStart(2, "0");
      var pv = livePreview(ch.url, ch.photo, ch.credit);
      var cells = [{ t: "Watch " + ch.name, s: ch.about, now: true, kicker: "Regular TV · " + ch.name, title: ch.name, sub: ch.about, preview: pv, act: function () { watchChannel(i + 1); } }];
      ch.items.slice(0, 6).forEach(function (it) {
        cells.push({ t: it.t, s: it.s, now: it.now, kicker: ch.name, title: it.t, sub: it.s,
          preview: it.photo ? { type: "photo", url: it.photo } : pv, act: function () { watchChannel(i + 1); } });
      });
      out.push({ num: num, name: ch.name, color: ch.color, cells: cells });
    });

    // 20 Apps, 21 Inputs
    var apps = sortApps(json("apps", []));
    out.push({ num: "20", name: "Apps", color: "#c9d2ff", cells: apps.map(function (a) {
      return { t: a.label, s: "App", kicker: "App", title: a.label, sub: "Opens " + a.label, preview: appPreview(a.pkg, a.label), act: function () { launch(a); } };
    }) });
    var inputs = json("inputs", []).map(function (i) {
      return { t: i.label, s: "Input", kicker: "Input", title: i.label, sub: "Switch the TV to " + i.label, preview: { type: "card", kicker: "Input", title: i.label },
        act: function () { var r = call("openInput", i.id); if (r !== "ok") toast("Couldn't switch to " + i.label + " (" + r + ")"); } };
    });
    inputs.push({ t: "Settings", s: "Fire TV", kicker: "Settings", title: "Settings", sub: "Fire TV settings", preview: { type: "card", kicker: "Fire TV", title: "Settings" },
      act: function () { if (call("settings") !== "ok") toast("Couldn't open settings"); } });
    out.push({ num: "21", name: "Inputs", color: "#c9d2ff", cells: inputs });

    // 22 Skins: change how the whole screen looks; the TV remembers your pick
    out.push({ num: "22", name: "Skins", color: "#ff7aa2", cells: SKINS.map(function (k) {
      return { t: k.name + (k.id === skin.id ? " ✓" : ""), s: k.about, kicker: "Skin" + (k.id === skin.id ? " · on now" : ""), title: k.name, sub: k.about,
        preview: { type: "swatch", colors: k.colors, title: k.name }, act: function () { pickSkin(k.id); } };
    }) });

    // Keep focus on the same channel if it still exists
    var keepNum = rows[focus.r] ? rows[focus.r].num : null;
    rows = out.filter(function (r) { return r.cells.length; });
    var again = keepNum ? rows.map(function (r) { return r.num; }).indexOf(keepNum) : -1;
    focus.r = again >= 0 ? again : Math.min(focus.r, rows.length - 1);
    focus.c = Math.min(focus.c, rows[focus.r].cells.length - 1);
    renderGuide();
  }

  function launch(a) { if (call("launch", a.pkg) !== "ok") toast("Couldn't open " + a.label); }

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
    setText("hl-hint", c.act ? "OK ▸ " + (row.num === "20" ? "open" : row.num === "21" ? "switch" : row.num === "22" ? "use this skin" : "watch") : "");
    setText("pv-ch", "CH " + row.num);
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
    switch (e.key || e.keyCode) {
      case "ArrowLeft": case 37: move(0, -1); break;
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
    idleTimer = setTimeout(function () { document.body.classList.add("idle"); }, IDLE_MS);
    if (inShell) {
      stationTimer = setTimeout(function () {
        if (json("nowPlaying", {}).state !== "playing") call("view", STATION_PAGE);
      }, STATION_AFTER_MS);
    }
    return wasIdle;
  }

  // Called by the Android shell.
  window.houseBack = function () {
    if (wake()) return;
    if (viewMode) { setView(false); return; }
    focus.r = 0; focus.c = 0; paint();
  };
  window.houseHome = function () { wake(); setView(false); focus.r = 0; focus.c = 0; paint(); };
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
  wake();
  buildGuide();
  loadSettings();
  refreshConditions();
  loadTown();
  loadLive();
  refreshNowPlaying();
  refreshRemote();
  setInterval(refreshConditions, 15 * 60 * 1000);
  setInterval(loadSettings, 10 * 60 * 1000);
  setInterval(loadTown, 10 * 60 * 1000);
  setInterval(refreshNowPlaying, 5000);
  setInterval(refreshRemote, 60 * 1000);
  setInterval(function () { if (!document.body.classList.contains("idle")) buildGuide(); }, 2 * 60 * 1000);
})();
