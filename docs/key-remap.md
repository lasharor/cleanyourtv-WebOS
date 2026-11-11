# Key remapping

A button on the remote can do something of your choice: open an app, an input, Live TV, Home or the Inputs list, change the volume, mute, turn the screen off, put the TV in standby, open the TV's settings, or do nothing at all. It can do one thing everywhere and something else while a chosen app is in front. Use it for the buttons
you never press (the Netflix, Prime or other shortcut keys, the colour keys) or for any spare button.

Set it up in the manager app: **Key remapping**. It is **off** until you switch it on with the first row of that screen. While it is off
nothing runs for it: no binds are added to the hook and the hook is not injected for it, so every button acts as LG made it. The buttons you saved are kept, so
switching it on again brings them back.

| Step | What happens |
|---|---|
| **Add a button** | Press the button on your remote. The TV reports which code the button sent, and that code is saved. Nothing about the code is assumed: remotes and firmware differ. |
| Choose what it does | **Open an app** (the apps on the TV), **Switch to an input** (the HDMI inputs, as the Inputs list shows them), **Open Live TV**, **Go to Home**, **Show the Inputs list**, one of the [extra actions](#extra-actions) below, or **Do nothing** (the press is taken away from LG and nothing happens, for a button you never want). |
| Pressing it | The button does that, over whatever is running. LG's own action for the button does not happen. |

The list shows each button by name when the TV tells us it ("Prime Video button", "Red button"), and by its number otherwise
("Button 1038"). The name is LG's own key name for the button (`KEY_AMAZON`), which the TV writes to its system log for every press; it is
read at the moment you press the button and saved with it. It is only a label: what the button does is decided by its code, so a button
without a name works the same. The name has its own text for about a hundred keys and is spelled out from LG's name for the rest. A saved
button with no name (one added before names existed) shows its name if its code is one seen on a real TV, otherwise its number until you
add it again.

Choose a button in the list to change what it does or to give it back to LG. Your saved buttons are still listed while the feature is off.
**Give every button back to LG** removes them all, after a confirmation. Up to 12 buttons can be remapped.

## One button, different actions in different apps

A button always has an **Everywhere** action: the one you choose when you add it. Choose the button in the list and use **Add an entry for
one app** to give it another action **Only in** an app you pick (for example Mute everywhere, but Volume up in the music app). Up to 8 apps
can have their own entry per button. Each entry has its own action, changed or removed from the button's screen (**Remove this entry**); the
Everywhere action can be changed but not removed while app entries exist (choose **Do nothing** for it if you want nothing to happen
elsewhere), and **Give the button back to LG** removes the whole button.

When the button is pressed the service asks the TV which app is in front (`getForegroundAppInfo` of the app manager, asked at the press: the
list of running apps lags by seconds after a start or close, so it is not used). If an entry is set for that app it runs; otherwise the
Everywhere action runs. If the TV cannot say (no app reported, even after a second try) the Everywhere action runs. Because a button always
has an Everywhere action, a press is never lost to "no entry". A button without app entries does not ask the TV anything.

A button saved before this feature (one action) is its Everywhere action and keeps working unchanged. In `config.json` the Everywhere action
is still the flat `type`, `id` and `label` of the button, and the app entries are a list `apps` of `{app, appName, type, id, label}`, which
an older service ignores.

## Extra actions

These are chosen from a fixed list in the code; each is its own fixed call, the same one the [phone remote](phone-remote.md) makes for the
same key. No command, path, address or method comes from `config.json` or from a request: an unknown action name is refused when saved
and ignored when read.

| Action | Does | Call |
|---|---|---|
| **Mute** | mutes, or unmutes when muted | `audio/master/getVolume`, then `audio/master/setMuted` with the opposite |
| **Volume up**, **Volume down** | one step | `audio/master/volumeUp`, `audio/master/volumeDown` (a quick second tap within a quarter second counts; other buttons ignore a repeat within 0.7 s) |
| **Turn the screen off** | the picture goes dark, the TV keeps running and the network stays up | `tvpower/power/turnOffScreen` |
| **Put the TV in standby** | the soft off of the remote's own power key, which Wake-on-LAN and Quick Start+ wake again | `tvpower/power/powerOff` with the reason `remoteKey` |
| **Open the TV's settings** | opens LG's Settings app | `applicationManager/launch` of `com.palm.app.settings` |

The last two change what the TV is doing on purpose: they are only ever a choice you make in the manager, never set automatically. If the TV
does not have the service (or refuses), the press does nothing, the service log says so once for each kind of failure, and the button
stays as it is. The assistant's tool `remote_buttons` can list these buttons but does not press one that turns the TV off or changes
the sound (mute, volume, screen off, standby): those run only from the remote. A full power-off, a restart, the picture mode and the energy
saving setting are not offered.

## What cannot be remapped

- The arrows, OK and Back are ignored while learning, so you cannot lock yourself out.
- A button that CleanYourTV already uses is refused: the **Input key** while it is taken over (241 unless you learned another), and the
  **Home**, **voice** and **Guide** keys you learned. Release that key first (switch the Input key off, or clear the learned key), or
  press another button.
- **Open Live TV** needs CleanYourTV as Home; with LG's Home selected it only opens LG's Home. **Go to Home** goes to whichever Home is selected.
- A button that never reaches the hook cannot be learned. Learning then times out after 45 seconds. Some buttons may be handled in
  other parts of the TV, so this is tried per remote and per firmware, and the answer is the one the TV gives when you press the button.
  On the test TV (remote LGE MR23) the Netflix, Prime Video, Alexa, microphone and colour keys all reached the hook.
- On some TVs no button reaches the hook at all, although it attached (LG 55UN6950ZUA, webOS 5.6.2, issue 185): LG's input service
  there passes the remote's buttons another way. When a learning step ends without a single button in the hook's log, the manager says
  so instead of "No button was pressed", and **Add a button** shows *no button reaches the hook on this TV*. Use Share log to report it.

## An app that opens on an Android box

An app that is set up to [open on an Android box](android-box.md) does that from a remapped button too: the TV switches to the box's input and starts
the app on the box.

## How it works and how to undo it

It uses the same hook as the [Input key](input-key.md): a bind in the hook's `keybinds.json` per remapped button runs
`/media/developer/cleanyourtv/remapkey.sh <code>`, which asks the service (`POST /api/remap/fire`) to run the action. The buttons are
kept in `config.json` under `remap`.

Nothing under `/usr`, `/etc` or the firmware changes: the binds live in the hook's `keybinds.json` and the buttons in `config.json`. The binds only work while the hook is in LG's input service, which the service puts there at
every boot. A reboot without the boot scripts (the Homebrew Channel's failsafe mode) gives every button back to LG, and so does
**Give every button back to LG** at once. Switching the feature off also takes every bind away at once; a hook that is already in LG's input
service stays there (for the Input key and the Guide key) until the next boot, and is not injected again for remapping.

If the hook cannot attach on your TV's firmware, **Add a button** shows as not available.
