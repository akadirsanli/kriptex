# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Use GitHub's [private vulnerability reporting](https://github.com/akadirsanli/kriptex/security/advisories/new)
(Security → Report a vulnerability). Include the version, the browser, a minimal
reproduction, and the impact you believe it has. You can expect an
acknowledgement within 72 hours and, for a confirmed high-severity issue, a fix
or a documented mitigation within 30 days. Reporters are credited in the
release notes unless they ask not to be.

## Supported versions

Only the latest tagged release on `main` is supported. The app is a static
bundle, so there is no patching of old deployments — update the files.

## Threat model

### What KRIPTEX protects against

| Scenario | Covered |
|---|---|
| An attacker who obtains the ciphertext (email, chat, backup, lost USB stick) | Yes — AES-GCM with a PBKDF2-derived key; the tag detects tampering. |
| A network observer of the app itself, or of what the page loads | Yes — no third-party requests at runtime; CSP `default-src 'none'`, `connect-src 'none'`. |
| A hostile cloud/CDN serving modified JavaScript | Yes — nothing is loaded from a CDN; vendored files are checksummed and tested in CI. |
| Someone reading `localStorage` on a shared machine | Partly — they get a sealed blob, not plaintext (but can attack it offline). |
| Silent corruption or truncation of a blob | Yes — GCM authentication; the header is authenticated too (KRX5/KRXFILE2). |
| A mistyped passphrase destroying data | Mitigated — encryption asks twice and verifies by re-decrypting before showing output. |

### What KRIPTEX does **not** protect against

* A compromised browser, a malicious extension, or injected script running in
  the page while the vault is unlocked — the key is in memory by design.
* A keylogger, screen capture, or shoulder surfing.
* A weak passphrase. The KDF slows guessing; it does not rescue `password1`.
* Loss of browser storage. `localStorage` can be cleared by the user, by the
  browser under storage pressure, or by a profile reset. **Export backups.**
* Traffic metadata of the initial page load (your IP reaching GitHub Pages).
  Only the *content* is free of third-party requests.

## Design decisions worth knowing

* **PBKDF2, not Argon2id (yet).** PBKDF2-HMAC-SHA256 is the only KDF in the
  Web Crypto API, so the app has no dependency at all for key derivation.
  Counts are 600k / 1M / 2M, at or above OWASP's 600k floor. Argon2id via WASM
  is on the roadmap; it is memory-hard and therefore much better against GPUs.
* **Keccak, not FIPS-202 SHA-3.** The bundled CryptoJS implements original
  Keccak (padding `0x01`), so the UI labels those options `Keccak-256` and
  `Keccak-512`. They intentionally do **not** match `openssl dgst -sha3-256`.
  This is pinned by a test vector.
* **`Keccak-256` is not a security weakness** — it is a naming/compatibility
  issue. Keccak is what Ethereum calls `keccak256`.
* **No password-based "recovery".** The vault, the passphrase and the keys are
  local. If the passphrase is lost, the data is gone. That is the point.

## Known limitations

1. Files are read fully into memory before sealing; very large files (>1 GB)
   may exhaust the tab. Chunked streaming is planned.
2. The vault is stored in `localStorage` (~5 MB). Saves fail loudly when full;
   export a backup and prune notes.
3. `*.github.io` origins are shared between all of a user's Pages projects, so
   another project on the same account could read this origin's storage. A
   custom domain is recommended for production use.
4. The app requires a secure context (`https://` or `localhost`); plain
   `http://` is rejected at boot because `crypto.subtle` is unavailable.

## Verifying a deployment

```bash
node --test tests/      # crypto vectors, formats, vault and static integrity checks
```

`tests/static.test.mjs` recomputes the SHA-256 of every vendored file and
compares it to `assets/vendor/CHECKSUMS.txt`, so a modified library cannot slip
through CI unnoticed.

If you host a fork, publish the SHA-256 of the deployed files next to the build
so users can confirm that what they are running matches the repository.
