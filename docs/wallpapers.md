# Wallpapers

Your own photos behind the home screen. Out of the box they are files: photos you upload from a phone. Other sources are
[add-ons](development/addons.md) you install in the manager: [Immich](https://immich.app) albums, [Unsplash](https://unsplash.com), and more. Everything ends up in
one rotation on the TV.

## Switching it on

In the launcher, **Customise** > **Wallpapers**:

| Row | What it does |
|---|---|
| Use Wallpapers | On: a photo from the library replaces the theme's background, in every theme. Off: the theme as it is. |
| New photo | When the photo changes: each time Home opens, or also every 10 or 30 seconds, every minute, or every 3, 5, 15 or 60 minutes while Home is on screen. The photos cross-fade. |
| Add photos... | Opens the manager app on its Wallpapers screen. |

The photo is chosen at random and darkened like a theme's wallpaper (the theme's own darkening, or 40 % when it has none). With
no photos in the library, Home looks as before. The theme **Still** switches the cross-fade off along with the other animations.

## Adding photos

In the manager app, **Wallpapers** > **Manage from your phone** shows a QR code and a 6-digit code. Scan it with a phone on the
same Wi-Fi. The page is for uploading:

- **Upload photos**: choose one or more photos. Each one is scaled on the phone before it is sent (to 3840 or 1920 pixels on the
  long side, see **Picture size**), which also turns an iPhone's HEIC photos into JPEG. The page shows the progress and what failed.
  Uploaded photos are listed below, each with a × to delete it.

The page is served by the TV itself on port 8791, needs the code shown on the TV, stays open while you use it (at most an hour)
and closes when you leave the QR screen. It is not encrypted: photos travel over your Wi-Fi.

## The manager screen

| Row | What it does |
|---|---|
| Manage from your phone | The QR code for the phone page. |
| Local uploads, one row per photo source, Total | How many photos there are per source, a line about each source (for Immich when it was last synced and its last error), and the space the uploads use. A source row opens that source's own page on the phone. |
| Picture size | 4K (3840 pixels, the default) or Full HD (1920). Applies to new uploads and to what photo sources download next. On a 4K TV, Home is laid out at 1920 x 1080 but drawn at 3840 x 2160, so a 4K photo is shown pixel for pixel; Full HD fits about four times as many photos in 150 MB. |
| Remove all uploads | Deletes every uploaded photo, after a confirmation. |
| Immich is an add-on now, Remove old Immich data | Only on a TV that used Immich before it became an add-on: the old settings and photos wait until you install the Immich add-on, which takes them over once. **Remove old Immich data** deletes them instead, after a confirmation. |

## Immich (add-on)

Install **Immich** in the manager's **Add-ons**. It adds a row on the Wallpapers screen that opens its page on the phone: the server
address and an API key, then **Test connection and save**, the albums, and the synced photos (tap one to hide it from the TV).

Create an API key in Immich under **Account settings** > **API keys** with at least the `album.read`, `asset.read` and `asset.view`
permissions (`asset.download` too for full-size pictures on older servers). The key is kept in the service's settings file
(`config.json`, readable by root only); the TV's pages only ever see its last four characters, and it is not logged.

A sync reads the chosen albums (your own and the ones shared with you) through the Immich API (on Immich 2 and newer, where an
album no longer lists its photos, by searching for the album's photos), skips videos and photos in the
trash, and downloads each photo once, newest first. A photo is downloaded again only when Immich reports a different checksum;
it is tracked by its Immich ID, not its file name. Photos that are no longer in a chosen album are deleted from the TV; nothing
else is touched. At 4K the TV asks for Immich's full-size picture (Immich 1.120 or newer), then the original when it is a JPEG,
PNG or WebP, then the preview; at Full HD it uses the preview (about 1440 pixels).

The sync runs every six hours, and when you save albums or press **Sync now** on the phone page. Shortly after the TV starts it only
runs when the last sync is more than a day old. When Immich cannot be reached the photos already on the TV stay, and the error is
shown. Showing a photo never needs Immich. The photos are kept in the add-on's own folder (`addon-data/immich/`), at most 300 photos
and 100 MB.

**From an earlier version.** Immich used to be part of Wallpapers. If your TV had it set up, the address, key, albums and photos stay
where they were until you install the Immich add-on, which takes them over once (nothing is downloaded again). Until then they are not
used. To drop them instead, use **Remove old Immich data** on the Wallpapers screen.

## Unsplash (add-on)

Install **Unsplash** in the manager's **Add-ons**. It adds a row on the Wallpapers screen that opens its page on the phone. A free
Access Key (unsplash.com/developers: create an application and copy its Access Key; a new key may make 50 requests an hour) gives Home a
new random landscape photo, from the search words you enter or, with none, from Unsplash's Wallpapers topic. The TV saves no picture:
Home loads each one straight from Unsplash's image host.

- **Test key and save** checks the key, saves it and fetches a photo at once, which Home shows within seconds.
- At most one new photo every 3 minutes (2 requests each, 40 of the 50 an hour). In between, and while the hourly limit is used up
  (a clear message; new photos come again after an hour), one of the last 30 photos shown comes round again. A request that fails is
  tried again after 30 seconds.
- Each photo shows its credit in a corner of Home, "Photo by NAME on Unsplash" (Unsplash's guidelines ask for it, so it cannot be
  switched off); the phone page lists the recent photos with the photographer and Unsplash linked, and every download is reported to
  Unsplash as the guidelines ask.
- The key goes only in the `Authorization` header of requests to `api.unsplash.com`, which are never redirected; picture requests
  carry no key. It is kept in the TV's `config.json` and the phone page shows its last four characters at most. **Remove Unsplash**
  deletes it. **Turn Unsplash off** on the page stops it without losing the key.

The Unsplash integration was first written by Edenik in a pull request to Wallpapers; it lives in this add-on now.

## More photo sources (add-ons)

Other sources of photos are add-ons that provide wallpapers (see [add-ons](development/addons.md#providing-something-to-the-service-photo-sources)).
Each shows as a row on the manager's **Wallpapers** screen with one line about it, and opens its own settings page on your phone. Their
photos are mixed with your uploads. A *live* source shows a new photo now and then without keeping it on the TV, and Home shows a small
credit line in the bottom right corner for such a photo (the photographer). Core only supplies the rotation, the dimming and the picture
size.

## Limits and storage

| | |
|---|---|
| Uploads | At most 100 photos, 12 MB each; JPEG, PNG and WebP (checked by their content, not their name). |
| Space | 150 MB for the uploads. A full library refuses uploads with a message. Each photo source keeps its own photos and limits (Immich: 300 photos, 100 MB). |

The photos are stored in `/media/developer/cleanyourtv/wallpapers/`: `upload/` (each under a random name) and `index.json`, which records every upload (`immich/` is what an earlier version synced
from Immich, kept until the Immich add-on takes it over). Only files listed there are ever
deleted. They survive restarts and updates; **Uninstall** removes them with the rest.
