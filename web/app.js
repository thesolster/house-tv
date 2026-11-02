/* House TV home screen.
 * Runs inside the House TV Android shell (window.HouseTV bridge) or in any
 * browser for previewing, where the bridge is faked with sample apps. */
(function () {
  "use strict";

  var SANTA_CRUZ = { lat: 36.9741, lon: -122.0308, tz: "America/Los_Angeles" };
  var TIDE_STATION = "9413745"; // NOAA, Santa Cruz
  var IDLE_MS = 5 * 60 * 1000;

  // Apps we want first, in this order, if they're installed. Everything else follows A-Z.
  var PREFERRED = [
    "com.netflix.ninja", "com.amazon.firetv.youtube", "com.google.android.youtube.tv",
    "com.amazon.avod", "com.disney.disneyplus", "com.hulu.plus", "com.wbd.stream",
    "com.hbo.hbonow", "com.apple.atve.amazon.appletv", "com.peacocktv.peacockandroid",
    "com.spotify.tv.android", "com.plexapp.android", "tv.pluto.android"
  ];
  // Amazon plumbing that shows up as "apps" but isn't something you'd open from the couch.
  var HIDDEN = [
    "com.amazon.tv.launcher", "com.amazon.tv.settings.v2", "com.amazon.venezia",
    "com.amazon.device.software.ota", "com.amazon.tv.oobe", "com.amazon.tv.legal.notices"
  ];

  /* ---------- bridge ---------- */

  var bridge = window.HouseTV || {
    // Browser preview stand-in.
    apps: function () {
      return JSON.stringify([
        { pkg: "com.netflix.ninja", label: "Netflix" },
        { pkg: "com.amazon.firetv.youtube", label: "YouTube" },
        { pkg: "com.amazon.avod", label: "Prime Video" },
        { pkg: "com.disney.disneyplus", label: "Disney+" },
        { pkg: "com.spotify.tv.android", label: "Spotify" },
        { pkg: "com.plexapp.android", label: "Plex" }
      ]);
    },
    icon: function () { return ""; },
    launch: function (pkg) { toast("Would open " + pkg); return "ok"; },
    inputs: function () {
      return JSON.stringify([
        { id: "hdmi1", label: "HDMI 1" }, { id: "hdmi2", label: "HDMI 2" },
        { id: "hdmi3", label: "HDMI 3" }, { id: "tuner", label: "Antenna" }
      ]);
    },
    openInput: function (id) { toast("Would switch to " + id); return "ok"; },
    settings: function () { toast("Would open settings"); return "ok"; },
    version: function () { return "browser preview"; },
    recent: function () {
      return JSON.stringify([{ pkg: "com.netflix.ninja", label: "Netflix" }, { pkg: "com.amazon.firetv.youtube", label: "YouTube" }]);
    },
    nowPlaying: function () {
      return JSON.stringify({ access: true, pkg: "com.netflix.ninja", app: "Netflix", title: "The Sopranos", subtitle: "S2:E4 · Commendatori", state: "playing", position: 1500000, duration: 3300000 });
    },
    media: function (a) { toast("Would " + a); return "ok"; },
    openUrl: function (u) { toast("Would open " + u); return "ok"; },
    view: function (u) { toast("Would show " + u); return "ok"; },
    status: function () { return JSON.stringify({ usage: true, nowPlaying: true, remote: "http://192.168.1.42:8765/?t=preview" }); }
  };

  function call(name) {
    try {
      var args = Array.prototype.slice.call(arguments, 1);
      return bridge[name].apply(bridge, args);
    } catch (e) { return "error: " + e.message; }
  }

  /* ---------- stage scaling ---------- */

  // The TV can report its size late, so measure again on load, on resize,
  // and every couple of seconds; only touch the page when the size changed.
  var stage = document.getElementById("stage");
  var lastFit = "";
  function fit() {
    var de = document.documentElement;
    var w = de.clientWidth || window.innerWidth;
    var h = de.clientHeight || window.innerHeight;
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

  // Pick up new versions of this page without anyone touching the TV.
  var fingerprint = null;
  function checkForUpdate() {
    if (location.protocol === "file:") return;
    Promise.all(["app.js", "style.css", "index.html"].map(function (f) {
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

  // Small stamp so we can tell which copy is on screen.
  var PAGE_VERSION = "page 5";
  var appVersion = window.HouseTV ? call("version") : "browser";
  setTimeout(function () {
    setText("build", PAGE_VERSION + " · app " + appVersion + " · " +
      document.documentElement.clientWidth + "×" + document.documentElement.clientHeight);
  }, 1500);

  /* ---------- clock ---------- */

  function fmtTime(d) {
    var h = d.getHours(), m = d.getMinutes();
    var h12 = h % 12 || 12;
    return h12 + ":" + (m < 10 ? "0" : "") + m;
  }
  function fmtShortTime(iso) {
    var d = new Date(iso);
    return fmtTime(d) + (d.getHours() < 12 ? "am" : "pm");
  }
  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  function greetingFor(h) {
    if (h < 5) return "Late night.";
    if (h < 12) return "Good morning.";
    if (h < 17) return "Good afternoon.";
    return "Good evening.";
  }

  function tick() {
    var d = new Date();
    var t = fmtTime(d);
    var date = DAYS[d.getDay()] + ", " + MONTHS[d.getMonth()] + " " + d.getDate();
    setText("clock", t);
    setText("ambient-clock", t);
    setText("date", date);
    setText("ambient-date", date);
    setText("greeting", greetingFor(d.getHours()));
  }
  setInterval(tick, 1000 * 10);
  tick();

  /* ---------- weather, sunset, tides ---------- */

  var WMO = {
    0: "clear", 1: "mostly clear", 2: "partly cloudy", 3: "cloudy", 45: "foggy", 48: "foggy",
    51: "drizzly", 53: "drizzly", 55: "drizzly", 61: "light rain", 63: "rain", 65: "heavy rain",
    71: "light snow", 73: "snow", 75: "heavy snow", 80: "showers", 81: "showers", 82: "heavy showers",
    95: "thunderstorms", 96: "thunderstorms", 99: "thunderstorms"
  };

  var conditions = { weather: null, tides: [] };

  function loadWeather() {
    var url = "https://api.open-meteo.com/v1/forecast?latitude=" + SANTA_CRUZ.lat + "&longitude=" + SANTA_CRUZ.lon +
      "&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,sunset,sunrise" +
      "&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=" + encodeURIComponent(SANTA_CRUZ.tz) + "&forecast_days=2";
    return getJSON(url).then(function (j) {
      conditions.weather = {
        temp: Math.round(j.current.temperature_2m),
        sky: WMO[j.current.weather_code] || "",
        wind: Math.round(j.current.wind_speed_10m),
        hi: Math.round(j.daily.temperature_2m_max[0]),
        lo: Math.round(j.daily.temperature_2m_min[0]),
        sunset: j.daily.sunset[0],
        sunrise: j.daily.sunrise[1],
        tomorrowHi: Math.round(j.daily.temperature_2m_max[1])
      };
    }).catch(function () {});
  }

  function ymd(d) {
    return d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");
  }

  function loadTides() {
    var url = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&application=house_tv" +
      "&begin_date=" + ymd(new Date()) + "&range=48&datum=MLLW&station=" + TIDE_STATION +
      "&time_zone=lst_ldt&units=english&interval=hilo&format=json";
    return getJSON(url).then(function (j) {
      var now = Date.now();
      conditions.tides = (j.predictions || []).map(function (p) {
        return { at: new Date(p.t.replace(" ", "T")), high: p.type === "H", ft: parseFloat(p.v) };
      }).filter(function (p) { return p.at.getTime() > now; }).slice(0, 2);
    }).catch(function () {});
  }

  function summaryLine() {
    var w = conditions.weather;
    if (!w) return "";
    var parts = [w.temp + "° and " + w.sky + " in Santa Cruz."];
    var now = new Date();
    var sunset = new Date(w.sunset);
    if (sunset > now) parts.push("Sunset at " + fmtShortTime(w.sunset) + ".");
    else parts.push("Tomorrow, a high of " + w.tomorrowHi + "°.");
    return parts.join(" ");
  }

  function renderSummary() {
    var s = summaryLine();
    setText("summary", s);
    setText("ambient-summary", s);
    buildTicker();
  }

  function refreshConditions() {
    Promise.all([loadWeather(), loadTides()]).then(renderSummary);
  }
  refreshConditions();
  setInterval(refreshConditions, 15 * 60 * 1000);

  /* ---------- ticker ---------- */

  var extraLines = [];

  function loadTickerFile() {
    return getJSON("ticker.json?t=" + Date.now()).then(function (j) {
      extraLines = (j.lines || []).filter(Boolean);
      buildTicker();
    }).catch(function () {});
  }
  loadTickerFile();
  setInterval(loadTickerFile, 10 * 60 * 1000);

  var strip = document.getElementById("strip");
  var tickerX = 0, stripWidth = 0;

  function buildTicker() {
    var items = [];
    var w = conditions.weather;
    if (w) {
      items.push("<i>Now</i> " + w.temp + "° " + esc(w.sky) + ", wind " + w.wind + " mph");
      items.push("<i>Today</i> high " + w.hi + "°, low " + w.lo + "°");
      if (new Date(w.sunset) > new Date()) items.push("<i>Sunset</i> " + fmtShortTime(w.sunset));
      items.push("<i>Sunrise</i> " + fmtShortTime(w.sunrise));
    }
    conditions.tides.forEach(function (t) {
      items.push("<i>" + (t.high ? "High tide" : "Low tide") + "</i> " + fmtShortTime(t.at) + ", " + t.ft.toFixed(1) + " ft");
    });
    extraLines.forEach(function (l) { items.push(esc(l)); });
    if (!items.length) items.push("Santa Cruz");

    var html = items.map(function (s) { return "<span>" + s + "</span><span>·</span>"; }).join("");
    strip.innerHTML = html + html; // doubled so the loop is seamless
    stripWidth = strip.scrollWidth / 2;
  }

  var lastFrame = 0;
  function runTicker(ts) {
    if (lastFrame) {
      var dt = Math.min(ts - lastFrame, 100);
      tickerX -= dt * 0.09; // px per ms
      if (stripWidth && -tickerX >= stripWidth) tickerX += stripWidth;
      strip.style.transform = "translateX(" + tickerX + "px)";
    }
    lastFrame = ts;
    requestAnimationFrame(runTicker);
  }
  requestAnimationFrame(runTicker);

  /* ---------- now playing ---------- */

  function fmtDur(ms) {
    var m = Math.floor(ms / 60000), h = Math.floor(m / 60);
    return h ? h + "h " + (m % 60) + "m" : m + "m";
  }

  function refreshNowPlaying() {
    var np = {};
    try { np = JSON.parse(call("nowPlaying") || "{}"); } catch (e) {}
    var card = document.getElementById("np");
    if (np.error || np.access === false) {
      // Show why, instead of hiding quietly (helps us debug on the TV).
      card.classList.remove("hidden");
      setText("np-app", "Now playing");
      setText("np-title", np.access === false && !np.error ? "Needs the one-time setup" : "Can't read it yet");
      setText("np-sub", np.error ? String(np.error) : "");
      document.getElementById("np-fill").style.width = "0";
      setText("np-state", "");
      return;
    }
    if (!np.title && !np.app) { card.classList.add("hidden"); return; }
    card.classList.remove("hidden");
    setText("np-app", np.state === "playing" ? "Now playing · " + (np.app || "") : (np.app || ""));
    setText("np-title", np.title || np.app || "");
    setText("np-sub", np.subtitle || "");
    var pct = np.duration > 0 ? Math.min(100, 100 * np.position / np.duration) : 0;
    document.getElementById("np-fill").style.width = pct + "%";
    var left = np.duration > 0 ? fmtDur(np.duration - np.position) + " left" : "";
    setText("np-state", (np.state === "paused" ? "Paused" : np.state === "playing" ? "Playing" : "") + (left ? " · " + left : "") + " · ⏯ on the remote");
  }
  refreshNowPlaying();
  setInterval(refreshNowPlaying, 5000);

  /* ---------- phone remote QR ---------- */

  var remoteUrl = "";
  function refreshRemote() {
    var st = {};
    try { st = JSON.parse(call("status") || "{}"); } catch (e) {}
    var card = document.getElementById("remote");
    if (!st.remote || typeof qrcode === "undefined") { card.classList.add("hidden"); return; }
    if (st.remote === remoteUrl) return;
    remoteUrl = st.remote;
    var qr = qrcode(0, "M");
    qr.addData(remoteUrl);
    qr.make();
    document.getElementById("qr").innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    card.classList.remove("hidden");
  }
  refreshRemote();
  setInterval(refreshRemote, 60 * 1000);

  /* ---------- rows ---------- */

  var rows = []; // [{el: tilesEl, section: sectionEl, tiles: [tileEl...]}]
  var focus = { r: 0, c: 0 };
  var liveItems = [];

  function sortApps(list) {
    var seen = {};
    list = list.filter(function (a) {
      if (seen[a.pkg] || HIDDEN.indexOf(a.pkg) >= 0) return false;
      seen[a.pkg] = true;
      return true;
    });
    return list.sort(function (a, b) {
      var ia = PREFERRED.indexOf(a.pkg), ib = PREFERRED.indexOf(b.pkg);
      if (ia >= 0 || ib >= 0) return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
      return a.label.localeCompare(b.label);
    });
  }

  function appTile(app) {
    var t = document.createElement("div");
    t.className = "tile";
    var art = call("icon", app.pkg);
    var isBanner = art && art.indexOf("banner:") === 0;
    if (isBanner) {
      t.innerHTML = '<img alt="">';
      t.firstChild.src = art.slice(7);
    } else {
      t.innerHTML = '<div class="icon-wrap">' + (art ? '<img alt="">' : "") + '<div class="name"></div></div>';
      if (art) t.querySelector("img").src = art.replace(/^icon:/, "");
      t.querySelector(".name").textContent = app.label;
    }
    t.onActivate = function () {
      var r = call("launch", app.pkg);
      if (r !== "ok") toast("Couldn't open " + app.label);
    };
    return t;
  }

  function textTile(name, sub, onActivate, live) {
    var t = document.createElement("div");
    t.className = "tile" + (live ? "" : " small");
    t.innerHTML = (live ? '<div class="live-dot">LIVE</div>' : "") +
      '<div class="icon-wrap"><div class="name"></div><div class="sub"></div></div>';
    t.querySelector(".name").textContent = name;
    t.querySelector(".sub").textContent = sub || "";
    t.onActivate = onActivate;
    return t;
  }

  function liveTile(item) {
    return textTile(item.title, item.sub, function () {
      var r = item.kind === "youtube" ? call("openUrl", item.url, "") : call("view", item.url);
      if (r !== "ok") toast("Couldn't open " + item.title + (r ? " (" + r + ")" : ""));
    }, true);
  }

  function loadLive() {
    return getJSON("live.json?t=" + Date.now()).then(function (j) {
      liveItems = j.items || [];
      buildRows();
    }).catch(function () {});
  }

  function fill(id, tiles) {
    var el = document.getElementById(id);
    el.innerHTML = "";
    tiles.forEach(function (t) { el.appendChild(t); });
    document.getElementById("row-" + id).classList.toggle("hidden", !tiles.length);
  }

  function buildRows() {
    var keep = rows[focus.r] ? rows[focus.r].el.id : null;

    var recent = [];
    try { recent = JSON.parse(call("recent") || "[]"); } catch (e) {}
    fill("recent", recent.slice(0, 8).map(appTile));

    fill("live", liveItems.map(liveTile));

    var apps = [];
    try { apps = sortApps(JSON.parse(call("apps") || "[]")); } catch (e) {}
    fill("apps", apps.map(appTile));

    var inputs = [];
    try { inputs = JSON.parse(call("inputs") || "[]"); } catch (e) {}
    var inputTiles = inputs.map(function (i) {
      return textTile(i.label, "Input", function () {
        var r = call("openInput", i.id);
        if (r !== "ok") toast("Couldn't switch to " + i.label + (r ? " (" + r + ")" : ""));
      });
    });
    inputTiles.push(textTile("Settings", "Fire TV", function () {
      if (call("settings") !== "ok") toast("Couldn't open settings");
    }));
    fill("inputs", inputTiles);

    rows = ["recent", "live", "apps", "inputs"].map(function (id) {
      var el = document.getElementById(id);
      return { el: el, section: document.getElementById("row-" + id), tiles: Array.prototype.slice.call(el.querySelectorAll(".tile")) };
    }).filter(function (r) { return r.tiles.length; });

    var again = keep ? rows.map(function (r) { return r.el.id; }).indexOf(keep) : -1;
    focus.r = again >= 0 ? again : Math.min(focus.r, rows.length - 1);
    focus.c = Math.min(focus.c, rows[focus.r].tiles.length - 1);
    paintFocus();
  }

  function paintFocus() {
    rows.forEach(function (row, ri) {
      row.tiles.forEach(function (t, ci) {
        t.classList.toggle("focus", ri === focus.r && ci === focus.c);
      });
      // Slide the row sideways so the focused tile stays on screen.
      var idx = ri === focus.r ? focus.c : (row.lastC || 0);
      var tile = row.tiles[idx];
      var visible = 1920 - 96 * 2;
      var offset = 0;
      if (tile) {
        var right = tile.offsetLeft + tile.offsetWidth;
        if (right > visible - 40) offset = right - visible + 40;
      }
      row.el.style.transform = "translateX(" + (-offset) + "px)";
      if (ri === focus.r) row.lastC = focus.c;
    });
    // Slide the list up so the focused row stays in the window above the ticker.
    var cur = rows[focus.r];
    if (cur) {
      var windowH = 1080 - 440 - 76;
      var top = cur.section.offsetTop, bottom = top + cur.section.offsetHeight + 30;
      var shift = Math.max(0, bottom - windowH);
      if (focus.r === 0) shift = 0;
      document.getElementById("rows").style.transform = "translateY(" + (-shift) + "px)";
    }
  }

  function move(dr, dc) {
    if (!rows.length) return;
    if (dr) {
      var nr = focus.r + dr;
      if (nr < 0 || nr >= rows.length) return;
      focus.r = nr;
      focus.c = Math.min(rows[nr].lastC || 0, rows[nr].tiles.length - 1);
    } else {
      var nc = focus.c + dc;
      if (nc < 0 || nc >= rows[focus.r].tiles.length) return;
      focus.c = nc;
    }
    paintFocus();
  }

  function activate() {
    var t = rows[focus.r] && rows[focus.r].tiles[focus.c];
    if (t && t.onActivate) t.onActivate();
  }

  /* ---------- idle / ambient ---------- */

  var idleTimer;
  function wake() {
    var wasIdle = document.body.classList.contains("idle");
    document.body.classList.remove("idle");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () { document.body.classList.add("idle"); }, IDLE_MS);
    return wasIdle;
  }
  wake();

  /* ---------- keys ---------- */

  document.addEventListener("keydown", function (e) {
    if (wake()) { e.preventDefault(); return; } // first press just wakes the screen
    switch (e.key || e.keyCode) {
      case "ArrowLeft": case 37: move(0, -1); break;
      case "ArrowRight": case 39: move(0, 1); break;
      case "ArrowUp": case 38: move(-1, 0); break;
      case "ArrowDown": case 40: move(1, 0); break;
      case "Enter": case 13: case " ": activate(); break;
      default: return;
    }
    e.preventDefault();
  });

  // Called by the Android shell.
  window.houseBack = function () {
    if (!wake()) { focus.r = 0; focus.c = 0; paintFocus(); }
  };
  window.houseHome = function () { wake(); focus.r = 0; focus.c = 0; paintFocus(); };
  window.houseResume = function () { wake(); buildRows(); tick(); };

  /* ---------- helpers ---------- */

  function getJSON(url) {
    return fetch(url, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    });
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

  buildRows();
  loadLive();
  setInterval(function () { if (!document.body.classList.contains("idle")) buildRows(); }, 60 * 1000);
})();
