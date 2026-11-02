package dev.glidian.homedeck;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ApplicationInfo;
import android.graphics.Color;
import android.media.tv.TvInputManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayDeque;
import java.util.Locale;

/**
 * The home screen: Home Deck's own HTML, CSS and JavaScript, full screen in a WebView. The page is served
 * from the APK's assets under an https address, so it gets normal web storage and fetch. {@link Bridge} answers its
 * questions about the TV, and this activity tells it when something changes (music, inputs, coming back home).
 */
public class HomeActivity extends Activity {
    static final String TAG = "HomeDeck";
    static final String HOST = "appassets.androidplatform.net";
    private static final String START = "https://" + HOST + "/index.html";
    /** True while the home screen is in front. Every WebView in the app shares one set of timers, so the screen saver
     *  checks it before pausing them. */
    static boolean showing;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView web;
    private Bridge bridge;
    private NowPlaying nowPlaying;
    private TvInputManager tvInputs;
    private boolean resumed, pageReady, appsChanged;
    /** When the page's renderer last died, to stop recreating it if it keeps dying. */
    private final ArrayDeque<Long> rendererDeaths = new ArrayDeque<>();

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Window w = getWindow();
        w.addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);

        boolean debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        WebView.setWebContentsDebuggingEnabled(debuggable);

        nowPlaying = new NowPlaying(this, handler, () -> emit("now", bridge.nowPlaying()));
        bridge = new Bridge(this, nowPlaying);
        tvInputs = (TvInputManager) getSystemService(TV_INPUT_SERVICE);

        web = buildWebView();
        setContentView(web);
        web.loadUrl(START);
        web.requestFocus();

        IntentFilter pkgs = new IntentFilter();
        pkgs.addAction(Intent.ACTION_PACKAGE_ADDED);
        pkgs.addAction(Intent.ACTION_PACKAGE_REMOVED);
        pkgs.addAction(Intent.ACTION_PACKAGE_CHANGED);
        pkgs.addDataScheme("package");
        registerReceiver(packagesChanged, pkgs);
    }

    private WebView buildWebView() {
        WebView w = new WebView(this);
        w.setBackgroundColor(Color.BLACK);
        w.setFocusable(true);
        w.setFocusableInTouchMode(true);
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setTextZoom(100);
        w.addJavascriptInterface(bridge, "HomeBridge");
        w.setWebViewClient(new Assets());
        w.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.i(TAG, m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")");
                return true;
            }
        });
        return w;
    }

    /** Serves the page's files and the apps' icons. Anything else (the weather service) goes to the network. */
    private class Assets extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            String path = u.getPath();
            if (HOST.equals(u.getHost()) && path != null && path.startsWith("/native/icon/")) {
                byte[] png = bridge.iconPng(path.substring("/native/icon/".length()));
                return png != null ? new WebResourceResponse("image/png", null, new ByteArrayInputStream(png)) : notFound();
            }
            return asset(HomeActivity.this, u);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            return true;        // the home screen never navigates away
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            pageReady = true;
            emit("now", bridge.nowPlaying());
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // the renderer was killed (low memory) or crashed; without this the whole launcher goes down with it
            Log.w(TAG, "WebView renderer gone, crashed=" + detail.didCrash());
            if (view.getParent() instanceof ViewGroup) ((ViewGroup) view.getParent()).removeView(view);
            view.destroy();
            if (view != web) return true;               // a view already replaced; nothing more to do
            web = null;
            pageReady = false;
            long now = System.currentTimeMillis();
            rendererDeaths.addLast(now);
            while (now - rendererDeaths.peekFirst() > 60_000) rendererDeaths.removeFirst();
            if (rendererDeaths.size() > 3) {            // dying in a loop: give up rather than spin, Android restarts the launcher
                Log.e(TAG, "WebView renderer died " + rendererDeaths.size() + " times in a minute, closing");
                finish();
                return true;
            }
            web = buildWebView();
            setContentView(web);
            if (!resumed) web.onPause();                // match the activity's state; timers are shared and already right
            web.loadUrl(START);
            web.requestFocus();
            return true;
        }
    }

    /** A file from the APK's www folder, for a page served under {@link #HOST}; null for any other address. */
    static WebResourceResponse asset(Context c, Uri u) {
        if (!HOST.equals(u.getHost())) return null;
        String path = u.getPath();
        if (path == null || path.contains("..")) return notFound();
        if (path.equals("/favicon.ico")) return empty();        // a WebView asks for one; the TV never shows it
        try {
            InputStream in = c.getAssets().open("www" + path);
            String type = mime(path);
            return new WebResourceResponse(type, type.startsWith("text/") ? "utf-8" : null, in);
        } catch (IOException e) {
            return notFound();
        }
    }

    private static WebResourceResponse empty() {
        WebResourceResponse r = new WebResourceResponse("image/x-icon", null, new ByteArrayInputStream(new byte[0]));
        r.setStatusCodeAndReasonPhrase(204, "No Content");
        return r;
    }

    private static WebResourceResponse notFound() {
        WebResourceResponse r = new WebResourceResponse("text/plain", "utf-8", null);
        r.setStatusCodeAndReasonPhrase(404, "Not Found");
        return r;
    }

    private static String mime(String path) {
        String p = path.toLowerCase(Locale.ROOT);
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".js")) return "text/javascript";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".json")) return "application/json";
        return "text/plain";
    }

    /** Tells the page something changed: window.__native(type, data). */
    private void emit(String type, String json) {
        if (!pageReady || web == null) return;
        handler.post(() -> {
            if (web != null) web.evaluateJavascript("window.__native&&window.__native(" + JSONObject.quote(type) + ","
                    + (json != null ? json : "null") + ")", null);
        });
    }

    // ---------------------------------------------------------------- what changes while the home screen is open

    private final TvInputManager.TvInputCallback inputWatch = new TvInputManager.TvInputCallback() {
        @Override
        public void onInputStateChanged(String inputId, int state) {
            inputsSoon();
        }

        @Override
        public void onInputAdded(String inputId) {
            inputsSoon();
        }

        @Override
        public void onInputRemoved(String inputId) {
            inputsSoon();
        }

        @Override
        public void onInputUpdated(String inputId) {
            inputsSoon();
        }
    };

    private final Runnable sendInputs = () -> emit("inputs", bridge.inputs());

    /** HDMI-CEC devices tend to announce themselves in a burst; wait for it to settle. */
    private void inputsSoon() {
        handler.removeCallbacks(sendInputs);
        handler.postDelayed(sendInputs, 400);
    }

    private final BroadcastReceiver packagesChanged = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent i) {
            if (resumed) reload();
            else appsChanged = true;
        }
    };

    private void reload() {
        appsChanged = false;
        pageReady = false;
        if (web != null) web.reload();
    }

    @Override
    protected void onResume() {
        super.onResume();
        resumed = showing = true;
        if (web != null) {
            web.onResume();
            web.resumeTimers();
        }
        bridge.musicAccess = nowPlaying.start();
        if (tvInputs != null) tvInputs.registerCallback(inputWatch, handler);
        if (appsChanged) {
            reload();
        } else {
            emit("resume", null);
            emit("now", bridge.nowPlaying());
            inputsSoon();
        }
    }

    @Override
    protected void onPause() {
        resumed = showing = false;
        nowPlaying.stop();
        if (tvInputs != null) tvInputs.unregisterCallback(inputWatch);
        if (web != null) {
            web.onPause();
            web.pauseTimers();
        }
        super.onPause();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        emit("home", null);         // the remote's Home button while already home
    }

    @Override
    protected void onDestroy() {
        unregisterReceiver(packagesChanged);
        if (web != null) web.destroy();
        super.onDestroy();
    }

    // ---------------------------------------------------------------- remote keys

    /**
     * The D-pad reaches the page as arrow keys on its own. OK goes in as Enter and Back as Escape, sent here so a held
     * key's repeats are marked as repeats (the WebView marks none): holding OK opens the options, holding Back Jump To.
     */
    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        String key = null;
        switch (e.getKeyCode()) {
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
            case KeyEvent.KEYCODE_NUMPAD_ENTER:
                key = "Enter";
                break;
            case KeyEvent.KEYCODE_BACK:
            case KeyEvent.KEYCODE_ESCAPE:
                key = "Escape";
                break;
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
            case KeyEvent.KEYCODE_MEDIA_PLAY:
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
                key = "p";
                break;
            case KeyEvent.KEYCODE_MENU:
                key = "ContextMenu";
                break;
        }
        if (key == null) return super.dispatchKeyEvent(e);
        if (e.getAction() == KeyEvent.ACTION_DOWN || e.getAction() == KeyEvent.ACTION_UP) {
            String type = e.getAction() == KeyEvent.ACTION_DOWN ? "keydown" : "keyup";
            if (web != null) {
                // sent to the focused element, as a real key is, so it reaches the page's listeners only once
                web.evaluateJavascript("(document.activeElement||document.body).dispatchEvent(new KeyboardEvent('" + type + "',{key:'" + key
                        + "',repeat:" + (e.getRepeatCount() > 0) + ",bubbles:true,cancelable:true}))", null);
            }
        }
        return true;
    }

    @Override
    public void onBackPressed() {
        // Handled in dispatchKeyEvent; a home screen has nothing to go back to.
    }
}
