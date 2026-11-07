# CleanYourTV add-on repository (template)

Copy this folder, put it on GitHub (or any https host), add your add-ons under `catalog/`, and install them on a TV.

```
index.json            written by make-index.js: id, version, a SHA-256 for every file of every add-on
make-index.js         node make-index.js  (run after every change; --check says whether index.json is current)
.gitattributes        keeps line endings as they are: the SHA-256 of a file must be the one the TV downloads
catalog/<id>/         one add-on: addon.json (required), index.html (the page), service.js (optional), preview.jpg (optional 800x450)
```

## Use it on a TV

```sh
ssh root@<tv-ip>
node /media/developer/cleanyourtv/cytv-addons.js shortcut   # once: makes the command cytv-addons
cytv-addons repo-add <your-user>/<your-repo>        # GitHub, branch main; or user/repo@branch, or any https://... folder
cytv-addons list                                    # what the repositories offer
cytv-addons install hello
```

Or on the TV: manager > Add-ons > Repositories > Add a repository.

## Make an add-on (recipe for a person or an AI assistant)

1. `catalog/<id>/` where `<id>` is lower case letters, digits and `-`, starting with a letter (2 to 32 characters). It must equal `"id"` in `addon.json`.
2. `addon.json`: copy `catalog/hello/addon.json`, change `id`, `name`, `version` (`1.0.0`), `description`, `tile.label` and `tile.icon`
   (`home tv clock chart globe photo music play star heart cards grid hdmi settings addon`).
   `kind` is `page` (only a web page) or `service` (also Node code, `entry.service`).
3. `index.html`: ES5 only (Chromium 68), black background, large text (it is read from the sofa). Include `<script src="/addon/sdk.js"></script>`: Back goes
   Home, number and colour buttons turn pages, `CYTV.api('/path', body)` calls your `service.js`. Only transform and opacity animate well.
4. `service.js` (only for `kind: "service"`): `module.exports = { create(ctx) { return { handle(req, res, path, body) {...} } } }`. Node 8.12: no `?.`, `??`,
   `fs.promises`, `URL` global. `ctx.settings.get()/set(obj)` keeps small settings, `ctx.dataDir` a folder. Network needs `"permissions": ["net.fetch"]` and then `ctx.fetch`.
5. Change `version` when you change files (the TV offers an update when it is higher).
6. `node make-index.js`, commit `index.json` with the add-on, push.
7. On the TV: `cytv-addons update` (or install again).

Everything an add-on can do is in the service docs: `docs/development/addons.md` and `docs/development/addon-repos.md` of CleanYourTV.
A service add-on runs as root on the TV: write only what you would trust, and tell people what it does.
