# Credits and licences

CleanYourTV for LG webOS is **MIT** licensed (see `LICENSE` in the repository). The package also contains the following unmodified
third-party files. They are separate programs that our service starts; none of our code is linked with them.

## inputhook

The files in `third-party/inputhook/` (installed to `/media/developer/cleanyourtv/inputhook/` on the TV) are taken unchanged from the
release `org.webosbrew.inputhook` 1.5.1 of [Simon34545/lginputhook](https://github.com/Simon34545/lginputhook). They inject a small
hook into LG's input process so a remote button can run a command; we use it for the Input button.

| File | What it is | Licence | Source |
|---|---|---|---|
| `ezinject` | process injector | Zlib | [smx-smx/ezinject](https://github.com/smx-smx/ezinject) |
| `libinputhookpp.so` | the hook library (it statically contains frida-gum) | GPL-3.0 | [sundermann/inputhookpp](https://github.com/sundermann/inputhookpp) |
| lginputhook (the app is not shipped; its key ids and config format are used) | button remapper | BSD-3-Clause | [Simon34545/lginputhook](https://github.com/Simon34545/lginputhook) |

!!! info "GPL-3.0 notice for `libinputhookpp.so`"
    The file is distributed unmodified, in the form it has in the inputhook 1.5.1 release. Its corresponding source code is the
    `inputhookpp` project linked above (with frida-gum). Anyone who received this package can ask for that source from this
    repository's issue tracker, and we will provide it. This applies to that library only, not to the rest of the project.

## Voice (optional download)

Nothing below is shipped in the package; the manager app downloads it on request. `voice/cytv-asr` (MIT, source in `voice/asr.c`)
is built against the Moonshine C header;
`voice/cytv-asr32` (MIT, source in `voice/asr32.c`, for a 32-bit ARM kernel) against the sherpa-onnx C header.

| Component | Licence | Source |
|---|---|---|
| Moonshine speech engine and models (`moonshine-voice` 0.1.5) | MIT | [moonshine-ai/moonshine](https://github.com/moonshine-ai/moonshine) |
| ONNX Runtime (inside the `moonshine-voice` package) | MIT | [microsoft/onnxruntime](https://github.com/microsoft/onnxruntime) |
| 64-bit GNU C library, libstdc++, libgcc (from `ubuntu-base` 22.04.5) | LGPL-2.1 / GPL-3.0 with runtime library exception | Ubuntu source packages `glibc` and `gcc-12` |
| sherpa-onnx C library (`sherpa-onnx-core` 2.0.1, for a 32-bit ARM kernel) | Apache-2.0 | [k2-fsa/sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) |
| ONNX Runtime (inside the `sherpa-onnx-core` package) | MIT | [microsoft/onnxruntime](https://github.com/microsoft/onnxruntime) |
| Moonshine tiny English model, quantized (sherpa-onnx's copy) | MIT | [moonshine-ai/moonshine](https://github.com/moonshine-ai/moonshine) |
| 32-bit hard-float GNU C library, libstdc++, libgcc (from `ubuntu-base` 22.04.5 armhf) | LGPL-2.1 / GPL-3.0 with runtime library exception | Ubuntu source packages `glibc` and `gcc-12` |

## qrcode-generator

`third-party/qrcode-generator/qrcode.js` is [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 1.4.4 by Kazuhiko
Arase, unmodified, licensed under the MIT license. The manager app loads it to draw QR codes.

## Design

The home-screen design follows the Android TV project [CleanYourTV](https://github.com/Gathin23/cleanyourtv) (MIT). No code from
it is used.

## This documentation

Built with [Zensical](https://zensical.org).
