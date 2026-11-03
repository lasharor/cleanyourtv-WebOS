package com.cleanyourtv.phone;

/** How long to wait before the next reload of the TV's page after a failed load. Pure, so it can be tested. */
final class Backoff {
    static final long CAP_MS = 10000;

    private Backoff() {}

    /** failures so far (0 = the first failure): 0 ms (once, at once), then 1 s, 2 s, 4 s, 8 s, and never more than 10 s. */
    static long delay(int failures) {
        if (failures <= 0) return 0;
        if (failures > 4) return CAP_MS;
        return Math.min(CAP_MS, 1000L << (failures - 1));
    }
}
