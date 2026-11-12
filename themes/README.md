# Themes

The themes of CleanYourTV. A theme changes how the home screen looks: colours, the position and size of the clock, buttons, app name,
dock and grid, text, effects and a wallpaper. In the manager app, **Theme** lists them with these screenshots; the TV reads this folder
from GitHub (the `main` branch) and downloads a theme when you choose it. A new theme is available to every TV as soon as it is merged,
without a release.

[![Classic, Midnight, Pixel and Bloom](../docs/screenshots/themes-readme.jpg)](../docs/screenshots/themes-readme.jpg)

| File | What it is |
|---|---|
| `index.json` | The list the TV downloads. Generated: `node tools/theme-index.js`. |
| `<id>/theme.json` | The theme: colours, positions, sizes, effects. Every key is optional. |
| `<id>/preview.jpg` | The screenshot shown in the manager. |
| `<id>/<wallpaper>` | The wallpaper, if the theme uses one. |
| `<id>/<typeface>` | A typeface (`type.fontFile`), if the theme uses one, with its licence file. |

Every setting, with its range and default, is in the [Themes page of the documentation](https://lasharor.github.io/cleanyourtv-WebOS/themes/).

## Make your own

A step-by-step guide, including how to make one with an AI assistant, is on the [Themes page](https://lasharor.github.io/cleanyourtv-WebOS/themes/#making-a-theme-with-an-ai-assistant). The short version:

1. Copy a folder, for example `classic/`, to `<id>/` (lower-case letters, digits and `-`).
2. Change only what you want to change in `theme.json`. A missing value keeps the default, or the value of the theme named in `"extends"`.
3. Put a screenshot of the result in `preview.jpg` (16:9, about 800 px wide, at most 600 KB). `node tools/theme-preview.mjs <id> --write` makes it.
4. If it uses a wallpaper, put a `.jpg`, `.png` or `.webp` (at most 1.5 MB, 1920 x 1080) in the folder and name it in `effects.wallpaper`.
5. Run `node tools/theme-index.js`, then `node tools/test.js theme`.
6. Open a pull request. A wallpaper or typeface must be your own work or under a licence that allows redistribution; say which,
   and put a typeface's licence file in the folder.

## The themes

### Classic

The original look: near-black, white focus, ten columns.

[![Classic](classic/preview.jpg)](classic/preview.jpg)

Folder: [`classic/`](classic/)

### Cinema

A dark living-room layout with wide app tiles, a soft pill top bar and the focused app's dimmed icon in the background.

[![Cinema](cinema/preview.jpg)](cinema/preview.jpg)

Folder: [`cinema/`](cinema/)

### Big Tiles

Classic with large tiles matching the dock in four columns.

[![Big Tiles](big-tiles/preview.jpg)](big-tiles/preview.jpg)

Folder: [`big-tiles/`](big-tiles/)

### Bloom

A flower wallpaper with the dock in a glass panel at the bottom. Down moves the dock up and the apps appear below it, centred.

[![Bloom](bloom/preview.jpg)](bloom/preview.jpg)

Folder: [`bloom/`](bloom/)

### Lock Screen

A phone-style lock screen: a greeting and a big clock top left, and a small, translucent dock low in the corner over a calm blue landscape, so the picture fills the screen. Down moves the dock up and shows all apps below it. Turn Wallpapers on in Customise for your own photos behind it. It has slots for cards (Customise > Cards): the greeting is one.

[![Lock Screen](lockscreen/preview.jpg)](lockscreen/preview.jpg)

Folder: [`lockscreen/`](lockscreen/)

### Moon

A moonlit autumn landscape with a four-app glass dock, warm focus, app-colour rails and places for cards around the clock.

[![Moon](moon/preview.jpg)](moon/preview.jpg)

Folder: [`moon/`](moon/)

### Liquid Glass

Translucent frosted glass surfaces with luminous edges over a deep dark aurora, a stacked greeting with inline time and date, and a sliding glass focus frame.

The typeface is Outfit (weight 400), in the folder as `outfit.ttf` under the SIL Open Font License 1.1 (`OFL.txt`); the wallpaper (`aurora.jpg`) and styling come from CYTV themes under the MIT License (`LICENSE.txt`, see `CREDITS.txt`).

[![Liquid Glass](liquid-glass/preview.jpg)](liquid-glass/preview.jpg)

Folder: [`liquid-glass/`](liquid-glass/)

### Horizon

A row of seven square apps along the bottom of a dusk landscape, the clock on the left and the buttons on the right at the top. Down moves the row up and shows all apps below it.

[![Horizon](horizon/preview.jpg)](horizon/preview.jpg)

Folder: [`horizon/`](horizon/)

### Pixel

Pixel art: a blocky typeface, square tiles and buttons, a yellow focus box and a sunset over a lake drawn in big pixels. Moves without animation, like an old console.

The typeface is Pixelify Sans (weight 500, Latin, unmodified), in the folder as `pixel.woff2` under the SIL Open Font License 1.1
(`OFL.txt`); the wallpaper was drawn for this theme.

[![Pixel](pixel/preview.jpg)](pixel/preview.jpg)

Folder: [`pixel/`](pixel/)

### Compact

Twelve columns of smaller tiles: more apps on screen.

[![Compact](compact/preview.jpg)](compact/preview.jpg)

Folder: [`compact/`](compact/)

### Large print

Eight columns of big tiles and bigger text, easier to read from the sofa.

[![Large print](large/preview.jpg)](large/preview.jpg)

Folder: [`large/`](large/)

### Midnight

Deep blue with a soft wallpaper and a blue focus.

[![Midnight](midnight/preview.jpg)](midnight/preview.jpg)

Folder: [`midnight/`](midnight/)

### OLED black

Pure black, no ambient glow: unlit pixels stay off.

[![OLED black](oled/preview.jpg)](oled/preview.jpg)

Folder: [`oled/`](oled/)

### Still

No animation and a quiet glow, for anyone who prefers a calm screen.

[![Still](still/preview.jpg)](still/preview.jpg)

Folder: [`still/`](still/)

### Warm

Brown and amber with the glow in the accent colour.

[![Warm](warm/preview.jpg)](warm/preview.jpg)

Folder: [`warm/`](warm/)
