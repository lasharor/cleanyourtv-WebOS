/* MIT. Bounded manual input trial; never installs hooks or changes firmware. */
#define _GNU_SOURCE
#include <assert.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <linux/input.h>
#include <linux/uinput.h>
#include <poll.h>
#include <signal.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/ioctl.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

/* LG extends key codes beyond the build host's KEY_MAX. */
#define KEY_LIMIT 2048
#define HOME_CODE 773
static volatile sig_atomic_t stopping;
static unsigned char held[KEY_LIMIT / 8];
static bool bit(const unsigned char *b, unsigned int n) { return (b[n / 8] & (1U << (n % 8))) != 0; }
static void set_bit(unsigned char *b, unsigned int n, bool on) {
    if (on) b[n / 8] |= (unsigned char)(1U << (n % 8));
    else b[n / 8] &= (unsigned char)~(1U << (n % 8));
}
static void stop_signal(int sig) { (void)sig; stopping = 1; }
static long long now_ms(void) {
    struct timespec t;
    if (clock_gettime(CLOCK_MONOTONIC, &t) != 0) return -1;
    return (long long)t.tv_sec * 1000 + t.tv_nsec / 1000000;
}
static int write_all(int fd, const void *data, size_t size) {
    const unsigned char *p = data;
    while (size) {
        ssize_t n = write(fd, p, size);
        if (n < 0 && errno == EINTR && !stopping) continue;
        if (n <= 0) return -1;
        p += n; size -= (size_t)n;
    }
    return 0;
}
/* -1: lost/invalid stream, 0: HOME removed, 1: forward unchanged. */
static int filter_event(const struct input_event *ev) {
    if (ev->type == EV_SYN && ev->code == SYN_DROPPED) return -1;
    if (ev->type != EV_SYN && ev->type != EV_KEY && ev->type != EV_REL) return -1;
    if (ev->type == EV_KEY) {
        if (ev->code >= KEY_LIMIT || ev->value < 0 || ev->value > 2) return -1;
        if (ev->code == HOME_CODE) return 0;
        set_bit(held, ev->code, ev->value != 0);
    }
    return 1;
}
static int read_name(int fd, char *name, size_t len) {
    memset(name, 0, len);
    return ioctl(fd, EVIOCGNAME(len - 1), name);
}
static bool consumer_has(const char *pid, const char *device) {
    char folder[128], link[192], target[256], name[32];
    snprintf(folder, sizeof(folder), "/proc/%s/comm", pid);
    FILE *f = fopen(folder, "r");
    if (!f) return false;
    bool same = fgets(name, sizeof(name), f) && strcmp(name, "surface-manager\n") == 0;
    fclose(f);
    if (!same) return false;
    snprintf(folder, sizeof(folder), "/proc/%s/fd", pid);
    DIR *d = opendir(folder);
    if (!d) return false;
    bool found = false;
    struct dirent *entry;
    while ((entry = readdir(d))) {
        if (entry->d_name[0] == '.' || strlen(entry->d_name) > 20) continue;
        snprintf(link, sizeof(link), "%s/%.20s", folder, entry->d_name);
        ssize_t n = readlink(link, target, sizeof(target) - 1);
        if (n < 0) continue;
        target[n] = 0;
        if (strcmp(target, device) == 0) { found = true; break; }
    }
    closedir(d);
    return found;
}
static int find_consumer(char *pid, size_t len) {
    DIR *d = opendir("/proc");
    if (!d) return -1;
    struct dirent *entry;
    int result = -1;
    while ((entry = readdir(d))) {
        if (strspn(entry->d_name, "0123456789") != strlen(entry->d_name) || strlen(entry->d_name) > 10) continue;
        if (consumer_has(entry->d_name, "/dev/input/event1")) {
            snprintf(pid, len, "%.10s", entry->d_name); result = 0; break;
        }
    }
    closedir(d);
    return result;
}
static int proxy_path(int fd, char *device, size_t len) {
    char sysname[64] = {0}, folder[128];
    if (ioctl(fd, UI_GET_SYSNAME(sizeof(sysname) - 1), sysname) < 0 || strncmp(sysname, "input", 5) != 0 ||
        strspn(sysname + 5, "0123456789") != strlen(sysname + 5)) return -1;
    snprintf(folder, sizeof(folder), "/sys/devices/virtual/input/%s", sysname);
    DIR *d = opendir(folder);
    if (!d) return -1;
    struct dirent *entry;
    int result = -1;
    while ((entry = readdir(d))) {
        if (strncmp(entry->d_name, "event", 5) != 0 || strlen(entry->d_name) > 15 ||
            strspn(entry->d_name + 5, "0123456789") != strlen(entry->d_name + 5)) continue;
        snprintf(device, len, "/dev/input/%.15s", entry->d_name); result = 0; break;
    }
    closedir(d);
    return result;
}
static void release_held(int proxy) {
    struct input_event ev;
    memset(&ev, 0, sizeof(ev));
    ev.type = EV_KEY;
    for (unsigned int k = 0; k < KEY_LIMIT; k++) if (bit(held, k)) {
        ev.code = (unsigned short)k;
        (void)write_all(proxy, &ev, sizeof(ev));
    }
    ev.type = EV_SYN; ev.code = SYN_REPORT;
    (void)write_all(proxy, &ev, sizeof(ev));
}
static int self_test(void) {
    struct input_event ev;
    memset(&ev, 0, sizeof(ev)); ev.type = EV_KEY; ev.code = HOME_CODE;
    for (int value = 0; value <= 2; value++) { ev.value = value; assert(filter_event(&ev) == 0); }
    ev.code = 103; ev.value = 1; assert(filter_event(&ev) == 1 && bit(held, 103));
    ev.value = 2; assert(filter_event(&ev) == 1 && bit(held, 103));
    ev.value = 0; assert(filter_event(&ev) == 1 && !bit(held, 103));
    ev.code = 1037; ev.value = 1; assert(filter_event(&ev) == 1 && bit(held, 1037));
    ev.code = KEY_LIMIT; assert(filter_event(&ev) == -1);
    ev.code = 412; ev.value = 8; assert(filter_event(&ev) == -1);
    ev.type = EV_SYN; ev.code = SYN_DROPPED; assert(filter_event(&ev) == -1);
    ev.code = SYN_REPORT; assert(filter_event(&ev) == 1);
    ev.type = EV_REL; ev.code = REL_X; assert(filter_event(&ev) == 1);
    ev.type = EV_ABS; assert(filter_event(&ev) == -1);
    puts("{\"event\":\"self-test-passed\"}"); return 0;
}

int main(int argc, char **argv) {
    if (argc == 2 && strcmp(argv[1], "--self-test") == 0) return self_test();
    bool probe = argc == 2 && strcmp(argv[1], "--probe") == 0;
    bool check = argc == 2 && strcmp(argv[1], "--check") == 0;
    bool trial = argc == 2 && strcmp(argv[1], "--filter-only") == 0;
    if (!probe && !check && !trial) { fputs("Usage: home-input --self-test | --probe | --check | --filter-only\n", stderr); return 2; }
    int input = -1, proxy = -1, lock = -1, status = 1;
    const char *stage = "probe";
    bool created = false, grabbed = false;
    char name[128], consumer[16], device[64] = {0};
    unsigned char types[8] = {0}, keys[KEY_LIMIT / 8] = {0}, rel[8] = {0};
    struct uinput_user_dev setup;
    memset(&setup, 0, sizeof(setup));
    signal(SIGTERM, stop_signal); signal(SIGINT, stop_signal); signal(SIGHUP, stop_signal); signal(SIGALRM, stop_signal);
    signal(SIGPIPE, SIG_IGN);
    alarm(120);
    long long deadline = now_ms() + 120000;
    setvbuf(stdout, NULL, _IONBF, 0);
    input = open("/dev/input/event1", O_RDONLY | O_NONBLOCK | O_CLOEXEC);
    if (input < 0 || read_name(input, name, sizeof(name)) < 0 || strcmp(name, "LGE RCU") != 0 ||
        ioctl(input, EVIOCGBIT(0, sizeof(types)), types) < 0 || ioctl(input, EVIOCGBIT(EV_KEY, sizeof(keys)), keys) < 0 ||
        ioctl(input, EVIOCGBIT(EV_REL, sizeof(rel)), rel) < 0 || ioctl(input, EVIOCGID, &setup.id) < 0 ||
        !bit(keys, HOME_CODE) || !bit(types, EV_KEY) || find_consumer(consumer, sizeof(consumer)) < 0) goto cleanup;
    for (unsigned int t = 3; t < sizeof(types) * 8; t++) if (bit(types, t)) goto cleanup;
    unsigned int highest = 0;
    for (unsigned int k = 0; k < KEY_LIMIT; k++) if (bit(keys, k)) highest = k;
    printf("{\"event\":\"probe\",\"frameBytes\":%zu,\"highestKey\":%u,\"consumerFound\":true}\n", sizeof(struct input_event), highest);
    if (probe) { status = 0; goto cleanup; }
    stage = "frame-layout";
    if (sizeof(struct input_event) != 16) goto cleanup;
    stage = "concurrent-trial";
    if (access("/tmp/cytv-home-lab.lock", F_OK) == 0) goto cleanup;
    stage = "lock";
    lock = open("/tmp/cytv-home-input.lock", O_CREAT | O_RDWR | O_NOFOLLOW | O_CLOEXEC, 0600);
    struct stat st;
    if (lock < 0 || fstat(lock, &st) < 0 || !S_ISREG(st.st_mode) || st.st_uid != 0 || st.st_nlink != 1 || flock(lock, LOCK_EX | LOCK_NB) < 0) goto cleanup;
    stage = "virtual-capabilities";
    proxy = open("/dev/uinput", O_WRONLY | O_NONBLOCK | O_CLOEXEC);
    if (proxy < 0 || ioctl(proxy, UI_SET_EVBIT, EV_KEY) < 0) goto cleanup;
    for (unsigned int k = 0; k < KEY_LIMIT; k++) if (bit(keys, k) && ioctl(proxy, UI_SET_KEYBIT, k) < 0) goto cleanup;
    if (bit(types, EV_REL)) {
        if (ioctl(proxy, UI_SET_EVBIT, EV_REL) < 0) goto cleanup;
        for (unsigned int k = 0; k < sizeof(rel) * 8; k++) if (bit(rel, k) && ioctl(proxy, UI_SET_RELBIT, k) < 0) goto cleanup;
    }
    snprintf(setup.name, sizeof(setup.name), "%s", "LGE RCU");
    stage = "create-virtual-device";
    if (write_all(proxy, &setup, sizeof(setup)) < 0 || ioctl(proxy, UI_DEV_CREATE) < 0) goto cleanup;
    created = true;
    stage = "wait-for-lg-consumer";
    long long ready_deadline = now_ms() + 5000;
    while (!stopping && now_ms() < ready_deadline) {
        if (proxy_path(proxy, device, sizeof(device)) == 0 && consumer_has(consumer, device)) break;
        usleep(100000);
    }
    if (stopping || !device[0] || !consumer_has(consumer, device)) goto cleanup;
    puts("{\"event\":\"proxy-accepted\",\"grabbed\":false}");
    if (check) { status = 0; goto cleanup; }
    stage = "keys-held";
    /* Never take the original input until LG has opened its replacement. */
    unsigned char pressed[KEY_LIMIT / 8] = {0};
    if (ioctl(input, EVIOCGKEY(sizeof(pressed)), pressed) < 0) goto cleanup;
    for (unsigned int k = 0; k < KEY_LIMIT; k++) if (bit(pressed, k)) goto cleanup;
    /* Discard only this reader's old queue; LG already received these events. */
    struct input_event events[32];
    while (read(input, events, sizeof(events)) > 0) { if (stopping || now_ms() >= deadline) goto cleanup; }
    stage = "exclusive-input";
    if (ioctl(input, EVIOCGRAB, 1) < 0) goto cleanup;
    grabbed = true;
    puts("{\"event\":\"ready\",\"mode\":\"filter-only\",\"maxSeconds\":120}");
    stage = "forward-events";
    status = 0;
    while (!stopping && now_ms() < deadline) {
        struct pollfd pfd = { .fd = input, .events = POLLIN };
        int rc = poll(&pfd, 1, 200);
        if (rc < 0 && errno == EINTR) continue;
        if (rc < 0 || (pfd.revents & (POLLERR | POLLHUP | POLLNVAL))) { status = 1; break; }
        if (!rc) continue;
        ssize_t n = read(input, events, sizeof(events));
        if (n < 0 && (errno == EINTR || errno == EAGAIN)) continue;
        if (n <= 0 || n % sizeof(events[0]) != 0) { status = 1; break; }
        for (size_t i = 0; i < (size_t)n / sizeof(events[0]); i++) {
            int forward = filter_event(&events[i]);
            if (forward < 0 || (forward && write_all(proxy, &events[i], sizeof(events[i])) < 0)) { status = 1; stopping = 1; break; }
            if (!forward && events[i].value == 1) puts("{\"event\":\"home-suppressed\"}");
        }
    }
cleanup:
    if (status) fprintf(stderr, "{\"event\":\"error\",\"stage\":\"%s\",\"errno\":%d,\"proxyResolved\":%s}\n",
                        stage, errno, device[0] ? "true" : "false");
    if (grabbed) { release_held(proxy); (void)ioctl(input, EVIOCGRAB, 0); }
    if (created) (void)ioctl(proxy, UI_DEV_DESTROY);
    if (proxy >= 0) close(proxy);
    if (input >= 0) close(input);
    if (lock >= 0) close(lock);
    printf("{\"event\":\"stopped\",\"status\":%d,\"hadGrab\":%s}\n", status, grabbed ? "true" : "false");
    return status;
}
