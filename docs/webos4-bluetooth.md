# Bluetooth automation findings: reference only

This page records the tested webOS 4 Bluetooth behavior so a future automation can reuse the findings. It does not add an
automation, enable a service, change pairing, modify the interface or install anything on a TV. Existing reference code remains
separate from the normal launcher/manager installation. Do not treat this page as an automatic setup procedure.

## What was established

On the tested SDK 4.4.0 firmware, a previously paired audio device can trigger a native confirmation with No initially selected.
Calling `com.webos.service.btaudiosrc/onClickListener` directly with the Yes action was insufficient: the dialog's subsequent
No close action disconnected the device. The working sequence uses the visible native dialog and the real RIGHT/ENTER input path.

The final trial recorded an `accepted` event, a subsequent status query confirmed the configured peer connected through A2DP,
and the user confirmed normal operation. The standalone observer was also smoke-tested with system Node 0.12.2. This is evidence
for that firmware and calibration, not a universal Bluetooth API contract or proof for another resolution/device.

## Interfaces observed on the TV

All URIs below start with `luna://`. They are firmware-specific observations, not APIs guaranteed across webOS versions.

| URI                                                | Purpose                                        | Relevant evidence                                                                                    |
| -------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `com.webos.notification/getAlertNotification`      | Subscribe with `{"subscribe":true}`            | `returnValue`, `subscribed`, `alertAction`, `alertInfo`                                              |
| `com.webos.service.bluetooth2/device/getStatus`    | Read paired devices and profiles               | Exact configured name/address, `paired=true`, `pairing=false`, `connectedProfiles` containing `a2dp` |
| `com.webos.service.btaudiosrc/getConnectedDevice`  | Read the active audio peer                     | `returnValue=true`, `connected=true`, configured name                                                |
| `com.webos.surfacemanager/getCurrentState`         | Read current UI focus context                  | `returnValue=true`, `currentState="alertView"`; insufficient alone to identify the dialog            |
| `com.webos.surfacemanager/captureCompositorOutput` | Capture the visible dialog                     | BMP output at an exact private temporary path; calibrated pixels distinguish No/Yes/unknown          |
| `com.webos.service.networkinput/sendSpecialKey`    | Send one verified native key                   | `{"key":"RIGHT"}` or `{"key":"ENTER"}`; changes the TV UI                                            |
| `com.webos.service.bluetooth2/a2dp/connect`        | Request reconnection of an already paired peer | One configured address only; changes the connection state and does not pair a new device             |

Read-only diagnosis can query status without changing the connection:

```sh
luna-send -n 1 -w 3000 luna://com.webos.service.bluetooth2/device/getStatus '{}' </dev/null
luna-send -n 1 -w 3000 luna://com.webos.service.btaudiosrc/getConnectedDevice '{}' </dev/null
luna-send -n 1 -w 3000 luna://com.webos.surfacemanager/getCurrentState '{}' </dev/null
```

These replies can contain device names and addresses. Keep them private; redact them before sharing. Redirect stdin to `/dev/null`:
an ordinary closed pipe caused empty `luna-send` replies on this firmware. A subscription uses `luna-send -i` and must parse complete
newline-delimited JSON, handle partial chunks, reject malformed/error replies and stop its own child on termination.

## Conditions for acting on a dialog

Use all of these together; a matching screen or generic `alertView` alone cannot authorize a global key:

- The notification is an open alert from exactly `com.webos.service.btaudiosrc`, with that service's alert-id prefix and the configured
  peer's bracketed name in the message. Do not match a translated generic sentence or any Bluetooth-looking popup.
- The two button actions belong to the same native service, use `onClickListener` with type 3 and buttons 4/5 in the observed order,
  and the close action is button 4. These fields identify the tested dialog; they are never invoked as a Yes shortcut.
- There is exactly one paired device with the configured name and matching address. It is not pairing, has A2DP connected, and the
  active audio peer agrees. Ambiguous names, another active peer or stale device state cancel the operation.
- A fresh capture matches the private calibration and the current UI context is still `alertView` immediately before each key.

The optional startup reconnection is a separate action: when that exact paired peer is disconnected and no other A2DP peer is
connected, one connection request was tested. It must not pair, take over another device, run continuously or retry uncertain results.
After requesting connection, wait for a matching notification; request acceptance alone does not authorize any key.

## Bounded confirmation sequence

1. Create one transaction for the matching alert id, with an absolute fifteen-second deadline. Duplicate notifications do not restart it.
2. Read the device and active-audio state, then observe focus and pixels. Missing focus or incomplete rendering can be observed again
   every 500 ms within the same deadline; observation does not send keys.
3. If Yes is selected, recheck the device, capture Yes again, confirm focus and send one ENTER.
4. If No is selected, recheck the device, capture No again, confirm focus and send one RIGHT. Wait for freshly recognized Yes, then
   repeat the checks before one ENTER. Never repeat RIGHT if the image still shows No, and never assume RIGHT selected Yes.
5. Unknown pixels, capture errors or lost focus cause waiting within the existing deadline. A changed device cancels. A closed/replaced
   alert, stop or deadline expiry cancels timers and invalidates late callbacks.
6. An uncertain key reply ends the transaction without retry or subsequent blind ENTER. A distinct later alert id can start a new one.

The focus check and global key are separate calls, not an atomic operation. A future implementation must retain the conservative
identity/pixel/focus checks and cancellation behavior; blindly sending RIGHT then ENTER is not an equivalent implementation.

## Private calibration and configuration

The tested configuration lives outside `/media/developer` at `/var/lib/webosbrew/cleanyourtv-bluetooth.json`. It is a regular,
root-owned private file with permissions 0600; symlinks and group/other access are refused by the observer. The developer tree's
permissions can change at boot, so it is unsuitable for this private configuration.

| Field                                                       | Meaning                                                                     |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| `name`, `address`                                           | Exact already-paired peer identity; local values, never repository defaults |
| `ui.width`, `ui.height`                                     | Compositor capture dimensions on that TV                                    |
| `ui.crop.x`, `ui.crop.y`, `ui.crop.width`, `ui.crop.height` | Rectangle that distinguishes the native No/Yes selection                    |
| `ui.no`, `ui.yes`                                           | Distinct SHA-256 hashes of the calibrated crop's pixel bytes                |

The observed parser accepts an uncompressed 24-bit BMP with the expected positive width/height. It hashes the crop in visual
top-to-bottom order, using the BMP's BGR pixel bytes and excluding row padding/header bytes. Different resolution, dialog layout,
language or rendering can invalidate the hashes. Calibrate both states from the actual loaded dialog; never interpret an unknown
image as No or copy another TV's hashes. Screenshots, hashes tied to private captures and actual peer identities stay out of Git.

## Evidence, logs and rollback for a future implementation

`READY` means the alert subscription is ready. `startup-connect-requested` means a request was accepted, not that audio works.
`accepted` means the verified ENTER request returned success, not independent proof of audio output. Follow it with paired/active
status checks and physical sound confirmation. Timeout with no dialog can be a normal idle outcome; it is not a reason to send keys.

The existing research references are `webos4/bluetooth-accept.js`, `webos4/bluetooth.sh` and
`tools/test/webos4bluetooth.test.js`. The 51 checks cover delayed focus/pixels, selected Yes, identity changes, cancellation,
deadline expiry, uncertain keys, private configuration and cleanup. Reading or testing them does not integrate Bluetooth into Home.

If a future optional integration is requested, its rollback must stop only its verified process/subscription and remove only its
owned boot entry. The existing controller's `stop` and `disable` operations illustrate this distinction; neither unpairs the device
nor deliberately disconnects audio. No new integration, boot entry, settings option or runtime change is introduced by this document.
