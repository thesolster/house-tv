package com.thesolster.housetv;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.net.wifi.WifiManager;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Plays a radio station's live stream in the app itself, so it keeps going while you
 * browse the guide (and so plain-http streams work). Tries each stream address in turn.
 *
 * Live streams drop: the station's server hiccups, wifi naps, the stream "ends". So once a
 * station is on, it stays on until you turn it off: if the stream ends, errors, or goes
 * quiet, it reconnects by itself (2s, 5s, 10s, then every 30s), forever.
 */
public final class Radio {

    private static final Handler main = new Handler(Looper.getMainLooper());
    private static final long[] BACKOFF = {2000, 5000, 10000, 20000, 30000};
    private static final long WATCH_MS = 15000;

    private static Context app;
    private static WifiManager.WifiLock wifiLock;
    private static MediaPlayer player;
    private static String[] urls = new String[0];
    private static String station = "";
    private static String url = "";
    private static String state = "stopped"; // stopped, connecting, playing, reconnecting, failed
    private static String error = "";
    private static int generation = 0;
    private static int reconnects = 0;
    private static int failsInARow = 0;
    private static long since = 0;
    private static int lastPos = -1;
    private static int stuck = 0;

    private Radio() {
    }

    /** Call once from the activity and the service so the radio can hold wifi awake. */
    public static void init(Context c) {
        if (app == null && c != null) app = c.getApplicationContext();
    }

    /** urls: JSON array of stream addresses to try in order. */
    public static String play(final String stationName, String urlsJson) {
        final String[] list;
        try {
            JSONArray a = new JSONArray(urlsJson);
            list = new String[a.length()];
            for (int i = 0; i < a.length(); i++) list[i] = a.getString(i);
        } catch (Exception e) {
            return "bad stream list";
        }
        if (list.length == 0) return "no stream";
        main.post(() -> {
            stopNow();
            station = stationName;
            urls = list;
            state = "connecting";
            error = "";
            reconnects = 0;
            failsInARow = 0;
            since = System.currentTimeMillis();
            holdWifi(true);
            final int gen = ++generation;
            tryUrl(0, gen);
            main.postDelayed(() -> watch(gen), WATCH_MS);
        });
        return "ok";
    }

    private static void tryUrl(final int i, final int gen) {
        if (gen != generation) return;
        if (i >= urls.length) {
            // Every address failed this round. Keep trying unless it never worked at all.
            if (reconnects == 0 && "connecting".equals(state)) {
                state = "failed";
                holdWifi(false);
            } else {
                retryLater(gen);
            }
            return;
        }
        try {
            final MediaPlayer mp = new MediaPlayer();
            player = mp;
            url = urls[i];
            mp.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build());
            if (app != null) mp.setWakeMode(app, PowerManager.PARTIAL_WAKE_LOCK);
            mp.setDataSource(urls[i]);
            mp.setOnPreparedListener(p -> {
                if (gen != generation) { p.release(); return; }
                p.start();
                state = "playing";
                failsInARow = 0;
                lastPos = -1;
                stuck = 0;
            });
            mp.setOnErrorListener((p, what, extra) -> {
                if (gen != generation) return true;
                error = "stream " + (i + 1) + " failed (" + what + "/" + extra + ")";
                release(p);
                if ("playing".equals(state)) retryLater(gen);   // it was playing and dropped
                else tryUrl(i + 1, gen);                        // still tuning in: next address
                return true;
            });
            mp.setOnCompletionListener(p -> {
                // A live stream never really ends. If it does, the server let go of us.
                if (gen != generation) return;
                error = "stream ended";
                release(p);
                retryLater(gen);
            });
            mp.prepareAsync();
            // Some streams never answer: give each one 12 seconds.
            main.postDelayed(() -> {
                if (gen == generation && player == mp && !"playing".equals(state)) {
                    error = "stream " + (i + 1) + " timed out";
                    release(mp);
                    tryUrl(i + 1, gen);
                }
            }, 12000);
        } catch (Exception e) {
            error = e.getClass().getSimpleName();
            tryUrl(i + 1, gen);
        }
    }

    private static void retryLater(final int gen) {
        if (gen != generation) return;
        state = "reconnecting";
        long wait = BACKOFF[Math.min(failsInARow, BACKOFF.length - 1)];
        failsInARow++;
        reconnects++;
        main.postDelayed(() -> {
            if (gen != generation) return;
            release(player);
            tryUrl(0, gen);
        }, wait);
    }

    /** Every 15 seconds: if it says it's playing but the audio hasn't moved, start over. */
    private static void watch(final int gen) {
        if (gen != generation) return;
        if ("playing".equals(state) && player != null) {
            int pos;
            boolean going;
            try {
                pos = player.getCurrentPosition();
                going = player.isPlaying();
            } catch (Exception e) {
                pos = -1;
                going = false;
            }
            if (!going || pos == lastPos) stuck++;
            else stuck = 0;
            lastPos = pos;
            if (stuck >= 2) {
                error = "stream went quiet";
                stuck = 0;
                release(player);
                retryLater(gen);
            }
        }
        main.postDelayed(() -> watch(gen), WATCH_MS);
    }

    private static void release(MediaPlayer p) {
        if (p == null) return;
        try {
            p.stop();
        } catch (Exception ignored) {
        }
        try {
            p.release();
        } catch (Exception ignored) {
        }
        if (player == p) player = null;
    }

    private static void holdWifi(boolean on) {
        try {
            if (app == null) return;
            if (wifiLock == null) {
                WifiManager wm = (WifiManager) app.getSystemService(Context.WIFI_SERVICE);
                if (wm == null) return;
                wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "housetv:radio");
                wifiLock.setReferenceCounted(false);
            }
            if (on && !wifiLock.isHeld()) wifiLock.acquire();
            if (!on && wifiLock.isHeld()) wifiLock.release();
        } catch (Exception ignored) {
        }
    }

    public static String stop() {
        main.post(Radio::stopNow);
        return "ok";
    }

    private static void stopNow() {
        generation++;
        release(player);
        player = null;
        state = "stopped";
        holdWifi(false);
    }

    public static String status() {
        try {
            return new JSONObject().put("state", state).put("station", station).put("url", url).put("error", error)
                    .put("reconnects", reconnects).put("since", since).toString();
        } catch (Exception e) {
            return "{}";
        }
    }
}
