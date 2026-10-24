# The Input key

The remote's **Input** button opens an Inputs picker over the running app.

![Inputs picker on the Input key](screenshots/picker.jpg)

The picker shows the dock apps in a row, the inputs below (each with its port and what is connected, and a green dot on the
active one) and, when [Live TV](live-tv.md) is on, **Live TV**. A device's name is cut with an ellipsis at the end of its card,
so a long one (HDMI-CEC names can be) never runs over the cards beside it.

| Key | Action |
|---|---|
| Left / Right | Move |
| Up / Down | Switch rows |
| OK | Open |
| Back or Input | Close |

The pointer works too.

## What the key shows

The Input button can show the Inputs list in three ways. **Input key** > **Input key shows** in the manager app chooses; each press of
that row goes to the next one.

| Choice | What happens | Default |
|---|---|---|
| Over the running app, ready in the background | A small app, `com.cleanyourtv.picker`, is started hidden after boot and the key only wakes it: instant. | webOS 25 (SDK 10) |
| Over the running app, started when pressed | The same app is started by the key and closes itself after use (Back, a choice, or ten idle seconds). Nothing runs hidden, so it cannot keep the remote. The first moment takes longer. | every other webOS version (5, 6, and 26 until the background app has been tried there) |
| The launcher's Inputs list | The TV goes to Home with the Inputs list open. Needs CleanYourTV as Home; when LG's Home is selected the key stays with LG. | none |

On webOS 6.5 (reports) the hidden background app kept the remote and showed a loading circle, which is why older webOS starts it on
demand. The background app is only kept while the hook attached: without the hook the key cannot open it. If the TV closes the background app three times in ten minutes, the service switches to *started when pressed* by itself
(`picker.mode: ondemand` in `config.json`). Other overlay projects for rooted TVs also start their overlay on demand and close it after
use.

## How it works

It uses the bundled [inputhook](credits.md#inputhook) library, which injects a small hook into LG's input process so that a remote
button can run a command. The Input button's code is **241** by default. The command opens the picker app
(`com.cleanyourtv.picker`) over whatever is on screen.

## Learning your remote's code

Remotes differ. In the manager app, **Input key** > **Learn the Input key** reads the code of the button you press and tests that
the picker opens. **Clear** restores the default.

The switch in the same menu removes the bind and gives the button back to LG's own picker. **Learn the Home key** is optional.

The Guide button can be bound the same way; that is part of [Live TV](live-tv.md#the-guide-button) (manager app > **Live TV** > **Learn the Guide key**).

!!! note "When the hook is not attached"
    On some firmware the hook cannot attach. The manager then shows the Input key as not available and LG's picker is used.
