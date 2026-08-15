# Third-party research and runtime dependencies

This project uses `puppeteer-core` and `@sparticuz/chromium` under their
respective open-source licenses. The direct public Douyin provider runs an
ordinary logged-out Chromium session and lets Douyin's public web application
produce its own request parameters. It does not embed a copied request signer,
stealth plugin, CAPTCHA solver, or authenticated session.

The implementation was informed by current public request and pagination
concepts documented in these independently maintained projects:

- `jiji262/douyin-downloader` (MIT; signer files have separate provenance)
- `tamnd/douyin-cli` (Apache-2.0)
- `Johnserf-Seed/f2` (Apache-2.0)

No source code from those projects is included here.
