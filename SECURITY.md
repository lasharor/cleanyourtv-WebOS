# Security

## What this changes on a TV

CleanYourTV runs a service as root on a rooted TV. It listens on `127.0.0.1:8765` only. Three short-lived pages open on
the local network on request, and an optional notification endpoint (off by default): the Live TV pairing page (port 8766, a 6-digit code shown on the TV, ten minutes) and the
share-log page (port 8768 and up, a random address, ten minutes, masked report) and, for the optional voice function, the voice setup page (port 8769, a random address, ten minutes; see Voice below).

## Network notifications

Off until switched on in the manager app. It then listens on port 8767 for `POST /notify` with
`Authorization: Bearer <token>` (a random 192-bit token kept in `config.json`, readable by root only). It exposes only
the notification call. Wrong tokens lock an address out for ten minutes, requests are limited to 20 a minute and 32 KB,
and an optional `allow` list restricts addresses. It is plain HTTP: the token can be read by anyone who can watch the
traffic on your network.

## Voice

Optional and off by default. Installing it downloads files over HTTPS from PyPI, Ubuntu's archive and Moonshine's
model server; each file is checked against a SHA-256 value written in the code, and a mismatch stops the install. The
recogniser is a 64-bit program started by the root service with its own copy of the C library; it reads audio from a
pipe and prints text. Audio from the remote's microphone is held in memory only while recognising. Only the recognised
text is sent, and only to the address you set (plain `http://` is possible: the token is then visible on your network)
and, if you switch on AI chat, to `openrouter.ai` over HTTPS with your OpenRouter key and the model you chose; OpenRouter and
that model's provider see the text (with an AI server address set, a self-hosted server of yours, the text goes there
instead, and the OpenRouter key never does). The phone setup page is a short-lived page on the local network (port 8769, a random 128-bit address, ten minutes,
closed after saving, plain HTTP: the key is visible on the network while it is typed). With Home Assistant set up, the recognised text goes to the address you set with your long-lived access token (plain `http://` makes the token visible on your network; a self-signed certificate is accepted only when switched on). The keys and the token are kept in `config.json` (readable by root only) and are never returned by the
service. Pausing LG's voice assistant sends it SIGSTOP; nothing of LG's is modified.

## Trust

Everything it installs comes from this repository's GitHub releases and runs as root. Releases carry a SHA-256 file,
which detects corruption but not a compromised repository. Download only from the release page of this repository.

## Dev builds

The manager's **Update channel** can follow the dev builds: the pre-release named `dev` that GitHub Actions publishes for each
push to the `dev` branch. It is opt-in and off by default; the stable updater only reads the latest non-pre-release. A dev build
is downloaded over HTTPS from the repository the TV already updates from and checked against the `.sha256` file in the same release,
so the check protects against a damaged download, not against someone who can publish to the repository (the same is true of
stable releases, which are not signed yet). The only pre-release the updater reads is the one tagged `dev`, and the files must be
the package and launcher names the updater already expects.

## Limits to know about

- Any app on the TV can already run root commands through the Homebrew Channel; apps are not a security boundary on a
  rooted TV.
- `/media/developer` is world-writable on webOS. The setup removes group and other write access from this project's
  files and keeps the playlist and settings files owner-only, but the parent folder remains writable.
- The service API refuses requests from web pages (any `http(s)` origin); local apps and scripts are accepted.

## Reporting

Open a private security advisory on the GitHub repository, or an issue that does not include exploit details.
