## New

- **The weather falls over the couch scenes.** A theme with the couch scenes can now let the weather outside fall over the photo behind Home: rain and drizzle as drops carried by the wind, snow drifting down, fog as two wide bands that move, and a thunderstorm as rain with a flash now and then. In dry weather nothing is drawn. It is off by default (the theme setting `effects.sceneWeather`), so a theme that does not ask for it looks and costs exactly what it did. The weather is the one Home already knows: the weather card's, or, with no card on Home, the weather of the place the TV stands (the place of **Features > Sun-aware scenes**), kept for ten minutes. Nothing new leaves the TV, and Home Assistant is not needed. The TV's weak GPU shaped it: the drops are drawn on one small canvas stretched over the screen, at most 30 frames a second and never while Home is away; fog and lightning only move and fade. The idea comes from [couch-tv](https://github.com/Seagey/couch-tv) (MIT); the code is this project's own. See [Themes](themes.md). By @larsoss (#275).
- **Home without a black screen on newer TVs.** On a TV whose own Home is a flutter or web app (webOS 24 and newer), the launcher used to become Home by restarting LG's app manager (`sam`). That restart is what blanked an HDMI input for about ten seconds when the TV came up on it, for example when a box switches the TV on over CEC. `sam` reads the app folders again whenever the UI language changes, so the boot now sets the language to its bare form (`it-IT` to `it`, so the words on screen stay the same) for a moment and back, and the picture of the input stays. If `sam` still reports LG's Home afterwards, or the file `home-rescan-off` is in the service folder, the boot restarts `sam` as before. By @privatepenguinzero (#274).

## Fixes

- **Glass cards are readable on a dark scene.** The evening photos of the couch scenes brought scenes that are dark from edge to edge, and on them the weather card and the "last watched" card were hard to make out. On a glass card the second line (the days of the forecast, `78% · 19 km/h`, the episode under a title) is now 88 % white instead of 62 %, as is the column of a Home Assistant weather card. The edge is a hairline of 32 % white instead of 20 %, with a shorter, darker shadow, so a card keeps its shape on a dark photo. Light scenes look as before. By @larsoss (#278).
- **The UI language can no longer be left changed by the rescan.** If the TV lost power in the moment the language was changed, the next boot puts it back. When that restore cannot run yet (the settings service is not ready), the boot now keeps the saved language, skips the rescan and restarts `sam` instead; before, it could take the changed language for yours and keep it (`it-IT` became `it`). Found in the review of #274 (#276).

## What to know

These changes are checked by the tests and by CI.

**The weather over the scene** was seen on a TV only up to the point that the new code was loaded, the setting was on and the weather service said rain (an LG 65UP77006LB, webOS 6.5). Whether the drops fall as intended on screen, and snow, fog and the thunderstorm, have not been looked at on a TV; the tests cover which effect each weather code gets and how the drops move. Please say what you see.

**The Home rescan** was tried on an LG OLED55B46LA (B4, webOS 24, firmware 33.31.75, flutter Home): a full reboot, and screen captures every 0.7 seconds while the TV showed HDMI 1 during the rescan, where the picture never changed. It has not been tried with the physical Home key (it was launched through the app manager), together with the screen saver, on another webOS version, or after a real power loss at the wrong moment (the test covers that). If the TV ends up in another language than yours, or Home does not open, create the file `home-rescan-off` in `/media/developer/cleanyourtv` and reboot to have the old restart back, and tell us in an issue. Going back to LG's Home still works as before.

**The glass cards** were checked on the two evening photos the report came from, on a webOS 6.5 TV.

## Thanks

@larsoss for the weather over the scenes and the readable glass cards; @privatepenguinzero for the Home rescan that keeps an HDMI input on screen; and everyone who reports what a dev build does on their TV.
