## New

- **Every AI provider can use the tools of the voice assistant.** With "Let the voice assistant act on the TV" on, a server of yours (Ollama, LM Studio, llama.cpp, vLLM) now gets the tools like OpenRouter does, wherever it is in the list, so "what is the weather" no longer gets answered from memory by the first provider. A model that takes no tools is still asked without them. The switch in the manager app no longer needs OpenRouter either. By @Edenik.
- **Home Assistant can recognise your speech.** The recogniser on the TV speaks English. For another language (Polish, say) with everything on your own network, the audio of what you say on the remote's microphone can now go to your Home Assistant's Assist pipeline, where its own speech-to-text (a Whisper in your language, for example) recognises it, and Assist answers in the same go. It is off by default, so the audio stays on the TV unless you switch it on. There is no switch in the manager app yet: it is set with `{"stt":"ha"}` in the voice settings, see [Voice](voice.md#home-assistant-recognises-the-speech-optional). If Home Assistant cannot be reached, the recogniser on the TV is used when it is installed. Asked for by @jtomaszewski (#233).
- **Key remapping: a different job in one app, and more jobs.** A remapped button can now do one thing while a given app is in front and something else everywhere else (**Key remapping**, choose a button, **Only in** an app). Buttons you set up before keep doing what they did: that is now their **Everywhere** job, and a press that matches no app always runs it. New jobs for a button: mute, volume up and volume down, turn the screen off, put the TV in standby, and open the TV's settings. The voice assistant and AI agents cannot press a button that does one of the first five. See [Key remapping](key-remap.md). The idea comes from [Magic Mapper](https://github.com/andrewfraley/magic_mapper) by Andrew Fraley.
- **The Cinema theme** (Theme > Cinema): a dark living-room layout with wide tiles, a soft pill top bar and the focused app's icon, dimmed, in the background. It comes with a new theme setting for theme makers, `effects.focusIcon` (see [Themes](themes.md)). By @mateimalai3-sys (#193).
- **Icon sizes for the dock, the grid and the Input picker.** Three new theme settings, `dock.iconScale`, `grid.iconScale` and `picker.iconScale` (0.5 to 2.5), scale the icons in each place on their own. They are settings of a theme (see [Themes](themes.md)); there is no control in the Customise menu yet. Asked for by @cmt-t (#227).
- **Live TV: the guide reopens on the tab a channel was chosen from.** A channel picked in All channels, Favourites, Recent or a category no longer sends the guide back to that channel's first category. By @Diplodock (#222).
- **Swedish is complete again.** 254 texts that had been added since the last update are translated (99 % now), and 37 texts of the manager's help and prompts, which no language could translate before, can be translated now. By @Steefzar (#221).

## Fixes

- **Wallpapers: opening Home no longer changes the photo before its time.** With an interval set (10 seconds to 60 minutes), Home picked a new photo every time it opened, and decoding a new full-size photo each time could freeze the TV for a few seconds. Now Home changes the photo when it opens only if the interval has passed since the last change. **Each time Home opens** works as before. If it still freezes, try **Wallpapers > Picture size > Full HD**. Reported by @nplezka (#234) and @negrostmthws (#225).
- **Home: Up and Down between rows of apps of different lengths** keep the column (the nearest one if the next row is shorter) instead of landing on a column that is proportionally the same. Reported by @negrostmthws (#225).
- **Live TV stays frozen when webOS leaves the video paused and ended** (issue 224, follow-up to 109). The player ignored that state, so nothing reloaded the stream. It now counts as a stall and the stream is loaded again. Reported by @bexum88-del.
- **The preload policy at a cold boot** (issue 226). When LG's preload manager was not ready yet, the policy you chose was not applied until the next five-minute run. A failed read is now tried again up to three times, five seconds apart. Reported by @cmt-t.
- **Jellyfin continue watching: missing pictures** (issue 236). Pictures are now asked for as images, one that failed is asked for again after a minute instead of staying empty, and the log says why a picture is missing. This may not be the whole cause of the empty boxes @nplezka saw: if they stay, please attach a Share log.

## What to know

These changes are checked by the tests and by CI, and none of them was tried on a TV by the maintainer yet.

- **Home Assistant recognising the speech:** not tried against a real Home Assistant, nor on the LG G5 the request was made for, and not the recognition quality in Polish. If you try it, please say what you see in an issue.
- **Key remapping per app and the new jobs:** the app that is in front is asked of LG's app manager at the press, and how fast it answers is not known on every firmware. The sound and power calls are the ones the phone remote already uses. Please say what you see.
- **Live TV after pause, the preload retry, the wallpapers and the Jellyfin pictures** are fixes to reports from other TVs (webOS 25 and others). Please say whether they work for you.
- **Cinema and the icon sizes** were not looked at on a TV by the maintainer. Please say how they look on yours.

## Thanks

@Edenik for the AI providers' tools; @mateimalai3-sys for the Cinema theme; @Diplodock for the Live TV guide; @Steefzar for the Swedish texts; @jtomaszewski for the Home Assistant request; Andrew Fraley for Magic Mapper, where the per-app idea comes from; @cmt-t, @bexum88-del, @negrostmthws and @nplezka for reports that became fixes; and everyone who reports what a dev build does on their TV.
