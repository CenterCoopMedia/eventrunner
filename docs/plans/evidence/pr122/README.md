# Evidence — PR #122

Rendered proof for the review of #122. Everything here was captured from the committed output in this branch: `docs/` served at `/eventrunner/` for the Pages surface, and `docs/demo/` for the print previews. Nothing is a mockup.

24 PNGs, 0.9 MB. They are quantized to a 256-colour palette, which is lossless enough for a flat, ruled design and keeps the set inside its budget. Not everything here is a picture: a print palette and a touch target are both things a screenshot cannot show, so they are recorded as numbers instead. Those are in `measurements.txt` and quoted below, as are the sideways-scroll numbers.

## The Pages surface

Three pages — the landing page, the longest documentation page, and the page with the widest tables — in both modes at three widths.

These are the top of each page: a 900px-tall viewport, which is where a reader lands and where the masthead, the first boundary, and the start of the article are. The two exceptions are `landing--{light,dark}--1440.png`, which are the whole page at 3082px because the landing page is short enough to hold in one image. The other pages are not close — the deploy runbook is 19,140px at 1440 and 32,364px at 320 — so a full-page capture of them would be an unreadable ribbon rather than evidence.

| File | What to look at |
|---|---|
| `landing--{light,dark}--{320,390,1440}.png` | The mark in the masthead. Three major boundaries on the strong rule (Open the demo, For operators, Project status), three secondary ones on the heading and its hairline. One hairline over the feature row at 1440; hairlines between the entries once it stacks. |
| `long-page-deploy-runbook--{light,dark}--{320,390,1440}.png` | A subsection heading now takes no rule. This is the page where a rule per `h3` was loudest. It is also the page whose `AUTO_DEPLOY_ENVIRONMENTS` heading used to scroll the whole document sideways at 320px — see below. |
| `wide-table-interface-guidelines--{light,dark}--{320,390,1440}.png` | Column heads at the raised folio floor. The table scrolls inside its own column; the page does not. |

**Both modes are authored, not inverted.** Compare any `--light--` with its `--dark--` twin: the dark palette has its own ground, its own ink, and its own accent, all lifted to clear their bar on a dark ground.

## 200% zoom

| File | What to look at |
|---|---|
| `zoom-200--landing--{light,dark}.png` | The masthead keeps the mark, the name, and the whole nav on one line, and the hero has dropped to a single column. |
| `zoom-200--wide-table-interface-guidelines--{light,dark}.png` | The breadcrumbs, the h1, and the contents list, which is one column at this width rather than two. |

200% browser zoom on a 1440px screen means a 720px CSS viewport at double device pixels, which is what these are. Like the captures above they are the top of the page, which at 200% is most of what a reader has and is where the layout either holds or does not. It holds — single column, nothing clipped, nothing overlapped, and no sideways scroll (see below).

## No page scrolls sideways

Every capture above was taken after scrolling the window as far right as it would go and recording where it landed. Every one recorded 0. Before this branch, `long-page-deploy-runbook` at 320px scrolled 94px and at 390px scrolled 25px: `4. AUTO_DEPLOY_ENVIRONMENTS (push auto-deploy)` is one word a browser has nowhere to break, and it dragged every paragraph on the page with it.

## The docket's touch target

Measured rather than pictured, because a hit area is transparent and a screenshot cannot show one. Every number is the bounding box of an entry in the section navigation on `/docs/deploy-runbook/`, and it is the same on every documentation page — the docket does not vary by page.

| Pointer | 1440px | 1024px | 390px | 320px |
|---|---|---|---|---|
| Mouse, before and after | 28.22px | 27.69px | 26.84px | 26.84px |
| Finger, before | 28.22px | 27.69px | 26.84px | 26.84px |
| Finger, after | 44.22px | 44.00px | 44.00px | 44.00px |

The 44px bar is the one the interface guidelines set under Accessibility. A mouse keeps the dense docket: identical numbers before and after, entries still flush against each other with 0px between them, so there is no dead space to miss. Widths were never the problem — an entry is 239px wide at 1440 and 279px at 320.

Nothing else moved. The article column starts at x=480 and is 784px wide at 1440, with a finger or with a mouse, before and after; no page gained a sideways scroll at any of 320, 390, 768, 1024, or 1440.

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

### And the documentation site, which had the same bug

The principle is "paper has no dark mode", and this site is held to it too. It carried no print rules at all, so it failed the same way the demo did, only worse: nothing switched, so a dark screen printed the dark ground and near-white ink.

`/docs/admin-guide/`, from a dark screen:

- before: surface `23 25 30`, ink `232 235 240` — the screen palette, straight onto the sheet
- after: surface `246 247 249`, ink `22 24 29` — the same values a light screen prints

No picture, for the same reason as the counterfactual above: the numbers are the claim. The gate is `printing a page from a dark screen gets the light edition` in `scripts/build-pages.test.cjs`.

## How to rebuild this

The captures came from a Playwright script against a static server over `docs/`. It is not committed: it is one-off review evidence, not a gate. The gates that hold the behaviour are in `apps/web/src/lib/themeRuntime.test.js`, `apps/web/src/lib/themeRuntime.parity.test.js`, `scripts/lib/tokens.test.cjs`, and `scripts/build-pages.test.cjs`.
