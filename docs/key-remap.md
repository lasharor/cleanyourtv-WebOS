# Key remapping

A button on the remote can open something of your choice: an app, an input, Live TV, Home or the Inputs list. Use it for the buttons
you never press (the Netflix, Prime or other shortcut keys, the colour keys) or for any spare button.

Set it up in the manager app: **Key remapping**. It is **off** until you switch it on with the first row of that screen. While it is off
nothing runs for it: no binds in the hook, no hook injected for it, and a button press does nothing. The buttons you saved are kept, so
switching it on again brings them back.

| Step | What happens |
|---|---|
| **Add a button** | Press the button on your remote. The TV tells the hook which code it sent; that code is saved. Nothing about the code is assumed: remotes and firmware differ. |
| Choose what it does | **Open an app** (the apps on the TV), **Switch to an input** (the HDMI inputs, as the Inputs list shows them), **Open Live TV**, **Go to Home** or **Show the Inputs list**. |
| Pressing it | The button does that, over whatever is running. LG's own action for the button does not happen. |

Choose a button in the list to change what it does or to give it back to LG. **Give every button back to LG** removes them all.
Up to 12 buttons can be remapped.

## What cannot be remapped

- The arrows, OK and Back are ignored while learning, so you cannot lock yourself out.
- A button that already has a job of ours is refused: the **Input key** (241 unless you learned another), and the learned **Home**,
  **voice** and **Guide** keys. Clear that one first, or press another button.
- **Open Live TV** and **Go to Home** need CleanYourTV as Home; with LG's Home selected they only open LG's Home.
- A button that never reaches the hook cannot be learned. Learning then times out after 45 seconds. Some buttons (the microphone
  button on some remotes, some streaming-service keys) are handled in other parts of the TV, so this is tried per remote and per
  firmware, and the answer is the one the TV gives when you press the button.

## An app that opens on an Android box

An app that is set up to [open on an Android box](android-box.md) does that from a remapped button too: the TV switches to the box's input and starts
the app on the box.

## How it works and how to undo it

It uses the same hook as the [Input key](input-key.md): a bind in the hook's `keybinds.json` per remapped button runs
`/media/developer/cleanyourtv/remapkey.sh <code>`, which asks the service (`POST /api/remap/fire`) to run the action. The buttons are
kept in `config.json` under `remap`.

Nothing on the TV's disk changes. The binds only work while the hook is in LG's input service, which the service puts there at
every boot. A reboot without the boot scripts (the Homebrew Channel's failsafe mode) gives every button back to LG, and so does
**Give every button back to LG** at once. Switching the feature off also takes every bind away at once; a hook that is already in LG's input
service stays there (for the Input key and the Guide key) until the next boot, and is not injected again for remapping. If the hook cannot attach on a firmware, the manager shows **Add a button** as not available.
