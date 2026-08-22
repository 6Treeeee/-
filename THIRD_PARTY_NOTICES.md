# Third-party notices

This distribution uses the following runtime dependencies. Their licenses are
compatible with this project's use when their notices and license terms are
preserved.

| Package | Version | License | Use |
| --- | --- | --- | --- |
| `@ai-sdk/gateway` | 4.0.62 | Apache-2.0 | Vercel AI Gateway transcription protocol |
| `@vercel/oidc` | 3.8.4 | Apache-2.0 | Request-scoped Vercel OIDC retrieval |
| `puppeteer-core` | 25.7.0 | Apache-2.0 | Ordinary logged-out browser automation |
| `@sparticuz/chromium` | 149.0.0 | MIT | Serverless Chromium runtime |
| `mp4box` | 2.4.1 | BSD-3-Clause | AAC remux from public MP4 into audio-only MP4 |
| `whisper.cpp` | b4938 (`371b5a7`) | MIT | Local CPU speech-to-text engine |
| OpenAI Whisper multilingual base q5_1 weights | revision `5359861` | MIT | Local speech-to-text model |

The Apache-2.0 packages are distributed under the Apache License, Version 2.0.
You may obtain a copy at <https://www.apache.org/licenses/LICENSE-2.0>.
Unless required by applicable law or agreed to in writing, software distributed
under that license is provided on an "AS IS" basis, without warranties or
conditions of any kind. `@ai-sdk/gateway` carries Copyright 2023 Vercel, Inc.
The complete Apache-2.0 texts remain present in the installed package
distributions.

## @sparticuz/chromium — MIT

Copyright (c) 2018 Alix Axel
Copyright (c) 2022 Kyle McNally

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## mp4box — BSD-3-Clause

Copyright (c) 2012. Telecom ParisTech/TSI/MM/GPAC Cyril Concolato
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER BE LIABLE FOR ANY
DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

## whisper.cpp engine and OpenAI Whisper model — MIT

The local engine is rebuilt from the pinned `whisper.cpp` release `b4938`,
commit `371b5a7561823ab2bb32142d2751e35e7534727b`, with OpenMP disabled so the
runtime does not depend on an unbundled `libgomp.so.1`. The multilingual
`ggml-base-q5_1.bin` model is pinned to repository revision
`5359861c739e955e79d9a303bcbc70fb988958b1`. Exact source URLs, sizes, and
SHA-256 hashes and reproducible build flags are recorded in
`assets/whisper/ASSET_MANIFEST.json`.

Both are distributed under the MIT License. Complete license copies are
included as `assets/whisper/LICENSE-whisper.cpp` and
`assets/whisper/LICENSE-OpenAI-Whisper` and must remain with redistributed
assets. No engine or model is downloaded at request time.

## Research references

The direct public provider runs a fresh logged-out Chromium session and lets
Douyin's public web application produce its own current request parameters. It
does not embed a copied signer, stealth plugin, CAPTCHA solver, authenticated
session, or DRM-removal code.

The implementation was informed by public request and pagination concepts in
these independently maintained projects:

- `jiji262/douyin-downloader` (MIT; signer files have separate provenance)
- `tamnd/douyin-cli` (Apache-2.0)
- `Johnserf-Seed/f2` (Apache-2.0)

No source code from those research projects is included here.
