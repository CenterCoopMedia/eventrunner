# Site fonts

Self-hosted woff2 files for the GitHub Pages surface — the landing page
(`docs/index.html`) and every generated documentation page under
`docs/docs/`. Both load `docs/styles.css`, which declares the `@font-face`
rules pointing here, so no page this site serves makes a font-CDN request.

Latin subsets only, at the weights the stylesheets actually use:

| File | Family | Weights | License |
| --- | --- | --- | --- |
| `bricolage-grotesque-latin.woff2` | Bricolage Grotesque | 700–800 (variable) | SIL OFL 1.1 |
| `source-sans-3-latin.woff2` | Source Sans 3 | 400–700 (variable) | SIL OFL 1.1 |
| `source-sans-3-italic-latin.woff2` | Source Sans 3 italic | 400–700 (variable) | SIL OFL 1.1 |
| `ibm-plex-mono-400-latin.woff2` | IBM Plex Mono | 400 | SIL OFL 1.1 |
| `ibm-plex-mono-500-latin.woff2` | IBM Plex Mono | 500 | SIL OFL 1.1 |

All are licensed under the SIL Open Font License 1.1
(<https://openfontlicense.org>), the same license as the app's bundled font
sets in `apps/web/public/fonts/`. `source-sans-3-latin.woff2` is byte-for-byte
the file already shipped there — the same subset serves both surfaces.

The files are the Latin subsets Google Fonts serves for these families.
Replacing one is a deliberate, reviewable change: drop in the new woff2, and
update the matching `@font-face` block and the weights column above.
