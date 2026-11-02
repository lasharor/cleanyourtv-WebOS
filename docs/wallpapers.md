# Wallpapers

Photos behind the home screen, from three sources: photos you upload from a phone, photos from albums on your
[Immich](https://immich.app) server, and landscape photos from [Unsplash](https://unsplash.com). All of them end up in one library on
the TV.

## Switching it on

In the launcher, **Customise** > **Wallpapers**:

| Row | What it does |
|---|---|
| Use Wallpapers | On: a photo from the library replaces the theme's background, in every theme. Off: the theme as it is. |
| New photo | When the photo changes: each time Home opens, or also every 10 or 30 seconds, every minute, or every 3, 5, 15 or 60 minutes while Home is on screen. The photos cross-fade. |
| Photo credit | On: an Unsplash photo shows "Photo by NAME on Unsplash" in the bottom corner, as Unsplash's guidelines ask. Off: no credit on Home (the phone page still lists the photographers). Other photos never show one. |
| Add photos... | Opens the manager app on its Wallpapers screen. |

The photo is chosen at random and darkened like a theme's wallpaper (the theme's own darkening, or 40 % when it has none). With
no photos in the library, Home looks as before. The theme **Still** switches the cross-fade off along with the other animations.

## Adding photos

In the manager app, **Wallpapers** > **Manage from your phone** shows a QR code and a 6-digit code. Scan it with a phone on the
same Wi-Fi. The page has three parts:

- **Upload photos**: choose one or more photos. Each one is scaled on the phone before it is sent (to 3840 or 1920 pixels on the
  long side, see **Picture size**), which also turns an iPhone's HEIC photos into JPEG. The page shows the progress and what failed.
  Uploaded photos are listed below, each with a × to delete it.
- **Configure Immich**: the server address and an API key, then **Test connection and save**. Choose albums and **Save albums and
  sync** (choosing albums while a sync runs starts another one right after it). The synced photos are listed; tap one to hide it from the TV (tap again to show it).
- **Configure Unsplash**: your Unsplash Access Key and, optionally, search words (see [Unsplash](#unsplash)), then
  **Test key and save**: it checks the key, fetches **one new photo now**, lists it under **Recent photos** and Home shows it within a few
  seconds, so you can see that a change worked (every click fetches another). Recent photos are the last ones Home showed, each with who
  took it ("Photo by NAME on Unsplash", each name linked to the photographer's Unsplash page). The page also has **Turn Unsplash off** or
  **on**, and **Remove Unsplash**.

The page is served by the TV itself on port 8791, needs the code shown on the TV, stays open while you use it (at most an hour)
and closes when you leave the QR screen. It is not encrypted: photos and the Immich and Unsplash keys travel over your Wi-Fi.

## The manager screen

| Row | What it does |
|---|---|
| Manage from your phone | The QR code for the phone page. |
| Local uploads, Immich, Unsplash, Total | How many photos there are per source, when Immich was last synced, the last error of Immich and Unsplash (or that Unsplash is paused for the hourly limit), and the space used. |
| Sync now | Downloads new and changed photos from the chosen Immich albums and removes the ones that left them. |
| Use Unsplash photos | Shows the Unsplash photos on Home (On) or not (Off). While it is off the key stays and nothing is asked of Unsplash. |
| Picture size | 4K (3840 pixels, the default) or Full HD (1920). Applies to new uploads, to the next Immich sync and to the next Unsplash photo. On a 4K TV, Home is laid out at 1920 x 1080 but drawn at 3840 x 2160, so a 4K photo is shown pixel for pixel; Full HD fits about four times as many photos in 150 MB. |
| Remove all uploads | Deletes every uploaded photo, after a confirmation. |
| Disconnect Immich | Forgets the address and the key and deletes the Immich photos, after a confirmation. |
| Remove Unsplash | Forgets the Access Key and the list of recent photos, after a confirmation. |

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

## Unsplash

Unsplash photos need your own free **Access Key**: sign in at [unsplash.com/developers](https://unsplash.com/developers), create a **New
Application** and copy its Access Key (not the Secret Key). A new application is in Unsplash's demo mode, which allows **50 requests
an hour**; you use the key under [Unsplash's API terms](https://unsplash.com/api-terms). The key is kept like the Immich key: in
`config.json` (readable by root only), shown on the TV's pages as its last four characters, never logged and never sent anywhere but
`api.unsplash.com`; the service does not follow a redirect with it.

**Which photos.** Landscape photos only (a photo that is taller than wide is skipped): those that match your **search words** (for
example `mountains`), with Unsplash's content filter set to high; with no words, Unsplash's **Wallpapers** topic.

**How it works.** Nothing is listed and no picture is saved on the TV. When Home is about to show an Unsplash photo, the service asks
Unsplash for **one random landscape photo** (`/photos/random`, for your search words or the Wallpapers topic), reports its
download (`links.download_location`, which Unsplash's guidelines require) and hands Home the picture's address; Home loads the picture from
Unsplash's image host and it fades in. The picture request never carries the key. The picture is Unsplash's `urls.raw` with `w` (3840 or
1920, the **Picture size**), `fit=max`, `q=80` and `fm=jpg` added (the `ixid` stays), not the full original. The TV's browser may keep
a picture in its own cache; CleanYourTV itself saves none.

**How often.** A new photo is asked for at most **every 3 minutes**: 2 requests each, 40 an hour of the 50 a new key has. Home may change
the wallpaper more often (**Customise > Wallpapers > New photo**, or each time Home opens); in between, a photo that was shown before is
shown again (never the one on screen when there is a choice). The service remembers the last 30 photos Home showed (their IDs, picture
addresses and photographers, in `index.json`; no pictures) and they go round. Photos shown again are not reported to Unsplash a second
time.

**Test key and save.** Checks a new key (1 request), then fetches one new photo at once (2 requests, whatever the 3 minutes say): it is
listed under Recent photos and Home shows it within a few seconds. While Unsplash is paused for the hourly limit it saves the settings,
fetches nothing and says why.

**When the hourly limit is used up** (Unsplash answers that it is, or its replies say fewer than two requests are left), nothing is asked
for an hour with a clear message on the phone page and in the manager, and the photos shown before go round. A key Unsplash refuses is
reported at once. **Without internet**, or while no photo has been shown yet, Home keeps what it shows.

**Credit.** The phone page lists every photographer as "Photo by NAME on Unsplash" with a link to their Unsplash page (with the
`utm_source=CleanYourTV&utm_medium=referral` parameters Unsplash asks for), and Home shows the same text, without a link, for the
current photo unless **Photo credit** is off.

**Turning it off.** **Use Unsplash photos** (manager) or **Turn Unsplash off** (phone page) stops showing them and asking Unsplash but
keeps the key. **Remove Unsplash** forgets the key and the list of recent photos.

## Limits and storage

| | |
|---|---|
| Uploads | At most 100 photos, 12 MB each; JPEG, PNG and WebP (checked by their content, not their name). |
| Immich | At most 300 photos. |
| Unsplash | No photos on the TV; a new photo at most every 3 minutes, and a new key may make 50 requests an hour. |
| Space | 150 MB for all sources together. A full library refuses uploads and stops the syncs with a message. |

The photos are stored in `/media/developer/cleanyourtv/wallpapers/`: `upload/` (each under a random name), `immich/` (each under
its Immich ID) and `index.json`, which records the source, size and checksum of every file and the last Unsplash photos Home showed. Only files listed there are ever
deleted. They survive restarts and updates; **Uninstall** removes them with the rest.
