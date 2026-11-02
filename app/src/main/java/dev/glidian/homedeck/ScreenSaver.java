package dev.glidian.homedeck;

import android.graphics.Color;
import android.service.dreams.DreamService;
import android.util.Log;
import android.view.ViewGroup;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * The screen saver (Settings > Device Preferences > Screen saver): the home screen's away screen, a dim clock that
 * moves every 20 seconds so nothing burns in. Its page reads only the home screen's own settings; the weather shows
 * only when it's switched on there. Any button ends it, and the TV still goes to sleep on its own timer.
 */
public class ScreenSaver extends DreamService {
    private static final String PAGE = "https://" + HomeActivity.HOST + "/away.html";
    private WebView web;

    @Override
    public void onAttachedToWindow() {
        super.onAttachedToWindow();
        setInteractive(false);
        setFullscreen(true);
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setTextZoom(100);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                return HomeActivity.asset(ScreenSaver.this, req.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                return true;
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // the renderer was killed or crashed; end the screen saver instead of taking the app down
                Log.w(HomeActivity.TAG, "WebView renderer gone, crashed=" + detail.didCrash());
                if (view.getParent() instanceof ViewGroup) ((ViewGroup) view.getParent()).removeView(view);
                view.destroy();
                if (view == web) web = null;
                finish();
                return true;
            }
        });
        setContentView(web);
    }

    @Override
    public void onDreamingStarted() {
        super.onDreamingStarted();
        web.resumeTimers();         // the home screen pauses them when anything covers it, this screen saver included
        web.loadUrl(PAGE);
    }

    @Override
    public void onDetachedFromWindow() {
        if (web != null) {
            if (!HomeActivity.showing) web.pauseTimers();
            web.destroy();
            web = null;
        }
        super.onDetachedFromWindow();
    }
}
