# webOS 4 runtime provenance

The system Node 0.12.2 remains installed. The experimental profile uses exactly Node 18.17.1 ARMv7 with the libraries in
`webos4/runtime-manifest.json`, invoked through the TV's `/lib/ld-linux.so.3` and a private library search path.
The official Linux ARM hard-float build did not run on the tested firmware; arbitrary Node builds are not interchangeable.

## Reproducible source

The verified source is [StremCompat v1.3.3](https://github.com/Alexesmm/stremcompat-lg-webos/releases/tag/v1.3.3), asset
`StremCompat-webOS4-UM4-armv7-graphics-1920x1080-1.2.29.ipk`, 48,781,846 bytes:

```text
SHA-256 65f6dea25bf2c802197e32e9c0e47fe0949de91241feed98a04b8a7d8984496e
```

`webos4/runtime-source.json` pins the download address, package digest and member prefix.
`python3 webos4/prepare-runtime.py <downloaded-ipk> <new-output-directory>` checks that digest before reading the package.
It copies only the 14 allowlisted files from `usr/palm/services/io.strem.tv.server/bin/`, checking each size/hash against the
profile-pinned manifest. Archive symlinks are resolved in memory, then materialized as regular private files; no IPK extraction
onto system paths, package installation or execution occurs. Existing outputs are refused.

On 30 October 2026, downloading this release reproduced all 14 files of the runtime already tested on the TV. The original app,
service scripts, frontend and other package code are not included or used. This repository contains the extraction code and manifests,
not the third-party binary files. A local kit can include those verified files for the owner's TV.

## Redistribution boundary

The project's MIT licence covers its own implementation. It does not relicense Node or its libraries. Node includes third-party
notices; library components include libstdc++, libatomic, c-ares, libuv, nghttp2 and OpenSSL. Keep the supplying project's source,
build information and the applicable component licences/notices available when preparing a public binary distribution.
This contribution does not claim that the supplying IPK alone establishes all redistribution requirements. Runtime-containing
artifacts are local development outputs and are not added to the normal release workflow. Public binary redistribution is a separate
maintainer task requiring verified source provenance and all applicable notices/source obligations.

The runtime installer checks the fixed SDK, complete manifest, archive checksum/types, each file, ARM ELF header and loader version.
It publishes a private version directory only after these checks and refuses foreign existing content. It never changes libc,
system Node, global library paths or firmware. The runtime install was tested on the owner TV; compatibility with other SDKs/models
or another runtime version is not established.
