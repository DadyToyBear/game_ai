package com.ministudio.app;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

/**
 * Mini Studio — веб-студия внутри WebView (Capacitor).
 * Всё считается на устройстве: Web Audio, WAV/MP3, ZIP. Интернет не нужен.
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        WebView webView = getBridge().getWebView();
        if (webView == null) return;

        webView.setBackgroundColor(Color.parseColor("#0B1118"));
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        // экран не гаснет во время игры на пэде
        webView.setKeepScreenOn(true);

        WebSettings s = webView.getSettings();
        s.setMediaPlaybackRequiresUserGesture(false); // звук после первого касания без доп. клика
        s.setSupportZoom(false);                      // никакого случайного зума щипком
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        s.setTextZoom(100);                           // системный масштаб шрифта не ломает верстку
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);

        applyImmersive();
    }

    /** Полноэкранный режим «от края до края»: вырез, жесты, панели свайпом. */
    private void applyImmersive() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        }
    }

    /** После возврата из фона снова прячем панели. */
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyImmersive();
    }
}
