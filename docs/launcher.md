# The launcher

The launcher replaces LG's Home. It is a web page of the project that the TV's browser runs, so it starts fast and works the
same on every supported webOS version.

![Home screen](screenshots/home.jpg)

## The screen

- **Dock.** Up to four apps, large, on the first row.
- **Top shelf.** The name of the focused app and an ambient glow taken from its icon.
- **Grid.** All other apps, sorted by how often you use each one, A to Z, or your own custom static order.
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

**Customise** holds how Home looks:

- the **dock**: each app in it can be replaced (an app already in the dock swaps places), moved or removed, and **Add an app...**
  fills a free place. Holding OK on an app gives **Move** (to rearrange tiles interactively with arrow keys and confirm with OK), **Add to dock** or **Remove from dock**, **Change icon** and **Reset icon** (see [Your own icon](#your-own-icon)), **Hide app** and **Uninstall** (with a confirmation prompt, for user-installed LG Store and Homebrew apps);
- the **top buttons**: move one left or right, remove it, or add Inputs, Settings, Live TV, TV, **Power off** or any app. **TV** opens LG's own Live TV (the
tuner) and is offered only when the TV has that app and **Show LG's own Live TV** is on in the manager;
  **Power off** asks first and then switches the TV off completely, unlike the remote's power key, which only suspends it (Quick Start+).
  The next start is a cold boot, so it takes longer, and Wake-on-LAN no longer wakes the TV;
- **hidden apps** (show them again);
- the **app order** (most used first, A to Z, or custom static);
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

| Card | What it shows |
|---|---|
| Greeting | Good morning, afternoon or evening, with your name if you set one, and the date or the weather on a second line where there is room. |
| Weather | The temperature and the sky now at a place you search for on the phone page, from Open-Meteo (free, no account), with the next three days if you like; °C or °F. The TV asks at most every 30 minutes and keeps the last answer for when the internet is away. |
| Home Assistant entity | One entity with an icon, its state (On, Off, 8.4 °C) and its name. Select it with the remote (it joins the row of top buttons) and press OK to switch a light, switch, fan or automation, or to run a scene or script. Locks, alarms and covers are never switched from the TV. |
| Home Assistant entities | A list of entities, one per line on the phone page, with an optional title. |
| Home Assistant camera | A camera's picture, renewed every 10, 30 or 60 seconds while Home is shown. |
| Home Assistant weather | A `weather.*` entity: the sky now with an icon, the temperature (from an outside temperature sensor if you choose one, otherwise the entity's own), humidity and wind, and the forecast for the next days or hours from `weather.get_forecasts` (Home Assistant 2023.9 and newer; older versions are read from the `forecast` attribute). Asked every five minutes, the forecast at most every 15 minutes. It also feeds `{{weather.temp}}`, `{{weather.text}}` and the greeting's weather line. |
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
Turkish, Arabic, Polish, Italian and Brazilian Portuguese. See [Languages](languages.md), also for adding one.

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
