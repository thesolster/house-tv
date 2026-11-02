package com.thesolster.housetv;

import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Plays a radio station's live stream in the app itself, so it keeps going while you
 * browse the guide (and so plain-http streams work). Tries each stream address in turn.
 */
public final class Radio {

    private static final Handler main = new Handler(Looper.getMainLooper());
    private static MediaPlayer player;
    private static String station = "";
    private static String url = "";
    private static String state = "stopped"; // stopped, connecting, playing, failed
    private static String error = "";
    private static int generation = 0;

    private Radio() {
    }

    /** urls: JSON array of stream addresses to try in order. */
    public static String play(final String stationName, String urlsJson) {
        final String[] urls;
        try {
            JSONArray a = new JSONArray(urlsJson);
            urls = new String[a.length()];
            for (int i = 0; i < a.length(); i++) urls[i] = a.getString(i);
        } catch (Exception e) {
            return "bad stream list";
        }
        if (urls.length == 0) return "no stream";
        main.post(() -> {
            stopNow();
            station = stationName;
            state = "connecting";
            error = "";
            final int gen = ++generation;
            tryUrl(urls, 0, gen);
        });
        return "ok";
    }

    private static void tryUrl(final String[] urls, final int i, final int gen) {
        if (gen != generation) return;
        if (i >= urls.length) {
            state = "failed";
            return;
        }
        try {
            final MediaPlayer mp = new MediaPlayer();
            player = mp;
            url = urls[i];
            mp.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build());
            mp.setDataSource(urls[i]);
            mp.setOnPreparedListener(p -> {
                if (gen != generation) { p.release(); return; }
                p.start();
                state = "playing";
            });
            mp.setOnErrorListener((p, what, extra) -> {
                error = "stream " + (i + 1) + " failed (" + what + "/" + extra + ")";
                p.release();
                if (player == p) player = null;
                tryUrl(urls, i + 1, gen);
                return true;
            });
            mp.prepareAsync();
            // Some streams never answer: give each one 12 seconds.
            main.postDelayed(() -> {
                if (gen == generation && player == mp && "connecting".equals(state)) {
                    error = "stream " + (i + 1) + " timed out";
                    mp.release();
                    player = null;
                    tryUrl(urls, i + 1, gen);
                }
            }, 12000);
        } catch (Exception e) {
            error = e.getClass().getSimpleName();
            tryUrl(urls, i + 1, gen);
        }
    }

    public static String stop() {
        main.post(Radio::stopNow);
        return "ok";
    }

    private static void stopNow() {
        generation++;
        if (player != null) {
            try {
                player.stop();
            } catch (Exception ignored) {
            }
            player.release();
            player = null;
        }
        state = "stopped";
    }

    public static String status() {
        try {
            return new JSONObject().put("state", state).put("station", station).put("url", url).put("error", error).toString();
        } catch (Exception e) {
            return "{}";
        }
    }
}
