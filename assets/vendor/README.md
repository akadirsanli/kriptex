# Vendored assets

Everything the app needs is committed here, so it can run with **zero network
access**. The Content-Security-Policy only allows `'self'`, and
`tests/static.test.mjs` fails the build if a third-party URL appears anywhere.

| Path | Version | License |
|---|---|---|
| `pako.min.js` | 2.1.0 | MIT |
| `crypto-js.min.js` | 4.2.0 | MIT |
| `fontawesome/css/all.min.css` + `webfonts/fa-solid-900.woff2` | 6.5.1 Free | Icons CC BY 4.0, fonts SIL OFL 1.1, code MIT |
| `fonts/jetbrains-mono*.woff2` + `jetbrains-mono.css` | Google Fonts static build | SIL OFL 1.1 |
| `fonts/inter-*.woff2` + `inter.css` | Google Fonts static build | SIL OFL 1.1 |

## Rules

1. Prefer a pinned build over a CDN. Add it here, not to `index.html`.
2. Regenerate `CHECKSUMS.txt` afterwards: `node scripts/checksums.mjs`.
3. Keep Font Awesome usage to `class="fas fa-…"` — only the solid face is
   vendored, so `far`/`fab` icons would 404.
4. Font CSS is rewritten to point at the local `.woff2` files (see the
   generators in `scripts/` or the git history for the exact fetch).
