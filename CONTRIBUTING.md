# Contributing

Thanks for wanting to help. This project is a security tool, so the bar for
changes to the crypto and storage layers is deliberately high.

## Setup

There is no build step and no runtime dependency to install.

```bash
git clone https://github.com/akadirsanli/kriptex.git
cd kriptex
python -m http.server 8080      # any static server works; http://localhost is a secure context
node --test tests/              # run the suite before and after your change
```

Node 20+ is required for the tests (they use `node:test` and WebCrypto).

## Ground rules

1. **No third-party requests at runtime.** No CDNs, no web fonts, no analytics,
   no telemetry. `tests/static.test.mjs` enforces this, and the Content-Security-Policy
   in `index.html` would block it anyway. Vendor pinned builds into
   `assets/vendor/` and regenerate `CHECKSUMS.txt`.
2. **No new dependency without an issue first.** Prefer the Web Crypto API and
   the standard library; every dependency is attack surface for a crypto tool.
3. **Formats are frozen once released.** Add a new envelope/container version
   and keep the old reader. Never silently change what an existing blob means.
4. **Every behaviour change needs a test.** Crypto changes need a vector. UI
   fixes can rely on the static checks, but prefer a real assertion.
5. **Do not weaken the defaults.** Higher iteration counts, stricter validation
   and smaller surfaces are always welcome; the reverse needs a very good reason.

## Style

* Vanilla ES2020+, no build step, no transcompiler.
* Four spaces, single quotes, semicolons, `const`/`let`, `'use strict'` at the
  top of every module.
* Modules hang off the `KX` namespace (`KX.crypto`, `KX.tabs.*`) so load order
  stays explicit in `index.html`.
* Comments explain *why*, not *what*.
* Prefer `textContent` over `innerHTML` for anything user-controlled.

## Commits and pull requests

* Keep commits focused; one concern per commit.
* Write the message in the imperative mood (`Add authenticated file header`).
* Fill in the PR template and tick the checklist — especially "no new network
  requests" and "tests pass".

## Reporting security issues

Do not open a public issue. See [SECURITY.md](SECURITY.md).
