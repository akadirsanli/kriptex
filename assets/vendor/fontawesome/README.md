# Vendored third-party assets

These files are copied into the repository so KRIPTEX can run without any
network access. Nothing here is modified except the font CSS URLs, which point
at the local copies instead of Google's servers.

| File | Version | License |
|---|---|---|
| `pako.min.js` | 2.1.0 | MIT |
| `crypto-js.min.js` | 4.2.0 | MIT |
| `fontawesome/css/all.min.css` + `webfonts/fa-solid-900.woff2` | 6.5.1 (Free) | Icons CC BY 4.0, fonts SIL OFL 1.1, code MIT |
| `fonts/jetbrains-mono*.woff2` + `jetbrains-mono.css` | Google Fonts static build | SIL OFL 1.1 |

Notes:

* Only the **solid** Font Awesome face is vendored. Use `class="fas fa-…"`
  icons only; `far`/`fab` would 404 (and the CSP would not fetch them anyway).
* `CHECKSUMS.txt` is checked by `tests/static.test.mjs`. Regenerate it with
  `node scripts/checksums.mjs` after any update.
* To add a dependency, prefer vendoring a pinned build over a CDN: the CSP
  (`script-src 'self'`) and the no-third-party-requests test will reject
  anything else.
