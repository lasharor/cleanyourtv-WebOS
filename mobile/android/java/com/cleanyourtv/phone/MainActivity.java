package com.cleanyourtv.phone;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * The app is a shell around the TV's own phone remote page: the page, the pairing, the keys and the Power sheet are all served by the TV,
 * so nothing of that is written here again. The app adds what a browser cannot do:
 *  - send the Wake-on-LAN packet itself (in the app the page's "Turn on" calls the bridge instead of a relay);
 *  - open at all while the TV is off: the last page the TV served is kept on the phone and shown instead, so the remote (and its
 *    On/Off button, which then wakes the TV) is there even with the TV in standby. The bundled pages only appear when nothing was
 *    ever loaded (assets/start.html for the address, assets/off.html as the last resort).
 * The bridge, the whole API between the page and the phone: getAddr/setAddr, getMac/setMac (the TV's page hands the address over when it
 * connects), wake(), discover(). A QR code read by the phone's own camera app opens the app on the TV's page (cytv://add?host=…&code=…).
 */
public class MainActivity extends Activity {

    private static final String START = "file:///android_asset/start.html";
    /* the TV is off or not on this network: the remote's own look with a power button, never the pairing screen */
    private static final String OFF = "file:///android_asset/off.html";
    private WebView web;
    private Store store;
    private String pending = ""; // a pairing code from the QR code, waiting for the TV's page to be there
    private byte[] savedPage; // the last phone page the TV served: shown, from the phone, while the TV is off
    private String savedFor = ""; // ...for this address
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean retryPending; // a delayed reload is already waiting: a second error must not schedule another
    private int failures; // loads of the TV's page that failed in a row (main thread only)
    private long lastAttempt; // when the last of them was tried
    private boolean loadFailed; // an error was seen: the onPageFinished that follows it is not a success (it is only cleared there)
    private volatile boolean servedSaved; // the page now loading is the copy kept on the phone, not the TV's own
    private final Runnable retry = new Runnable() {
        public void run() {
            retryPending = false;
            reload();
        }
    };

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        store = new Store(this);
        web = new WebView(this);
        web.setBackgroundColor(0xFF101218); // the icon's tile: no white flash while the page comes
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true); // the phone's token lives in the localStorage of the TV's page: without this it would pair every time
        // the page is rendered by the TV on every request: a cached copy can only be an old one (a WebView keeps its own cache, headers or not)
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        s.setAllowFileAccess(true);
        web.addJavascriptInterface(new Bridge(), "CYTV_APP");
        web.clearCache(true); // an older page from before this setting, once
        web.setWebViewClient(new Client());
        setContentView(web);
        link(getIntent()); // a QR code opened us: it already put the address (and maybe the pairing code) in place
        if (store.addr().length() > 0) open();
        else start();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(retry);
        retryPending = false;
        super.onDestroy();
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        setIntent(i);
        if (link(i) || store.addr().length() > 0) open();
        else start();
    }

    /** cytv://add?host=192.168.1.50:8794&code=123456 (the code the TV shows): returns true when the link was for this app. A link is a
     *  browsable intent, so any web page can send one: the address must be a literal one on the local network (Store.clean), and when the
     *  app already has a TV the new address is only taken after the user says so. The pairing code is kept for the page only once the
     *  address is accepted. */
    private boolean link(Intent i) {
        if (i == null || i.getData() == null || !"cytv".equals(i.getData().getScheme())) return false;
        final String v = Store.clean(i.getData().getQueryParameter("host"));
        if (v.length() == 0) {
            Toast.makeText(this, "That link is not the address of a TV on your local network (like 192.168.1.50), so it was ignored.",
                    Toast.LENGTH_LONG).show();
            return false;
        }
        String c = String.valueOf(i.getData().getQueryParameter("code") == null ? "" : i.getData().getQueryParameter("code"))
                .replaceAll("[^0-9]", "");
        final String code = c.length() == 6 ? c : "";
        String saved = store.addr();
        if (saved.length() == 0 || saved.equals(v)) {
            store.setAddr(v);
            if (code.length() == 6) pending = code; // the page fills it in as soon as it is there; the user names the phone and taps Pair
            return true;
        }
        pending = ""; // nothing is paired until the user agrees
        new AlertDialog.Builder(this)
                .setTitle("Connect to " + v + "?")
                .setMessage("A link asks this app to use another TV. Only connect if you started this yourself, from the TV's screen.")
                .setCancelable(false)
                .setPositiveButton("Connect", new DialogInterface.OnClickListener() {
                    public void onClick(DialogInterface d, int w) {
                        store.setAddr(v);
                        if (code.length() == 6) pending = code;
                        open();
                    }
                })
                .setNegativeButton("Cancel", new DialogInterface.OnClickListener() {
                    public void onClick(DialogInterface d, int w) {
                        pending = "";
                    }
                })
                .show();
        return true;
    }

    private void start() {
        cancelRetry();
        if (!START.equals(web.getUrl())) web.loadUrl(START);
    }

    /** the page file on the phone: the last one the TV served, kept across restarts of the app */
    private File pageFile() {
        return new File(getFilesDir(), "tv-page.html");
    }

    private void loadSaved() {
        if (savedPage != null && store.addr().equals(savedFor)) return;
        savedPage = null;
        savedFor = store.addr();
        InputStream in = null;
        try {
            in = new FileInputStream(pageFile());
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] b = new byte[8192];
            int n;
            while ((n = in.read(b)) > 0) out.write(b, 0, n);
            savedPage = out.toByteArray();
        } catch (Exception e) {
            savedPage = null;
        } finally {
            try {
                if (in != null) in.close();
            } catch (Exception e) {
                // nothing
            }
        }
    }

    /** keep the page the TV just served, so the remote can be drawn while the TV is off */
    private void savePage() {
        final String addr = store.addr();
        if (addr.length() == 0) return;
        new Thread(new Runnable() {
            public void run() {
                try {
                    HttpURLConnection c = (HttpURLConnection) new URL("http://" + addr + "/").openConnection();
                    c.setConnectTimeout(4000);
                    c.setReadTimeout(6000);
                    c.setRequestProperty("Cache-Control", "no-store");
                    InputStream in = c.getInputStream();
                    ByteArrayOutputStream out = new ByteArrayOutputStream();
                    byte[] b = new byte[8192];
                    int n;
                    while ((n = in.read(b)) > 0) out.write(b, 0, n);
                    in.close();
                    final byte[] page = out.toByteArray();
                    if (page.length < 500) return;
                    savedPage = page;
                    savedFor = addr;
                    FileOutputStream f = new FileOutputStream(pageFile());
                    f.write(page);
                    f.close();
                } catch (Exception e) {
                    // the TV went away while we asked: the page we have is still the best one
                }
            }
        }).start();
    }

    private void cancelRetry() {
        handler.removeCallbacks(retry);
        retryPending = false;
    }

    private void open() {
        cancelRetry();
        servedSaved = false;
        web.loadUrl("http://" + store.addr() + "/");
    }

    /** the TV's page did not load: try again, at once the first time, then after 1 s, 2 s, 4 s ... never more than 10 s apart, so a TV whose
     *  port answers but whose service is restarting is not asked in a loop. One reload waits at a time. Main thread. */
    private void lost() {
        if (retryPending) return;
        long now = System.currentTimeMillis();
        if (now - lastAttempt > 30000) failures = 0; // it has been quiet for a while: start over
        long wait = Backoff.delay(failures);
        failures++;
        lastAttempt = now;
        if (wait <= 0) {
            reload();
            return;
        }
        retryPending = true;
        handler.postDelayed(retry, wait);
    }

    /** show the last page the TV served (the remote, with its On/Off button), or the off screen */
    private void reload() {
        if (store.addr().length() == 0) {
            off();
            return;
        }
        loadSaved();
        if (savedPage != null && savedPage.length > 0) {
            servedSaved = false;
            web.loadUrl("http://" + store.addr() + "/");
        } else off();
    }

    /** the last resort when there is not even a page to show: offer to turn the TV on */
    private void off() {
        cancelRetry();
        if (!OFF.equals(web.getUrl())) web.loadUrl(OFF);
    }

    /** call a function of the page that is on screen, from a thread that is not the UI one */
    private void js(final String code) {
        runOnUiThread(new Runnable() {
            public void run() {
                try {
                    web.evaluateJavascript(code, null);
                } catch (Exception e) {
                    // the page is not there any more
                }
            }
        });
    }

    private class Client extends WebViewClient {

        /** the TV's own page, from the phone, when the TV does not answer: the remote draws itself and its power button wakes the TV */
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
            if (r == null || r.getUrl() == null) return null;
            String addr = store.addr();
            if (addr.length() == 0) return null;
            String url = r.getUrl().toString();
            if (!("http://" + addr + "/").equals(url)) return null;
            loadSaved();
            if (savedPage == null || savedPage.length == 0) return null;
            if (Reach.up(addr, 400)) return null; // the TV is there: its own page, always the current one
            servedSaved = true; // this load is the copy on the phone: finishing it says nothing about the TV
            return new WebResourceResponse("text/html", "utf-8", new ByteArrayInputStream(savedPage));
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView v, String url) {
            if (url == null) return false;
            if (url.startsWith(START) || url.startsWith(OFF)) return false;
            String base = store.addr().length() > 0 ? "http://" + store.addr() : "";
            if (base.length() > 0 && url.startsWith(base)) return false;
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            } catch (Exception e) {
                // nothing can take it
            }
            return true;
        }

        // API 23 and newer
        @Override
        public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
            if (r != null && r.isForMainFrame()) {
                loadFailed = true;
                lost();
            }
        }

        // API 21 and 22
        @Override
        public void onReceivedError(WebView v, int code, String desc, String failing) {
            loadFailed = true;
            lost();
        }

        @Override
        public void onReceivedHttpError(WebView v, WebResourceRequest r, WebResourceResponse e) {
            if (r != null && r.isForMainFrame()) {
                loadFailed = true;
                lost();
            }
        }

        @Override
        public void onPageFinished(WebView v, String url) {
            if (url != null && url.startsWith("http://" + store.addr() + "/")) {
                if (loadFailed) loadFailed = false; // an error page also ends in onPageFinished: not a success
                else if (servedSaved) servedSaved = false; // the saved copy, not the TV: keep the backoff
                else {
                    failures = 0; // the TV's own page loaded: the next failure starts again at once
                    cancelRetry();
                }
            }
            // the TV's page is up and a code came with the QR code: pair now, so the remote is ready without typing anything
            if (url != null && url.startsWith("http://" + store.addr() + "/")) savePage(); // so the remote can be shown with the TV off
            if (pending.length() != 6 || url == null || !url.startsWith("http://" + store.addr())) return;
            String code = pending;
            pending = "";
            js("window.cytvPair&&cytvPair('" + code + "');");
        }
    }

    private class Bridge {

        @JavascriptInterface
        public String getAddr() {
            return store.addr();
        }

        @JavascriptInterface
        public void setAddr(String a) {
            store.setAddr(a);
        }

        @JavascriptInterface
        public String getMac() {
            return store.mac();
        }

        /** the TV's page calls this once it has connected: the address of the TV's network card, for the wake packet */
        @JavascriptInterface
        public void setMac(String m) {
            store.setMac(m);
        }

        /** send the packet, then open the TV as soon as it answers; false when the TV was never connected, so the page can say so */
        @JavascriptInterface
        public boolean wake() {
            final String mac = store.mac();
            final String addr = store.addr();
            if (mac.length() == 0) return false;
            new Thread(new Runnable() {
                public void run() {
                    Wake.send(mac);
                    for (int i = 0; i < 45; i++) {
                        try {
                            Thread.sleep(1000);
                        } catch (InterruptedException e) {
                            return;
                        }
                        if (!Reach.up(addr)) continue;
                        runOnUiThread(new Runnable() {
                            public void run() {
                                open();
                            }
                        });
                        return;
                    }
                    js("if(window.cytvOff)cytvOff('The TV did not wake up. Check that TV On With Mobile is on in the TV settings.');");
                }
            }).start();
            return true;
        }

        /** a short tick under the thumb for a key press: a WebView has no navigator.vibrate, so the phone does it here */
        @JavascriptInterface
        public void buzz() {
            try {
                android.os.Vibrator v = (android.os.Vibrator) getSystemService(VIBRATOR_SERVICE);
                if (v == null || !v.hasVibrator()) return;
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O)
                    v.vibrate(android.os.VibrationEffect.createOneShot(12, 90));
                else v.vibrate(12);
            } catch (Exception ignored) {
                // no vibrator, or the system refused it: a key press still works
            }
        }

        /** is the TV's page answering? a socket that died silently (standby) does not say so, this does */
        @JavascriptInterface
        public boolean up() {
            return Reach.up(store.addr(), 600);
        }

        /** the off screen: try again, go back to the pairing screen, or read the name the TV gave last time */
        @JavascriptInterface
        public void open() {
            runOnUiThread(new Runnable() {
                public void run() {
                    MainActivity.this.open();
                }
            });
        }

        @JavascriptInterface
        public void start() {
            runOnUiThread(new Runnable() {
                public void run() {
                    MainActivity.this.start();
                }
            });
        }

        @JavascriptInterface
        public String name() {
            return store.name();
        }

        /** log out of the TV (the page has told the TV, if it could): the app forgets the TV and shows its start page, with what happened */
        @JavascriptInterface
        public void forget(final String how) {
            runOnUiThread(new Runnable() {
                public void run() {
                    store.forget(how);
                    savedPage = null;
                    savedFor = "";
                    pageFile().delete();
                    android.webkit.WebStorage.getInstance().deleteAllData();
                    web.clearCache(true);
                    MainActivity.this.start();
                }
            });
        }

        /** the start page asks once what the last log out did */
        @JavascriptInterface
        public String bye() {
            return store.takeBye();
        }

        @JavascriptInterface
        public void setName(String n) {
            store.setName(n);
        }

        /** the code typed (or scanned) with the address: to the page when it is up, otherwise kept for when it is */
        @JavascriptInterface
        public void pair(String code) {
            final String c = String.valueOf(code == null ? "" : code).replaceAll("[^0-9]", "");
            if (c.length() != 6) return;
            String url = web.getUrl();
            if (url != null && url.startsWith("http://" + store.addr())) js("window.cytvPair&&cytvPair('" + c + "');");
            else pending = c;
        }

        /** look for the TV on this network; the answer goes to window.cytvFound / window.cytvNotFound */
        @JavascriptInterface
        public void discover() {
            new Thread(new Runnable() {
                public void run() {
                    String host = Discover.find();
                    if (host.length() > 0) js("if(window.cytvFound)cytvFound('" + host + "');");
                    else js("if(window.cytvNotFound)cytvNotFound();");
                }
            }).start();
        }
    }
}
