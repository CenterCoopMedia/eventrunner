# Badger brand files

Badger is the name badge in `console/web/src/WaitingBuddy.jsx`. These SVGs
redraw the selected concepts with geometric shapes and paths. The concept
PNGs are references; no final asset contains their pixels.

Console page titles use `console/web/src/PageHeading.jsx`: a semantic `h1`
with a still Badger beside wrapping title text, inside the page flow. The
decorative drawing is hidden from assistive technology and fits a 48px box,
or 36px on phones. Heading ids, focus targets and adjacent actions belong to
their existing routes. Loading and build feedback use `WaitingBuddy` separately,
with their existing motion preferences. The masthead keeps the running mark.

| File | Use and source |
| --- | --- |
| `badger-mark.svg` | Running mark for dark ground, from `concepts/logo-d.png`. Includes the V lanyard, clip, band, face, raised arm, two legs, and two speed bars. |
| `badger-mark-light.svg` | The same drawing for light ground. |
| `badger-lockup.svg` | Running mark and stacked Event Runner wordmark for dark ground. |
| `badger-lockup-light.svg` | The same lockup for light ground. |
| `badger-face.svg` | Face-only icon source. The outline and eyes are sized to read at 16px. No limbs, lanyard, speed bars, or confetti. |
| `og-console.svg` | Console share card, 1200 by 630. |
| `og-default.svg` | Documentation share card, 1200 by 630. |
| `social-preview.svg` | Homepage share card, 1200 by 630. |
| `concepts/` | All original concept references, kept with the final artwork. `00-badger-reference.png` shows the existing console character. |

The lockups embed the existing `docs/fonts/source-sans-3-latin.woff2` font at
weight 700, as used by the console masthead. The wordmark is text, not outlines.
The card sources reference that font; the renderer embeds its bytes before
Chrome reads the SVG.

The dark mark uses ink `rgb(238 238 236)` and accent `rgb(128 178 238)`.
The light mark uses ink `rgb(23 24 26)` and accent `rgb(26 82 150)`.
The inline masthead marks use each page's CSS color tokens. Their rendered
boxes retain their previous sizes.

All three cards use the dark panels in `concepts/og-a.png`: Stacked wordmark
on the left, running Badger on the right, faint interface panels, accent
bars, and a soft shadow. Each card keeps its original sentence and footer.
The shared template and those text values are in the render script.

From the repository root in a local terminal outside the agent sandbox, run:

```sh
node scripts/dev/build-social-cards.mjs
node scripts/dev/build-social-cards.mjs --check
```

The script writes the three card SVGs and their PNGs, both adaptive favicon
SVGs, the console and docs 32px favicons and 180px Apple icons, and the console
192px and 512px app icons. All icon drawings come from `badger-face.svg`.
Apple and app icons have an opaque accent ground. The face fits inside the
central 80% safe circle for maskable icons.

The renderer uses system Chrome headless. Set `CHROME` to its executable if
needed. Otherwise it tries the macOS Google Chrome path, then `google-chrome`
and `chromium` on `PATH`. No browser package or new dependency is required.
`--check` renders in a temporary directory, compares bytes, and does not write
repository files. A missing or stale file fails the check.

After a masthead or template change, run `node scripts/build-pages.cjs` to
regenerate `docs/docs/`. The agreement PDF uses matching face paths in its
existing 24-unit tile. Event-specific placeholders under `apps/web` are separate.
