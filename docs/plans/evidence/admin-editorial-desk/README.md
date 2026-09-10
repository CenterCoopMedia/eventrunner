# Evidence — the admin editorial desk

Rendered proof for the review of `docs/plans/2026-09-10-admin-editorial-desk.md`. Every capture
was taken from a real build of this branch: the Vite dev server against the Firebase emulators,
seeded with the e2e event and the synthetic demo fixture (`e2e/global-setup.mjs`'s two scripts),
signed in as the seeded admin through the emailed-code flow. Nothing is a mockup and every name on
screen is fictional.

27 PNGs, 2.6 MB, at a device pixel ratio of 1. Not everything here is a picture: a control's height
and a type step are numbers, so they are recorded in `measurements.txt` and quoted below.

The unprefixed captures show the default: the admin follows the seeded event's own main brand
colour, the Institutional style's blue, so the rail and the action colour are that blue worked to
their bars. The `brand-oxblood--` and `scheme-forest--` captures are the same routes with the
document changed, and are described under "The event's own colours" below.

## The shell

| File | What to look at |
|---|---|
| `pages--{light,dark}--1440.png` | The frame: the dark rail down the leading edge with the job mark on its paper tile, the four docket groups under small uppercase folios, the current item filled in the action blue with its leading-edge marker, and the account foot. The white title band with the mark beside the name, the count in the data face, and the one filled action. Rows in the galley: the record's name in bold, its state and its standing facts as badges, its path and section count in the data face, and a quiet link at the trailing end. |
| `pages--light--390.png` | The rail as the head of the page: the same groups as wrapping rows of words, the account line, then the band and the list inside the first screen. |

**Both modes are authored, not inverted.** Compare any `--light--` with its `--dark--` twin: the
night canvas, the lifted panel, the rail a step below the canvas, the brightened action blue and
the lifted state inks are each their own values, and every pair in
`apps/web/src/lib/themeModes.test.js` clears its bar in both.

## The editor

| File | What to look at |
|---|---|
| `pages-home--{light,dark}--1440.png` | The title band carries the page's name, its state badge, its id, and its two save actions, and it holds the top of the viewport while the form scrolls. Under it, white panels on the canvas with a bold heading and a secondary-ink description each, 44px fields inside the control rule, and the checkbox in the action blue. |
| `pages-home--light--390.png` | The band wraps: the name and the badge, then the three actions, then the id. Fields run full width. |
| `branding--{light,dark}--1440.png` | The split view: the controls bench in panels on one side, the page preview inside a control-rule frame on the other, the preview's own controls as one filled choice per row, and a caution notice on the proof ground. The client's page stays contained in its frame in both modes. |
| `branding--light--390.png` | The bench and the preview stack; the band's two actions wrap under the name. |

## The galleys

| File | What to look at |
|---|---|
| `sessions--{light,dark}--1440.png` | One flush panel per day with the day as its heading; child sessions indented under their parent; the time, track and place in the data face; the state badge at the trailing end. |
| `sessions--light--390.png` | The same rows at phone width. A badge wraps under the row when the title needs the whole line. |
| `speakers--{light,dark}--1440.png` | Two badge axes on one row — the record's state and the invitation pipeline — beside the name, the credit line and the slug in the data face, and `Edit` as a link-coloured word. |
| `attendees--light--1440.png` | A search field and a status filter at control height above the list; a `Pending` badge in the neutral tone; a secondary `Approve` button in the row. |
| `media--light--1440.png` | The two drawers, a search field beside the one filled action, and the dashed empty state on the raised ground. |
| `ticketing--light--1440.png` | Panels for the provider status, the CSV import and the ticket search; a native file input inside a 44px field; the empty state. |
| `settings--light--1440.png` | A long form: the save action in the band, panels with their own secondary actions in the panel head, and a destructive control on the alarm ground at normal size. |
| `feedback--light--1440.png` | A filter in the title band with its label beside the control, so the band stays one line tall. |

## The event's own colours

| File | What to look at |
|---|---|
| `brand-oxblood--pages--{light,dark}--1440.png` | The document's main brand colour set to a deep oxblood and nothing else changed. The rail, the current item, the filled action, the link ink and the mark beside the title all take it. In light the button is the client's value exactly, because it already holds white text; in dark the action is the same hue lifted until dark ink holds on it, and the rail sits a step below the charcoal canvas. The state badges keep their own green and grey. |
| `brand-oxblood--branding--{light,dark}--1440.png` | The same on the split view: the bench's filled choices and the preview's own controls take the colour, and the client's page inside the frame is unchanged. |
| `scheme-forest--pages--{light,dark}--1440.png` | The document names the forest house scheme with the brand colour back on the style's blue. The rail and the action are the house green; the mark beside the title stays the client's blue, because that one slot is the client's and a house scheme is the tool's. |
| `scheme-forest--pages-home--{light,dark}--1440.png` | The editor under the forest scheme: the primary save action, the checkbox and the focus ring take the green, and every field, panel, badge and rule keeps its fixed value. |

**Nothing in these eight captures reached the public site.** The scheme rewrites the `admin-*`
action and rail tokens on the root; the page inside the preview frame resolves none of them.

## Measured rather than pictured

From `measurements.txt`, on `/admin/pages/home` in light mode. The same numbers at both widths
are the point: density comes from the gutters, never from the targets.

| Measurement | 1440px | 390px |
|---|---|---|
| Text field height | 44.00px | 44.00px |
| Primary button height | 44.00px | 44.00px |
| Secondary button height | 44.00px | 44.00px |
| Title (`h1`) | 31.68px | 26px |
| Field label | 15px | 15px |
| Description text | 14px | 14px |
| State badge text | 13px | 13px |
| Rail width | 232px (14.5rem) | 390px (the full head) |

The current rail item measures 38.5px at 1440 and 29px at 390 under a mouse; on a coarse pointer
the `admin-target` floor lifts it to 44px, as it lifts every quiet in-row link.

## How to rebuild this

The captures came from a Playwright script against the dev server and the emulators (sign in
through the emailed code, clear the emulator's auth rate bucket first, set `data-mode` on the
root, screenshot each route). The colour captures wrote `brandColor` and `adminScheme` on the
emulator's `config/theme` document through firebase-admin between runs and removed both at the
end. It is not committed: it is one-off review evidence, not a gate. The gates that hold the
behaviour are `apps/web/src/lib/themeModes.test.js` (every admin token pair in both modes),
`packages/shared/src/theme.test.cjs` (every derived scheme's 23 pairs, for every style, eight
hostile brand colours and every house scheme, in both modes),
`apps/web/src/admin/adminIdiom.test.js` (admin tokens only, one accent slot),
`apps/web/src/admin/AdminLayout.test.jsx` (the rail's four signals), and
`apps/web/src/admin/components/formControls.test.jsx` (the control height and the field boundary).
