## New

- **The Frosted Glass theme** (Theme > Frosted Glass): translucent frosted-glass panels, pills and tiles with luminous edges over a deep dark aurora, in the Outfit typeface, with a stacked greeting, clock and date, and one glass focus frame that slides between the dock and the app rows. There are two places for cards, under the clock and at the side. An app icon that fills its tile fills it from top to bottom, while a transparent logo keeps the glass look. In this theme, a card shown in a frame (the weather forecast, for example) sits where it should under the clock, not over it. See [Themes](themes.md). By @warleysr (#253).
- **Brazilian Portuguese is complete.** The texts of everything added since the last update are translated (Bluetooth controllers, the phone remote's light mode, AI agents, Stocks and crypto, the screen saver, remapping a button for one app), so Portuguese is at 100 %. By @warleysr (#253).
- **Catalan is up to date**, with the newer texts translated. By @jmtalarn (#254).

## Fixes

- **Weather: a clear sky has a word of its own.** "Clear" was one text for the weather and for the **Clear** button, and each language had chosen one of the two meanings: Dutch, German, French, Spanish, Russian, Turkish, Arabic and Swedish the weather, Polish, Italian, Hungarian, Vietnamese, Danish, Portuguese and Catalan the button. So in the second group the weather showed the word for "wipe it". The weather now says **Clear sky** (in English too, where it said "Clear") with its own translation, also on the Home Assistant weather card for a clear night. Nothing changes in the first group; Catalan and Portuguese have their own word ("Cel serè", "Céu limpo"), and Polish, Italian, Hungarian, Vietnamese and Danish show English "Clear sky" until someone translates it. Weather add-on 1.5.1. Noticed by @jmtalarn (#254).

## What to know

These changes are checked by the tests and by CI.

Frosted Glass was tried by its author on an LG webOS 24 TV (layout, moving the focus, the language), under its first name. It has not been looked at on a TV since it was renamed, nor on webOS 5 and 6. Please say how it looks on yours.

The weather change is covered by tests, but the Home Assistant clear-night label and the weather text in each language have not been looked at on a TV. Please say what you see in an issue.

## Thanks

@warleysr for the Frosted Glass theme and the Portuguese texts; @jmtalarn for the Catalan texts and for noticing that "Clear" is two different words; and everyone who reports what a dev build does on their TV.
