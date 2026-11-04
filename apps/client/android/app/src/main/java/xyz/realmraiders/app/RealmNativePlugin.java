package xyz.realmraiders.app;

import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.Uri;
import java.net.Inet4Address;
import android.util.Base64;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;

/**
 * Small in-app native helpers (no extra libraries, so the APK stays small).
 * shareImage: write a base64 PNG to the cache and open the Android share sheet with it
 * (the share sheet takes files, not data: URLs).
 * wifiIp: this phone's IPv4 address on the current network, so Play with Friends can scan the
 * /24 for a host (a WebView can't see its own LAN address).
 */
@CapacitorPlugin(name = "RealmNative")
public class RealmNativePlugin extends Plugin {

    @PluginMethod
    public void wifiIp(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            Network net = cm == null ? null : cm.getActiveNetwork();
            LinkProperties lp = net == null ? null : cm.getLinkProperties(net);
            if (lp != null) {
                for (LinkAddress la : lp.getLinkAddresses()) {
                    if (la.getAddress() instanceof Inet4Address && !la.getAddress().isLoopbackAddress()) {
                        ret.put("ip", la.getAddress().getHostAddress());
                        ret.put("prefix", la.getPrefixLength());
                        break;
                    }
                }
            }
        } catch (Exception e) {
            // No address: the app falls back to manual entry.
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void shareImage(PluginCall call) {
        String data = call.getString("base64");
        String name = call.getString("fileName", "realm-raiders.png");
        if (data == null || data.isEmpty()) {
            call.reject("No image to share.");
            return;
        }
        try {
            File dir = new File(getContext().getCacheDir(), "share");
            if (!dir.exists() && !dir.mkdirs()) throw new Exception("Could not create the share folder.");
            File file = new File(dir, name.replaceAll("[^A-Za-z0-9._-]", "_"));
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(Base64.decode(data, Base64.DEFAULT));
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("image/png");
            send.putExtra(Intent.EXTRA_STREAM, uri);
            String text = call.getString("text");
            if (text != null) send.putExtra(Intent.EXTRA_TEXT, text);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, call.getString("title", "Share"));
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooser);
            JSObject ret = new JSObject();
            ret.put("shared", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not share the card: " + e.getMessage());
        }
    }
}
