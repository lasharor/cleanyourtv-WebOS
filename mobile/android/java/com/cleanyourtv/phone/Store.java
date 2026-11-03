package com.cleanyourtv.phone;

import android.content.Context;
import android.content.SharedPreferences;

/** The two things the app keeps: where the TV is, and the address of its network card (for Wake-on-LAN). */
class Store {
    private final SharedPreferences p;

    Store(Context c) {
        p = c.getSharedPreferences("cytv", Context.MODE_PRIVATE);
    }

    String addr() {
        return p.getString("addr", "");
    }

    void setAddr(String a) {
        String v = clean(a);
        if (v.length() > 0) p.edit().putString("addr", v).apply(); // an address that is not one on this network is ignored, never stored
    }

    String mac() {
        return p.getString("mac", "");
    }

    /** the TV's own name, as its phone page reported it last time: only used on the "TV is off" screen */
    String name() {
        return p.getString("name", "");
    }

    void setName(String n) {
        String v = String.valueOf(n == null ? "" : n).trim();
        if (v.length() > 40) v = v.substring(0, 40);
        p.edit().putString("name", v).apply();
    }

    /** logging out: the app forgets everything it kept (the TV's address, name and network card address), and keeps one line for the start page to say what happened */
    void forget(String how) {
        p.edit().clear().putString("bye", "removed".equals(how) ? "removed" : "left").apply();
    }

    /** what the start page says once after a log out: "removed" (the TV forgot this phone too), "left" (the TV did not answer), or "" */
    String takeBye() {
        String v = p.getString("bye", "");
        if (v.length() > 0) p.edit().remove("bye").apply();
        return v;
    }

    void setMac(String m) {
        String v = cleanMac(m);
        if (v.length() > 0) p.edit().putString("mac", v).apply();
    }

    /** "192.168.1.50", "http://192.168.1.50:8794/" -> "192.168.1.50:8794" (the phone remote is always on 8794 unless given); "" when it is not
     *  a literal address on the local network: see Addr. Every way an address gets in (typed, linked, bridge, search) goes through here. */
    static String clean(String v) {
        return Addr.clean(v);
    }

    /** "a4-bb-cc-dd-ee-01", "a4:bb:cc:dd:ee:01" -> "A4:BB:CC:DD:EE:01"; "" when it is not an address. */
    static String cleanMac(String v) {
        String hex = String.valueOf(v == null ? "" : v).replaceAll("[^0-9a-fA-F]", "");
        if (hex.length() != 12) return "";
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < 12; i += 2) {
            if (b.length() > 0) b.append(':');
            b.append(hex.substring(i, i + 2).toUpperCase());
        }
        return b.toString();
    }
}
