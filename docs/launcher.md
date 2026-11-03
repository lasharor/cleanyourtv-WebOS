# The launcher

The launcher replaces LG's Home. It is a web page of the project that the TV's browser runs, so it starts fast and works the
same on every supported webOS version.

![Home screen](screenshots/home.jpg)

## The screen

- **Dock.** Up to four apps, large, on the first row.
- **Top shelf.** The name of the focused app and an ambient glow taken from its icon.
- **Grid.** All other apps, sorted by how often you use each one, A to Z, or your own custom static order. An app you install (from the Homebrew
  Channel or the LG store) appears within a few seconds by itself, also while Home is on screen; one you never opened yet sorts last
  when the grid is sorted by use.
- **Top buttons.** Inputs, Live TV (your playlist), TV (LG's own tuner), Settings and Customise, and a clock. The buttons you see are
yours to change.
- **Open apps.** Optionally a green dot on the tile of every app that is open, as on the active input in the Inputs list: off by
  default, **Customise** > **Mark running apps** switches it on, in the launcher and in the Inputs picker. Back on the home screen lists
  the open apps to close them (see [Running apps](#running-apps)).

## Keys

| Action | How |
|---|---|
| Open an app | OK |
| App options (move, dock, icon, hide, uninstall) | Hold OK on an app |
| Move or remove a top button | Hold OK on it |
| Customise | The **Customise** button |
| Live TV | The **Live TV** button or tile |
| LG's own Live TV (the tuner) | A **TV** button, or **TV** in the Inputs list |
| Switch input | The **Inputs** button |
| Put an input on Home | Hold OK on it in the Inputs list |
| Close running apps | Back on the home screen |

The Magic Remote pointer works too: pointing and clicking, and holding the button on an app for its options. The wheel moves from tile to tile on the
home screen (along the dock, then the grid row by row) and up and down in every menu, where the list scrolls one row at a time and, under the pointer, only when it reaches the first or last row on show.

![App options](screenshots/options.jpg)

## Running apps

Back on the home screen lists the apps that are open, as LG's Home does with its Recents on a second Back. OK closes an app,
**Close all** closes every app in the list, and Back leaves it. Closing an app also removes it from LG's recent apps.

It lists the apps the launcher knows, including the ones you hid from the grid; Home itself, CleanYourTV's own apps and the TV's
system apps are never in it. The list is read when it opens and closes when you leave Home. Suggested and first built by
[Steefzar](https://github.com/lasharor/cleanyourtv-WebOS/issues/16).

![Running apps](screenshots/running.jpg)

## Customise

![Customise menu](screenshots/customise.jpg)

**Customise** has four tabs across the top, **Apps**, **Look**, **Top & cards** and **More**; Left and Right turn to another tab and the
rows of that tab are below. A menu opened from a row (the dock, the theme) returns to the same tab with Back.

- **Apps**: the dock, hidden apps, app order (and **Arrange apps...**) and **Mark running apps**.
- **Look**: **Theme**, **Accent colour**, **Wallpapers** and **Clock**.
- **Top & cards**: the top buttons and, in themes with places for cards, **Home Assistant** and **Cards**.
- **More**: **More settings...**, the manager app.

In detail:

- the **dock**: each app in it can be replaced (an app already in the dock swaps places), moved or removed, and **Add an app...**
  fills a free place. Holding OK on an app gives **Move** (to rearrange tiles interactively with arrow keys and confirm with OK), **Add to dock** or **Remove from dock**, **Change icon** and **Reset icon** (see [Your own icon](#your-own-icon)), **Hide app** and **Uninstall** (with a confirmation prompt, for user-installed LG Store and Homebrew apps);
- the **top buttons**: move one left or right, remove it, or add Inputs, Settings, Live TV, TV, **Power off** or any app. **TV** opens LG's own Live TV (the
tuner) and is offered only when the TV has that app and **Show LG's own Live TV** is on in the manager;
  **Power off** asks first and then switches the TV off completely, unlike the remote's power key, which only suspends it (Quick Start+).
  The next start is a cold boot, so it takes longer, and Wake-on-LAN no longer wakes the TV;
- **hidden apps** (show them again);
- the **app order** (most used first, A to Z, or custom static);
- **show app name**: shows or hides the large name of the focused app. When hidden in the plain layout (`below` mode, dock near the top), the dock moves up to the name's position. The dock stays where it is in `push` and `overlay` grid modes and when the dock is at the bottom;
- **mark running apps** (a green dot on their tiles, or none);
- the **clock** format (automatic, 12 or 24 hour);
- the **theme** (see [Themes](themes.md)) and the **accent colour**; the theme list shows each theme's screenshot;
- **Wallpapers**: your own photos behind Home, and how often they change (see [Wallpapers](wallpapers.md));
- **More settings...**, which opens the [manager app](manager.md) for everything the TV and the service do.

Putting the dock, buttons, hidden apps, order and clock back to the defaults is in the manager app: **Reset Home customisation**.


## Cards

Cards are set up in the [manager app](manager.md), **Cards**. Themes with places for cards (**Lock Screen**, **Bloom** and **Horizon**)
also have a **Cards** row in **Customise** that opens it. It lists the places (above the clock, beside the clock, a column on the right,
above the dock); choose one to put a card there or leave it empty. A card you chose stays when you switch to another theme with the
same place.

**More cards** are downloaded: in the manager, **Cards** > **Get more cards** lists the cards in the project's catalog on GitHub, each with a picture and a text, and installs or removes them (a countdown to a date, a quote, the progress of the year, prayer times and a remembrance in Arabic (cards with a page of their own, which runs in a closed frame), and more as people add them). An installed card is one more kind of card for each place, and its options (a title, a date, a text) are typed on the phone page. A card has no script, only a template, so it cannot run anything on the TV; how to make one is in [Making a card](development/cards.md).

| Card | What it shows |
|---|---|
| Greeting | Good morning, afternoon or evening, with your name if you set one, and the date or the weather on a second line where there is room. |
| Weather | The temperature and the sky now at a place you search for on the phone page, from Open-Meteo (free, no account), with the next three days if you like; °C or °F. The TV asks at most every 30 minutes and keeps the last answer for when the internet is away. |
| Home Assistant entity | One entity with an icon, its state (On, Off, 8.4 °C) and its name. Select it with the remote (it joins the row of top buttons) and press OK to switch a light, switch, fan or automation, or to run a scene or script. Locks, alarms and covers are never switched from the TV. |
| Home Assistant entities | A list of entities, one per line on the phone page, with an optional title. |
| Home Assistant camera | A camera's picture, renewed every 10, 30 or 60 seconds while Home is shown. |
| Home Assistant weather | A `weather.*` entity: the sky now with an icon, the temperature (from an outside temperature sensor if you choose one, otherwise the entity's own), humidity and wind, and the forecast for the next days or hours from `weather.get_forecasts` (Home Assistant 2023.9 and newer; older versions are read from the `forecast` attribute). Asked every five minutes, the forecast at most every 15 minutes. It also feeds `{{weather.temp}}`, `{{weather.text}}` and the greeting's weather line. |
| Spotify now playing | What plays on your Spotify account, on any device, with the cover, the title, the artist, a thin progress bar and four buttons: previous, play or pause, next, and the output (where it plays). It is there while something plays and while a track is paused (to resume it); an advertisement, nothing playing, offline or not set up all leave it away. See [Spotify now playing](#spotify-now-playing). |
| Text | Your own text. `{{greeting}}`, `{{time}}`, `{{date}}` and `{{weekday}}` are filled in and kept up to date, and `{{weather.temp}}` and `{{weather.text}}` with a weather card on Home; `**bold**`, `*italic*` and a line starting with `#` for a heading. In three sizes. |

**Customise** > **Home Assistant** (the first row, in themes with places for cards) chooses the cards with
the remote: for each place the kind of card (Home Assistant entity, entities, camera, greeting or empty, and the Home Assistant weather card where the launcher has it) and what it shows,
picked from the entities Home Assistant has (a weather entity and a temperature sensor for the weather card; for the entity cards
first the kind, such as lights or sensors, then the entity). It saves the same settings as the phone page. Its first row, **Connection**, says whether Home Assistant is linked and opens the manager app's Home Assistant screen with the code for the phone page.

Names, texts and the other options are typed on your phone: **Cards** > **Set up from your phone** in the manager app shows a QR
code. The page shows a form for each place, and **Edit as JSON** shows all cards at once, for example
`{"greeting": {"type": "greeting", "name": "Sam"}}`. It stays open while you use it, at most an hour, and needs the code shown on
the TV. The Home Assistant cards use the address and the long-lived access token set in the manager app under **More** >
**Home Assistant** > **Set up from your phone**, the same ones [Voice](voice.md) uses. Without them a Home Assistant card says that
Home Assistant is not set up; the TV asks Home Assistant for the states every 30 seconds while Home is shown. The phone page
offers your entities while you type.

A Home Assistant card stays hidden while Home Assistant is not set up or no entity is chosen, and is then no place for the focus
either.

### Spotify now playing

The TV does not share what the LG Spotify app plays: webOS has no equivalent of Android's media session that other apps can read, so
the card asks Spotify's Web API for what plays on your account (it also shows music playing on your phone or computer). That needs
a Spotify app of your own, which is free, but Spotify's rules for it apply:

- The Spotify account that owns the app needs **Premium**, or the app stops working (Spotify's rule since February 2026).
- A Spotify app in development mode serves up to **five users**, added by email under **Users Management** in its settings. That
  is enough for a household. Nobody else can use your app.
- Nothing is sent to anyone but Spotify. The TV asks for the current track every 6 seconds while it plays and every 15 seconds
  while nothing does, only while Home is shown; the service keeps each answer for a few seconds and waits when Spotify says
  "too many requests".

To set it up, open **Customise** > **Spotify** on Home, below Home Assistant. It works like Home Assistant: **Connection** opens the
Spotify page of the manager app, and each place of the theme below it shows Spotify there (OK) or empties it again. The manager app has
the same page under **Spotify now playing**. In the connection page choose **Connect from your phone** and scan the code:
The phone page walks through these steps one at a time (log in, create the app, add your email, Client ID and sign-in, approve and
connect); the sign-in link and the box for the address appear in the last step. Once connected it shows the name of the Spotify account
that is signed in, and so do **Customise** > **Spotify** and the manager app (the name is asked from Spotify, kept only in memory and never saved):

1. On developer.spotify.com create an app. Add `http://127.0.0.1:8888/callback` as its **Redirect URI** (Spotify accepts only https
   addresses or a loopback address written as an IP) and your own email under **Users Management**. Copy the **Client ID**. You do
   not need the client secret and should never type it anywhere.
2. On the phone page paste the Client ID and tap **Prepare sign-in**, then **Open Spotify sign-in** and approve.
3. Spotify sends the phone's browser to the redirect address, which cannot open on a phone: that is expected. Copy the whole address
   from the browser's address bar, paste it into the page and tap **Connect**. The code in it works only with the TV that made the
   sign-in link, and only once.
4. Back in **Customise** > **Spotify**, choose the place for the card (or choose it for a place in **Cards**, or **Customise** >
   **Home Assistant**, where the place's menu also has the one option of the card, the progress bar).

**The buttons.** In a place at least 200 px high the card shows previous, play or pause, next and the output, and the time (`1:05 / 3:54`)
beside them. They join the top row for the remote like the buttons of the top row (Up from the apps reaches Inputs, Live TV, Settings
and Customise; Down from there goes to play or pause, Left and Right move between the buttons, OK presses, Up goes back to the top
row). A smaller place shows the cover and the text only. The buttons send Spotify's player commands (`play`, `pause`, `next`,
`previous`) to whichever device plays; Spotify allows them only to **Premium** users, and answers "no active device" when nothing is
playing anywhere. The card changes at once and asks Spotify again after each press until the answer agrees. If you connected before
the buttons existed, the sign-in lacks the permission to control playback: the settings page says so, and **Sign in again from your
phone** asks for it.

**The output.** The last button (a speaker) lists the devices that Spotify shows for your account, the ones with Spotify open and signed
in (this TV's Spotify app, your phone, a speaker), with the one that plays marked. OK on another moves the music there: a song that
plays keeps playing, a paused one stays paused. Each row has a picture of the kind of device (TV, computer, phone, speaker). Spotify lists a device only while its Spotify app is awake, so the service also looks for Spotify Connect speakers on your network (mDNS, like the Spotify apps do) and adds the ones that are missing. Choosing one of those wakes it first: the service gives it your account's access token over your local network (encrypted for that device), it registers with Spotify, and the music moves there. Waking needs the permission **streaming**: after an update, **Sign in again from your phone** once (the manager says so). Without a TV in the list the last row is **This TV**, which (like a TV that is listed) does what the cover does: it opens the TV's Spotify app on the song, at the place it was, and the app takes the music over from the other device. A plain transfer to the TV is not used: the TV's app then stays paused. Moving the music sets the song back to where it was when the new device starts it from the beginning. This needs the same
Premium account and permission as the other buttons.

**The cover and long names.** The cover is a target for the remote and the pointer too (the first one in that row, left of the
buttons): OK or a click opens the Spotify app of the TV on the song that plays. The app can show the song only when it is started with it,
and then plays it from the start; the service therefore sets the song back to where it was a moment after the app has started it
(a short jump back to the beginning can be heard; the music stays on the device that plays it, and a paused song is not touched: the
app then opens on its Home). A title or an artist wider than the card runs sideways to its end and back, resting at both ends,
instead of being cut off; a short one stays still.

**When Spotify turns the settings down.** If Spotify no longer accepts the saved sign-in (revoked at spotify.com/account/apps, or older than six months) or refuses the account for your app (not under Users Management), the card shows one toast, the first time the card is on Home after the TV is switched on (the service remembers that it has been shown until it runs anew, and a different kind of rejection is shown again). Sign in again from **Customise** > **Spotify**.

The sign-in is kept in `config.json` (readable by root only) and is never shown or returned; **Disconnect Spotify** deletes it. Spotify
lets a sign-in last about six months; after that the settings page says to sign in again (**Sign in again from your phone**). The cover is shown as Spotify sends it and
is kept in memory for an hour at most. The card names Spotify; it does not carry Spotify's logo or a link back, which a TV cannot
follow.

Cards dim after three minutes without a key press and shift by a few pixels every few minutes, so nothing stays in one place on an
OLED panel for hours. How a theme marks its places is in [Themes](themes.md#slots-for-cards).

## Inputs

The **Inputs** button lists HDMI inputs by the names LG shows, with what is connected and a marker on the active one. OK
switches to the input.

### An input on Home

Hold OK on an input in the Inputs list and choose **Add to Home**. The input then shows as a tile, with the HDMI symbol, the name
the TV gives it (for example the name of the connected console) and its port. It is a tile like an app: OK switches to the input,
and holding OK on it offers **Add to dock**, **Move left**, **Move right** and **Remove from dock**. **Remove from Home** takes it
off again; that is also in the Inputs list. A tile of an input with nothing connected is dimmed and still switches to it.

In the [Inputs picker](input-key.md) of the Input key, holding OK on an HDMI input does the same: it is added to Home, or taken off
when it already is. An input in the dock also shows in the picker's row of dock apps.

Suggested and first built by [ibexes](https://github.com/lasharor/cleanyourtv-WebOS/pull/25).

![Inputs menu](screenshots/inputs.jpg)

## Icons

Each tile uses the app's own icon. The tile colour is taken from the icon's edge colour, so an icon that reaches its edges blends
into the tile, and the ambient glow comes from the icon's most vivid colour. Colours are worked out once per app and remembered.

A picture on one flat colour (a logo on black) gives that colour to its tile, taken from the picture's four corners, so the picture does
not show as a square. A transparent logo drawn in near-black (made for a white background) gets a light tile, where it would hardly be seen. The Inputs picker colours the tiles of its apps the same way.

An icon that is an opaque square with a transparent margin around it (many LG icons) is enlarged so it fills its tile, and a
gradient icon in the dock gets a tile with the same gradient ([#3](https://github.com/lasharor/cleanyourtv-WebOS/issues/3)).

### Your own icon

This is the **App icons** add-on, which ships with CleanYourTV and is on by default (manager > Add-ons). With it off, **Change icon** and
**Reset icon** are not offered, the **App icons** screen is hidden and every app shows its own icon again; the pictures stay on the TV.

Hold OK on an app and choose **Change icon**: the manager app opens its **App icons** screen with a QR code. On the phone page (port 8794,
the code shown on the TV, at most an hour) choose **Change** next to the app and a picture. A preview shows it in a dock tile and a grid
tile of the theme in use, in one of two ways:

- **Full tile** (the default for a photo): the picture covers the whole tile, its middle kept, so any photo works. The phone scales it to
  1024 pixels on the long side.
- **Icon** (the default for a picture with see-through parts): the picture sits inside the tile like the app's own icon, with the tile's
  colour and glow worked out from it; best for a logo on a transparent background. The phone scales it to 512 pixels.

A photo is sent as JPEG; a picture with see-through parts as PNG (made smaller when needed to fit in 1 MB), so it stays see-through in
either way of showing it.

The screen on the TV and the phone page give the sizes that fit best: for Full tile the size of a dock tile in the panel's own pixels
(the grid's tiles, which are squarer, show its middle), for Icon 512 x 512. They follow the theme, and the manager measures the screen's
scale, so a 4K TV, where Home is drawn at 3840 x 2160, gets twice the size of its CSS pixels. Back on Home the tile shows the picture in
the dock, the grid and the Inputs list. **Reset icon**, on Home or on the phone page, gives the app its own icon again. The pictures (JPEG,
PNG or WebP, at most 1 MB) are kept in `/media/developer/cleanyourtv/icons/` (Icon) and `icons/tile/` (Full tile), one per app, at most
300; the app's own files are never touched, so the picture stays when the app or CleanYourTV updates. **More** > **App icons** in the
manager opens the same page.

## Language

Menus follow the TV's language, or the one chosen in the manager app: English, Dutch, German, French, Spanish, Catalan, Russian,
Turkish, Arabic, Polish, Italian, Brazilian Portuguese, Vietnamese and Hungarian. See [Languages](languages.md), also for adding one.

## Themes

The look of the home screen (colours, tile and text size, columns, clock, glow, animation speed, wallpaper) is a [theme](themes.md),
chosen in the manager app.

## Settings file

Settings are stored on the TV in `/media/developer/cleanyourtv/config.json`:

| Key | Meaning |
|---|---|
| `dock` | App ids in the dock (up to four). |
| `topbar` | The buttons at the top. |
| `hidden` | App ids you hid. |
| `pinnedInputs` | The inputs on Home: `{id, label, port}`, `id` being the input's app (for example `com.webos.app.hdmi2`). |
| `sort` | `usage` or `alpha`. |
| `clock` | `auto`, `12` or `24`. |
| `runDots` | `true` shows a green dot on open apps (off by default). |

See [`config.example.json`](https://github.com/lasharor/cleanyourtv-WebOS/blob/main/config.example.json). Change settings in
the launcher; the file is read and written by the service.
