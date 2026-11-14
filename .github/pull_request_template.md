## What changed

<!-- One or two sentences. Link the issue if there is one. -->

## Checklist

- [ ] `node --test tests/` passes locally
- [ ] No new third-party requests at runtime (no CDNs, fonts, analytics)
- [ ] New/changed crypto behaviour has a test vector
- [ ] Old blobs still decrypt (format versions are additive, never mutated)
- [ ] No secret, passphrase or real ciphertext added to the repo
- [ ] `assets/vendor/CHECKSUMS.txt` regenerated if a vendored file changed

## Notes for reviewers

<!-- Anything subtle: format changes, threat-model implications, follow-ups. -->
