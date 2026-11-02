package com.thesolster.housetv;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.Drawable;
import android.media.tv.TvContract;
import android.media.tv.TvInputInfo;
import android.media.tv.TvInputManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.util.Base64;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A thin shell: one full-screen WebView showing our home page, plus a small
 * bridge (window.HouseTV) so the page can list and open apps and inputs.
 * Everything you see lives in the web page, so it changes without reinstalling.
 */
public class HomeActivity extends Activity {

    private static final String LOCAL_URL = "file:///android_asset/index.html";

    private WebView web;
    private String homeUrl;
    private long loadedAt = 0;
    private final Map<String, String> artCache = new HashMap<>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        homeUrl = getString(R.string.home_url);

        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(18, 16, 14));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        // Lay the page out at its own declared width (1920) and zoom it to fit the
        // screen, instead of trusting the size the TV reports to the page.
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(false);
        s.setTextZoom(100);
        web.addJavascriptInterface(new Bridge(), "HouseTV");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                // No network or the site is down: fall back to the copy built into the app.
                if (req.isForMainFrame() && !req.getUrl().toString().startsWith("file:")) {
                    view.loadUrl(LOCAL_URL);
                }
            }
        });
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        setContentView(web);
        web.requestFocus(View.FOCUS_DOWN);
        load();
    }

    private void load() {
        loadedAt = System.currentTimeMillis();
        web.loadUrl(homeUrl.isEmpty() ? LOCAL_URL : homeUrl);
    }

    @Override
    protected void onResume() {
        super.onResume();
        String url = web.getUrl();
        boolean stale = System.currentTimeMillis() - loadedAt > 10 * 60 * 1000;
        if (stale || (!homeUrl.isEmpty() && url != null && url.startsWith("file:"))) {
            load(); // fresh copy of the live page
        } else {
            js("window.houseResume && houseResume()");
        }
        web.requestFocus();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        js("window.houseHome && houseHome()");
    }

    @Override
    public void onBackPressed() {
        // We're the home screen: Back never leaves. Let the page decide what it means.
        js("window.houseBack && houseBack()");
    }

    private void js(final String code) {
        if (web != null) web.post(() -> web.evaluateJavascript(code, null));
    }

    /* ---------------- bridge ---------------- */

    private class Bridge {

        @JavascriptInterface
        public String version() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "?";
            }
        }

        /** Launchable apps as JSON: [{pkg, label}]. */
        @JavascriptInterface
        public String apps() {
            PackageManager pm = getPackageManager();
            Map<String, String> found = new LinkedHashMap<>();
            for (String category : new String[]{Intent.CATEGORY_LEANBACK_LAUNCHER, Intent.CATEGORY_LAUNCHER}) {
                Intent q = new Intent(Intent.ACTION_MAIN).addCategory(category);
                List<ResolveInfo> list = pm.queryIntentActivities(q, 0);
                for (ResolveInfo ri : list) {
                    String pkg = ri.activityInfo.packageName;
                    if (pkg.equals(getPackageName()) || found.containsKey(pkg)) continue;
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

        /** "banner:data:..." for a wide TV banner, "icon:data:..." for a square icon, or "". */
        @JavascriptInterface
        public String icon(String pkg) {
            synchronized (artCache) {
                if (artCache.containsKey(pkg)) return artCache.get(pkg);
            }
            String result = "";
            try {
                PackageManager pm = getPackageManager();
                Intent launch = launchIntent(pkg);
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
                    Drawable icon = pm.getApplicationIcon(pkg);
                    result = "icon:" + toDataUrl(icon, 192, 192);
                }
            } catch (Exception ignored) {
            }
            synchronized (artCache) {
                artCache.put(pkg, result);
            }
            return result;
        }

        @JavascriptInterface
        public String launch(String pkg) {
            try {
                Intent i = launchIntent(pkg);
                if (i == null) return "not installed";
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
                return "ok";
            } catch (Exception e) {
                return e.getClass().getSimpleName();
            }
        }

        /** HDMI and antenna inputs as JSON: [{id, label}]. */
        @JavascriptInterface
        public String inputs() {
            JSONArray out = new JSONArray();
            try {
                TvInputManager tim = (TvInputManager) getSystemService(TV_INPUT_SERVICE);
                if (tim == null) return "[]";
                for (TvInputInfo info : tim.getTvInputList()) {
                    if (Build.VERSION.SDK_INT >= 23 && info.isHidden(HomeActivity.this)) continue;
                    boolean passthrough = info.isPassthroughInput();
                    boolean tuner = info.getType() == TvInputInfo.TYPE_TUNER;
                    if (!passthrough && !tuner) continue;
                    String label = String.valueOf(info.loadLabel(HomeActivity.this));
                    out.put(new JSONObject().put("id", info.getId()).put("label", label));
                }
            } catch (Exception ignored) {
            }
            return out.toString();
        }

        @JavascriptInterface
        public String openInput(String id) {
            try {
                TvInputManager tim = (TvInputManager) getSystemService(TV_INPUT_SERVICE);
                TvInputInfo info = tim == null ? null : tim.getTvInputInfo(id);
                if (info == null) return "no such input";
                Uri uri = info.isPassthroughInput()
                        ? TvContract.buildChannelUriForPassthroughInput(id)
                        : TvContract.buildChannelsUriForInput(id);
                Intent i = new Intent(Intent.ACTION_VIEW, uri);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
                return "ok";
            } catch (Exception e) {
                return e.getClass().getSimpleName();
            }
        }

        @JavascriptInterface
        public String settings() {
            try {
                Intent i = new Intent(Settings.ACTION_SETTINGS);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
                return "ok";
            } catch (Exception e) {
                return e.getClass().getSimpleName();
            }
        }
    }

    private Intent launchIntent(String pkg) {
        PackageManager pm = getPackageManager();
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
