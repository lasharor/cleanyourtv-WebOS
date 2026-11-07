## New

- **AI providers in order, with fallback.** Voice's AI chat can answer from OpenRouter, from a server of your own that speaks the OpenAI-compatible chat API (Ollama, LM Studio, llama.cpp's `llama-server`, vLLM and others: nothing paid, the text stays at home), or both: the first answers and the next takes over when it cannot be reached or does not answer in time, with the same conversation. Set them up on the phone page (**Voice > Set up from your phone**), order and test them under **Voice > AI providers**. Each key goes only to its own provider. An OpenRouter setup from 1.6 keeps working as the first provider, with nothing to do. By @Edenik (#208).

## What to know

AI providers with fallback were tried on a 65UR91006LB (webOS 25) with Ollama on a PC and OpenRouter, including an OpenRouter setup from 1.6; not yet on webOS 5 or 6. Please say what you see in an issue.

## Thanks

@Edenik for the AI providers with fallback; and everyone who reports what a dev build does on their TV.
