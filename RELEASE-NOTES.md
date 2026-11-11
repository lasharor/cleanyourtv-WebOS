## New

- **A Bluetooth button for game controllers, keyboards and mice** (Customise > the top buttons > **Bluetooth**; the default top bar does not change). It lists the paired devices and whether each is connected. OK on a controller, keyboard or mouse disconnects it, or connects it again; hold OK removes its pairing, after a question. **Pair a controller...** looks for devices for about 20 seconds and pairs the one you choose. A DualSense keeps one console or TV only, so after it was used with a PS5 the TV still lists it as paired but it no longer connects: pairing it again from here removes the old pairing of that controller first, and no other. LG's own remote is never listed, so it cannot be disconnected or removed by mistake. Headphones and speakers are shown dimmed: connect them in LG's settings. See [Home](launcher.md#bluetooth). By @prepwerk-apps (#239).
- **The phone remote follows the phone's light or dark setting.** The page was always dark. It now follows the setting of an iPhone, an Android phone or a desktop browser, and switches at once when the setting changes; a page shown inside an app with its own theme can choose with `html.light` or `html.dark`. Phone remote add-on 1.1.1, so a TV with 1.1.0 is offered the update. See [Phone remote](phone-remote.md#light-and-dark). By @larsoss (#243).
- **German is complete.** The texts that were still in English (the phone remote's pairing, Spotify, Jellyfin, app icons, add-on repositories, the Android box, the card catalog, key remapping and more) are translated, so German is at 100 %. By @gasparegas (#244).

## What to know

These changes are checked by the tests and by CI.

The Bluetooth button was tried on an LG OLED65C47LA (webOS 25) with a PS5 DualSense: the list, disconnect, connecting from the controller, pairing again and pairing a new one, and after a restart of the TV. Not tried: other controllers (Xbox, 8BitDo, Switch Pro), keyboards and mice, devices that ask for a code or a confirmation, webOS 22 to 24 and webOS 5 and 6, more than one controller at a time, and removing a pairing from the menu. Please say what you see in an issue.

The phone remote's light mode was looked at in a browser with light and dark emulated, not yet on a real phone. On the iPhone Home Screen app the status bar text may be hard to read on the light page. Please say how it looks on your phone.

## Thanks

@prepwerk-apps for the Bluetooth button, tested on a real TV; @larsoss for the phone remote's light mode; @gasparegas for the German texts; and everyone who reports what a dev build does on their TV.
