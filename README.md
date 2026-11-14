# KRIPTEX v4.2 — Client-Side Encryption Suite

[![ci](https://github.com/akadirsanli/kriptex/actions/workflows/ci.yml/badge.svg)](https://github.com/akadirsanli/kriptex/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-33ff66.svg)](LICENSE)
[![no network](https://img.shields.io/badge/runtime%20requests-none-33ff66.svg)](SECURITY.md)

🌐 **[Live app →](https://akadirsanli.github.io/kriptex/)**

KRIPTEX is a serverless cryptography toolkit that runs entirely in your browser.
It encrypts text and files with AES-GCM, hashes text and files, generates
passwords and passphrases, and keeps an encrypted notes vault in local storage.

**Nothing is uploaded, and nothing is fetched after the page loads** — the
libraries, fonts and icons are vendored in this repository and a strict
Content-Security-Policy (`connect-src 'none'`) enforces it.

## Features

* **Text encryption** — AES-128/256-GCM with PBKDF2-HMAC-SHA256 (600k / 1M / 2M
  iterations). Self-describing `KRX5` envelopes; the whole header is
  authenticated as GCM additional data, so a blob cannot be downgraded or
  re-labelled. Legacy `KRX4` and v3 blobs still open.
* **File sealing** — `.krx` (`KRXFILE2`) containers with an authenticated
  header and an encrypted filename, so the restored file keeps its name. Sealed
  files are re-decrypted and compared before the download is offered.
* **Hashing** — SHA-1/224/256/384/512, Keccak-256/512, RIPEMD-160, MD5 for text
  and for files (4 MB streaming slices, constant memory), plus digest comparison
  and length-based algorithm detection.
* **Hash recovery** — dictionary attack in a Web Worker with a 112-mutation
  generator, live rate display, real cancellation and flat memory use.
* **Compression** — streaming zlib in a Web Worker, base64 or binary output,
  with an inflation cap so a malicious payload cannot exhaust memory.
* **Generators** — CSPRNG passwords (every enabled class guaranteed) and
  EFF-large-list passphrases (7,776 words, 12.9 bits each), both with a live
  entropy estimate.
* **Encrypted vault** — notes sealed as a single AES-256-GCM blob with a
  sentinel-based passphrase check, idle auto-lock, encrypted export/import
  backups, cross-tab locking and a guard against storage quota failures.

## Interface

A persistent control rail on the left, one working area on the right, and a
card-based layout that puts the input and the result side by side. The four
palettes (`fsociety`, `darkarmy`, `ecorp`, `whiterose`) are token-driven, so
every component respects the active theme — including a genuinely light one.

* Typography pairs **Inter** for prose with **JetBrains Mono** for labels, code
  and numbers. Both are self-hosted, subsetted to latin + latin-ext.
* Destructive actions use an in-page modal instead of `window.confirm()`;
  buttons, dropzones, tabs and switches are keyboard operable and labelled.
* Motion is decorative only: it respects `prefers-reduced-motion`, can be
  switched off entirely, and the app is identical without it.
* The layout collapses to a single column below 1100px and to a scrollable
  top nav below 900px.

`tests/design.test.mjs` keeps it honest: balanced stylesheets, no undefined
custom properties, no unstyled class in the markup, one heading per panel, and
no unlabelled buttons.

## Quick start

Web Crypto requires a secure context, so serve the folder over `http://localhost`
or `https://` — opening `index.html` from the filesystem is not supported.

```bash
git clone https://github.com/akadirsanli/kriptex.git
cd kriptex
python -m http.server 8080
# then open http://localhost:8080
```

Or use the [live deployment](https://akadirsanli.github.io/kriptex/), which is
the same static files.

## Verify it

```bash
node --test tests/            # 36 tests: crypto vectors, formats, vault, static checks
node scripts/checksums.mjs    # regenerate assets/vendor/CHECKSUMS.txt after an update
```

`tests/static.test.mjs` fails the build if the app ever loads a third-party
subresource, if a Content-Security-Policy is missing, if a `getElementById`
reference does not exist, or if a vendored library does not match its recorded
SHA-256.

The format is documented byte-for-byte in [docs/FORMAT.md](docs/FORMAT.md), and
`tests/fixtures/` contains blobs produced by an independent implementation
(Node's WebCrypto) so compatibility is tested rather than assumed.

## Project layout

```
index.html                 markup only — no inline script
assets/css/                themes and layout
assets/js/core/            crypto engine, vault, workers, utils, wordlist
assets/js/tabs/            one module per tab
assets/js/workers/         worker entry points (real files, not blobs)
assets/vendor/             pinned third-party builds + CHECKSUMS.txt
docs/FORMAT.md             wire formats (KRX5, KRXFILE2, legacy)
scripts/                   fixture + checksum generators
tests/                     node:test suites and fixtures
```

## Security model

Read [SECURITY.md](SECURITY.md) for the full threat model. In short: KRIPTEX
protects data **at rest and in transit** against someone who obtains the
ciphertext, and against network-level observation of the app itself. It cannot
protect you from a compromised browser, a malicious extension, a keylogger, or
someone who watches you type the passphrase.

* The passphrase is never stored; the vault verifies it by decrypting a known
  sentinel.
* Keys are derived with Web Crypto and are non-extractable.
* Salts and IVs are fresh for every operation and come from `crypto.getRandomValues`.
* The "no server" claim is enforced by the CSP and a CI test, not only by
  documentation.

## Roadmap

* Argon2id (WASM) as the default KDF, with automatic re-seal of older blobs.
* Chunked, genuinely streaming file encryption for multi-gigabyte files.
* Service worker for offline install (the app already needs no network).
* Additional locales (the UI is English only today).

## License

[MIT](LICENSE). Vendored third-party assets keep their own licenses — see
[assets/vendor/fontawesome/README.md](assets/vendor/fontawesome/README.md).
