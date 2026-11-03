package com.cleanyourtv.phone;

/**
 * The only addresses the app will ever open: a literal IPv4 address on the local network (10/8, 172.16/12, 192.168/16, link-local
 * 169.254/16) with an optional port. No Android classes here, so the rules can be tested with a plain javac. Hostnames, public
 * addresses, IPv6, credentials and paths are refused, because the app's page has a bridge (setAddr, wake, pair) that must never be
 * pointed at a machine someone else controls.
 */
final class Addr {
    static final int PORT = 8799;

    private Addr() {}

    /** "192.168.1.50", "http://192.168.1.50:8799/" -> "192.168.1.50:8799"; "" when it is not a private IPv4 address. */
    static String clean(String v) {
        String s = String.valueOf(v == null ? "" : v).trim();
        if (s.regionMatches(true, 0, "http://", 0, 7)) s = s.substring(7);
        while (s.length() > 0 && s.charAt(s.length() - 1) == '/') s = s.substring(0, s.length() - 1);
        if (s.length() == 0) return "";
        String host = s;
        int port = PORT;
        int colon = s.indexOf(':');
        if (colon >= 0) {
            host = s.substring(0, colon);
            String p = s.substring(colon + 1);
            if (!p.matches("[0-9]{1,5}")) return "";
            port = Integer.parseInt(p);
            if (port < 1 || port > 65535) return "";
        }
        String[] parts = host.split("[.]", -1);
        if (parts.length != 4) return "";
        int[] o = new int[4];
        for (int i = 0; i < 4; i++) {
            if (!parts[i].matches("[0-9]{1,3}") || (parts[i].length() > 1 && parts[i].charAt(0) == '0')) return "";
            o[i] = Integer.parseInt(parts[i]);
            if (o[i] > 255) return "";
        }
        boolean priv = o[0] == 10
                || (o[0] == 172 && o[1] >= 16 && o[1] <= 31)
                || (o[0] == 192 && o[1] == 168)
                || (o[0] == 169 && o[1] == 254);
        if (!priv) return "";
        return o[0] + "." + o[1] + "." + o[2] + "." + o[3] + ":" + port;
    }
}
