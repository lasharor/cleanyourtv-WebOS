## New

- **Our own screen saver (off until you switch it on).** CleanYourTV can replace LG's screen saver with a page that shows what Home has behind it (the theme's scenes, your wallpaper photos, Unsplash with its credit, or the theme's wallpaper) with a clock, and closes on the first key. Switch it on in the manager, **Features > Screen saver** (the TV restarts); a new install and an update keep LG's. It works where CleanYourTV takes over Home with its folder mount and LG's screen saver is an app, as on webOS 25; on TVs with LG's native Home or screen saver the row says "not available on this TV yet". By @Edenik (#194).
- **Stocks and crypto on Home** (Add-ons > Get more > Stocks and crypto). Two cards: your stocks (US shares and ETFs, from Twelve Data with your own free key, set from your phone) and your coins (from CoinGecko, no key), each as a ticker, cells or a panel. OK opens a drawer with the list; OK on a symbol shows its chart (1D to 1Y), the key numbers and its day and 52-week ranges, and Left, Right or CH+/CH- go to the next symbol. The free Twelve Data plan has 800 credits a day, so a longer list is updated less often (every 5 minutes for 5 symbols, every 20 for 20, while the US market is open). By @Edenik (#187).
- **A mic button on the phone remote.** The round button between Inputs and Keyboard asks the TV's voice assistant (the AI chat, Home Assistant or your server). Speak or type on the phone (the keyboard's dictation works on any phone, the phone's own speech recognition where the browser allows the page to use the microphone), or let the TV listen on its remote. The question and the answer show on the phone in a full-screen conversation and on the TV as its card. The button is dimmed while nothing on the TV answers. Phone remote add-on 1.1.0. By @Edenik (#206).
- **The phone remote on an iPhone, as an app.** iPhones cannot install the Android app, so the phone page can now live on the Home Screen as an app: full screen, its own icon, no address bar. In Safari the pairing screen says to add it to the Home Screen first (a Home Screen app has its own storage, apart from Safari's) and the code from the QR code goes along, so the app opens with it filled in. Keys tick on iOS 18 and newer. Phone remote 1.1.0. By @larsoss (#212).
- **The Cinema theme** (Theme > Cinema): a dark living-room layout with wide tiles, a soft pill top bar and the focused app's icon, dimmed, in the background. It comes with a new theme setting for theme makers, `effects.focusIcon` (see [Themes](themes.md)). By @mateimalai3-sys (#193).
- **Voice on a TV with a 32-bit ARMv7 kernel** (issue 175). Voice could not be installed on such a TV, because the program for it needs a 64-bit kernel. It now installs `cytv-asr32`, a small program on the sherpa-onnx library that runs the Moonshine tiny English model, with a C library of its own (LG's 32-bit userland cannot load the hard-float libraries). Downloads are pinned by checksum, and the licences are listed in `THIRD-PARTY.md`. Kernels older than ARMv7 are still refused. By @Edenik (#203).
- **The launcher opens at power on with LG's Home Auto Launch.** On a TV with LG's native Home, the TV stayed on its last input after a power on even with **General > Home Settings > Home Auto Launch** on, because the stand-in did not do what LG's own Home does. It now follows the TV's power state: coming back from standby with the setting on and an input (or nothing) in front, it opens Home. An app the TV was turned on with (the Netflix key, a cast) stays in front, and with the setting off the TV stays on its input. By @larsoss (#195).
- **Add-ons: Open page.** An add-on's screen in the manager has **Open page**, which opens that add-on's page on the TV, also when **Page of the book** is switched off. Before, the phone remote's pairing screen (its page) could not be reached once its page was taken out of the book, so no phone could be paired. Home turns to the page at once, and Back returns to Home. By @Edenik (#201).

## Fixes

- **Fast start of the launcher after a boot** (issue 125). On a TV with LG's native Home, the Home key showed LG's Home until the launcher's stand-in was mounted, because the boot script started Node.js five times first. The way is now remembered, and when nothing changed the stand-in is mounted as the first step, before the service. The boot script also copies only the launcher files that changed (it took 36 s to copy all of them on one TV) and its log starts with the time it began. By @larsoss (#162).
- **No black screen after standby** (issues 168 and 170). LG's app manager restarts when the TV goes to standby, and the new one could take the launcher for Home without the stand-in behind it: a black screen with only the pointer, and the Home key did nothing. The stand-in now has the launcher closed and starts Home afresh in that case, and the watchdog does the same when it sees an empty screen or Home without its stand-in on two checks in a row; after two such tries LG's Home comes back until the next reboot. A child program that Node.js 8 aborted before it ran is started again, up to three times. By @larsoss (#162).
- **A black box for resets** (issue 112). A line every 30 seconds in `blackbox.log` on the TV's storage (free memory and swap, load, the app in front, the busiest programs; under 64 KB). At the next boot it becomes `blackbox.last.log`, headed by the reason the TV gave for that start (`cpuAbnormal` after a reset). Share log includes both. By @larsoss (#162).

## The voice assistant can act on the TV

- **Let the voice assistant act on the TV** (manager app, Features > AI agents (MCP)): the AI may open apps, switch inputs, show a card and use the tools of add-ons you
  approved. Off by default. The tools go to OpenRouter, in its place among the AI providers; a server of yours only answers.
  Turning the TV off asks first: say "yes" within 30 seconds.
- **`/api/mcp`**: every tool of the service and of the add-ons, over the Model Context Protocol, for programs on the TV.
- **Accept MCP clients from the network** (manager app, Features > AI agents (MCP)): off by default; switched on, AI agents on other computers (any MCP client, or a script) can use the same tools on port 8802. Each agent pairs once with a code shown on the TV and gets a token of its own; the TV lists the
  agents, blocks or removes them, and removes unused ones after two weeks by default. Turning the TV off is never allowed from the network.
- Add-ons can provide tools (`"provides": ["tools"]`). The **Agent tools (MCP)** add-on 1.2.1 gives the tools that apps and add-ons
  sign in a `tools.json`, after you approve each on its phone page.
- **Safer signed tools.** A tool that is not a plain read (a method other than GET) always asks for your yes, whatever its file says; a tool reaches only the add-on that signed it; an address that stands for the TV itself is refused, also when it is written as a name; and a spoken yes must be the whole reply ("okay, what's the weather" does not turn the TV off). The per-address counters of the network port keep at most 500 addresses.
- The voice setup page marks the models that can use tools.
- **More tools from the service** (wave 1): what is on screen (`get_current_app`), the running apps and closing one, going to Home, Live TV or the Inputs list (`navigate`), the volume, the TV and its version (`tv_info`), the most used apps, the weather, a new conversation, and cards with a picture, a time and a place on screen.
- **Tools for add-ons and Home** (wave 2), one tool per part with an action: `theme` (list, set, revert) and `remote_buttons` (list, press); the Spotify add-on 1.2.0 gives `spotify` (what plays, play, pause, next, previous, the devices, open on the TV); the Weather forecast add-on 1.5.0 gives `weather` (a detailed forecast, finding a place); Live TV gives `iptv` (find a channel, what is on, the guide, favourites, check a stream, reload); the Android box gives `androidbox` (status, its apps, a connection test, choosing an app); Unsplash 1.1.0 gives `unsplash` (status, the search words, on or off, who took the photo); App icons gives `icons` (which apps have a picture of their own) and Agent tools 1.2.0 gives `agent` (the sources that sign tools, approved or not).
- **Choose the tools** (manager app, Features > AI agents (MCP) > Tools): switch the AI's tools by group or one at a time, and choose whether new tools turn on by themselves (the default) or stay off until you turn them on. The same choice holds for the voice assistant and network agents.

## What to know

The screen saver was tried on a 65UR91006LB (webOS 25), switched off and on, and through restarts. Please say what you see in an issue.

The Stocks and crypto cards and their drawers were tried on a 65UR91006LB (webOS 25) with a free Twelve Data key, but not yet on webOS 5 or 6. Please say what you see in an issue.

The phone remote's mic was tried on a 65UR91006LB (webOS 25) with a Samsung S22: questions sent from the phone and the TV listening on its remote; the phone's own speech recognition was tried over HTTPS only, in a separate test page. A paired phone can start the TV's remote microphone, as the docs say. The mic button together with the iPhone app was not tried on a phone yet.

The phone remote as an iPhone app was tried on an iPhone (iOS 26) with a 65UP77006LB (webOS 6.5): adding it to the Home Screen, pairing in the app, the keys and their tick; not yet on an iPad or on iOS 17 and older.

Voice on a 32-bit ARMv7 kernel was tried on a 65UR91006LB with the 32-bit way forced (the install, the checksums, the self-test and a test clip), but not yet on a TV that really has an ARMv7 kernel, nor on Node.js 8. If that is your TV, please say how it works and how fast it answers.

The fast start, the fix for the black screen after standby and Home Auto Launch were tried on a 65UP77006LB (webOS 6.5.3): two reboots, a launcher update, switching CleanYourTV as Home off and on, and standby with a restart of the app manager. Not tried: a TV with a Flutter or web Home, a real power loss, and Home Auto Launch switched off (that is covered by tests).

The AI agent tools were reviewed for security before this release and the fixes are checked by tests, but the network side (port 8802) is new: it is off by default, so switch it on only on a network you trust, and please say what you see in an issue.

The Cinema theme and Open page were not tried on a TV by the maintainer. Please say how Cinema looks on yours, and whether Open page works on webOS 5 and 6.

Languages: Polish, Catalan and Swedish arrived in the release before this one.

## Thanks

@Edenik for the screen saver, Stocks and crypto, the phone remote's mic, the AI agents and tools, voice on a 32-bit ARMv7 kernel and Open page; @larsoss for the fast start, the black screen fix, Home Auto Launch, the iPhone app and the Dutch texts; @mateimalai3-sys for the Cinema theme; and everyone who reports what a dev build does on their TV.
