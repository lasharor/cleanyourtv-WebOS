#!/usr/bin/env python3
"""Build a webOS .ipk (an ar archive) from an app folder: build-ipk.py <appdir> <out.ipk>. Reads id and version from appinfo.json."""
import io, os, sys, tarfile, json
app = os.path.abspath(sys.argv[1]); out = sys.argv[2]
info = json.load(open(os.path.join(app, 'appinfo.json'))); ID = info['id']; VER = info.get('version', '1.0.0')
def tgz(files):
    b = io.BytesIO()
    with tarfile.open(fileobj=b, mode='w:gz', format=tarfile.GNU_FORMAT) as t:
        for name, data in files:
            # Match build.py: some TVs refuse files with a zero timestamp.
            ti = tarfile.TarInfo(name); ti.size = len(data); ti.mode = 0o644; ti.uid = ti.gid = 0; ti.mtime = 1761000000
            t.addfile(ti, io.BytesIO(data))
    return b.getvalue()
data = []
for root, _, files in os.walk(app):
    for f in sorted(files):
        p = os.path.join(root, f); rel = os.path.relpath(p, app).replace(os.sep, '/')
        data.append(('./usr/palm/applications/%s/%s' % (ID, rel), open(p, 'rb').read()))
data.append(('./usr/palm/packages/%s/packageinfo.json' % ID, json.dumps({"id": ID, "version": VER, "app": ID}).encode()))
ctl = ("Package: %s\nVersion: %s\nSection: misc\nPriority: optional\nArchitecture: all\nInstalled-Size: 1\nMaintainer: N/A <nobody@example.com>\nDescription: %s\nwebOS-Package-Format-Version: 2\nwebOS-Packager-Version: x.y.x\n" % (ID, VER, info.get('title', ID))).encode()
parts = [('debian-binary', b'2.0\n'), ('control.tar.gz', tgz([('./control', ctl)])), ('data.tar.gz', tgz(data))]
blob = b'!<arch>\n'
for n, d in parts:
    blob += ('%-16s%-12d%-6d%-6d%-8s%-10d`\n' % (n + '/', 0, 0, 0, '100644', len(d))).encode() + d + (b'\n' if len(d) % 2 else b'')
open(out, 'wb').write(blob)
