# Admin CMS — the editorial desk

**Date:** 2026-09-10
**Status:** Settled. This amends `docs/plans/2026-08-27-admin-identity-story.md` (the composing
room) and brief §5.2. Where this document and the story disagree, this document wins; where the
brief's §0 calibration and this document disagree, this document wins for the admin surface.
**Binding source:** `docs/plans/2026-08-27-design-system-overhaul.md`. Its §2.4 anti-pattern list
and its §8 accessibility bar still apply to every sentence below.
**Reference:** the NJ PBS newsroom CMS admin (`jamditis/njpbs-site`, `admin/`), whose editorial
desk direction the owner asked this surface to take: its style, its type pairing, and its
hierarchy. What is ported is the language, not the brand; nothing in this document names a client.

## What the owner asked for

The composing room set every admin surface on one warm grey, at eleven to fourteen pixels, with
24px controls, a black filled button, and a navigation that shared its ground with the work. It was
coherent and it was flat: a reviewer could not tell the frame from the page, a state from a
caption, or the one action that mattered from the six beside it.

The NJ PBS admin answers each of those with one device. A dark rail anchors the tool against a
light canvas. A white title band names the page and holds its actions. White panels sit on the
canvas. One action blue carries every primary control, link and focus ring. A state is a word on a
tinted ground. Controls are 44px tall and the UI reads at 15px. This document ports that hierarchy
into Event Runner's own token system.

## The desk

You are still in the room where the paper gets made, and the room has been fitted out.

- **The rail** — the navigation, on its own deep ground down the leading edge, navy by default
  and the event's own colour worked dark where a deployment follows it (below). The event's
  short name and the job mark sit at its head; the docket's four groups stand below them, group
  heads as small uppercase folios; the signed-in address and the two ways out sit at its foot. On a
  wide screen the rail holds the viewport and scrolls on its own; on a narrow one it stacks above
  the work.
- **The canvas** — the base ground behind everything: a calm cool grey, never white.
- **The title band** — the page header. The page's name at title size on the white ground, a
  small mark in the client's colour beside it, the record's state badge and identifiers beside or
  under the name, and the page's own actions at the trailing end. The band runs to the edges of
  the work surface and holds the top of the viewport while the page scrolls, so the name and the
  save actions are always in reach. The page's description is a paragraph under the band, not
  inside it.
- **The panel** — a white surface on the canvas inside a hairline rule with the panel radius. A
  panel's heading is bold at the large step with its description under it in the secondary ink.
  Elevation is the step from the canvas to the paper; no shadow ships.
- **The galley** — a list. Hairline rows inside a flush panel: the record's name in bold, its
  state badge and its standing facts beside the name, its identifiers under it in the data face,
  and the row's quiet actions at the trailing end as link-coloured words. No zebra striping, no row
  cards.
- **The badge** — a word on a tinted ground, the smallest radius in the room, never a pill. Seven
  tones and every one pairs with its word: ok, draft, caution, error, info, neutral, dead.
- **The control** — a field or a button is 2.75rem tall on every pointer, at the base type step,
  with one radius. The primary button is filled in the action blue. The secondary is white inside
  a strong rule and lifts to the soft action ground under the pointer. The destructive control
  sits on the alarm ground in the alarm ink and fills only under the pointer. Density comes from
  the gutters, never from the targets.
- **The two faces** — Source Sans 3 carries everything a person reads, across its 400 to 700
  weights; IBM Plex Mono with tabular figures carries everything the machine owns. The pairing is
  unchanged; what changed is the scale it is set on and the weight it is allowed.
- **Dark mode** — the night desk. The canvas goes to charcoal, the panels lift a step, the rail
  drops a step below the canvas so it still reads as the frame, the action blue brightens to clear
  its bar, and every state ink lifts. Authored value by value, never the day inverted.

## The token contract

`design/tokens/admin.json` is the source. `scripts/build-preset-catalog.cjs` mirrors it into
`packages/shared`, `scripts/generate-content.cjs` emits it into `theme.css`, and
`apps/web/tailwind.config.js` maps every token below to a utility. Every colour resolves under both
modes; `apps/web/src/lib/themeModes.test.js` measures the pairs.

| Family | Tokens | What changed |
|---|---|---|
| Grounds | `ground`, `ground-raised`, `ground-soft`, `ground-proof`, `ground-input`, `ground-alarm`, `ground-ok`, `ground-info` | The canvas is cool grey and the raised ground is white. Three grounds are new: `soft` for a table head or a nested group, `ok` and `info` for the badges and notices that needed them. |
| Inks | `ink`, `ink-secondary`, `ink-data`, `ink-inverse`, `ink-disabled`, `ink-link` | Navy near-black in the day, bone at night. The link ink is the action blue's text form. |
| Rules | `rule-hairline`, `rule-strong`, `rule-control`, `rule-header`, `rule-alarm` | `rule-control` is new: a form control's boundary, clearing 3:1. The strong rule clears 3:1 too, because it bounds a secondary button. |
| States | `state-live`, `state-draft`, `state-error`, `state-caution`, `state-ok`, `state-info` | `state-info` is new. Every state ink pairs with a ground and a word. |
| Action | `action`, `action-hover`, `action-pressed`, `action-soft`, `action-soft-hover` | New. Authored navy; at runtime the family follows the main brand colour, worked safe, or a house scheme (below). Never the raw client accent. |
| Focus | `focus-ring`, `focus-ring-rail` | The ring is the action blue at 3px; the rail has its own light ring. |
| Rail | `rail-ground`, `rail-ground-raised`, `rail-ground-hover`, `rail-current`, `rail-ink`, `rail-ink-muted`, `rail-rule` | New. The navigation's dark ground and the inks that read on it. The grounds and the rule follow the scheme; the two inks are fixed. |
| Client | `client-accent`, `client-accent-ink`, `page-header-mark` | One slot (below). |
| Scale | `text-xs` … `text-title`, `leading-*`, `tracking-*`, `control-height`, `radius`, `radius-panel`, `radius-small`, `rail-width`, `canvas-max` | The admin's own six-step type scale, the control height, and three radii. |

**One client-accent slot.** The composing room gave the client accent two places: the marker
beside the current docket item and the mark on the page-header rule. On a dark rail an arbitrary
client colour has no legibility guarantee, so the current item's marker is now the rail's own ink
— a structural signal that belongs to the tool — and the client accent appears in exactly one
place: the mark beside the page title. `--admin-nav-active-marker` still exists as a component
token; it resolves to `--admin-rail-ink` and is read in the shell alone. The legibility floor is
unchanged in kind and moved in place: `resolveAdminAccent` measures the resolved brand colour
against `--admin-ground-raised`, the band the mark sits on, and falls back to `--admin-ink` when it
fails 3:1. `apps/web/src/admin/adminIdiom.test.js` pins the single slot.

**The job mark on a tile.** A client's mark is drawn for a light ground and the rail is dark, so
the mark sits on a small white tile at the head of the rail. The tile is the one light thing on
the rail and it belongs to the client. It is a tint on the raised ground, never a shadow.

## The event's own colours

The desk was first drawn in one navy: the rail and the action family were fixed and the client's
colour appeared in its one slot. The owner then asked whether a deployment could have something
other than blue and white. The answer keeps the one-slot rule for the raw client colour and lets
the action family and the rail take the event's colour, worked safe by construction.

- **By default the admin follows the main brand colour.** `resolveAdminScheme` in
  `packages/shared/src/theme.cjs` seeds from the resolved primary for the mode, and
  `deriveAdminScheme` works that seed into the twelve tokens of the family: the action colour, its
  hover and pressed steps, the two soft grounds, the link ink, the focus ring, the rail ground with
  its raised and hover steps, the rail rule, and the current-item fill. Each step moves only as far
  as its bar requires (`stepToContrast`), so a colour that already holds white text is used on the
  button exactly as given, and one that cannot — white, yellow, the canvas grey — is stepped until
  it does. The rail ground is the seed mixed down toward black and pushed further until the muted
  rail ink holds 4.5:1 on the hover ground; in dark mode it is also held below the canvas so the
  frame stays the frame. The generator overlays the same derivation onto the demo's `theme.css`
  (`scripts/lib/tokens.cjs`), and the runtime writes it for a live document
  (`apps/web/src/lib/themeRuntime.js`).
- **A house scheme replaces it.** `config/theme.adminScheme` names one of six pairs authored in
  `design/tokens/admin.json`: navy (the authored default), graphite, forest, oxblood, teal and
  plum, each with a light and a dark seed. The Branding tab offers them under **Admin colours**,
  after **Light or dark**, with **Follow the main brand colour** first. The default is never
  written, so every existing document keeps following its brand colour, and the schema accepts
  only the known ids.
- **The public site never sees it.** The scheme rewrites `admin-*` tokens only, they stay
  root-only, and the page-preview frame does not resolve them.
- **Every derived family is measured.** `theme.test.cjs` runs the derivation for every style, for
  eight hostile brand colours and for every house scheme, in both modes, and asserts 23 pairs on
  each plus the rail sitting below the canvas. `tokens.test.cjs` and `themeRuntime.test.js` pin
  the overlay at build time and at runtime.

## What stays refused

Everything in brief §2.4, and from the composing room's own list: the icon rail, counts in
bubbles, KPI tiles and dashboard theatre, status colour without a word, pulse dots, pills, the
client's theme on any admin surface, expressive motion, disappearing confirmation, eyebrows, and
the tan canvas. A badge is not a pill: it carries a word, takes the small radius, and never
appears without its word. A dark rail is not an icon rail: every item is still a word.

## What moved from the composing room

| Composing room | Desk |
|---|---|
| One warm grey ground for rail and work | A dark rail against a cool-grey canvas with white panels |
| The job line: a heavy rule under a small title | The title band: title size on white, sticky, with the page's actions |
| Type at the editorial caption and folio steps | The admin's own scale, 13 to 32px, base 15px |
| 24px controls, uniform tiny buttons, black primary | 2.75rem controls, one action blue, secondary and destructive as quiet forms |
| A state as a word in mono ink | A state as a word in a tinted badge |
| Two client-accent slots, floor against the canvas | One slot, floor against the title band |
| One fixed navy for the rail and the action | The main brand colour worked safe, or a house scheme |
| One 2px radius | 6px controls, 10px panels, 4px badges |
| Editor save actions at the foot of the form | Save draft and Save and publish in the title band |

## Verification

Recorded on the branch tip; the captures and the numbers are in
`docs/plans/evidence/admin-editorial-desk/README.md`.

- `npm run lint`, `npm run check:copy`, `npm test`, `npm run test:web`, the generated-content
  hygiene check, the preset-catalog freshness check, the web build with its bundle budget, the
  demo build, and the documentation checks all pass.
- Every admin token pair in `themeModes.test.js` clears its bar in both modes, including the rail,
  action, control-rule, and badge pairs this amendment adds.
- Every derived admin colour scheme clears the same bars in both modes: `theme.test.cjs` measures
  23 pairs for every style, eight hostile brand colours and every house scheme.
- Measured on `/admin/pages/home` at 1440px and at 390px: a text field, a primary button and a
  secondary button are each 44.00px tall at both widths; the title is 31.68px and 26px; a field
  label is 15px; a description is 14px; a badge's word is 13px.
- The captures were taken from the emulators with the seeded e2e event, signed in through the
  emailed-code flow: the pages list, the page editor, sessions, speakers and branding in both modes
  at 1440px; attendees, media, ticketing, event settings and feedback in light at 1440px; the
  pages list, the page editor, sessions and branding at 390px. They show the default: the admin
  following the seeded event's blue.
- Eight more captures show the event's own colours reaching the admin: the pages list and the
  branding tab with the main brand colour set to a deep oxblood, and the pages list and the page
  editor under the forest house scheme, each in both modes at 1440px.

## Rollout and rollback

No data changes. The admin reads the same documents it read before; only its presentation and
its token set change. Rollback is a revert of the branch: the token JSON, the generated mirrors,
the stylesheet, the chrome, and the pages travel together and must be reverted together, because
a page that names a utility the config no longer maps renders unstyled.
