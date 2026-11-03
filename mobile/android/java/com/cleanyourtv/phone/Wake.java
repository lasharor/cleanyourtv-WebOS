package com.cleanyourtv.phone;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.List;

/** The Wake-on-LAN packet, and the addresses it goes to. Nothing here needs a permission: a phone may send broadcast UDP. */
class Wake {

    /** six 0xFF bytes and then the address sixteen times: 102 bytes, the packet every TV's network chip listens for. */
    static byte[] packet(String mac) {
        String hex = Store.cleanMac(mac).replace(":", "");
        if (hex.length() != 12) return null;
        byte[] out = new byte[6 + 16 * 6];
        for (int i = 0; i < 6; i++) out[i] = (byte) 0xFF;
        for (int i = 0; i < 16; i++)
            for (int j = 0; j < 6; j++)
                out[6 + i * 6 + j] = (byte) Integer.parseInt(hex.substring(j * 2, j * 2 + 2), 16);
        return out;
    }

    /** Sends it to the limited broadcast and to the broadcast address of every network the phone is on, on ports 9 and 7 (as a PC on
     *  the same network woke the TV). Returns true when at least one copy went out. */
    static boolean send(String mac) {
        byte[] pkt = packet(mac);
        if (pkt == null) return false;
        DatagramSocket s = null;
        boolean any = false;
        try {
            s = new DatagramSocket();
            s.setBroadcast(true);
            for (String host : hosts()) {
                InetAddress a = InetAddress.getByName(host);
                for (int port : new int[] { 9, 7 }) {
                    try {
                        s.send(new DatagramPacket(pkt, pkt.length, a, port));
                        any = true;
                    } catch (Exception e) {
                        // a network that refuses a broadcast is skipped; the others still try
                    }
                }
            }
        } catch (Exception e) {
            return false;
        } finally {
            if (s != null) s.close();
        }
        return any;
    }

    static List<String> hosts() {
        List<String> out = new ArrayList<String>();
        out.add("255.255.255.255");
        try {
            Enumeration<NetworkInterface> en = NetworkInterface.getNetworkInterfaces();
            while (en.hasMoreElements()) {
                NetworkInterface n = en.nextElement();
                if (!n.isUp() || n.isLoopback()) continue;
                for (InterfaceAddress ia : n.getInterfaceAddresses()) {
                    InetAddress b = ia.getBroadcast();
                    if (b == null) continue;
                    String h = b.getHostAddress();
                    if (h.indexOf(':') >= 0 || out.contains(h)) continue; // IPv6 has no broadcast
                    out.add(h);
                }
            }
        } catch (Exception e) {
            // only the limited broadcast then
        }
        return out;
    }
}
