# Evidence — PR #122

Rendered proof for the review of #122. Everything here was captured from the committed output in this branch: `docs/` served at `/eventrunner/` for the Pages surface, and `docs/demo/` for the print previews. Nothing is a mockup.

24 PNGs, 0.9 MB. They are quantized to a 256-colour palette, which is lossless enough for a flat, ruled design and keeps the set inside its budget. Measured values are in `measurements.txt` and quoted below.

## The Pages surface

Three pages — the landing page, the longest documentation page, and the page with the widest tables — in both modes at three widths. Full page, capped at 3600px where a page is longer than that.

| File | What to look at |
|---|---|
| `landing--{light,dark}--{320,390,1440}.png` | The mark in the masthead. Three major boundaries on the strong rule (Open the demo, For operators, Project status), three secondary ones on the heading and its hairline. One hairline over the feature row at 1440; hairlines between the entries once it stacks. |
| `long-page-deploy-runbook--{light,dark}--{320,390,1440}.png` | A subsection heading now takes no rule. This is the page where a rule per `h3` was loudest. It is also the page whose `AUTO_DEPLOY_ENVIRONMENTS` heading used to scroll the whole document sideways at 320px — see below. |
| `wide-table-interface-guidelines--{light,dark}--{320,390,1440}.png` | Column heads at the raised folio floor. The table scrolls inside its own column; the page does not. |

**Both modes are authored, not inverted.** Compare any `--light--` with its `--dark--` twin: the dark palette has its own ground, its own ink, and its own accent, all lifted to clear their bar on a dark ground.

## 200% zoom

| File | |
|---|---|
| `zoom-200--landing--{light,dark}.png` | |
| `zoom-200--wide-table-interface-guidelines--{light,dark}.png` | |

200% browser zoom on a 1440px screen means a 720px CSS viewport at double device pixels, which is what these are. The layout is single-column, the documentation navigation has moved below the article, the contents list is one column, and nothing is clipped or overlapped.

## No page scrolls sideways

Every capture above was taken after scrolling the window as far right as it would go and recording where it landed. Every one recorded 0. Before this branch, `long-page-deploy-runbook` at 320px scrolled 94px and at 390px scrolled 25px: `4. AUTO_DEPLOY_ENVIRONMENTS (push auto-deploy)` is one word a browser has nowhere to break, and it dragged every paragraph on the page with it.

## The print fix

Two dark-screen print previews of the demo schedule, and one measurement with no picture.

**`print--dark-screen--base-theme.png`** — a deployment running what it shipped with, printing from a dark screen. It gets the light edition. The generated stylesheet's print block does this on its own, and it always did.

- on the dark screen: surface `23 25 30`, ink `232 235 240`
- what printed: surface `246 247 249`, ink `22 24 29`

**`print--dark-screen--customized-theme.png`** — the same page after a live publish: a different site style and a client brand colour, arriving over the build-time values the way `config/theme` actually arrives. It prints the light edition **of the theme the site is wearing now**.

- on the dark screen: surface `18 22 27`, ink `238 242 246`
- what printed: surface `251 247 239`, ink `20 24 31`

`251 247 239` is the live light ground. The warm sheet and the Zine headings in the image are the live look, from a dark screen.

**The counterfactual, measured rather than asserted.** The same page, the same live theme, with the runtime print block cut back out — which is exactly what shipped before this branch:

- what printed: surface `246 247 249`, ink `22 24 29`

That is the build-time palette. The client restyled their site, printed a hundred programmes from a dark screen, and got the palette the deployment shipped with — and only from a dark screen, because the generated print selectors lead with `html` and outranked the runtime element's dark block. A light screen printed the live palette correctly, which is what made it hard to see.

## How to rebuild this

The captures came from a Playwright script against a static server over `docs/`. It is not committed: it is one-off review evidence, not a gate. The gates that hold the behaviour are in `apps/web/src/lib/themeRuntime.test.js`, `apps/web/src/lib/themeRuntime.parity.test.js`, `scripts/lib/tokens.test.cjs`, and `scripts/build-pages.test.cjs`.
