// House TV radio helper, runs on Vercel (the TV and Claude's workspace can't reach every station directly).
//   /api/radio?mode=check   test every station's streams: does it answer with audio, and what's its ICY title
//   /api/radio              now playing for every station (Spinitron where the station uses it, else the stream's ICY title)
//   /api/radio?mode=probe&code=KSJS   raw look at what a station's sources return, for debugging
const stations = require("../radio.json").stations;

const RB = ["https://de1.api.radio-browser.info", "https://nl1.api.radio-browser.info", "https://at1.api.radio-browser.info"];
const UA = "HouseTV/1.0 (+https://house-tv.vercel.app)";

function timeout(ms) { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; }

async function rbLookup(find) {
  for (const base of RB) {
    try {
      const r = await fetch(`${base}/json/stations/search?name=${encodeURIComponent(find)}&countrycode=US&hidebroken=true&order=votes&reverse=true&limit=10`,
        { headers: { "User-Agent": UA }, signal: timeout(6000) });
      if (!r.ok) continue;
      const list = await r.json();
      return list.filter(s => (s.name || "").toUpperCase().includes(find.toUpperCase()))
        .map(s => ({ url: s.url_resolved || s.url, name: s.name, codec: s.codec, bitrate: s.bitrate, ok: s.lastcheckok }));
    } catch (e) { /* try next mirror */ }
  }
  return [];
}

// Open a stream, read a few seconds, and pull the first ICY "StreamTitle" if the server sends one.
async function testStream(url, ms = 5000) {
  const out = { url, ok: false };
  const started = Date.now();
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Icy-MetaData": "1" }, redirect: "follow", signal: timeout(ms + 2000) });
    out.status = r.status;
    out.type = r.headers.get("content-type") || "";
    out.finalUrl = r.url;
    const metaint = parseInt(r.headers.get("icy-metaint") || "0", 10);
    out.icyName = r.headers.get("icy-name") || "";
    if (!r.ok || !r.body) return out;
    const reader = r.body.getReader();
    let bytes = 0, buf = [];
    while (Date.now() - started < ms) {
      const { value, done } = await reader.read();
      if (done) { out.ended = true; break; }
      bytes += value.length;
      if (metaint && bytes <= metaint + 4096 + value.length) buf.push(value);
      if (bytes > 400000) break;
    }
    try { reader.cancel(); } catch (e) {}
    out.bytes = bytes;
    out.secs = Math.round((Date.now() - started) / 100) / 10;
    out.kbps = Math.round((bytes * 8) / 1000 / Math.max(out.secs, 0.5));
    const audio = /audio|mpeg|aac|ogg|octet-stream/i.test(out.type) && !/text\/html/i.test(out.type);
    out.ok = audio && bytes > 20000 && !out.ended;
    if (metaint && buf.length) {
      const all = Buffer.concat(buf.map(b => Buffer.from(b)));
      if (all.length > metaint) {
        const len = all[metaint] * 16;
        const meta = all.slice(metaint + 1, metaint + 1 + len).toString("utf8");
        const m = meta.match(/StreamTitle='([^']*)'/);
        if (m && m[1].trim()) out.title = m[1].trim();
      }
    }
  } catch (e) { out.error = e.name === "AbortError" ? "timeout" : e.message; }
  return out;
}

// Spinitron station page: the show on air, its time slot, the DJ, and the latest song.
function strip(s) { return (s || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim(); }
async function spinitron(id, raw) {
  try {
    const r = await fetch(`https://spinitron.com/${encodeURIComponent(id)}/`, { headers: { "User-Agent": UA }, signal: timeout(6000) });
    if (!r.ok) return { error: "status " + r.status };
    const html = await r.text();
    const i = html.indexOf('class="playlist-block onair"');
    if (i < 0) return { empty: true };
    const block = html.slice(i, i + 20000);
    const grab = re => { const m = block.match(re); return m ? strip(m[1]) : ""; };
    const out = {
      show: grab(/class="show-title"[^>]*>([\s\S]*?)<\/h3>/),
      slot: grab(/class="timeslot"[^>]*>([\s\S]*?)<\/p>/),
      dj: grab(/class="dj-name"[^>]*>([\s\S]*?)<\/p>/).replace(/^With\s+/i, ""),
      genre: grab(/class="show-categoty"[^>]*>([\s\S]*?)<\/p>/)
    };
    const m = block.match(/data-spin="([^"]+)"/);
    if (m) { try { const sp = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#0?39;/g, "'")); out.artist = sp.a || ""; out.song = sp.s || ""; } catch (e) {} }
    const u = out.slot.match(/(\d{1,2}:\d\d\s*[AP]M)\s*–\s*(\d{1,2}:\d\d\s*[AP]M)/);
    if (u) { out.from = u[1]; out.until = u[2]; }
    if (/\d{1,2}\/\d{1,2}\/\d\d/.test(out.show)) out.show = "";   // automation playlists named after the date
    if (/bot$/i.test(out.dj)) out.dj = "";
    if (raw) out.raw = block.slice(0, 3000);
    return out;
  } catch (e) { return { error: e.message }; }
}

module.exports = async (req, res) => {
  const q = req.query || {};
  res.setHeader("Access-Control-Allow-Origin", "*");
  const mode = q.mode || "now";

  if (mode === "raw") {
    // debugging: look at a page from a station or playlist site
    const u = String(q.url || "");
    if (!/^https:\/\/([a-z0-9-]+\.)*(spinitron\.com|krml\.com|freakradio\.org|mutinyradio\.fm|radiobilingue\.org|kpcr\.org|piratecatradio\.com)\//.test(u)) return res.status(400).json({ error: "not allowed" });
    try {
      const r = await fetch(u, { headers: { "User-Agent": UA }, signal: timeout(8000) });
      const t = await r.text();
      const from = parseInt(q.from || "0", 10);
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.status(r.status).send(t.slice(from, from + 12000));
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  if (mode === "probe") {
    const st = stations.find(s => s.code === q.code) || { code: q.code, find: q.code, streams: [] };
    const rb = st.find ? await rbLookup(st.find) : [];
    const spin = await spinitron(st.spinitron || st.code, true);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ station: st, radioBrowser: rb, spinitron: spin });
  }

  if (mode === "check") {
    const results = await Promise.all(stations.map(async st => {
      const found = st.find ? await rbLookup(st.find) : [];
      const urls = [...new Set([...(st.streams || []), ...found.map(f => f.url)])].slice(0, 5);
      const tests = await Promise.all(urls.map(u => testStream(u, parseInt(q.secs || "5", 10) * 1000)));
      const good = tests.find(t => t.ok);
      return { code: st.code, name: st.name, ok: !!good, best: good ? good.url : null, tests, found: found.map(f => f.name + " · " + f.url) };
    }));
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ at: new Date().toISOString(), results });
  }

  // now: program info for every station
  const now = {};
  await Promise.all(stations.map(async st => {
    const info = {};
    if (st.spinitron) {
      const sp = await spinitron(st.spinitron);
      if (!sp.error && !sp.empty) Object.assign(info, sp);
    }
    if (!info.song && st.streams && st.streams[0]) {
      const t = await testStream(st.streams[0], 2500);
      if (t.title && /\s/.test(t.title) && !/https?:|\.(mp3|aac)\b/i.test(t.title)) info.title = t.title;
    }
    now[st.code] = info;
  }));
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");
  return res.status(200).json({ at: new Date().toISOString(), now });
};
