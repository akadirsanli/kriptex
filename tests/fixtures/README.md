# Test fixtures

Blobs produced by `scripts/make-fixtures.mjs`, which implements the formats in
[docs/FORMAT.md](../docs/FORMAT.md) independently of the application code
(Node WebCrypto + zlib). The tests decrypt these fixtures, so a change that
silently breaks the wire format fails CI.

| File | Format | Passphrase | Contents |
|---|---|---|---|
| `krx5-envelope.txt` | KRX5 text envelope, AES-128-GCM, 600 000 iterations | `kriptex-fixture-v5` | `KRX5 fixture: the header is authenticated as AES-GCM AAD.` |
| `legacy-v4-envelope.txt` | KRX4 legacy envelope, AES-256-GCM, 250 000 iterations | `kriptex-fixture-v4` | `Legacy KRX4 envelope fixture — decrypts with the v4 profile.` |
| `legacy-v1-file.krx` | v1 container `salt‖iv‖ciphertext`, 250 000 iterations | `kriptex-fixture-krx-v1` | `legacy v1 container payload` |
| `krxfile2.krx` | KRXFILE2 container, 300 000 iterations | `kriptex-fixture-krxfile2` | `KRXFILE2 container payload\nsecond line`, stored name `fixture-note.txt` |

Regenerate with:

```bash
node scripts/make-fixtures.mjs
```

These fixtures are intentionally committed. Do not replace them with "cleaner"
ones: their value is that they never change, so they keep proving backwards
compatibility.
