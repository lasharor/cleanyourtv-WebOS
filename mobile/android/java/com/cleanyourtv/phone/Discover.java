package com.cleanyourtv.phone;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;

/** Finds the TV on the local network: one SSDP search, and the address comes back in the LOCATION header of LG's reply. */
class Discover {

    /** The TV's address as "192.168.1.50", or "" when nothing answered (multicast blocked, or another network). */
    static String find() {
        DatagramSocket s = null;
        try {
            s = new DatagramSocket();
            s.setSoTimeout(800);
            String msg = "M-SEARCH * HTTP/1.1\r\n"
                    + "HOST: 239.255.255.250:1900\r\n"
                    + "MAN: \"ssdp:discover\"\r\n"
                    + "MX: 2\r\n"
                    + "ST: urn:lge-com:service:webos-second-screen:1\r\n\r\n";
            byte[] data = msg.getBytes("UTF-8");
            InetAddress group = InetAddress.getByName("239.255.255.250");
            for (int i = 0; i < 2; i++) {
                try {
                    s.send(new DatagramPacket(data, data.length, group, 1900));
                } catch (Exception e) {
                    // try the second time anyway
                }
            }
            long end = System.currentTimeMillis() + 3500;
            byte[] buf = new byte[2048];
            while (System.currentTimeMillis() < end) {
                DatagramPacket p = new DatagramPacket(buf, buf.length);
                try {
                    s.receive(p);
                } catch (java.net.SocketTimeoutException te) {
                    continue;
                }
                String reply = new String(buf, 0, p.getLength(), "UTF-8");
                if (!isTv(reply)) continue; // some other machine answered the search: not the TV, whatever its LOCATION claims
                String host = host(reply);
                if (host.length() > 0) return host;
            }
        } catch (Exception e) {
            return "";
        } finally {
            if (s != null) s.close();
        }
        return "";
    }

    /** Is this reply the TV's own? The search asks for webos-second-screen, and LG's TV repeats that in its ST (and in its USN) header. A
     *  reply without it in either header is another machine answering for the TV, and its LOCATION is not the TV's address: ignored. */
    static boolean isTv(String reply) {
        String[] lines = String.valueOf(reply).split("\r?\n");
        for (String line : lines) {
            String u = line.trim().toUpperCase();
            if ((u.startsWith("ST:") || u.startsWith("USN:")) && u.indexOf("WEBOS-SECOND-SCREEN") >= 0) return true;
        }
        return false;
    }

    /** the host of the LOCATION line of an SSDP reply: "LOCATION: http://10.0.0.5:3000/x" -> "10.0.0.5" */
    static String host(String reply) {
        String[] lines = String.valueOf(reply).split("\r\n");
        for (String line : lines) {
            if (line.length() < 10 || !line.toUpperCase().startsWith("LOCATION:")) continue;
            String v = line.substring(9).trim();
            int scheme = v.indexOf("://");
            if (scheme >= 0) v = v.substring(scheme + 3);
            int slash = v.indexOf('/');
            if (slash >= 0) v = v.substring(0, slash);
            int colon = v.lastIndexOf(':');
            if (colon > 0) v = v.substring(0, colon);
            v = v.trim();
            String c = Addr.clean(v);
            return c.length() > 0 ? c.substring(0, c.indexOf(':')) : "";
        }
        return "";
    }
}
