# Bundled font sets

Self-hosted `woff2` only. No font CDN request at runtime, and a client never
supplies a font URL (spec §7.4, design brief §4). Every file here is a Latin
subset, and every face clears the four tests in brief §9:

1. It carries the SIL Open Font Licence or an equivalent libre licence.
2. It subsets to a Latin `woff2` under 60KB.
3. It stays legible at nameplate size and at `--text-h3`.
4. It holds contrast in both modes.

**Twenty-three families live in this directory. A deployed site loads two to
four of them.** The bundle is the repo's, not the reader's: `buildTokenCss`
(`scripts/lib/tokens.cjs`) resolves the active preset plus the operator's
picked options down to the faces that preset actually names, and emits an
`@font-face` block for those files only. The other twenty families are never
mentioned in `apps/web/src/generated/theme.css`, so a browser never requests
them. The two admin faces — Source Sans 3 and IBM Plex Mono — are emitted on
every deployment, because the admin identity is fixed and ships with the
product (admin story part 6g).

## The faces

`Set id` is what `config/theme.fonts.<role>` names and what a preset's type map
and heading options point at. `Weights` is what the emitted `@font-face`
declares.

| File | Family | Weights | Set id | Size | Licence |
| --- | --- | --- | --- | --- | --- |
| `source-serif-4-latin.woff2` | Source Serif 4 | 400–700 var | `serif-editorial` | 50 KB | SIL OFL 1.1 |
| `source-sans-3-latin.woff2` | Source Sans 3 | 400–700 var | `sans-humanist` | 29 KB | SIL OFL 1.1 |
| `caveat-latin.woff2` | Caveat | 400 | `script-casual` | 48 KB | SIL OFL 1.1 |
| `libre-caslon-display-latin.woff2` | Libre Caslon Display | 400 | `caslon-display` | 24 KB | SIL OFL 1.1 |
| `libre-caslon-text-400-latin.woff2`, `libre-caslon-text-700-latin.woff2` | Libre Caslon Text | 400, 700 | `caslon-text` | 25 KB + 25 KB | SIL OFL 1.1 |
| `libre-baskerville-latin.woff2` | Libre Baskerville | 400–700 var | `baskerville` | 33 KB | SIL OFL 1.1 |
| `spectral-600-latin.woff2` | Spectral | 600 | `spectral` | 22 KB | SIL OFL 1.1 |
| `fraunces-latin.woff2` | Fraunces | 400–700 var | `fraunces` | 32 KB | SIL OFL 1.1 |
| `newsreader-latin.woff2` | Newsreader | 400–700 var | `newsreader` | 40 KB | SIL OFL 1.1 |
| `ibm-plex-sans-latin.woff2` | IBM Plex Sans | 400–700 var | `plex-sans` | 35 KB | SIL OFL 1.1 |
| `ibm-plex-mono-400-latin.woff2`, `ibm-plex-mono-600-latin.woff2` | IBM Plex Mono | 400, 600 | `plex-mono` | 14 KB + 15 KB | SIL OFL 1.1 |
| `archivo-condensed-latin.woff2` | Archivo (width 75) | 400–700 var | `archivo-condensed` | 33 KB | SIL OFL 1.1 |
| `merriweather-400-latin.woff2`, `merriweather-700-latin.woff2` | Merriweather | 400, 700 | `merriweather` | 47 KB + 46 KB | SIL OFL 1.1 |
| `public-sans-latin.woff2` | Public Sans | 400–700 var | `public-sans` | 24 KB | SIL OFL 1.1 |
| `karrik-latin.woff2` | Karrik | 400 | `karrik` | 16 KB | SIL OFL 1.1 |
| `bagnard-latin.woff2` | Bagnard | 400 | `bagnard` | 7 KB | SIL OFL 1.1 |
| `avara-latin.woff2` | Avara | 700 | `avara` | 6 KB | SIL OFL 1.1 |
| `fragment-mono-latin.woff2` | Fragment Mono | 400 | `fragment-mono` | 17 KB | SIL OFL 1.1 |
| `besley-latin.woff2` | Besley | 400–700 var | `besley` | 33 KB | SIL OFL 1.1 |
| `vollkorn-latin.woff2` | Vollkorn | 400–700 var | `vollkorn` | 42 KB | SIL OFL 1.1 |
| `overpass-latin.woff2` | Overpass | 400–700 var | `overpass` | 28 KB | SIL OFL 1.1 |
| `overpass-mono-latin.woff2` | Overpass Mono | 400–700 var | `overpass-mono` | 21 KB | SIL OFL 1.1 |
| `libre-franklin-latin.woff2` | Libre Franklin | 400–700 var | `libre-franklin` | 27 KB | SIL OFL 1.1 |

## Who drew them, and where they came from

Every face is licensed under the **SIL Open Font License, Version 1.1**
(<https://openfontlicense.org>). Four of them are not on Google Fonts, so their
licence text travels with the binary in `licenses/`; the rest carry the same
OFL 1.1 text in their upstream Google Fonts repository.

| Family | Designer / foundry | Upstream |
| --- | --- | --- |
| Source Serif 4, Source Sans 3 | Frank Grießhammer, Paul D. Hunt (Adobe) | Google Fonts |
| Caveat | Pablo Impallari | Google Fonts |
| Libre Caslon Display, Libre Caslon Text, Libre Baskerville, Libre Franklin | Impallari Type / Pablo Impallari, Rodrigo Fuenzalida | Google Fonts |
| Spectral | Production Type | Google Fonts |
| Fraunces | Undercase Type — Phaedra Charles, Flavia Zimbardi | Google Fonts |
| Newsreader | Production Type | Google Fonts |
| IBM Plex Sans, IBM Plex Mono | Mike Abbink, Bold Monday (IBM) | Google Fonts |
| Archivo | Omnibus-Type | Google Fonts |
| Merriweather | Sorkin Type / Eben Sorkin | Google Fonts |
| Public Sans | USWDS, after Libre Franklin | Google Fonts |
| Besley | Indestructible Type / Owen Earl | Google Fonts |
| Vollkorn | Friedrich Althausen | Google Fonts |
| Overpass, Overpass Mono | Delve Withrington, Dave Bailey, Thomas Jockin (Red Hat) | Google Fonts |
| Karrik | Jean-Baptiste Morizot, Lucas Le Bihan (Velvetyne) | `licenses/karrik-OFL.txt` |
| Bagnard | Sébastien Sanfilippo (Love Letters) | `licenses/bagnard-OFL.txt` |
| Avara | Raphaël Bastide (Velvetyne) | `licenses/avara-OFL.txt` |
| Fragment Mono | Wei Huang | `licenses/fragment-mono-OFL.txt` |

## How a face was prepared

- **From Google Fonts.** Each file is the `latin` slice Google itself serves —
  fetched from the `fonts.googleapis.com/css2` stylesheet with a modern
  browser user agent, and taken from the block whose `unicode-range` is the
  Latin one. No re-subsetting was needed.
- **Weight range.** A variable face has its `wght` axis clipped to 400–700 with
  `fonttools varLib.instancer`, so the emitted `font-weight: 400 700` is the
  truth and the file carries no weights the system can reach. Any second axis
  (optical size, width) is instanced to one value: Archivo is pinned to
  `wdth=75`, the condensed cut the map-label option asks for.
- **Static families.** Where the family has no `wght` axis, each weight the
  system uses ships as its own file, and `@font-face` declares that exact
  weight. Merriweather ships as two statics rather than one variable: its
  variable Latin subset is 94 KB, over the 60 KB bar, and two 47 KB statics
  clear it.
- **Not on Google Fonts.** Karrik, Bagnard, Avara, and Fragment Mono were
  subset from the foundry's own `woff2` with
  `pyftsubset --flavor=woff2 --layout-features='*' --no-hinting --desubroutinize`
  over the standard Latin unicode range.

## Adding a face

Adding a font set is a deliberate, reviewable pull request:

1. Add the `woff2` here, Latin-subset and under 60 KB.
2. Add the row above, with the designer, the licence, and how it was prepared.
3. Add the set id to `FONT_SETS` in `scripts/lib/theme.cjs` — family, stack,
   and the faces to emit — and to `FONT_SETS` in
   `apps/web/src/lib/themeRuntime.js`. `THEME_FONT_SET_IDS` in
   `packages/shared/src/theme.cjs` is the allowlist the server validates
   against; `themeRuntime.parity.test.js` fails if the three drift.
4. Point a preset's type map or one of its heading options at the set id.
