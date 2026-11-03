# Wallpapers

Your own photos behind the home screen, from two sources: photos you upload from a phone, and photos from albums on your
[Immich](https://immich.app) server. Both end up in one library on the TV.

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
same Wi-Fi. The page has two parts:

- **Upload photos**: choose one or more photos. Each one is scaled on the phone before it is sent (to 3840 or 1920 pixels on the
  long side, see **Picture size**), which also turns an iPhone's HEIC photos into JPEG. The page shows the progress and what failed.
  Uploaded photos are listed below, each with a × to delete it.
- **Configure Immich**: the server address and an API key, then **Test connection and save**. Choose albums and **Save albums and
  sync** (choosing albums while a sync runs starts another one right after it). The synced photos are listed; tap one to hide it from the TV (tap again to show it).

The page is served by the TV itself on port 8791, needs the code shown on the TV, stays open while you use it (at most an hour)
and closes when you leave the QR screen. It is not encrypted: photos and the Immich key travel over your Wi-Fi.

## The manager screen

| Row | What it does |
|---|---|
| Manage from your phone | The QR code for the phone page. |
| Local uploads, Immich, Total | How many photos there are per source, when Immich was last synced and its last error, and the space used. |
| Sync now | Downloads new and changed photos from the chosen Immich albums and removes the ones that left them. |
| Picture size | 4K (3840 pixels, the default) or Full HD (1920). Applies to new uploads and to the next Immich sync. On a 4K TV, Home is laid out at 1920 x 1080 but drawn at 3840 x 2160, so a 4K photo is shown pixel for pixel; Full HD fits about four times as many photos in 150 MB. |
| Remove all uploads | Deletes every uploaded photo, after a confirmation. |
| Disconnect Immich | Forgets the address and the key and deletes the Immich photos, after a confirmation. |

## Immich

Create an API key in Immich under **Account settings** > **API keys** with at least the `album.read`, `asset.read` and `asset.view`
permissions (`asset.download` too for full-size pictures on older servers). The key is kept in the service's settings file
(`config.json`, readable by root only); the TV's pages only ever see its last four characters, and it is not logged.

A sync reads the chosen albums (your own and the ones shared with you) through the Immich API (on Immich 2 and newer, where an
album no longer lists its photos, by searching for the album's photos), skips videos and photos in the
trash, and downloads each photo once, newest first. A photo is downloaded again only when Immich reports a different checksum;
it is tracked by its Immich ID, not its file name. Photos that are no longer in a chosen album are deleted from the TV; nothing
else is touched. At 4K the TV asks for Immich's full-size picture (Immich 1.120 or newer), then the original when it is a JPEG,
PNG or WebP, then the preview; at Full HD it uses the preview (about 1440 pixels).

The sync runs every six hours, and with **Sync now**. Shortly after the TV starts it only runs when the last sync is more than a
day old. When Immich cannot be reached the photos already on the TV stay, and the error is shown. Showing a photo never needs
Immich.

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
| Immich | At most 300 photos. |
| Space | 150 MB for both together. A full library refuses uploads and stops the sync with a message. |

The photos are stored in `/media/developer/cleanyourtv/wallpapers/`: `upload/` (each under a random name), `immich/` (each under
its Immich ID) and `index.json`, which records the source, size and checksum of every file. Only files listed there are ever
deleted. They survive restarts and updates; **Uninstall** removes them with the rest.
