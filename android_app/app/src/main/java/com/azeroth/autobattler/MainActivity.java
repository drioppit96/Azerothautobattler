package com.azeroth.autobattler;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/* The game in a web view: its files are in the app (assets/www - the same folders as "C:\wow excel"), served from
   https://appassets.androidplatform.net so the game loads its data like from the PC's server. The saves stay in the
   web view's storage (an update of the app keeps them). Back: closes the open window in the game, else the app goes
   to the background. Export writes the save to Downloads, Import picks a file. */
public class MainActivity extends Activity {
    private static final String START = "https://appassets.androidplatform.net/assets/www/game/index.html";
    private static final int PICK_FILE = 7;
    private WebView web;
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        WebView.setWebContentsDebuggingEnabled(true);
        web = new WebView(this);
        web.setBackgroundColor(0xff000000);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        s.setUserAgentString(s.getUserAgentString() + " AzerothApp");

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if ("appassets.androidplatform.net".equals(u.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception e) { /* no browser */ }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                try { startActivityForResult(Intent.createChooser(i, "Load characters"), PICK_FILE); }
                catch (Exception e) { fileCallback = null; return false; }
                return true;
            }
        });
        web.addJavascriptInterface(new Bridge(), "AzerothApp");
        web.loadUrl(START);
    }

    /* what the game can ask of the app */
    private class Bridge {
        @JavascriptInterface
        public boolean saveFile(String name, String text) {
            try {
                byte[] data = text.getBytes(StandardCharsets.UTF_8);
                String where;
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Downloads.DISPLAY_NAME, name);
                    v.put(MediaStore.Downloads.MIME_TYPE, "application/json");
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    try (OutputStream o = getContentResolver().openOutputStream(uri)) { o.write(data); }
                    where = "Downloads/" + name;
                } else {
                    File dir = getExternalFilesDir(null);
                    File f = new File(dir, name);
                    try (FileOutputStream o = new FileOutputStream(f)) { o.write(data); }
                    where = f.getAbsolutePath();
                }
                final String msg = "Saved: " + where;
                runOnUiThread(() -> Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show());
                return true;
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "Could not save the file", Toast.LENGTH_LONG).show());
                return false;
            }
        }
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req == PICK_FILE && fileCallback != null) {
            Uri[] r = null;
            if (res == RESULT_OK && data != null && data.getData() != null) r = new Uri[]{data.getData()};
            fileCallback.onReceiveValue(r);
            fileCallback = null;
            return;
        }
        super.onActivityResult(req, res, data);
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("(window.appBack && appBack()) ? 1 : 0", v -> { if (!"1".equals(v)) moveTaskToBack(true); });
    }

    @Override
    protected void onPause() {
        // the game saves (the time it stopped counts for offline progress); the web view stops until it comes back
        web.evaluateJavascript("window.save && save()", null);
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }
}
