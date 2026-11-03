package com.cleanyourtv.phone;

import java.net.InetSocketAddress;
import java.net.Socket;

/** Is the TV's page there? One TCP connection to the phone remote's port: the cheapest true answer (in standby nothing answers). */
class Reach {
    static boolean up(String addr) {
        return up(addr, 1500);
    }

    /** the same with a wait: the page asks every few seconds, so it must not wait long */
    static boolean up(String addr, int ms) {
        if (addr == null) return false;
        int i = addr.lastIndexOf(':');
        if (i < 1) return false;
        try {
            Socket s = new Socket();
            s.connect(new InetSocketAddress(addr.substring(0, i), Integer.parseInt(addr.substring(i + 1))), ms);
            s.close();
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}
