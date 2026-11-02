package com.thesolster.housetv;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The phone remote. A tiny web server on the house wifi only (port 8765).
 * Phones that scan the QR on the TV get the token in the link; nothing else is allowed in.
 * No cloud: commands go phone -> TV directly.
 */
public class RemoteService extends Service {

    private static final String TAG = "HouseRemote";
    private ServerSocket server;
    private final ExecutorService pool = Executors.newFixedThreadPool(4);
    private volatile boolean running;

    public static void start(Context ctx) {
        Intent i = new Intent(ctx, RemoteService.class);
        try {
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i);
            else ctx.startService(i);
        } catch (Exception e) {
            Log.w(TAG, "could not start remote", e);
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        Radio.init(this);
        goForeground();
        running = true;
        new Thread(this::serve, "house-remote").start();
        new Thread(this::recordLoop, "house-history").start();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        try {
            if (server != null) server.close();
        } catch (Exception ignored) {
        }
        pool.shutdownNow();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void goForeground() {
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            nm.createNotificationChannel(new NotificationChannel("remote", "Phone remote", NotificationManager.IMPORTANCE_MIN));
            b = new Notification.Builder(this, "remote");
        } else {
            b = new Notification.Builder(this);
        }
        Notification n = b.setContentTitle("Home")
                .setContentText("Phone remote is on")
                .setSmallIcon(android.R.drawable.ic_media_play)
                .build();
        startForeground(1, n);
    }

    /** Jot down what's playing every 15 seconds, so "Last watched" works after the app closes. */
    private void recordLoop() {
        while (running) {
            Tv.recordNowPlaying(this);
            try {
                Thread.sleep(15000);
            } catch (InterruptedException e) {
                return;
            }
        }
    }

    private void serve() {
        try {
            server = new ServerSocket(Tv.REMOTE_PORT);
            while (running) {
                final Socket s = server.accept();
                pool.execute(() -> handle(s));
            }
        } catch (Exception e) {
            if (running) Log.w(TAG, "server stopped", e);
        }
    }

    /* ---------------- tiny HTTP ---------------- */

    private void handle(Socket s) {
        try (Socket sock = s) {
            sock.setSoTimeout(8000);
            InputStream in = new BufferedInputStream(sock.getInputStream());
            String requestLine = readLine(in);
            if (requestLine == null) return;
            String[] parts = requestLine.split(" ");
            if (parts.length < 2) return;
            String method = parts[0];
            String target = parts[1];
            int contentLength = 0;
            String line;
            while ((line = readLine(in)) != null && !line.isEmpty()) {
                int c = line.indexOf(':');
                if (c > 0 && line.substring(0, c).trim().equalsIgnoreCase("content-length")) {
                    contentLength = Integer.parseInt(line.substring(c + 1).trim());
                }
            }
            byte[] body = new byte[Math.min(contentLength, 64 * 1024)];
            int read = 0;
            while (read < body.length) {
                int r = in.read(body, read, body.length - read);
                if (r < 0) break;
                read += r;
            }

            String path = target;
            String query = "";
            int q = target.indexOf('?');
            if (q >= 0) {
                path = target.substring(0, q);
                query = target.substring(q + 1);
            }
            String token = param(query, "t");
            OutputStream out = sock.getOutputStream();

            if ("OPTIONS".equals(method)) {
                respond(out, 204, "text/plain", new byte[0]);
                return;
            }
            if (!Tv.token(this).equals(token)) {
                respond(out, 403, "text/plain", "Scan the code on the TV to use the remote.".getBytes(StandardCharsets.UTF_8));
                return;
            }

            if (path.equals("/") || path.equals("/remote")) {
                respond(out, 200, "text/html; charset=utf-8", asset("remote.html"));
            } else if (path.equals("/api/state")) {
                JSONObject st = new JSONObject()
                        .put("nowPlaying", new JSONObject(Tv.nowPlaying(this)))
                        .put("recent", new org.json.JSONArray(Tv.recent(this)))
                        .put("history", new JSONObject(Tv.history(this)))
                        .put("apps", new org.json.JSONArray(Tv.apps(this)))
                        .put("inputs", new org.json.JSONArray(Tv.inputs(this)))
                        .put("status", new JSONObject(Tv.status(this)))
                        .put("radio", new JSONObject(Radio.status()));
                respond(out, 200, "application/json", st.toString().getBytes(StandardCharsets.UTF_8));
            } else if (path.equals("/api/cmd") && "POST".equals(method)) {
                JSONObject cmd = new JSONObject(new String(body, 0, read, StandardCharsets.UTF_8));
                String result = run(cmd);
                respond(out, 200, "application/json",
                        new JSONObject().put("result", result).toString().getBytes(StandardCharsets.UTF_8));
            } else {
                respond(out, 404, "text/plain", "not found".getBytes(StandardCharsets.UTF_8));
            }
        } catch (Exception e) {
            Log.w(TAG, "request failed", e);
        }
    }

    private String run(JSONObject cmd) {
        String what = cmd.optString("do");
        switch (what) {
            case "launch": return Tv.launch(this, cmd.optString("pkg"));
            case "open": return Tv.openUrl(this, cmd.optString("url"), cmd.optString("pkg"));
            case "view": return HomeActivity.showPage(this, cmd.optString("url"));
            case "media": return Tv.media(this, cmd.optString("action"));
            case "input": return Tv.openInput(this, cmd.optString("id"));
            case "home": return Tv.goHome(this);
            case "settings": return Tv.settings(this);
            case "skin": {
                String id = cmd.optString("id").replaceAll("[^a-z]", "");
                return HomeActivity.pageCall("window.houseSkin && houseSkin('" + id + "')");
            }
            case "radio": {
                org.json.JSONArray urls = cmd.optJSONArray("urls");
                return Radio.play(cmd.optString("station"), urls == null ? "[]" : urls.toString());
            }
            case "radioStop": return Radio.stop();
            default: return "unknown command";
        }
    }

    private byte[] asset(String name) throws Exception {
        try (InputStream in = getAssets().open(name)) {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            return bos.toByteArray();
        }
    }

    private static void respond(OutputStream out, int code, String type, byte[] body) throws Exception {
        String status = code == 200 ? "OK" : code == 204 ? "No Content" : code == 403 ? "Forbidden" : "Not Found";
        String head = "HTTP/1.1 " + code + " " + status + "\r\n"
                + "Content-Type: " + type + "\r\n"
                + "Content-Length: " + body.length + "\r\n"
                + "Cache-Control: no-store\r\n"
                + "Access-Control-Allow-Origin: *\r\n"
                + "Access-Control-Allow-Headers: Content-Type\r\n"
                + "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
                + "Connection: close\r\n\r\n";
        out.write(head.getBytes(StandardCharsets.UTF_8));
        out.write(body);
        out.flush();
    }

    private static String readLine(InputStream in) throws Exception {
        StringBuilder sb = new StringBuilder();
        int c;
        while ((c = in.read()) >= 0) {
            if (c == '\n') break;
            if (c != '\r') sb.append((char) c);
            if (sb.length() > 8192) break;
        }
        if (c < 0 && sb.length() == 0) return null;
        return sb.toString();
    }

    private static String param(String query, String key) {
        for (String kv : query.split("&")) {
            int e = kv.indexOf('=');
            if (e > 0 && kv.substring(0, e).equals(key)) {
                try {
                    return URLDecoder.decode(kv.substring(e + 1), "UTF-8");
                } catch (Exception ignored) {
                }
            }
        }
        return "";
    }
}
