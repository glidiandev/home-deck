package dev.glidian.homedeck;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.media.tv.TvContract;
import android.media.tv.TvInputInfo;
import android.media.tv.TvInputManager;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.webkit.JavascriptInterface;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * What the page asks the TV for: the installed apps, opening them, what is playing, the HDMI inputs and a few
 * settings screens. Every answer is JSON text. Called on a WebView thread, so nothing here touches views.
 */
final class Bridge {
    private final Context context;
    private final NowPlaying nowPlaying;
    private final SharedPreferences recents;
    /** Whether the user has given the music bar its access; kept up to date by the activity. */
    volatile boolean musicAccess;

    /**
     * Installed but not shown: manuals, firmware updaters, store demos, setup and factory tools that come with a TV
     * but aren't apps anyone opens. The TV's own input app is reached through Inputs and Live TV instead.
     */
    private static final Set<String> HIDDEN = new HashSet<>(Arrays.asList(
            "jp.co.sharp.av.android.emanual", "jp.co.sharp.av.android.epopdemo", "rcota.android.av.sharp.co.jp.rcota",
            "com.mediatek.wwtv.tvcenter",
            "com.google.android.tungsten.setupwraith", "com.google.android.tvtutorials",
            "fusion.android.tv.demo",
            "com.tcl.ocean.instructions", "com.tcl.repairguide", "com.tcl.exhibit", "com.tcl.esticker",
            "com.tcl.versionUpdateApp", "com.tcl.UpdatePeripheral", "com.tcl.useragreement",
            "com.hisense.fte", "com.vt.fte", "com.hisense.storemode", "com.vt.storemode", "com.hisense.tv.ota",
            "com.hisense.remoteupgrade", "com.vt.tv.ota", "com.vt.remoteupgrade",
            "com.sony.dtv.imanual", "com.sony.dtv.demomode", "com.sony.dtv.demosupport", "com.sony.dtv.multiscreendemo",
            "com.xiaomi.mitv.handbook", "com.xiaomi.mitv.manualhelp", "com.xiaomi.mitv.updateservice",
            "com.xiaomi.mitv.upgrade", "com.duokan.factorytest",
            "org.droidtv.demome", "com.Smartdevice.emanual"));

    /** Live TV apps that TV makers ship, tried in order. */
    private static final String ART = "www/icons";

    private static final String[] LIVE_TV = {
            "com.mediatek.wwtv.tvcenter", "com.google.android.tv", "com.android.tv", "com.sony.dtv.tvx",
            "com.tcl.tv", "com.hisense.tv"};

    Bridge(Context c, NowPlaying nowPlaying) {
        this.context = c;
        this.nowPlaying = nowPlaying;
        this.recents = c.getSharedPreferences("recents", Context.MODE_PRIVATE);
    }

    // ---------------------------------------------------------------- the TV

    @JavascriptInterface
    public String device() {
        DisplayMetrics m = context.getResources().getDisplayMetrics();
        String name = Settings.Global.getString(context.getContentResolver(), Settings.Global.DEVICE_NAME);
        JSONObject o = new JSONObject();
        put(o, "name", name != null ? name : android.os.Build.MODEL);
        put(o, "width", Math.max(m.widthPixels, m.heightPixels));
        put(o, "height", Math.min(m.widthPixels, m.heightPixels));
        // the panel itself: Android TVs often draw their interface at 1080p on a 4K screen
        int panel = 0;
        android.hardware.display.DisplayManager dm = context.getSystemService(android.hardware.display.DisplayManager.class);
        android.view.Display d = dm != null ? dm.getDisplay(android.view.Display.DEFAULT_DISPLAY) : null;
        if (d != null) for (android.view.Display.Mode mode : d.getSupportedModes()) {
            panel = Math.max(panel, Math.min(mode.getPhysicalWidth(), mode.getPhysicalHeight()));
        }
        put(o, "panel", panel);
        return o.toString();
    }

    @JavascriptInterface
    public String network() {
        JSONObject o = new JSONObject();
        ConnectivityManager cm = context.getSystemService(ConnectivityManager.class);
        NetworkCapabilities caps = cm != null ? cm.getNetworkCapabilities(cm.getActiveNetwork()) : null;
        if (caps == null) {
            put(o, "type", "none");
        } else if (caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) {
            put(o, "type", "ethernet");
        } else if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
            put(o, "type", "wifi");
            WifiManager wm = context.getApplicationContext().getSystemService(WifiManager.class);
            WifiInfo w = wm != null ? wm.getConnectionInfo() : null;
            if (w != null) {
                put(o, "mhz", w.getFrequency());
                put(o, "mbps", w.getLinkSpeed());
            }
        } else {
            put(o, "type", "other");
        }
        return o.toString();
    }

    // ---------------------------------------------------------------- apps

    @JavascriptInterface
    public String apps() {
        PackageManager pm = context.getPackageManager();
        Intent probe = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER);
        List<ResolveInfo> found = pm.queryIntentActivities(probe, 0);
        Set<String> seen = new HashSet<>();
        List<JSONObject> out = new ArrayList<>();
        for (ResolveInfo ri : found) {
            String pkg = ri.activityInfo.packageName;
            if (pkg.equals(context.getPackageName()) || HIDDEN.contains(pkg) || !seen.add(pkg)) continue;
            ApplicationInfo ai = ri.activityInfo.applicationInfo;
            String label = String.valueOf(ri.loadLabel(pm)).trim();
            JSONObject o = new JSONObject();
            put(o, "pkg", pkg);
            put(o, "label", label);
            put(o, "kind", kindOf(pkg, label, ai));
            put(o, "system", (ai.flags & ApplicationInfo.FLAG_SYSTEM) != 0);
            put(o, "icon", "/native/icon/" + pkg);
            out.add(o);
        }
        Collections.sort(out, (a, b) -> a.optString("label").compareToIgnoreCase(b.optString("label")));
        return new JSONArray(out).toString();
    }

    /** A rough kind for apps without a catalog entry, from words in the name, then what the app declares. */
    private static String kindOf(String pkg, String label, ApplicationInfo ai) {
        String hay = (label + " " + pkg).toLowerCase(Locale.ROOT);
        if (hay.matches(".*(music|radio|audio|podcast).*")) return "Music";
        if (hay.matches(".*(kids|junior).*")) return "Kids";
        if (hay.matches(".*(game|play\\.games|arcade).*")) return "Games";
        if (hay.matches(".*(news).*")) return "News";
        if (hay.matches(".*(sport|espn).*")) return "Sport";
        if (hay.matches(".*(player|media|video|movie|film|tv).*")) return "Player";
        switch (ai.category) {
            case ApplicationInfo.CATEGORY_AUDIO: return "Music";
            case ApplicationInfo.CATEGORY_GAME: return "Games";
            case ApplicationInfo.CATEGORY_VIDEO: return "Player";
            case ApplicationInfo.CATEGORY_NEWS: return "News";
            default: return "Tool";
        }
    }

    /** The tile art files the app carries, so the page only uses art that is really there. */
    @JavascriptInterface
    public String artFiles() {
        JSONArray out = new JSONArray();
        try {
            String[] files = context.getAssets().list(ART);
            if (files != null) for (String f : files) out.put(f);
        } catch (java.io.IOException ignored) {
            // no art folder: every app gets its badge
        }
        return out.toString();
    }

    /** The app's own TV icon as a PNG, for apps without tile art. Null when it has none. */
    byte[] iconPng(String pkg) {
        PackageManager pm = context.getPackageManager();
        try {
            Intent i = pm.getLeanbackLaunchIntentForPackage(pkg);
            Drawable d = null;
            if (i != null) {
                ResolveInfo ri = pm.resolveActivity(i, 0);
                if (ri != null) d = ri.loadIcon(pm);
            }
            if (d == null) d = pm.getApplicationIcon(pkg);
            int w = 192, h = 192;
            Bitmap b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
            d.setBounds(0, 0, w, h);
            d.draw(new Canvas(b));
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            b.compress(Bitmap.CompressFormat.PNG, 100, out);
            b.recycle();
            return out.toByteArray();
        } catch (PackageManager.NameNotFoundException | RuntimeException e) {
            return null;
        }
    }

    /** Opens an app and remembers when, for "Jump back in". */
    @JavascriptInterface
    public boolean launch(String pkg) {
        PackageManager pm = context.getPackageManager();
        Intent i = pm.getLeanbackLaunchIntentForPackage(pkg);
        if (i == null) i = pm.getLaunchIntentForPackage(pkg);
        if (i == null) return false;
        try {
            context.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED));
        } catch (ActivityNotFoundException | SecurityException e) {
            return false;
        }
        recents.edit().putLong(pkg, System.currentTimeMillis()).apply();
        return true;
    }

    /** When each app was last opened from here, as milliseconds since 1970. */
    @JavascriptInterface
    public String recents() {
        JSONObject o = new JSONObject();
        for (String k : recents.getAll().keySet()) put(o, k, recents.getLong(k, 0));
        return o.toString();
    }

    @JavascriptInterface
    public String appInfo(String pkg) {
        JSONObject o = new JSONObject();
        try {
            PackageInfo p = context.getPackageManager().getPackageInfo(pkg, 0);
            put(o, "version", p.versionName != null ? p.versionName : "");
            put(o, "installed", p.firstInstallTime);
            put(o, "updated", p.lastUpdateTime);
        } catch (PackageManager.NameNotFoundException e) {
            put(o, "missing", true);
        }
        return o.toString();
    }

    /** Asks Android to uninstall an app; the TV shows its own confirmation. */
    @JavascriptInterface
    public boolean uninstall(String pkg) {
        try {
            context.startActivity(new Intent(Intent.ACTION_DELETE, Uri.parse("package:" + pkg))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            return true;
        } catch (ActivityNotFoundException e) {
            return false;
        }
    }

    // ---------------------------------------------------------------- music

    @JavascriptInterface
    public String nowPlaying() {
        JSONObject o = new JSONObject();
        put(o, "access", musicAccess);
        if (musicAccess && nowPlaying.active()) {
            String pkg = nowPlaying.packageName();
            if (pkg != null) {
                put(o, "pkg", pkg);
                put(o, "label", labelOf(pkg));
                put(o, "title", nowPlaying.title());
                put(o, "artist", nullToEmpty(nowPlaying.artist()));
                put(o, "album", nullToEmpty(nowPlaying.album()));
                put(o, "playing", nowPlaying.playing());
                put(o, "elapsed", nowPlaying.elapsedSeconds());
                put(o, "total", nowPlaying.totalSeconds());
            }
        }
        return o.toString();
    }

    @JavascriptInterface
    public void playPause() {
        nowPlaying.playPause();
    }

    @JavascriptInterface
    public boolean skip(boolean next) {
        return nowPlaying.skip(next);
    }

    /** The shell command that gives the music bar its access, for the README and the settings line. */
    @JavascriptInterface
    public String listenerCommand() {
        return "adb shell cmd notification allow_listener " + NowPlaying.listener(context).flattenToShortString();
    }

    // ---------------------------------------------------------------- inputs

    /**
     * The TV's HDMI ports. A device that announces itself over HDMI-CEC (a console, a player) is listed by Android
     * as its own input under the port, so its name comes from there; a name given to the port in the TV's settings
     * comes next. "connected" is the TV's own idea of a signal, which some TVs report loosely.
     */
    @JavascriptInterface
    public String inputs() {
        JSONArray out = new JSONArray();
        TvInputManager tim = context.getSystemService(TvInputManager.class);
        if (tim == null) return out.toString();
        List<TvInputInfo> all;
        try {
            all = tim.getTvInputList();
        } catch (RuntimeException e) {
            return out.toString();
        }
        Set<String> hdmi = new HashSet<>();
        for (TvInputInfo i : all) if (i.isPassthroughInput() && i.getType() == TvInputInfo.TYPE_HDMI) hdmi.add(i.getId());
        List<TvInputInfo> ports = new ArrayList<>();
        for (TvInputInfo i : all) {
            if (!i.isPassthroughInput() || i.getType() != TvInputInfo.TYPE_HDMI) continue;
            if (i.getParentId() == null || !hdmi.contains(i.getParentId())) ports.add(i);
        }
        Collections.sort(ports, (a, b) -> Integer.compare(portNumber(a), portNumber(b)));
        int k = 1;
        for (TvInputInfo p : ports) {
            JSONObject o = new JSONObject();
            int n = portNumber(p);
            put(o, "id", p.getId());
            put(o, "n", n > 0 ? n : k);
            String cec = null;
            boolean child = false;
            for (TvInputInfo c : all) {
                if (!p.getId().equals(c.getParentId())) continue;
                child = true;
                if (cec == null) cec = nameOf(c, true);
            }
            if (cec == null) cec = nameOf(p, false);
            if (cec != null) put(o, "cec", cec);
            int state = tim.getInputState(p.getId());
            put(o, "connected", state == TvInputManager.INPUT_STATE_CONNECTED || child);
            put(o, "state", state);
            out.put(o);
            k++;
        }
        return out.toString();
    }

    private int portNumber(TvInputInfo i) {
        String digits = String.valueOf(i.loadLabel(context)).replaceAll("[^0-9]", "");
        try {
            return digits.isEmpty() ? 0 : Integer.parseInt(digits);
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    /** The name the user gave in the TV's settings, or (for a CEC device) the name it announces. */
    private String nameOf(TvInputInfo info, boolean orLabel) {
        CharSequence custom = info.loadCustomLabel(context);
        if (custom != null && custom.toString().trim().length() > 0) return custom.toString().trim();
        if (!orLabel) return null;
        CharSequence label = info.loadLabel(context);
        return label != null && label.toString().trim().length() > 0 ? label.toString().trim() : null;
    }

    @JavascriptInterface
    public boolean switchInput(String id) {
        Uri uri = TvContract.buildChannelUriForPassthroughInput(id);
        return start(new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "vnd.android.cursor.item/channel"));
    }

    @JavascriptInterface
    public boolean openLiveTv() {
        PackageManager pm = context.getPackageManager();
        for (String pkg : LIVE_TV) {
            Intent i = pm.getLeanbackLaunchIntentForPackage(pkg);
            if (i != null && start(i)) return true;
        }
        return start(new Intent(Intent.ACTION_VIEW, TvContract.Channels.CONTENT_URI));
    }

    // ---------------------------------------------------------------- settings screens

    /** Opens one of the TV's own settings screens: picture, sound, network, notification access, or all of them. */
    @JavascriptInterface
    public boolean openSettings(String which) {
        String action;
        switch (which) {
            case "picture": action = Settings.ACTION_DISPLAY_SETTINGS; break;
            case "sound": action = Settings.ACTION_SOUND_SETTINGS; break;
            case "network": action = Settings.ACTION_WIFI_SETTINGS; break;
            case "listener": action = Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS; break;
            default: action = Settings.ACTION_SETTINGS; break;
        }
        return start(new Intent(action)) || start(new Intent(Settings.ACTION_SETTINGS));
    }

    // ---------------------------------------------------------------- helpers

    private boolean start(Intent i) {
        try {
            context.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            return true;
        } catch (ActivityNotFoundException | SecurityException e) {
            return false;
        }
    }

    private String labelOf(String pkg) {
        try {
            PackageManager pm = context.getPackageManager();
            return String.valueOf(pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)));
        } catch (PackageManager.NameNotFoundException e) {
            return pkg;
        }
    }

    private static String nullToEmpty(String s) {
        return s != null ? s : "";
    }

    private static void put(JSONObject o, String k, Object v) {
        try {
            o.put(k, v);
        } catch (JSONException ignored) {
            // only thrown for NaN numbers and null keys, which never reach here
        }
    }
}
