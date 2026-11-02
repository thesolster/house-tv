package com.thesolster.housetv;

import android.app.AppOpsManager;
import android.app.usage.UsageStats;
import android.app.usage.UsageStatsManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.Drawable;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.media.tv.TvContract;
import android.media.tv.TvInputInfo;
import android.media.tv.TvInputManager;
import android.net.Uri;
import android.os.Build;
import android.os.Process;
import android.provider.Settings;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Everything the home screen and the phone remote can ask the TV to do. */
public final class Tv {

    public static final int REMOTE_PORT = 8765;
    private static final String YOUTUBE_FIRE = "com.amazon.firetv.youtube";
    private static final String YOUTUBE_ATV = "com.google.android.youtube.tv";

    private static final Map<String, String> artCache = new HashMap<>();

    private Tv() {
    }

    /* ---------------- apps ---------------- */

    public static String apps(Context ctx) {
        PackageManager pm = ctx.getPackageManager();
        Map<String, String> found = new LinkedHashMap<>();
        for (String category : new String[]{Intent.CATEGORY_LEANBACK_LAUNCHER, Intent.CATEGORY_LAUNCHER}) {
            Intent q = new Intent(Intent.ACTION_MAIN).addCategory(category);
            for (ResolveInfo ri : pm.queryIntentActivities(q, 0)) {
                String pkg = ri.activityInfo.packageName;
                if (pkg.equals(ctx.getPackageName()) || found.containsKey(pkg)) continue;
                found.put(pkg, String.valueOf(ri.loadLabel(pm)));
            }
        }
        JSONArray out = new JSONArray();
        try {
            for (Map.Entry<String, String> e : found.entrySet()) {
                out.put(new JSONObject().put("pkg", e.getKey()).put("label", e.getValue()));
            }
        } catch (Exception ignored) {
        }
        return out.toString();
    }

    public static String label(Context ctx, String pkg) {
        try {
            PackageManager pm = ctx.getPackageManager();
            return String.valueOf(pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)));
        } catch (Exception e) {
            return pkg;
        }
    }

    /** "banner:data:..." for a wide TV banner, "icon:data:..." for a square icon, or "". */
    public static String icon(Context ctx, String pkg) {
        synchronized (artCache) {
            if (artCache.containsKey(pkg)) return artCache.get(pkg);
        }
        String result = "";
        try {
            PackageManager pm = ctx.getPackageManager();
            Intent launch = launchIntent(ctx, pkg);
            ActivityInfo ai = null;
            if (launch != null) {
                ResolveInfo ri = pm.resolveActivity(launch, 0);
                if (ri != null) ai = ri.activityInfo;
            }
            Drawable banner = null;
            if (ai != null) banner = ai.loadBanner(pm);
            if (banner == null) banner = pm.getApplicationBanner(pkg);
            if (banner != null) {
                result = "banner:" + toDataUrl(banner, 640, 360);
            } else {
                result = "icon:" + toDataUrl(pm.getApplicationIcon(pkg), 192, 192);
            }
        } catch (Exception ignored) {
        }
        synchronized (artCache) {
            artCache.put(pkg, result);
        }
        return result;
    }

    public static String launch(Context ctx, String pkg) {
        try {
            Intent i = launchIntent(ctx, pkg);
            if (i == null) return "not installed";
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            return "ok";
        } catch (Exception e) {
            return e.getClass().getSimpleName();
        }
    }

    /** Open a link in the app that handles it (YouTube for YouTube links). */
    public static String openUrl(Context ctx, String url, String pkg) {
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PackageManager pm = ctx.getPackageManager();
        if (pkg == null || pkg.isEmpty()) {
            if (url.contains("youtube.com") || url.contains("youtu.be")) {
                if (installed(ctx, YOUTUBE_FIRE)) pkg = YOUTUBE_FIRE;
                else if (installed(ctx, YOUTUBE_ATV)) pkg = YOUTUBE_ATV;
            }
        }
        if (pkg != null && !pkg.isEmpty()) i.setPackage(pkg);
        try {
            if (pm.resolveActivity(i, 0) == null) return "no app for that link";
            ctx.startActivity(i);
            return "ok";
        } catch (Exception e) {
            return e.getClass().getSimpleName();
        }
    }

    public static String settings(Context ctx) {
        try {
            Intent i = new Intent(Settings.ACTION_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            return "ok";
        } catch (Exception e) {
            return e.getClass().getSimpleName();
        }
    }

    /** Bring our home screen to the front. */
    public static String goHome(Context ctx) {
        try {
            Intent i = new Intent(ctx, HomeActivity.class);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
            ctx.startActivity(i);
            return "ok";
        } catch (Exception e) {
            return e.getClass().getSimpleName();
        }
    }

    /* ---------------- inputs ---------------- */

    public static String inputs(Context ctx) {
        JSONArray out = new JSONArray();
        try {
            TvInputManager tim = (TvInputManager) ctx.getSystemService(Context.TV_INPUT_SERVICE);
            if (tim == null) return "[]";
            for (TvInputInfo info : tim.getTvInputList()) {
                if (Build.VERSION.SDK_INT >= 23 && info.isHidden(ctx)) continue;
                boolean passthrough = info.isPassthroughInput();
                boolean tuner = info.getType() == TvInputInfo.TYPE_TUNER;
                if (!passthrough && !tuner) continue;
                out.put(new JSONObject().put("id", info.getId()).put("label", String.valueOf(info.loadLabel(ctx))));
            }
        } catch (Exception ignored) {
        }
        return out.toString();
    }

    public static String openInput(Context ctx, String id) {
        try {
            TvInputManager tim = (TvInputManager) ctx.getSystemService(Context.TV_INPUT_SERVICE);
            TvInputInfo info = tim == null ? null : tim.getTvInputInfo(id);
            if (info == null) return "no such input";
            Uri uri = info.isPassthroughInput()
                    ? TvContract.buildChannelUriForPassthroughInput(id)
                    : TvContract.buildChannelsUriForInput(id);
            Intent i = new Intent(Intent.ACTION_VIEW, uri);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            return "ok";
        } catch (Exception e) {
            return e.getClass().getSimpleName();
        }
    }

    /* ---------------- recent apps (needs usage access, granted once over ADB) ---------------- */

    public static boolean hasUsageAccess(Context ctx) {
        try {
            AppOpsManager ops = (AppOpsManager) ctx.getSystemService(Context.APP_OPS_SERVICE);
            int mode = ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.getPackageName());
            return mode == AppOpsManager.MODE_ALLOWED;
        } catch (Exception e) {
            return false;
        }
    }

    public static String recent(Context ctx) {
        JSONArray out = new JSONArray();
        if (!hasUsageAccess(ctx)) return out.toString();
        try {
            UsageStatsManager usm = (UsageStatsManager) ctx.getSystemService(Context.USAGE_STATS_SERVICE);
            long now = System.currentTimeMillis();
            List<UsageStats> stats = usm.queryUsageStats(UsageStatsManager.INTERVAL_BEST, now - 14L * 24 * 3600 * 1000, now);
            Map<String, Long> last = new HashMap<>();
            if (stats != null) {
                for (UsageStats s : stats) {
                    if (s.getTotalTimeInForeground() < 30 * 1000) continue; // ignore passing through
                    Long prev = last.get(s.getPackageName());
                    if (prev == null || s.getLastTimeUsed() > prev) last.put(s.getPackageName(), s.getLastTimeUsed());
                }
            }
            List<Map.Entry<String, Long>> sorted = new ArrayList<>(last.entrySet());
            Collections.sort(sorted, (a, b) -> Long.compare(b.getValue(), a.getValue()));
            int n = 0;
            for (Map.Entry<String, Long> e : sorted) {
                String pkg = e.getKey();
                if (pkg.equals(ctx.getPackageName()) || pkg.startsWith("com.amazon.tv.launcher")) continue;
                if (launchIntent(ctx, pkg) == null) continue;
                out.put(new JSONObject().put("pkg", pkg).put("label", label(ctx, pkg)).put("at", e.getValue()));
                if (++n >= 8) break;
            }
        } catch (Exception ignored) {
        }
        return out.toString();
    }

    /* ---------------- now playing (needs notification access, granted once over ADB) ---------------- */

    public static boolean hasNowPlayingAccess(Context ctx) {
        String enabled = Settings.Secure.getString(ctx.getContentResolver(), "enabled_notification_listeners");
        return enabled != null && enabled.contains(ctx.getPackageName());
    }

    private static MediaController activeController(Context ctx) {
        MediaSessionManager msm = (MediaSessionManager) ctx.getSystemService(Context.MEDIA_SESSION_SERVICE);
        List<MediaController> list = msm.getActiveSessions(new ComponentName(ctx, NowPlayingListener.class));
        MediaController best = null;
        for (MediaController c : list) {
            PlaybackState st = c.getPlaybackState();
            if (st != null && st.getState() == PlaybackState.STATE_PLAYING) return c;
            if (best == null && c.getMetadata() != null) best = c;
        }
        return best;
    }

    public static String nowPlaying(Context ctx) {
        try {
            if (!hasNowPlayingAccess(ctx)) return "{\"access\":false}";
            MediaController c = activeController(ctx);
            JSONObject o = new JSONObject().put("access", true);
            if (c == null) return o.toString();
            MediaMetadata md = c.getMetadata();
            PlaybackState st = c.getPlaybackState();
            String pkg = c.getPackageName();
            o.put("pkg", pkg).put("app", label(ctx, pkg));
            if (md != null) {
                CharSequence title = md.getText(MediaMetadata.METADATA_KEY_TITLE);
                if (title == null) title = md.getText(MediaMetadata.METADATA_KEY_DISPLAY_TITLE);
                CharSequence sub = md.getText(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE);
                if (sub == null) sub = md.getText(MediaMetadata.METADATA_KEY_ARTIST);
                if (sub == null) sub = md.getText(MediaMetadata.METADATA_KEY_ALBUM);
                o.put("title", title == null ? "" : title.toString());
                o.put("subtitle", sub == null ? "" : sub.toString());
                o.put("duration", md.getLong(MediaMetadata.METADATA_KEY_DURATION));
            }
            if (st != null) {
                int s = st.getState();
                o.put("state", s == PlaybackState.STATE_PLAYING ? "playing"
                        : s == PlaybackState.STATE_PAUSED ? "paused"
                        : s == PlaybackState.STATE_BUFFERING ? "buffering" : "stopped");
                long pos = st.getPosition();
                if (s == PlaybackState.STATE_PLAYING && st.getLastPositionUpdateTime() > 0) {
                    pos += (long) ((android.os.SystemClock.elapsedRealtime() - st.getLastPositionUpdateTime()) * st.getPlaybackSpeed());
                }
                o.put("position", Math.max(0, pos));
            }
            return o.toString();
        } catch (Exception e) {
            return "{\"access\":false,\"error\":\"" + e.getClass().getSimpleName() + "\"}";
        }
    }

    /** play, pause, toggle, next, previous, stop, forward, back */
    public static String media(Context ctx, String action) {
        try {
            if (!hasNowPlayingAccess(ctx)) return "needs setup";
            MediaController c = activeController(ctx);
            if (c == null) return "nothing playing";
            MediaController.TransportControls t = c.getTransportControls();
            PlaybackState st = c.getPlaybackState();
            boolean playing = st != null && st.getState() == PlaybackState.STATE_PLAYING;
            long pos = st == null ? 0 : st.getPosition();
            switch (action) {
                case "play": t.play(); break;
                case "pause": t.pause(); break;
                case "toggle": if (playing) t.pause(); else t.play(); break;
                case "next": t.skipToNext(); break;
                case "previous": t.skipToPrevious(); break;
                case "stop": t.stop(); break;
                case "forward": t.seekTo(pos + 30000); break;
                case "back": t.seekTo(Math.max(0, pos - 10000)); break;
                default: return "unknown action";
            }
            return "ok";
        } catch (Exception e) {
            return e.getClass().getSimpleName();
        }
    }

    /* ---------------- phone remote address ---------------- */

    public static String token(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences("house", Context.MODE_PRIVATE);
        String t = p.getString("token", null);
        if (t == null) {
            String alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
            SecureRandom r = new SecureRandom();
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < 10; i++) sb.append(alphabet.charAt(r.nextInt(alphabet.length())));
            t = sb.toString();
            p.edit().putString("token", t).apply();
        }
        return t;
    }

    public static String ip() {
        try {
            Enumeration<NetworkInterface> ifs = NetworkInterface.getNetworkInterfaces();
            while (ifs.hasMoreElements()) {
                NetworkInterface ni = ifs.nextElement();
                if (!ni.isUp() || ni.isLoopback()) continue;
                Enumeration<InetAddress> addrs = ni.getInetAddresses();
                while (addrs.hasMoreElements()) {
                    InetAddress a = addrs.nextElement();
                    if (a instanceof Inet4Address && a.isSiteLocalAddress()) return a.getHostAddress();
                }
            }
        } catch (Exception ignored) {
        }
        return "";
    }

    public static String remoteUrl(Context ctx) {
        String ip = ip();
        if (ip.isEmpty()) return "";
        return "http://" + ip + ":" + REMOTE_PORT + "/?t=" + token(ctx);
    }

    public static String status(Context ctx) {
        try {
            return new JSONObject()
                    .put("usage", hasUsageAccess(ctx))
                    .put("nowPlaying", hasNowPlayingAccess(ctx))
                    .put("remote", remoteUrl(ctx))
                    .toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    /* ---------------- helpers ---------------- */

    static boolean installed(Context ctx, String pkg) {
        try {
            ctx.getPackageManager().getPackageInfo(pkg, 0);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    static Intent launchIntent(Context ctx, String pkg) {
        PackageManager pm = ctx.getPackageManager();
        Intent i = pm.getLeanbackLaunchIntentForPackage(pkg);
        if (i == null) i = pm.getLaunchIntentForPackage(pkg);
        return i;
    }

    private static String toDataUrl(Drawable d, int maxW, int maxH) {
        Bitmap bmp;
        if (d instanceof BitmapDrawable && ((BitmapDrawable) d).getBitmap() != null) {
            bmp = ((BitmapDrawable) d).getBitmap();
        } else {
            int w = d.getIntrinsicWidth() > 0 ? d.getIntrinsicWidth() : maxW;
            int h = d.getIntrinsicHeight() > 0 ? d.getIntrinsicHeight() : maxH;
            bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
            Canvas c = new Canvas(bmp);
            d.setBounds(0, 0, w, h);
            d.draw(c);
        }
        if (bmp.getWidth() > maxW || bmp.getHeight() > maxH) {
            float scale = Math.min((float) maxW / bmp.getWidth(), (float) maxH / bmp.getHeight());
            bmp = Bitmap.createScaledBitmap(bmp, Math.max(1, Math.round(bmp.getWidth() * scale)),
                    Math.max(1, Math.round(bmp.getHeight() * scale)), true);
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        bmp.compress(Bitmap.CompressFormat.PNG, 100, out);
        return "data:image/png;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
    }
}
