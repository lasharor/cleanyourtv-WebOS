## New

- **The Home key works on a page of the book.** On Live TV or any add-on's page, the Home button did nothing, because a page is part of the Home app and webOS saw nothing to bring forward. The key now turns back to Home's first page while a page shows (the code learned in the manager, else the usual one), and gives the key back to LG as soon as you are on Home. By @Edenik (#192).
- **A click on the page strip turns to that page.** The strip on Home ("Home · Live TV · Phone remote") now takes a click from the Magic Remote's pointer, as its number or colour button does. By @larsoss (#197).
- **Card dimming is a setting.** Home cards dim after three minutes without a key to protect an OLED. **Features > Dim inactive cards** now turns that off or sets 3, 5 or 10 minutes; the pixel shift stays. By @ramzeka (#176).
- **Add-on repositories show where an add-on came from.** `cytv-addons installed` says which repository each add-on was installed from, the columns of `repos` and `list` no longer run into each other when a name is long, and the catalog marks an add-on as installed only on the row of its own repository. By @larsoss (#196).
- **The Add-ons screen and the phone remote can be translated.** The manager's rows ("Switch off", "Page of the book", "Install · 1.0.0" and others) never reached the translation files, so no language could translate them; they do now, and so does the phone remote's first step. Dutch is complete again. By @larsoss (#198).
- **The phone remote on an iPhone, as an app.** iPhones cannot install the Android app, so the phone page can now live on the Home Screen as an app: full screen, its own icon, no address bar. In Safari the pairing screen says to add it to the Home Screen first (a Home Screen app has its own storage, apart from Safari's) and the code from the QR code goes along, so the app opens with it filled in. Keys tick on iOS 18 and newer. Phone remote 1.1.0. By @larsoss (#212).

## Fixes

- **Voice on a 65UR91 (webOS 25): "I did not hear anything".** LG's voice service puts the remote's audio in a different place on this model, and says where in its reply. The service now reads that reply, and asks again until the mic button is held, and says "Hold the remote's mic button while you speak" instead of giving up silently. By @Edenik (#184).
- **Input hook that attaches but gets no buttons** (issue 185, 55UN6950ZUA, webOS 5). Learning a button now says so ("no button reaches the hook on this TV"), the manager no longer shows the Input key as working there, and a hook like that does not keep the hidden picker. Detection only: the buttons of that model are not remapped yet. By @Edenik (#186).

## What to know

The Home key on a page was tried on a 65UR91006LB (webOS 25) with the default code, the voice fix on the same model, the card dimming setting on a 55NANO866NA (webOS 5.6) and the page strip click on a 65UP77006LB (webOS 6.5). The detection of a hook that gets no buttons (issue 185) has **not** been tried on a real TV yet: its author is waiting for the reporter of the issue to confirm it. The Home key binds LG's input service while a page shows, so it needs the Input key hook, which is on by default. The phone remote as an iPhone app was tried on an iPhone (iOS 26) with a 65UP77006LB (webOS 6.5): adding it to the Home Screen, pairing in the app, the keys and their tick; not yet on an iPad or on iOS 17 and older. Please say what you see in an issue.

## Thanks

@Edenik for the Home key, the voice fix and the hook detection; @larsoss for the page strip, the add-on repository output and the translations of the manager; @ramzeka for the card dimming setting; and everyone who reports what a dev build does on their TV.
