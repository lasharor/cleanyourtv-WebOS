## New

- **Our own screen saver (off until you switch it on).** CleanYourTV can replace LG's screen saver with a page that shows what Home has behind it (the theme's scenes, your wallpaper photos, Unsplash with its credit, or the theme's wallpaper) with a clock, and closes on the first key. Switch it on in the manager, **Features > Screen saver** (the TV restarts); a new install and an update keep LG's. It works where CleanYourTV takes over Home with its folder mount and LG's screen saver is an app, as on webOS 25; on TVs with LG's native Home or screen saver the row says "not available on this TV yet". By @Edenik (#194).
- **Stocks and crypto on Home** (Add-ons > Get more > Stocks and crypto). Two cards: your stocks (US shares and ETFs, from Twelve Data with your own free key, set from your phone) and your coins (from CoinGecko, no key), each as a ticker, cells or a panel. OK opens a drawer with the list; OK on a symbol shows its chart (1D to 1Y), the key numbers and its day and 52-week ranges, and Left, Right or CH+/CH- go to the next symbol. The free Twelve Data plan has 800 credits a day, so a longer list is updated less often (every 5 minutes for 5 symbols, every 20 for 20, while the US market is open). By @Edenik (#187).
- **A mic button on the phone remote.** The round button between Inputs and Keyboard asks the TV's voice assistant (the AI chat, Home Assistant or your server). Speak or type on the phone (the keyboard's dictation works on any phone, the phone's own speech recognition where the browser allows the page to use the microphone), or let the TV listen on its remote. The question and the answer show on the phone in a full-screen conversation and on the TV as its card. The button is dimmed while nothing on the TV answers. Phone remote add-on 1.1.0. By @Edenik (#206).
- **The phone remote on an iPhone, as an app.** iPhones cannot install the Android app, so the phone page can now live on the Home Screen as an app: full screen, its own icon, no address bar. In Safari the pairing screen says to add it to the Home Screen first (a Home Screen app has its own storage, apart from Safari's) and the code from the QR code goes along, so the app opens with it filled in. Keys tick on iOS 18 and newer. Phone remote 1.1.0. By @larsoss (#212).

## The voice assistant can act on the TV

- **Let the voice assistant act on the TV** (manager app, Features > AI agents (MCP)): the AI may open apps, switch inputs, show a card and use the tools of add-ons you
  approved. Off by default. The tools go to OpenRouter, in its place among the AI providers; a server of yours only answers.
  Turning the TV off asks first: say "yes" within 30 seconds.
- **`/api/mcp`**: every tool of the service and of the add-ons, over the Model Context Protocol, for programs on the TV.
- **Accept MCP clients from the network** (manager app, Features > AI agents (MCP)): off by default; switched on, AI agents on other computers (any MCP client, or a script) can use the same tools on port 8802. Each agent pairs once with a code shown on the TV and gets a token of its own; the TV lists the
  agents, blocks or removes them, and removes unused ones after two weeks by default. Turning the TV off is never allowed from the network.
- Add-ons can provide tools (`"provides": ["tools"]`). The **Agent tools (MCP)** add-on 1.1.0 gives the tools that apps and add-ons
  sign in a `tools.json`, after you approve each on its phone page.
- **Safer signed tools** (Agent tools (MCP) 1.2.1): a tool that is not a plain read (a method other than GET) always asks for your yes, whatever its file says; a tool reaches only the add-on that signed it; an address that stands for the TV itself is refused, also when it is written as a name; and a spoken yes must be the whole reply ("okay, what's the weather" no longer turns the TV off).
- The voice setup page marks the models that can use tools.
- **More tools from the service** (wave 1): what is on screen (`get_current_app`), the running apps and closing one, going to Home, Live TV or the Inputs list (`navigate`), the volume, the TV and its version (`tv_info`), the most used apps, the weather, a new conversation, and cards with a picture, a time and a place on screen.
- **Tools for add-ons and Home** (wave 2), one tool per part with an action: `theme` (list, set, revert) and `remote_buttons` (list, press); the Spotify add-on 1.2.0 gives `spotify` (what plays, play, pause, next, previous, the devices, open on the TV); the Weather forecast add-on 1.5.0 gives `weather` (a detailed forecast, finding a place); Live TV gives `iptv` (find a channel, what is on, the guide, favourites, check a stream, reload); the Android box gives `androidbox` (status, its apps, a connection test, choosing an app); Unsplash 1.1.0 gives `unsplash` (status, the search words, on or off, who took the photo); App icons gives `icons` (which apps have a picture of their own) and Agent tools 1.2.0 gives `agent` (the sources that sign tools, approved or not).
- **Choose the tools** (manager app, Features > AI agents (MCP) > Tools): switch the AI's tools by group or one at a time, and choose whether new tools turn on by themselves (the default) or stay off until you turn them on. The same choice holds for the voice assistant and network agents.

## What to know

The screen saver was tried on a 65UR91006LB (webOS 25), switched off and on, and through restarts. Please say what you see in an issue.

The Stocks and crypto cards and their drawers were tried on a 65UR91006LB (webOS 25) with a free Twelve Data key, but not yet on webOS 5 or 6. Please say what you see in an issue.

The phone remote's mic was tried on a 65UR91006LB (webOS 25) with a Samsung S22: questions sent from the phone and the TV listening on its remote; the phone's own speech recognition was tried over HTTPS only, in a separate test page. Please say what you see in an issue.

The phone remote as an iPhone app was tried on an iPhone (iOS 26) with a 65UP77006LB (webOS 6.5): adding it to the Home Screen, pairing in the app, the keys and their tick; not yet on an iPad or on iOS 17 and older.

## Thanks

@Edenik for the screen saver, the Stocks and crypto cards and the phone remote's mic; @larsoss for the phone remote as an iPhone app; and everyone who reports what a dev build does on their TV.
