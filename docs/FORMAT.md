# Wire formats

All multi-byte integers are **big-endian**. `b64` means standard RFC 4648
base64 with padding; `b64url` means URL-safe base64 without padding.

## Text envelopes

### KRX5 (current)

```
KRX5.<b64url(JSON envelope)>
```

```json
{
  "v": 5,
  "lvl": "standard | advanced | maximum",
  "alg": "AES-128-GCM | AES-256-GCM",
  "kdf": "PBKDF2-SHA256",
  "i": 600000,
  "s": "<b64, 16-byte salt>",
  "iv": "<b64, 12-byte IV>",
  "z": "deflate | none",
  "d": "<b64, ciphertext || 16-byte GCM tag>"
}
```

**Additional authenticated data**: the UTF-8 encoding of

```json
{"v":5,"lvl":…,"alg":…,"kdf":…,"i":…,"s":…,"iv":…,"z":…}
```

i.e. the envelope without `d`, serialised by `JSON.stringify` in exactly that
key order. Because the header is authenticated, editing `lvl`, `i`, `alg`, `s`,
`iv` or `z` invalidates the tag — a blob cannot be downgraded.

Plaintext pipeline: `UTF-8 → DEFLATE (zlib wrapper) → AES-GCM`.

Readers MUST validate before deriving a key:

| Field | Rule |
|---|---|
| `v` | must be `5` |
| `alg` | `AES-128-GCM` or `AES-256-GCM` |
| `kdf` | `PBKDF2-SHA256` |
| `lvl` | one of the three level names |
| `i` | integer, 100 000 ≤ i ≤ 4 000 000 |
| `s` | exactly 16 bytes |
| `iv` | exactly 12 bytes |
| `d` | at least 17 bytes (1 byte + 16-byte tag), at most 96 MiB |
| `z` | `deflate` or `none` |

Decrypted output is capped at 256 MiB to stop decompression bombs.

### KRX4 (legacy, still readable)

Same JSON shape with `"v": 4`, but the header is **not** authenticated and there
is no AAD. No new KRX4 blobs are produced.

### v3 legacy (still readable)

`b64( salt[16] || iv[12] || AES-256-GCM(ciphertext) )`, PBKDF2-HMAC-SHA256 with
exactly 250 000 iterations, no AAD. Recognised by the absence of a `KRX`
prefix.

## File containers

### KRXFILE2 (current)

```
offset  size  field
0       8     magic "KRXFILE2" (0x4B 52 58 46 49 4C 45 32)
8       1     container version = 2
9       1     cipher id = 1 (AES-256-GCM)
10      1     kdf id = 1 (PBKDF2-HMAC-SHA256, 256-bit)
11      1     reserved = 0
12      4     PBKDF2 iterations (uint32)
16      16    salt
32      12    IV
44      …     ciphertext || tag
```

Bytes `0…43` are passed to AES-GCM as **additional authenticated data**.

The plaintext of the ciphertext field is:

```
uint32 metaLen || UTF-8 JSON meta || file bytes
meta = { "name": "report.pdf", "size": 12345, "mtime": 1700000000000 }
```

`metaLen` is capped at 64 KiB; `meta.name` is sanitised (path separators and
control characters replaced) before it is used as a download name.

### v1 legacy (still readable)

No magic. `salt[16] || iv[12] || AES-256-GCM(file bytes)` with PBKDF2 250 000
iterations and no metadata; the restored name is the container name minus
`.krx`.

## Hashing

* SHA-1/224/256/384/512, RIPEMD-160, MD5 — standard implementations.
* `Keccak-256`, `Keccak-512` — original Keccak (padding byte `0x01`), **not**
  FIPS-202 SHA-3 (padding `0x06`). A test pins the empty-string digest
  `c5d2460186f7233c…`, so the label can never drift.

## Vault storage

`localStorage["kriptex.vault.v1"]` holds:

```json
{
  "v": 1,
  "kdf": { "iterations": 600000, "salt": "<b64>" },
  "verify": { "iv": "<b64>", "data": "<b64>" },
  "notes":  { "iv": "<b64>", "data": "<b64>" },
  "notesCount": 3,
  "createdAt": 1700000000000,
  "updatedAt": 1700000000000
}
```

`verify` is `AES-GCM(sentinel)` where the sentinel is
`kriptex::vault-sentinel::v1`; `notes` is `AES-GCM(JSON array of notes)`. Both
use the same key and independent random IVs. Exporting a backup writes this JSON
verbatim — it contains no plaintext and no key.
