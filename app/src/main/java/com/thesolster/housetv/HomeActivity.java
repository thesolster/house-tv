package com.thesolster.housetv;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

/**
 * A thin shell: one full-screen WebView showing our home page, plus a small
 * bridge (window.HouseTV) so the page can list and open apps and inputs.
 * A second WebView ("the viewer") shows web pages like town cams full screen; Back closes it.
 */
public class HomeActivity extends Activity {

    private static final String LOCAL_URL = "file:///android_asset/index.html";

    private static HomeActivity current;
    private static String pendingPage;

    private WebView web;
    private WebView viewer;
    // Channels you can flip through with left/right while one plays full screen.
    private org.json.JSONArray channels = null;
    private int channelIdx = 0;
    private String homeUrl;
    private long loadedAt = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        current = this;
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        homeUrl = getString(R.string.home_url);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(18, 16, 14));

        web = new WebView(this);
        setup(web);
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
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));

        viewer = new WebView(this);
        setup(viewer);
        viewer.getSettings().setUseWideViewPort(true);
        viewer.setWebChromeClient(new WebChromeClient());
        viewer.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                // Many cam pages wrap the stream in an iframe; jump straight to the player.
                view.evaluateJavascript(
                        "(function(){var f=document.querySelector('iframe[src*=\"cam\"],iframe[src*=\"stream\"],iframe[src*=\"live\"],iframe[src*=\"player\"],iframe[src*=\"youtube\"]');"
                                + "if(f&&f.src&&location.href.indexOf(f.src)<0&&!window.__houseJumped){window.__houseJumped=1;location.href=f.src;return;}"
                                + "var v=document.querySelector('video');if(v){v.muted=true;v.play&&v.play();}})()", null);
            }
        });
        viewer.setVisibility(View.GONE);
        root.addView(viewer, new FrameLayout.LayoutParams(-1, -1));

        setContentView(root);
        web.requestFocus(View.FOCUS_DOWN);
        load();
        RemoteService.start(this);
    }

    private void setup(WebView w) {
        w.setBackgroundColor(Color.rgb(18, 16, 14));
        WebSettings s = w.getSettings();
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
        w.setFocusable(true);
        w.setFocusableInTouchMode(true);
    }

    private void load() {
        loadedAt = System.currentTimeMillis();
        web.loadUrl(homeUrl.isEmpty() ? LOCAL_URL : homeUrl);
    }

    @Override
    protected void onResume() {
        super.onResume();
        current = this;
        String url = web.getUrl();
        boolean stale = System.currentTimeMillis() - loadedAt > 10 * 60 * 1000;
        if (stale || (!homeUrl.isEmpty() && url != null && url.startsWith("file:"))) {
            load(); // fresh copy of the live page
        } else {
            js("window.houseResume && houseResume()");
        }
        if (pendingPage != null) {
            String p = pendingPage;
            pendingPage = null;
            openViewer(p);
        } else if (viewer.getVisibility() != View.VISIBLE) {
            web.requestFocus();
        }
    }

    @Override
    protected void onDestroy() {
        if (current == this) current = null;
        super.onDestroy();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (pendingPage == null) {
            closeViewer();
            js("window.houseHome && houseHome()");
        }
    }

    @Override
    public void onBackPressed() {
        if (viewer.getVisibility() == View.VISIBLE) {
            closeViewer();
            return;
        }
        // We're the home screen: Back never leaves. Let the page decide what it means.
        js("window.houseBack && houseBack()");
    }

    private void flip(int dir) {
        if (channels == null || channels.length() == 0) return;
        channelIdx = (channelIdx + dir + channels.length()) % channels.length();
        org.json.JSONObject ch = channels.optJSONObject(channelIdx);
        if (ch == null) return;
        viewer.loadUrl(ch.optString("url"));
        android.widget.Toast.makeText(this, ch.optString("name"), android.widget.Toast.LENGTH_SHORT).show();
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        // While a town channel plays: left/right (or channel up/down) flips channels, like cable.
        if (viewer.getVisibility() == View.VISIBLE && channels != null && event.getAction() == KeyEvent.ACTION_DOWN) {
            int k = event.getKeyCode();
            if (k == KeyEvent.KEYCODE_DPAD_RIGHT || k == KeyEvent.KEYCODE_CHANNEL_UP) { flip(1); return true; }
            if (k == KeyEvent.KEYCODE_DPAD_LEFT || k == KeyEvent.KEYCODE_CHANNEL_DOWN) { flip(-1); return true; }
        }
        // Play/pause on the remote controls whatever is playing, even from our screen.
        if (event.getAction() == KeyEvent.ACTION_DOWN
                && event.getKeyCode() == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE
                && viewer.getVisibility() != View.VISIBLE) {
            Tv.media(this, "toggle");
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    private void openViewer(String url) {
        channels = null; // watch() sets the list again when it's a channel
        viewer.setVisibility(View.VISIBLE);
        viewer.loadUrl(url);
        viewer.requestFocus();
    }

    private void closeViewer() {
        channels = null;
        if (viewer.getVisibility() != View.VISIBLE) return;
        viewer.loadUrl("about:blank");
        viewer.setVisibility(View.GONE);
        web.requestFocus();
    }

    /** Show a web page full screen on the TV (called from the page or the phone remote). */
    static String showPage(Context ctx, String url) {
        if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) return "bad link";
        HomeActivity a = current;
        if (a != null && a.hasWindowFocus()) {
            a.runOnUiThread(() -> a.openViewer(url));
        } else {
            pendingPage = url;
            Tv.goHome(ctx);
        }
        return "ok";
    }

    private void js(final String code) {
        if (web != null) web.post(() -> web.evaluateJavascript(code, null));
    }

    /* ---------------- bridge ---------------- */

    private class Bridge {
        private final Context ctx = HomeActivity.this;

        @JavascriptInterface
        public String version() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "?";
            }
        }

        @JavascriptInterface public String apps() { return Tv.apps(ctx); }
        @JavascriptInterface public String icon(String pkg) { return Tv.icon(ctx, pkg); }
        @JavascriptInterface public String launch(String pkg) { return Tv.launch(ctx, pkg); }
        @JavascriptInterface public String openUrl(String url, String pkg) { return Tv.openUrl(ctx, url, pkg); }
        @JavascriptInterface public String view(String url) { return showPage(ctx, url); }
        @JavascriptInterface public String inputs() { return Tv.inputs(ctx); }
        @JavascriptInterface public String openInput(String id) { return Tv.openInput(ctx, id); }
        @JavascriptInterface public String settings() { return Tv.settings(ctx); }
        @JavascriptInterface public String recent() { return Tv.recent(ctx); }
        @JavascriptInterface public String nowPlaying() { return Tv.nowPlaying(ctx); }
        @JavascriptInterface public String media(String action) { return Tv.media(ctx, action); }
        @JavascriptInterface public String status() { return Tv.status(ctx); }
        @JavascriptInterface public String history() { return Tv.history(ctx); }
        @JavascriptInterface public String resume(String pkg, String mediaId, String mediaUri) { return Tv.resume(ctx, pkg, mediaId, mediaUri); }

        /** Play one of a list of channels full screen; left/right flips between them. */
        @JavascriptInterface
        public String watch(String json, int index) {
            try {
                final org.json.JSONArray list = new org.json.JSONArray(json);
                final int i = Math.max(0, Math.min(index, list.length() - 1));
                final String url = list.getJSONObject(i).getString("url");
                runOnUiThread(() -> {
                    openViewer(url);
                    channels = list;
                    channelIdx = i;
                });
                return "ok";
            } catch (Exception e) {
                return e.getClass().getSimpleName();
            }
        }
        @JavascriptInterface public String clearHistory() { return Tv.clearHistory(ctx); }
    }
}
