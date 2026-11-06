# Voice (optional)

Recognises speech from the remote's microphone **on the TV**. The text is shown on screen and can be sent to a server you run,
to a language model through OpenRouter, or both; the answer is shown as text on screen. Answers are not spoken. No audio is
recorded or sent anywhere.

It is **off and not installed by default**. Nothing described here runs until you install it.

## Installing

**Voice** in the manager app downloads about 80 MB into `/media/developer/cleanyourtv/voice`. The checksums are pinned in the
code; **Remove voice** deletes everything again.

| Part | From |
|---|---|
| Speech engine `libmoonshine.so` and ONNX Runtime | the `moonshine-voice` 0.1.5 package on PyPI (MIT) |
| 64-bit C library | `ubuntu-base` 22.04.5 for arm64 (this TV has a 32-bit userland on a 64-bit kernel, so the 64-bit recogniser brings its own) |
| Model `tiny-streaming-en` (34 million parameters, int8) | download.moonshine.ai (MIT) |
| `cytv-asr`, a small program that feeds audio to the engine | this repository (`voice/asr.c`, built with `voice/build.sh`) |

## Using it

| Step | How |
|---|---|
| Choose the button | **Voice** > **Learn the voice button**. Try the remote's microphone button; if the hook does not see it, any spare button works. Then switch **Listen on the voice button** on. |
| Try without a button | **Voice** > **Try it now**, or `curl -X POST localhost:8765/api/voice/listen` |
| Send the text to a server | `curl -X POST localhost:8765/api/voice/set -d '{"url":"http://server:port/path","token":"optional"}'` |
| Pause LG's voice assistant | **Voice** > **Switch off LG's voice assistant**. It pauses LG's `voiceconductor` process while voice is on, so LG's own screen and its cloud recognition do not start on the same button. A reboot or turning the switch off undoes it. |

On screen a card changes in place while you speak: **Listening** (moving bars), **Recognising** or **Thinking** (dots), then your
question in small type above the answer. Reading time follows the length of the answer.

### Sending text to your own server

The TV sends `POST` with the JSON body `{"text":"...","source":"cleanyourtv","language":"en","time":"..."}` and, when a token is set,
`Authorization: Bearer <token>`. If the server answers with JSON (`{"title","text","image","seconds"}`) or plain text, the answer
is shown as a card. The address and token are stored in `config.json` on the TV only.

## AI chat (OpenRouter)

In **Voice**, **Set up from your phone** shows a QR code. Scan it with a phone on the same Wi-Fi and enter:

- your OpenRouter key,
- a model (the list is read from OpenRouter; any model name can be typed),
- instructions, and, if you like, the address of your own server.

The page is open for ten minutes or until you save, at a random address. It is plain HTTP, so use it on a network you trust.
**Model** on the TV chooses among the newest models of the main providers, with their price. **AI chat (OpenRouter)** switches
the answers on and off.

The same from a shell:

```sh
curl -X POST localhost:8765/api/voice/set -d '{"llm":{"key":"sk-or-...","model":"openrouter/auto"}}'
curl -X POST localhost:8765/api/voice/set -d '{"llm":{"enabled":true}}'
```

What you say is sent as text to `openrouter.ai` with the model you chose (a short instruction asks for one to three plain
sentences; change it with `"system"`), and the answer appears on screen. The model remembers the last six exchanges for ten
minutes (**Forget the conversation** clears them). The key is stored in `config.json` on the TV only. With a server address set
as well, the server also receives the text and the model's answer (`{"text","answer"}`).

You can also ask by text, with the same result, and without the speech download:

```sh
curl -X POST localhost:8765/api/voice/ask -d '{"text":"..."}'
```

It answers `{"text","answer","error"}`; add `"card":false` to skip the screen.

## The speech model

[Moonshine](https://github.com/moonshine-ai/moonshine) (Moonshine AI, MIT licence) runs on the TV; there is no cloud recogniser.

| | |
|---|---|
| Model | `tiny-streaming-en`: about 34 million parameters, encoder and decoder, int8 weights, 45 MB. |
| Runtime | ONNX Runtime on the CPU (two ARM cores on the G2). |
| Segmentation | The engine's voice-activity detection splits the audio into phrases. The service stops recording after 1.2 s of silence, after 7 s without speech, or after 15 s. |
| Cost on the G2 | Load 0.3 s; a 3 s phrase takes about 1.4 s; about 190 MB of memory while recognising, none when idle. |
| Reported accuracy | 12.0 % average word error rate on the Open ASR Leaderboard datasets, 4.8 % on LibriSpeech test-clean (figures from the Moonshine project; not measured through the remote's microphone). |
| Language | English. Moonshine also publishes German, Spanish, Arabic, Japanese, Mandarin, Tagalog and Vietnamese models and larger English ones (small 123 M, medium 245 M parameters). |
| Audio | 16 kHz mono from the microphone stream of LG's `voiceinput` service. Held in memory while recognising, then discarded; not written to disk or sent anywhere. |

**Which TVs.** Voice needs a TV with a **64-bit kernel**. A TV whose kernel is 32-bit ARM (`uname -m` says `armv7l`, as on the 43UP7550PTZ, issue 175) cannot run the recogniser at all: the manager says so and downloads nothing.

The TV's programs are 32-bit ARM on a 64-bit kernel and the recogniser is a 64-bit program, so `cytv-asr` runs through the 64-bit
loader and libraries that the download places in the same folder. Nothing in the system folders is changed.

Only text goes further: to your server, to OpenRouter, or nowhere. LG's own assistant is a separate path with its own cloud
recognition; **Switch off LG's voice assistant** pauses it while voice is on.

## Home Assistant (Assist)

The recognised text can go to [Home Assistant's Assist](https://www.home-assistant.io/voice_control/) (`POST /api/conversation/process`),
which turns on lights, answers questions about your home and so on. Its answer is shown as text on the card. Answers are not spoken.

Home Assistant has its own screen in the manager app, **More** > **Home Assistant**, because the [cards](launcher.md#cards) use it
too. Its **Set up from your phone** asks for:

- the **address** of Home Assistant, for example `http://homeassistant.local:8123`,
- a **long-lived access token** (your Home Assistant profile page, under Security),
- whether to accept a **self-signed certificate** (only matters for `https://` addresses).

A token without an address is refused. **Test the connection** there, or **Home Assistant (Assist)** in **Voice**, shows the name and
version of your Home Assistant; **Forget Home Assistant** removes the address and the token. **Which answers first** is set in **Voice**,
in the menu or on its phone page.


| Setting | Behaviour |
|---|---|
| Home Assistant first, then the AI (default) | The text goes to Assist. If Assist understood it, its answer is shown. If it did not (`no_intent_match`), or Home Assistant cannot be reached, the same text goes to the AI chat, when that is switched on. Without the AI, Assist's own message is shown. |
| Home Assistant only | The AI is never asked. |
| The AI only | Home Assistant is not asked. |

**Assist agent** lists the conversation agents of your Home Assistant (its `conversation.*` entities) and lets you choose one;
the default is the built-in agent. A conversation id is passed on, so follow-up questions keep their context; a new
conversation starts after ten quiet minutes or after **Forget the conversation**.

The same from a shell:

```sh
curl -X POST localhost:8765/api/voice/set -d '{"ha":{"url":"http://homeassistant.local:8123","token":"eyJ..."}}'
curl -X POST localhost:8765/api/voice/set -d '{"ha":{"route":"ha-only","agent":"conversation.home_assistant","selfSigned":false}}'
curl -X POST localhost:8765/api/voice/ha-test
curl -X POST localhost:8765/api/voice/ask -d '{"text":"turn on the living room light"}'
```

`route` is `ha-first`, `ha-only` or `ai-only`; `{"ha":{"clear":true}}` removes the address and the token. `/api/voice/ask` answers
`{"text","answer","via","error"}`, where `via` is `ha` or `ai`.

The token is stored in `config.json` on the TV only and is never returned by the service. Only the recognised text goes to your
Home Assistant. With a plain `http://` address the token is visible on your network.
