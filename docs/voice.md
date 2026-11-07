# Voice (optional)

Recognises speech from the remote's microphone **on the TV**. The text is shown on screen and can be sent to a server you run,
to language models (OpenRouter, a self-hosted AI server, or both, one taking over when the other fails), or to both; the answer
is shown as text on screen. Answers are not spoken. No audio is recorded or sent anywhere.

It is **off and not installed by default**. Nothing described here runs until you install it.

## Installing

**Voice** in the manager app downloads about 80 MB into `/media/developer/cleanyourtv/voice`. The checksums are pinned in the
code; **Remove voice** deletes everything again.

On a TV with a **64-bit kernel** (most TVs, the G2 among them):

| Part | From |
|---|---|
| Speech engine `libmoonshine.so` and ONNX Runtime | the `moonshine-voice` 0.1.5 package on PyPI (MIT) |
| 64-bit C library | `ubuntu-base` 22.04.5 for arm64 (this TV has a 32-bit userland on a 64-bit kernel, so the 64-bit recogniser brings its own) |
| Model `tiny-streaming-en` (34 million parameters, int8) | download.moonshine.ai (MIT) |
| `cytv-asr`, a small program that feeds audio to the engine | this repository (`voice/asr.c`, built with `voice/build.sh`) |

On a TV with a **32-bit ARM kernel** (`uname -m` says `armv7l`, as on the 43UP7550PTZ, issue 175), about 80 MB as well:

| Part | From |
|---|---|
| Speech engine `libsherpa-onnx-c-api.so` and ONNX Runtime (9 MB) | the `sherpa-onnx-core` 2.0.1 package for armv7l on PyPI (Apache-2.0) |
| 32-bit hard-float C library (26 MB) | `ubuntu-base` 22.04.5 for armhf (the TV's own 32-bit programs are soft-float, so the recogniser brings its own) |
| Model Moonshine tiny English, quantized (43 MB) | sherpa-onnx's copy on Hugging Face, at a fixed revision (MIT) |
| `cytv-asr32`, the same small program for this engine | this repository (`voice/asr32.c`, built with `voice/build.sh`) |

## Using it

| Step | How |
|---|---|
| Choose the button | **Voice** > **Learn the voice button**. Try the remote's microphone button; if the hook does not see it, any spare button works. Then switch **Listen on the voice button** on. |
| From the phone remote | The mic button of the [phone remote](phone-remote.md) asks the same assistant: speak or type on the phone (no speech download needed) or let the TV listen on its remote, and read the conversation on the phone. The button is dimmed until something here answers (the AI chat, Home Assistant or a server). |
| Try without a button | **Voice** > **Try it now**, or `curl -X POST localhost:8765/api/voice/listen`. On some TVs (the 65UR91, webOS 25 on a 2023 board) LG's service opens the microphone only while the mic button is held: hold it within 8 seconds, or the card says **Hold the remote's mic button while you speak**. |
| Send the text to a server | `curl -X POST localhost:8765/api/voice/set -d '{"url":"http://server:port/path","token":"optional"}'` |
| Pause LG's voice assistant | **Voice** > **Switch off LG's voice assistant**. It pauses LG's `voiceconductor` process while voice is on, so LG's own screen and its cloud recognition do not start on the same button. A reboot or turning the switch off undoes it. |

On screen a card changes in place while you speak: **Listening** (moving bars), **Recognising** or **Thinking** (dots), then your
question in small type above the answer. Reading time follows the length of the answer.

### Sending text to your own server

The TV sends `POST` with the JSON body `{"text":"...","source":"cleanyourtv","language":"en","time":"..."}` and, when a token is set,
`Authorization: Bearer <token>`. If the server answers with JSON (`{"title","text","image","seconds"}`) or plain text, the answer
is shown as a card. The address and token are stored in `config.json` on the TV only.

## AI chat: providers and fallback

The answers come from one or more AI providers, asked in their order: the first answers; when it cannot be reached, does not
answer in time or fails, the next one is asked, with the same conversation. A provider is either:

- **OpenRouter**, with your OpenRouter key (paid per use; many models), or
- **your own server**: a language model on a computer of yours, with any server that speaks the OpenAI-compatible chat API
  (Ollama, LM Studio, llama.cpp's `llama-server`, vLLM, LocalAI, Jan, text-generation-webui and others). Nothing is paid and the
  text stays on your network.

A typical list: your own server first, OpenRouter as the fallback for when the computer is off.

### Setting them up

In **Voice**, **Set up from your phone** shows a QR code. Scan it with a phone on the same Wi-Fi. The page shows one card per
provider: **+ OpenRouter** and **+ Your own server** add one, ▲ and ▼ change the order, ✕ removes one. On each card:

- **Address** (your own server): the part before `/chat/completions`, usually ending with `/v1`: `http://<computer>:<port>/v1`.
- **API key**: OpenRouter's key, or your server's if it asks for one (most do not). A saved key is never shown; leave the
  field empty to keep it.
- **Model**: the list is read from that provider once its address is entered; any model name can be typed.
- **Wait for an answer**: 10, 25, 30, 45 or 60 seconds (25 for a server, 30 for OpenRouter by default).
- **Test** asks the provider "Say OK" with the values on the card and shows the time it took, or what went wrong.

Below the cards: **Answer with the AI**, the instructions, which answers first (Home Assistant or the AI) and the address of a
server of yours that gets the text (see above). **Save** checks every card first. The page is open for ten minutes or until you
save, at a random address. It is plain HTTP, so use it on a network you trust.

On the TV, **Voice** > **AI providers** lists them in their order with the last result of each (a green dot: answered; red: did
not answer; grey: not tried yet). Channel up and down move the selected one; OK opens it: **Test now**, **Model**, **Wait for an
answer**, **Use this provider** (switch it off without removing it), **Make first**, **Move up**, **Move down** and **Remove**.
**AI chat** switches the answers on and off.

### When the next one is asked

- the provider cannot be reached within 4 seconds (the computer is off, a wrong address, nothing listening);
- it does not answer within its wait;
- it answers with an error, or refuses the key;
- it gives an empty answer, or tries to call a tool, after one more try.

All providers together have 60 seconds. A provider that could not be reached is skipped for one minute, so a computer that is off
costs nothing on the next question. The card on the TV does not say which provider answered: it shows **Thinking**, then the
answer. When none answers, the card **Not answered** lists the reason of each one. The reply of `/api/voice/ask` (below) and
**Voice** > **AI providers** in the manager app show which one answered.

### Your own server

What the server needs:

- the endpoints `/v1/chat/completions` (the answers) and `/v1/models` (the list of models);
- to listen on the network, not only on the computer itself (`localhost` or `127.0.0.1`, which many servers use by default);
- its port open in the computer's firewall;
- a model small enough to answer within its wait: on a computer without a graphics card, take one of 1 to 4 billion parameters.
  The first answer after a while can take longer, while the server loads the model again.

| Server | Address | Listening on the network |
|---|---|---|
| [Ollama](https://ollama.com) | `http://<computer>:11434/v1` | set `OLLAMA_HOST=0.0.0.0` (on Windows and macOS in the environment of the Ollama app, then restart it) |
| [LM Studio](https://lmstudio.ai) | `http://<computer>:1234/v1` | switch on **Serve on Local Network** in its server settings |
| llama.cpp's `llama-server` | `http://<computer>:8080/v1` | start it with `--host 0.0.0.0 --port 8080` |
| [vLLM](https://docs.vllm.ai) | `http://<computer>:8000/v1` | start it with `vllm serve <model> --host 0.0.0.0` |

With Ollama, for example:

```sh
ollama pull llama3.2:3b
OLLAMA_HOST=0.0.0.0 ollama serve
```

`http://` is fine on your own network. Home Assistant is another way to a local model: if it has a conversation agent backed by
one (its Ollama integration, for example), choose that agent under **Assist agent** (below).

### Keys and privacy

What you say is sent as text to the providers that are asked, never audio. Each key is stored in `config.json` on the TV only and
goes only to its own provider: the OpenRouter key never reaches your server, and your server's key never reaches OpenRouter. The
status (`/api/voice/status`) says whether a provider has a key (`hasKey`), never which. A short instruction asks for one to three
plain sentences (change it with `"system"`). The conversation remembers the last six exchanges for ten minutes, whichever provider
answered (**Forget the conversation** clears them). With your own server set for the text as well, it also receives the text and
the answer (`{"text","answer"}`).

### From a shell

```sh
curl -X POST localhost:8765/api/voice/set -d '{"llm":{"enabled":true,"providers":[
  {"type":"server","name":"Ollama on PC","base":"http://192.168.1.20:11434/v1","model":"llama3.2:3b"},
  {"type":"openrouter","key":"sk-or-...","model":"openrouter/auto"}]}}'
```

`providers` replaces the list; an entry with the `id` of a saved provider changes it, and keeps its key unless `key` or
`"clearKey":true` is given. Other changes: `{"llm":{"provider":{...}}}` adds one (no `id`) or changes one, `{"llm":{"remove":"<id>"}}`,
`{"llm":{"order":["<id>",...]}}`, `{"llm":{"first":"<id>"}}`. A provider takes `type` (`server` or `openrouter`, at most one),
`name`, `base`, `key`, `model`, `waitS` (10, 25, 30, 45 or 60) and `off`. `POST /api/voice/test {"id":"<id>"}` tests one;
`GET /api/voice/models?id=<id>` lists its models.

**Coming from version 1.6 (OpenRouter only):** nothing to do. Your OpenRouter key, model and instructions become the first
provider and answer as before. To have your own server answer first, add it on the phone page and move it to the top: OpenRouter
is then the fallback. The commands of 1.6 still work and act on the OpenRouter provider: `{"llm":{"key":"sk-or-...","model":"..."}}`
adds it or changes its key or model, `{"llm":{"clearKey":true}}` removes it, `{"llm":{"enabled":true}}` switches the answers on.
The status still has `hasKey` (an OpenRouter key is saved) and `model` (of the provider asked first). The settings keep
OpenRouter's key and model where 1.6 reads them, so going back to the previous version in the manager keeps OpenRouter answering.

You can also ask by text, with the same result, and without the speech download:

```sh
curl -X POST localhost:8765/api/voice/ask -d '{"text":"..."}'
```

It answers `{"text","answer","via","provider","tried","error"}`: `provider` is the id of the one that answered, `tried` the ones
asked before it, with their reason. Add `"card":false` to skip the screen.

### Letting the AI act on the TV

**Let the voice assistant act on the TV** (manager app, **Features > AI agents (MCP)**; the voice setup page; or `{"llm":{"agent":true}}`) lets the model use tools: open apps, switch inputs, show
a card, turn the TV off after you say yes, and the tools of add-ons you approved. It is off by default. How it works, the yes, and
the MCP endpoint other programs can use: [Tools for the assistant](agent.md).

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
| Audio | 16 kHz mono from the microphone stream of LG's `voiceinput` service, read from the socket its reply names (`/var/voiceinput/voiceinput_remote1.soc` on the 65UR91, `/tmp/voiceinput_remote1.soc` when the reply names none). Held in memory while recognising, then discarded; not written to disk or sent anywhere. |

**Which TVs.** A TV with a **64-bit kernel** gets the 64-bit recogniser. A TV whose kernel is 32-bit ARM (`uname -m` says `armv7l`,
as on the 43UP7550PTZ, issue 175) cannot start a 64-bit program at all, so it gets the 32-bit recogniser instead: the same Moonshine
tiny English model, run by sherpa-onnx. Only an ARM core older than ARMv7 can run neither: the manager says so and downloads nothing.

The TV's programs are 32-bit ARM and soft-float. Neither recogniser can use the TV's own C library: `cytv-asr` is 64-bit and
`cytv-asr32` is hard-float. Each runs through the loader and libraries that the download places in the same folder. Nothing in the
system folders is changed.

Only text goes further: to your server, to the AI providers you set, or nowhere. LG's own assistant is a separate path
with its own cloud recognition; **Switch off LG's voice assistant** pauses it while voice is on.

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
