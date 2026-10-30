/* what each row does, shown on the left for the focused row */
var INFO = {
  'Launcher':
    'The home screen you see. Updates come from GitHub releases and are checked against a SHA-256 file before they are installed. If a new launcher does not start, the previous one is put back.',
  'Service':
    'The background service behind the launcher: Live TV, picture notifications, the Input key, these updates. A failed update restores the previous files.',
  'Check for updates': 'Looks for a newer release on GitHub. Nothing is installed until you choose an update.',
  'Update channel':
    'Stable releases are what most people want: at most one a day, made from the dev builds. Dev builds come with every change and can be less finished; choose Dev here, then use the Launcher and Service rows to install it. Going back to Stable offers the latest release again.',
  'Go back to launcher': 'Swaps the previous launcher version back in. The newer one stays available as an update.',
  'CleanYourTV as Home': 'Whether this launcher is Home, and learning the Home key.',
  'Debloat LG\u2019s ads and telemetry':
    'Stops LG\u2019s ad, recommendation and telemetry services and blocks a few ad servers. Nothing is uninstalled, and it only applies while this launcher is Home.',
  'Debloat':
    'Stops LG\u2019s ad, tracking, telemetry and suggestion services, in four groups you can switch separately. Nothing is uninstalled, and it only applies while this launcher is Home.',
  'Ads': 'Keeps adoverlay-service from starting and points three LG ad servers at nothing in /etc/hosts.',
  'Viewing tracking (LivePlus)':
    'Keeps acr2 from starting: the service that recognises what is on screen (LG calls it LivePlus) and reports it.',
  'Telemetry logs': 'Stops remotelogger and service-logger, which collect logs and send them to LG.',
  'Suggestions and nudges': 'Stops contentminer and nudge (recommendations and pop-up tips) and keeps sportsalarm from starting.',
  'Switch all on': 'Switches every group on.',
  'Switch all off': 'Switches the debloat off: the services start again and the hosts lines are removed.',
  'More': 'Voice, the language of the screens and network notifications.',
  'Language':
    'The language of CleanYourTV\u2019s screens: the launcher, this app and the Inputs list. Automatic follows the TV\u2019s menu language. The percentage says how much of a language is translated; the rest stays English. Translations are files in the repository that anyone can add to.',
  'Automatic': 'Follows the TV\u2019s menu language. English when CleanYourTV has no translation for it.',
  'Wallpapers':
    'Your own photos behind Home: uploaded from a phone, or synced from Immich albums. Switch them on in the launcher: Customise > Wallpapers.',
  'App icons':
    'A picture of your own for an app, chosen on a phone: shows a QR code. The app keeps it when it updates. On Home, hold OK on an app for Change icon and Reset icon.',
  'Manage from your phone':
    'Shows a QR code. On the phone page you upload photos (they are made the right size on the phone), delete uploads, connect Immich, choose albums and hide single photos.',
  'Local uploads': 'Photos uploaded from a phone, kept on the TV. At most 100.',
  'Immich':
    'Photos from the Immich albums you chose, downloaded to the TV every six hours (and with Sync now), so Home never waits for Immich. At most 300.',
  'Total': 'Every photo Wallpapers can show, and the space they use on the TV (at most 150 MB).',
  'Sync now': 'Downloads new and changed photos from the chosen albums now and removes the ones that left them.',
  'Picture size':
    '4K (the default) keeps photos at 3840 pixels, the size the TV draws Home at, so they look sharp; Full HD at 1920 fits about four times as many photos in 150 MB. It applies to new uploads and to the next Immich sync.',
  'Remove all uploads': 'Deletes every uploaded photo from the TV. Immich photos stay.',
  'Disconnect Immich': 'Forgets the address and the key and deletes the Immich photos from the TV. Uploads stay.',
  'Reset Home customisation':
    'Puts the dock, the top buttons, hidden apps, the app order and the clock back to the defaults. The theme stays.',
  'Yes, reset Home': 'The launcher\u2019s own settings go back to the defaults. Apps, the theme and everything in this app stay.',
  'Use CleanYourTV as Home':
    'On: the Home button opens this launcher. Off: LG\u2019s own Home. Switching restarts the TV (about a minute); the service keeps running either way.',

  'Network notifications':
    'Lets other devices on your network send picture notifications to this TV with a POST request and a secret token. Off by default.',
  'Accept notifications from the network':
    'On: the TV listens on port 8767 for POST /notify with the token. Anyone who has the token and network access can show cards on this screen.',
  'How to send': 'Shows the address, the token and an example request.',
  'Show as QR code':
    'Shows a QR code. A phone that scans it opens a page, served by the TV for ten minutes, that shows the notification address and the token with Copy buttons (for Home Assistant, for example). The token is a secret.',
  'New token': 'Creates a new secret token. Devices using the old one stop working.',
  'Voice':
    'Optional. Speak into the remote and the TV turns it into text on the TV itself (Moonshine, English). The text can be sent to a server you run. Audio never leaves the TV. Needs a download of about 80 MB.',
  'Install voice':
    'Downloads the speech engine, a 64-bit C library and the model (checksums are verified), then tests them. About a minute. Nothing is installed in the system folders.',
  'Listen on the voice button': 'On: pressing the button you learned starts listening. A card shows what was heard.',
  'AI chat (OpenRouter)':
    'On: what you say is also sent as text to a language model through OpenRouter and the answer is shown on screen. Needs your OpenRouter key; the text goes to OpenRouter and the model provider, never audio.',
  'Set up from your phone':
    'Shows a QR code. Scan it with a phone on the same Wi-Fi to enter your OpenRouter key, choose a model, write instructions and set a server address. Nothing is typed on the TV.',
  'Model':
    'Choose the model that answers. The list is read from OpenRouter: the newest models of the main providers, with the price per million words in. The phone page lists every model.',
  'Set up with commands': 'Shows the commands to set the key, model and instructions from a shell, and how to ask by text.',
  'Forget the conversation': 'The AI and Home Assistant remember the last turns for ten minutes. This clears them.',
  'Home Assistant (Assist)':
    'Sends what you say as text to Home Assistant\u2019s Assist and shows its answer. Needs the address and a long-lived access token (Home Assistant profile page), entered on your phone. Choosing this row tests the connection.',
  'Which answers first':
    'Home Assistant first, then the AI: Assist gets the text; if it does not understand, the AI answers. Home Assistant only: never the AI. The AI only: Home Assistant is not asked. Choose to switch.',
  'Assist agent':
    'Which Home Assistant conversation agent answers. The default is the built-in one; others (for example a language-model agent) are listed from your Home Assistant.',
  'Switch off LG\u2019s voice assistant':
    'LG\u2019s own assistant reacts to the same button and sends the audio to LG. On: it is paused while voice is on. A reboot or switching this off undoes it.',
  'Learn the voice button':
    'Records the code of the remote button that starts listening. Try the microphone button first; any spare button works.',
  'Try it now': 'Starts listening without the button: speak when the card appears.',
  'Send the text to':
    'Where the recognised text goes. Shows how to set the address of your server. Without one, the text is only shown on screen.',
  'Remove voice': 'Deletes the downloaded engine and model. The rest of CleanYourTV is not affected.',
  'Input key':
    'The remote\u2019s Input button opens our Inputs list over the running app instead of LG\u2019s picker. Open this screen to switch it off or to learn the button.',
  'Share log':
    'Shows a QR code. Scan it with a phone on the same Wi-Fi to copy a report for a bug report. Addresses and URL paths are masked; the page closes after ten minutes.',
  'Uninstall': 'Removes the apps, the boot scripts and your settings, then restarts the TV so LG\u2019s Home comes back.',
  'Input key opens our Inputs list': 'On: pressing Input shows our Inputs list. Off: LG\u2019s picker comes back at once.',
  'Learn the Input key':
    'Reads the code of your remote\u2019s Input button from the hook, then tests that our list opens. The default is 241. Clear goes back to it.',
  'Live TV': 'Settings for Live TV: switch it on or off, set up or remove your playlist, refresh the guide and learn the Guide key.',
  'Show Live TV':
    'On: the launcher has a Live TV button and tile, the Inputs list has Live TV, and the Guide key can open the channel guide. Off: all of that is hidden and LG\u2019s own player and guide are used. Your playlist is kept.',
  'Show LG\u2019s own Live TV':
    'On: LG\u2019s own Live TV (the antenna or cable tuner) is in the Inputs list and the Input key list, and the launcher offers a TV button. Off: none of that, for a TV that only plays a playlist or external boxes. Independent of Show Live TV, so you can have both, one of them, or neither.',
  'Playlist':
    'Your M3U playlist and its XMLTV guide. Choose it to set up: a QR code opens a page on your phone where you enter the playlist address and the 6-digit code shown here.',
  'Refresh playlist and guide': 'Downloads the playlist and the programme guide again now. It also happens twice a day.',
  'Clear recent channels': 'Empties the Recent tab and the list of channels that failed. Favourites stay.',
  'Remove the playlist': 'Deletes the playlist address, the channel list, the guide and your favourites from the TV.',
  'Yes, remove the playlist': 'Deletes the playlist and everything stored for it on the TV. You can set it up again.',
  'Learn the Guide key':
    'Records the Guide button\u2019s code. Afterwards it opens the Live TV channel guide over whatever is running (only while Live TV is on). Clear it to get LG\u2019s guide back.',
  'Input key shows':
    'How the Input button shows the Inputs. Over the running app, ready in the background: instant, tested on webOS 25. Over the running app, started when pressed: nothing runs hidden, so it cannot keep the remote; the default on older webOS, where the background one showed a loading circle. The launcher\u2019s Inputs list: the TV goes to our Home (needs CleanYourTV as Home; otherwise the key stays with LG). Choose to go to the next one.',
  'Learn the Home key': 'Optional. Records the Home button\u2019s code. The Home key keeps working exactly as before.',
  'Back': 'Back to the previous list.',
  'Cancel': 'Nothing changes.',
  'Yes, remove CleanYourTV': 'Deletes the apps, the boot scripts and the settings, then restarts the TV.',
  'Yes, use CleanYourTV as Home': 'Restarts the TV; this launcher is Home after it starts.',
  'Yes, use LG\u2019s Home': 'Restarts the TV; LG\u2019s own Home is Home after it starts. You can switch back here.',
  'Update to': 'A newer package is available. Install it before the setup: it may contain fixes for your firmware.',
  'Take over the Input key': 'The remote\u2019s Input button opens our Inputs list instead of LG\u2019s picker. You can change this later.',
  'Set up now':
    'Installs the launcher, replaces LG\u2019s Home at boot and starts the service. About a minute; the screen blinks once. If the new Home does not come up, the setup removes itself and restarts the TV.',
  'Set up anyway':
    'Your firmware is not in the compatibility list and LG\u2019s Home looks different. This tries it anyway; a failed start restarts the TV with LG\u2019s Home.',
};
function infoFor(r) {
  if (!r || r.sep) return null;
  if (r.info) return r.info;
  var k = r.label.replace(/ [0-9][0-9.]*$/, '');
  if (k === 'Check for updates' && offline)
    return { t: k, d: 'Works without the service: looks for a newer package and installs it through the root service.' };
  if (k === 'Use CleanYourTV as Home' && st.home && st.home.fullhome)
    return {
      t: k,
      d:
        tr(INFO[k]) +
        ' ' +
        tr(
          'This TV also has LG\u2019s full-screen Home: if the Home button opens that instead of this launcher, set TV Settings > General > Home Settings > Home Style to Basic.'
        ),
    };
  return INFO[k] ? { t: k, d: INFO[k] } : null;
}
