#!/bin/sh
# Run by the inputhook when a remapped button is pressed ($1: the button's code): the service runs the action chosen for it
# (helper/remap.js). Only digits are passed on.
export PATH=/usr/bin:/usr/sbin:/bin:/sbin:$PATH
case "$1" in ''|*[!0-9]*) exit 0 ;; esac
curl -s -m 5 -X POST -H 'content-type: application/json' -d "{\"code\":\"$1\"}" http://127.0.0.1:8765/api/remap/fire </dev/null >/dev/null 2>&1
