# Design system overhaul — binding brief

**Date:** 2026-08-27
**Status:** Binding. This document is the design contract. Later pull requests build against it.
**Owner:** Design lead.
**Builds on:** `docs/adr/0001-event-platform-v1.md` §7 (Theming), `docs/interface-guidelines.md`,
`docs/plans/2026-08-16-event-platform-v1-triage.md`, and the anti-pattern work in issues
[#105](https://github.com/CenterCoopMedia/eventrunner/issues/105),
[#109](https://github.com/CenterCoopMedia/eventrunner/issues/109), and
[#113](https://github.com/CenterCoopMedia/eventrunner/issues/113), and in pull request
[#112](https://github.com/CenterCoopMedia/eventrunner/pull/112).
**Surfaces:** the public event site, the admin CMS, and the documentation/marketing site.

## How to read this document

Every sentence in this document is a rule, a fact, or a named decision. Treat a sentence with
"must" as a merge requirement. Treat a sentence with "may" as a permitted option. Treat a sentence
with "never" as a rejection rule that a reviewer applies without discussion.

This document uses plain language on purpose. Write all product copy, all documentation, and all
future briefs the same way. Use short sentences. Use active voice. Give one instruction per
sentence. Use common words.

This brief changes design, not architecture. It extends the theming chain in ADR §7. It does not
replace it. It does not change the deploy model, the data model, or the provider abstractions.

---

## 0. Owner review and calibration (2026-08-27)

The owner reviewed the PR2 work and then calibrated that review. Both bind. Where this section and
the rest of this brief disagree, this section wins; where the calibration and the review disagree,
the calibration wins. Everything the brief says that is not named here still stands.

**All six site styles ship first-class.** Each one is complete, coherent, accessible, responsive,
and visibly distinct. There is no stability tier, no experimental group, and no warning label.
`packages/shared/src/presetCatalog.cjs` carries them in picker order, and order is the only ranking
the system has. Institutional leads it because a fresh deployment starts there — an onboarding
decision, not a verdict on the other five. §4 stands otherwise.

**Every style ships one recommended configuration.** The option defaults in a style's file are that
configuration, and picking the style hands an operator a document that is publishable as it stands.
`recommendedConfiguration` builds it and `theme.test.cjs` measures all six against the §8.1 bar in
both modes.

**Progressive disclosure replaces breadth at first contact.** The normal workflow is six decisions
in order: Site style, logo and icon, main brand colour, header style, schedule style, and light or
dark. Typography, Illustrations, density, texture, corners, the remaining component variants, and
the expert colour controls live behind one Advanced disclosure. Nothing is removed to get there.
This supersedes the "two depths" wording in §5.2 — the second depth is now the whole of Advanced,
not raw tokens alone.

**Do not homogenize the styles.** Zine is still handmade, Field Guide is still observational, Atlas
is still cartographic, Broadsheet is still authoritative. A default may be refined. A style's
expressive treatments stay fully developed and selectable, and a retune that costs a style its
conviction is a regression. `theme.test.cjs` pins one signature per style.

**Supporting colours are derived from one brand colour.** `config/theme.brandColor` is the client's
main colour; `primary`, `primaryDark`, and `primaryLight` are derived from it per mode and are
contrast-safe by construction (§8.1 still applies, and the derivation cannot produce a failing
pair). The accent and the five semantic roles stay the style's own. The expert per-token overrides
of §5.2 are retained under Advanced with live contrast checks, warnings, and a reset path back to
the derived values.

**There is no separate admin marker colour.** `config/theme.adminAccent` is removed. The admin's two
client-owned slots take the resolved brand colour, and the §5.2 legibility floor is unchanged.

**The preview stays a real-route preview, and it grows.** It renders the app's own routes and
components, never swatches (§5.2). It adds desktop and phone widths at true CSS width, zoom to fit,
long-title and dense-schedule stress fixtures, a light-and-dark comparison state, and warnings for
any colour or font that will not render as asked.

**The catalog is split by reader.** The runtime catalog carries rendering values only; the words
staff read live beside the editor that shows them; the design prose is generated documentation. The
staleness gate covers all three.

**The full 23-family font library stays**, with licensing, loading, fallback, and performance
verified in `scripts/lib/tokens.test.cjs`, and the curated recommended pairings surfaced in the
editor and in `design/tokens/presets/README.md`.

**UI names.** Preset is **Site style**. Motifs are **Illustrations**. The proof frame is the **Page
preview**. Raw token editing is **Advanced colour settings**. Nameplate treatment is **Header
style**. The per-style component variant — Schedule presentation, Session card, Session block,
Session presentation — is **Schedule style** everywhere.

---

## 1. Goal

Rebuild the Event Runner visual system from the foundation up.

The new system has six parts:

1. An **editorial base system**. Typography carries the design. Print devices give the structure.
2. **Six theme presets**. Each preset is a complete, designed look, not a color swap.
3. **Full per-client token override**. A client picks a preset. A client may then override any
   token.
4. **Light and dark modes**. Every theme defines both. A client chooses light, dark, or
   follow-system.
5. **Layout variants**. A system page can change its shape without a code edit.
6. **Hybrid page composition**. A system page keeps its core feature component and gains
   composable sections around it.

The system must serve three surfaces. The public event site uses the preset the client picked. The
admin CMS uses one fixed Event Runner identity. The documentation site uses the same design
language as the product.

The result must read as crafted, subtle, and fresh. It must never read as an AI template. A
reviewer who cannot tell the difference should apply §2.4 as the test.

**Why this work is worth doing.** The admin CMS is the product (triage record, "Buyers"). A client
buys a site that their staff can run. A generic site is a weak sale. A site that looks like a
newsroom built it is a strong sale. The current surface leans on Tailwind defaults, one warm-paper
palette, and rounded cards. That look was rejected in #105 and #109. This brief replaces it.

---

## 2. Design principles

These principles bind every surface. A pull request that breaks one must change this document
first.

### 2.1 Editorial character

Real typographic hierarchy does the visual work. Size, weight, width, spacing, and rules carry the
structure. Color decorates very little. Shadow decorates nothing. §2.4 grants the Zine stamp one
narrow exception to the shadow rule. That exception is an ink layer, not depth, and it changes
nothing on any other preset.

Two rules from §2.4 bind this section directly:

- **The eyebrow ban is absolute.** No text sits directly above a heading. This holds for a folio in
  plain small-caps text. It holds at every size, on every surface, in every preset. A folio lives
  beside a rule at a section boundary, in a margin, or in a running header. Where a label must sit
  near a title, put it below the title or beside it. Two things are not eyebrows: Metadata inside
  the rule-bounded nameplate block, which is part of the nameplate device wherever it sits inside
  it; and a form `<label>` above its own input, which is a control label and must never be
  "corrected".
- **The Zine stamp is the only box behind a box.** See §2.4.

Use print devices with intent. Each device below has one job. Use a device where its job applies.
Never use a device as decoration.

| Device | What it is | Where to use it | The rule |
|---|---|---|---|
| **Masthead nameplate** | A rule-bounded title block. It holds the event name, the dates, and the edition line. | The header of a deployment whose theme names the `masthead` or `compact` treatment (§2.5.1). | Never a hero banner with a background image. Never a photo behind the name. The nameplate is type and rules only. Never mandatory: A theme chooses it. |
| **Lead image** | One picture beside the opening copy, or below it at narrow viewports. | The opening section of a page whose subject has a face, a place, or a room. | See §2.5.2. Text never sits over it. Alt text, a token-fixed crop, and a stated focal point are all required. One per page. |
| **Hairline rules** | Low-contrast 1px rules that separate content. | Section boundaries, table rows, folios, column gutters. | A rule replaces a card border. A rule never carries brand color. Rules use the `--rule-*` tokens only. |
| **Folios** | A small-caps plain-text label beside a rule. It states the section, the day, or the page role. | A section boundary, a schedule day head, an archive label, a margin, or a running header. | Never a chip. Never a pill. Never a colored badge. Text plus rule only. A folio never sits directly above a heading. See §2.4. |
| **Multi-column long form** | Two or three text columns at wide viewports. | Long prose pages: About, travel, code of conduct, policy pages. | Apply columns only above the `lg` breakpoint. Keep 60–75 characters per line (interface guidelines, Typography). Never column-split a list of controls. |
| **Drop cap** | A large first letter that spans two or three lines. | The first paragraph of a long-form page. | One drop cap per page at most. Never on a short intro. Never on a card. |
| **Stat and chart anatomy** | A fixed four-part contract for every data block. | Every stat block, every chart, every number the site presents as evidence. | See §2.1.1. The anatomy is enforced, not advisory, from PR3 on. |
| **Grid schedule** | A two-axis schedule. Time runs down the left. Tracks run across the top. | The schedule page at wide viewports. | The grid must degrade to a single time-ordered list at narrow viewports. The list is the accessible baseline, not a fallback of lower quality. |
| **Back issue** | An archival treatment for a past event or a past day. | Any content the event has moved past. | Reduce the palette to the archive tokens. Add the "Back issue" folio. Remove live controls. Never hide the content. |

#### 2.1.1 The stat and chart contract

Every stat block and every chart must carry four parts. A block that misses a part fails review.

1. **Takeaway title.** State the finding in words. "Two thirds of sessions are workshops" is a
   takeaway. "Session types" is not.
2. **Description.** Say what the number counts and over what period.
3. **Source line.** Name where the number came from. Name the date it was read.
4. **Alt text.** Describe the finding for a screen reader. Do not describe the shape of the chart.

A large number with a small caption under it is not a stat block. It fails this contract.

**When the contract lands.** The contract arrives in two phases. Do not read it as one gate.

- **PR1 restyles stat presentation.** PR1 gives stat blocks their editorial treatment and renders
  both shapes: A block that carries all four parts, and a legacy block that does not. A legacy stat
  block keeps rendering. PR1 never drops content because a part is missing.
- **PR3 enforces the contract.** The four-part schema, the editor fields, the seed migration, and
  the write-time enforcement land in PR3 beside the block-schema work. From PR3 on, a block that
  misses a part fails review and fails validation.

### 2.2 Motion

The system has exactly two motion classes. There is no third class.

**Functional motion.** Functional motion shows a state change. Use it for menus, filters, tabs,
disclosure, and toasts. Keep it between 120ms and 200ms. Animate `transform` and `opacity` only.
Use `ease-out`. Never use `transition: all` (interface guidelines, Animation).

**Expressive motion.** Expressive motion is a designed signature interaction. Allow one per
surface. The schedule grid is the chosen signature for the public site. A signature interaction
must start from a user action. It must finish in under 600ms. It must leave the page in a readable
state at every frame.

These rules bind both classes:

- Never trigger motion from scroll position. Scroll-triggered reveals are banned (#105).
- Never run ambient animation. Nothing loops, drifts, pulses, or breathes on its own.
- Wayfinding is instant. Navigation, route changes, and focus moves never animate.
- Support `prefers-reduced-motion` in full. The reduced state must be truly static. A shortened
  animation is not a reduced-motion fallback.
- Wrap every motion rule in `@media (prefers-reduced-motion: no-preference)` (interface
  guidelines, Accessibility).

**React Bits.** [React Bits](https://reactbits.dev) is an allowed source for a signature
interaction. It is not a source for general UI. Before you use a component from it, apply all six
checks:

1. The component passes every rule in this section.
2. You copy the source into the repo. You never load it from a CDN.
3. You replace every color literal with a token. The hex sweep must pass (ADR §7.6).
4. You add a static reduced-motion state.
5. You confirm the licence allows use and redistribution under Apache-2.0.
6. You add a keyboard path and a visible focus state.

### 2.3 Motifs and ornament

A motif set is a named group of small drawings. A preset may enable one set. A motif set gives a
preset its own visual vocabulary beyond type and color. See §3.8 for the tokens.

**Motif style is mixed per theme.** Each preset uses the illustration style that fits its
personality. There is no single house illustration style. Bind these pairings:

| Preset | Motif style |
|---|---|
| Broadsheet | Engraving and plate linework. |
| Field Guide | Engraving and botanical-plate linework. |
| Atlas | Precise survey linework. |
| Zine | Hand-drawn linework. |
| Newsroom modern | Restrained flat marks, only if the client enables a set. |
| Civic | Restrained flat marks, only if the client enables a set. |

These rules bind every motif:

- A motif supports content. A motif never replaces content.
- A motif inherits theme ink color. A motif never carries its own color. Render it one of two ways
  only: As a CSS `mask-image` with `background-color: var(--color-ink-motif)`, or as an inline SVG
  symbol that reads `currentColor`. Never render a motif as an external `<img>` and never as a CSS
  `url()` fill. Those two forms cannot inherit theme ink, so they break this rule by construction.
  See §3.8.
- A motif is decorative to a screen reader. Give it `aria-hidden="true"` and
  `pointer-events: none`.
- A motif that carries meaning is an icon, not a motif. Give an icon a label.
- Keep motif density low. Use at most three motifs on a page.

### 2.4 Anti-pattern guidance

This section is holistic guidance, not a checklist to game. The goal is a site that a designer
made. A reviewer may reject a pattern that this list does not name. A reviewer may accept a listed
pattern only where this document grants an exception.

Reject these patterns:

- **Eyebrow furniture.** The ban is absolute. Nothing sits directly above a heading. No eyebrow
  labels. No chips. No pills. No dash-style eyebrows. No genre-claim pills. No small description
  copy above a headline. A folio does not escape this rule: A plain small-caps folio stacked above
  a heading is still an eyebrow, and a reviewer rejects it. The rule holds at every size, on every
  surface, and in every preset. A folio lives beside a rule at a section boundary, in a margin, or
  in a running header. Where a label must sit near a title, put it below the title or beside it.
  Two things are not eyebrows. Metadata inside the rule-bounded nameplate block is part of the
  nameplate device, wherever it sits inside that block: The dates and the edition line above the
  event name are the nameplate, not an eyebrow. A form `<label>` above its own input is a control
  label. Never "fix" a form label to satisfy this rule.
- **Decorative gradients.** No gradient blobs. No purple-heavy gradients. No gradient as a
  background event.
- **Glassmorphism.** No frosted panels. No blurred translucent overlays used as style.
- **Zero-padded decorative numbers.** No `01` / `02` / `03` motifs.
- **Headline tricks.** No italicized single word in a headline. No underlined single word in a
  headline.
- **Carousels.** No sliding text carousels. No auto-advancing content.
- **The tan-canvas look.** No warm-tan canvas paired with an oversized primary action (#109).
- **Colored card edges.** No arbitrary colored left edges on cards, buttons, or blocks. No
  decorative colored rule across the top of a card. This closes #113 for `SessionCard`.
- **Tiny low-contrast subtext.** Body-adjacent text must meet the contrast bar in both modes.
- **Pulse dots.** No glowing dots. No pulsing status dots above a primary action.
- **Fake 3D stacking.** No box-behind-box layering. No pointless depth. The Zine stamp is the one
  named exception below, and it is an ink layer, not depth.
- **Generic SaaS framing.** No startup marketing voice. No self-justifying subheads. No
  insider-facing copy that a visitor does not need.
- **Pill-shaped everything.** No fully rounded decoration across the interface. This closes #113
  for `TypeBadge`.
- **Default-typeface tells.** Never ship Inter alone, Space Grotesk, or Geist Mono as the design
  default. Never use the stereotypical AI-site serif treatment.
- **Dead calls to action.** No "Contact now" that only opens a mail client. Every action must have
  a stated workflow behind it.
- **Sectionless scroll.** No single undifferentiated scroll surface. Every page has named,
  meaningful sections.
- **Pointless forms.** No newsletter slot without a real purpose and a real backend.
- **Inconsistent dark mode.** No half-applied mode. See §8.2.
- **Semantic color conflicts.** Never use a color against its familiar meaning. Never use color
  alone for status (interface guidelines, Accessibility).
- **Corner errors.** Never let a rounded-box stroke shrink at the corner. Apply the concentric
  radius rule (interface guidelines, User interface).
- **Cursor and reveal effects.** No oversized cursor animations. No reveal-on-scroll.
- **Repetition.** No verbose sections. No repeated promotional copy.

This list has exactly two exceptions. Both are named below. A pattern this list rejects gets no
other exception, and a preset may not grant itself one.

**Exception one: Bento grids.** #105 rejected bento grids. This brief allows one narrow form.
A bento grid is allowed only when it passes all five tests:

1. Cell size follows content rank. A bigger cell holds more important content.
2. Every cell holds real content. No cell holds an icon plus a heading plus one filler line.
3. Hairline rules separate cells. Cards, shadows, and colored edges do not.
4. The page holds at most one bento grid.
5. The grid reflows to a readable single column at narrow viewports.

A bento grid that fails any test is a basic template bento. Reject it.

**Exception two: The Zine stamp.** Zine may print a session block twice, the way a two-pass job
prints off register. This is the only box-behind-box layering the system allows, and it is a
printing artefact, not depth.

The stamp is allowed only when it passes all six tests:

1. The offset layer is flat. It carries no blur, no gradient, and no grey. It is the block's own
   shape, tinted with theme ink or the accent.
2. The offset is a fixed small distance. It never scales with the pointer and never follows it.
3. It ships in the Zine preset only. No other preset may enable it, and no client override may
   bring it to another preset.
4. The hover and focus peek runs at 150ms on `transform` and `opacity` only, with `ease-out`, and
   it starts from a user action. `:focus-visible` gets the same treatment as hover.
5. Under `prefers-reduced-motion` the state is truly static. The stamp still renders. It does not
   move.
6. The stamp is never the only signal that a block is interactive. The link is the affordance.

"Shadow decorates nothing" (§2.1) and "no box-behind-box layering" stay intact everywhere else.
The stamp buys Zine nothing else: No drop shadow, no depth stack, no second offset layer. Zine also
ships the flat-block variant, which is the same block with the stamp off. That variant needs no
exception, and a client may pick it.

### 2.5 A neutral base and an expressive theme

The base system is what a deployment renders before a theme states anything. It must be neutral. A
theme is where the character lives, and a theme may be very expressive indeed.

This section binds both halves. Read it with §2.1: The devices in §2.1 are the vocabulary, and this
section says who chooses which of them a deployment uses.

#### 2.5.1 The four public headers

A public page renders one of four headers. The active theme names the default for its deployment,
and a page may state its own. `standard` is the base: A theme that names no header renders it, and
so does a stored value outside this list.

| Header | What it draws | Where it fits |
|---|---|---|
| **`standard`** | The event name at heading size, the dates and place beside it, the navigation under a hairline. | The base. A conference, a university event, a nonprofit convening — any event whose own identity should lead. |
| **`masthead`** | The masthead nameplate device in full (§2.1), with the navigation under it. | An event that wants the authority of a publication. Broadsheet and Newsroom default to it. |
| **`compact`** | The nameplate device at running-header size: The short name and the dates on one baseline, between the same two rules. | A long site where the header must not push the page's subject down. |
| **`minimal`** | The client's mark and the navigation. Nothing else. | A deployment whose own logo is the identity and needs no second voice. |

Bind these:

- Every treatment carries the site identity and the navigation. A header that drops either fails
  review.
- The identity repeats on every page, so it is never a heading. Every page owns its own `<h1>`.
- **Never print the same words twice.** `masthead` sets the event name at display size. Where a
  page's own headline is that same name, the page keeps its `<h1>` for structure and does not print
  it a second time. The other three treatments set the identity at running-header size, so a page
  headline that repeats it is not a repetition a reader sees.
- No treatment puts text over an image, and none of them is a hero banner.
- A theme may name any of the four. Never make one of them mandatory across every deployment.

#### 2.5.2 The lead image

A page may open with one image. The image sits beside the opening copy at wide viewports and below
it at narrow ones.

Bind these:

- **Never over the copy.** No text sits on the picture and the picture never sits behind text. A
  lead image is a composed layout, not a hero banner.
- **Alt text is required.** An image with no alt text does not render. An empty `alt` is for
  decoration, and the one image that opens a page is not decoration.
- **The crop is stable.** The aspect ratio is a token, so swapping the picture never reflows the
  page.
- **The editor states the focal point.** Two percentages from the top left say what the fixed crop
  must keep. Both default to the centre.
- **One per page.** A second image in the opening section is not rendered there.

#### 2.5.3 Flat surfaces are the default

Flat is the base. The page ground paints no texture on its own.

A texture is a theme opt-in. `config/theme.texture` names one, and paper, dot, grid, and grain are
theme treatments, never base treatments. Keep texture where it creates atmosphere or separates one
plane from another. Never add it as decoration.

#### 2.5.4 Client identity leads

The shared system supplies type, spacing, rules, focus, and accessibility. It does not supply a
look that every client then works around.

Bind these:

- A fresh deployment seeds a neutral palette. Every brand slot is a grey, so the first hue a reader
  sees is the client's own. Semantic slots keep their hues, because a status color that is grey
  states nothing.
- A fresh deployment seeds one neutral face for every role. A theme brings the pairing.
- The seeded branding placeholders are neutral. They carry no product's mark and no product's
  color.
- No deployment reads as Event Runner first and the client's event second.

#### 2.5.5 Ambition is not the thing being trimmed

This section adds contracts. It removes no capability, and a later pull request must not read it as
permission to remove one.

- The masthead and the nameplate stay strong, fully developed choices. The neutral contracts sit
  beside them. They never replace them and never weaken them.
- Every theme may choose an expressive default. A neutral fallback always exists beneath it.
- Texture, rules, folios, drop caps, and unusual typography stay wherever they build hierarchy or
  atmosphere. Never flatten a surface toward generic institutional UI.
- Control complexity with defaults and contracts. Never control it by deleting a capability.

The target is one sentence: An ambitious system, with clear defaults, and room for a client to
express itself. A reviewer who is choosing between "make this smaller" and "make this clearer"
picks clearer.

---

## 3. Token architecture

### 3.1 Three tiers

The system has three token tiers. Each tier has one job.

| Tier | Name pattern | Holds | Who reads it |
|---|---|---|---|
| 1. Primitives | `--er-<family>-<step>` | Raw values. Color channels, sizes, weights, durations. | Tier 2 only. |
| 2. Semantic | `--color-*`, `--text-*`, `--space-*`, `--rule-*`, `--font-*`, `--radius-*`, `--motion-*` | Theme meaning. Presets live here. | Tier 3, Tailwind, and components. |
| 3. Component | `--<component>-<part>` | A component contract. Example: `--session-card-rule`. | One component each. |

**Components must reference tier 2 or tier 3 tokens only.** A component that reads a primitive
fails review. A primitive is a value, not a meaning.

A component token exists when a component needs a value that the theme may change on its own. A
component token defaults to a semantic token. Example: `--session-card-rule: var(--rule-hairline)`.

### 3.2 Font roles, not family names

Tokens name roles. Tokens never name families. This follows the USWDS pattern.

The system has four roles. PR1 shipped all four.

- `--font-heading` — display and headings.
- `--font-body` — running text.
- `--font-data` — captions, labels, metadata lines, and support text beside the body. This role may
  be a sans. It is not required to be a mono.
- `--font-mono` — figures, timestamps, code, identifiers, and every tabular column. This role is
  always a mono or a face with true tabular figures.

The split between `data` and `mono` is what stops a preset from setting every caption in a
typewriter face. Read it as one sentence: **`data` is the voice beside the text; `mono` is the
value a reader would copy, compare, or align.**

A preset may point `data` and `mono` at the same family where its story asks for it. Field Guide
and Atlas both do.

A deployment made before these roles existed still resolves every role. The alias chain in
`semantic.json` runs `--font-mono` → `--font-data` → `--font-body`, so a role the stored document
leaves out follows the role above it.

The current `--font-accent` role stays for one release as an alias of `--font-heading`. PR2 removes
it. `THEME_FONT_ROLES` in `packages/shared/src/theme.cjs`, which
`apps/web/src/lib/themeRuntime.js` re-exports, carries `heading`, `body`, `data`, and `mono` as of
PR1.

Set `font-variant-numeric: tabular-nums` wherever the mono role renders a changing value, and
wherever the data role renders one (interface guidelines, Typography).

### 3.3 Mode-scoped palettes

Every theme must define a light value and a dark value for every color token. A theme with one
palette is incomplete.

The mode switch is a `data-mode` attribute on the root element. Its values are `light` and `dark`.
The generated stylesheet defines every color token under `:root[data-mode='light']` and under
`:root[data-mode='dark']`.

**First paint is always fully styled.** The runtime writes `data-mode` after the page starts
painting, so the stylesheet must resolve every color token before the attribute exists. PR1 shipped
this rule. Bind it:

- The generated stylesheet emits an attribute-free `:root` baseline carrying the light values.
  Nothing paints unstyled, on any deployment, at any mode policy.
- `:root[data-mode='light']` repeats the light values. The two blocks stay symmetrical, so the
  §8.2 completeness test can compare them token for token.
- A deployment whose mode policy is `dark` also emits the dark values under
  `:root:not([data-mode])`. The block stops matching the moment the runtime writes the attribute.
- A deployment whose mode policy is `system` emits that same `:root:not([data-mode])` block inside
  `@media (prefers-color-scheme: dark)`. First paint follows the reader's setting.

Never solve first paint with a blocking script, an inline style, or a flash-of-light-ground
placeholder. The stylesheet carries it.

The client config chooses the policy. Add `mode` to the `config/theme` document. Its values are:

- `light` — always light.
- `dark` — always dark.
- `system` — follow `prefers-color-scheme`. The runtime writes `data-mode` from the media query and
  updates it on change.

Dark mode is its own palette. It is never light mode reversed (interface guidelines, Colors).
Disable transitions while the mode changes (interface guidelines, Animation).

### 3.4 Theme switching

The theme switch is a `data-theme` attribute on the root element. Its values are the preset ids in
§4. A theme remaps the same custom properties. A theme never introduces a new property name and
never introduces a new class.

`data-theme` and `data-mode` combine. The generated stylesheet emits one block per pair.

One theme mechanism serves the whole repo. Never add an ad-hoc `.dark` class per component
(interface guidelines, Colors).

### 3.5 One source of truth

Tokens live in JSON under `design/tokens/`:

```
design/tokens/
  primitives.json          # tier 1
  semantic.json            # tier 2 role map, mode-scoped
  components.json          # tier 3 contracts
  motifs.json              # motif sets (§3.8)
  presets/broadsheet.json
  presets/newsroom.json
  presets/zine.json
  presets/civic.json
  presets/field-guide.json
  presets/atlas.json
```

A build step reads the JSON and writes the CSS custom properties. Adding a seventh preset is a data
change. It is never a code change. A preset file that a generator cannot resolve fails the build.

### 3.6 How this extends the existing chain

The chain in ADR §7.2 stays. This brief adds one step at the front and one attribute at the end:

```
design/tokens/*.json  (NEW: token source of truth)
   → scripts/lib/theme.cjs + scripts/lib/tokens.cjs (NEW)
   → config/theme (Firestore: preset id, mode policy, per-token overrides)
   → generate-content.cjs → apps/web/src/generated/theme.css   (build-time custom properties)
   → EventConfigProvider → <style id="event-theme-runtime">     (runtime override, same properties)
   → data-theme + data-mode on <html>                           (NEW: which block wins)
   → tailwind.config.js maps utilities to var(--…)
```

Bind these rules:

- Keep the RGB-triple form for color custom properties. Tailwind's
  `rgb(var(--…-rgb) / <alpha-value>)` mapping depends on it (ADR §7.2). Opacity modifiers must keep
  working.
- Keep `buildRuntimeThemeCss` in `apps/web/src/lib/themeRuntime.js` as the one runtime builder.
  Extend it to emit mode-scoped blocks and to accept per-token overrides. Never add a second
  builder.
- Keep the bundled-font allowlist (ADR §7.4). A preset names bundled faces. A client never supplies
  a font URL.
- **Respect the hex sweep (ADR §7.6).** `apps/web/src/generated/theme.css` stays the only file in
  `apps/web` allowed to carry raw color values. Do not extend the ESLint allowlist. Token JSON is
  data, not linted source. `scripts/**` is not on the allowlist, so generator code must declare
  color channels as numbers, exactly as `scripts/lib/theme.cjs` does today.
- Keep `config/theme` a whole-document replace. The admin editor always sends the complete
  document.

### 3.7 New scales

The system leans on Tailwind defaults today. Replace that with real scales.

**Type scale.** Ship a fluid editorial scale as tokens. Use `clamp()` per step. Bind eight steps:
`--text-folio`, `--text-caption`, `--text-body`, `--text-lead`, `--text-h3`, `--text-h2`,
`--text-h1`, `--text-nameplate`. Each step carries a size, a line height, and a tracking value. A
preset may retune the steps. A preset never adds a step.

**Spacing scale.** Ship a spacing scale as tokens: `--space-3xs` through `--space-3xl`. Keep the
grouping rule: The gap between groups is at least twice the gap inside one (interface guidelines,
Layout).

**Rule scale.** Ship `--rule-hairline`, `--rule-strong`, and `--rule-nameplate` as color plus width
pairs. Rules are structure. Give them tokens of their own.

Map Tailwind to these tokens in `tailwind.config.js`. Do not leave components on default Tailwind
sizes.

### 3.8 Motif token layer

The system has a fourth, optional layer beside the three tiers: The motif layer. A motif set is a
named group of small SVG drawings. `design/tokens/motifs.json` declares the sets. The launch sets
are `botanical`, `fauna`, `cartographic`, and `none`.

Bind the mechanics:

- Store each drawing as an SVG asset under `apps/web/public/motifs/<set>/`. Ship SVG only. Never
  ship a raster motif.
- Every path uses `currentColor` or a theme custom property. A motif file must carry no color
  literal. The hex sweep does not lint SVG, so a reviewer checks this by hand.
- **Render a motif one of two ways only.** Either apply the asset as a CSS `mask-image` and paint
  it with `background-color: var(--color-ink-motif)`, or inline it as an SVG symbol that reads
  `currentColor`. Never render a motif as an external `<img>`. Never render it as a CSS `url()`
  fill. Neither form can inherit theme ink, so neither can meet the §2.3 ink rule in both modes.
- Each set declares named slots. The launch slots are `section-mark`, `divider`, `nameplate-mark`,
  and `empty-state`. A slot may be empty in a set.
- A preset enables a set through one semantic token: `--motif-set`. That token is the record of
  which set is active. It does not do the switching on its own.
- **Set switching is an attribute.** The root element carries `data-motif-set`. The generated
  stylesheet emits one block per `[data-motif-set]` value, and each block resolves every slot token
  to that set's asset. This is the same mechanism as `data-theme` and `data-mode` (§3.4). A custom
  property cannot rewrite the asset a second custom property points at, so `--motif-set` alone can
  never remap the slot URLs. Do not try.
- A motif inherits ink color from `--color-ink-motif`. That token defaults to
  `--color-text-secondary`. A preset may retune it per mode.
- Any preset may enable any set. Field Guide ships with `botanical` on by default. Atlas ships with
  `cartographic` on by default. The other four presets ship with `none` by default.
- A client may switch a set or turn motifs off from the theme editor. Treat `--motif-set` as a
  normal overridable token.
- Adding a motif set is a data change plus new SVG assets. It is never a component change.

Draw each set in the style §2.3 assigns to the preset that uses it. One set may ship two style
variants when two presets share it.

**The cartographic set carries the transit register too.** Atlas is a survey sheet and a network at
once (§4.6), so `cartographic` adds transit slots beside its map marks:

- **Route marks.** The drawn shape a line letter sits inside.
- **Station symbols.** The mark that stands for a room or a venue on the sheet.
- **Schematic line diagrams.** Beck-style runs of straight segments and 45° turns, used as section
  dividers.

These are drawings, so they follow every §2.3 rule: Ink only, `aria-hidden="true"`,
`pointer-events: none`. The line between a motif and an icon is meaning, not shape. A mark that
names a specific line, venue, or room carries meaning. That mark is a labelled icon (§4.6), never a
motif, and it never renders through the motif layer.

---

## 4. Theme presets

Six presets ship at launch. Each preset defines a light palette, a dark palette, a type pairing,
shape and texture and density settings, a motif default, and a personality statement.

Each preset must tell one visual story. The type pairing, the palette, the shape, the density, and
the motifs must all serve that one story, and a preset whose parts pull in different directions
fails review. The six visual-story specs are written and settled. They live in
`docs/plans/2026-08-27-preset-visual-stories.md`: The narrative, the visual vocabulary, the
signature moments, the palette words, what each story refuses, and the curated options. Read that
document before any preset work starts in PR2. Where it and this brief disagree, this brief wins.

A client picks one preset. A client may then override any token. An override applies per mode.

**Each preset ships curated option sets.** A preset is a story with room to move, not one fixed
look. Every preset ships two or three heading faces, three nameplate treatments, and two or three
component style variants. Bind these rules:

- Every option must keep that preset's visual story coherent. The visual-story specs define the
  options and state, one sentence each, why an option still belongs. An option that needs a
  different story is a different preset, not an option.
- An option remaps existing tier 2 and tier 3 tokens only. An option never adds a property name,
  never adds a class, and never adds a component type (§3.4). An option is a data change in the
  preset file.
- Every option defines both modes and clears the §8.1 contrast bar in both.
- An option never unlocks a rejected pattern. The §2.4 list applies to every combination of
  options.
- The theme editor renders each option list as a picker (§5.2).

All faces must be self-hosted `woff2` (interface guidelines, Typography). All faces must carry the
SIL Open Font Licence or an equivalent libre licence. No face may load from a CDN. Expand
`apps/web/public/fonts/` in PR2. Subset every face to Latin. Record the licence for each face in
`apps/web/public/fonts/README.md`.

**The font budget is about 20 to 22 Latin-subset `woff2` families repo-wide.** That count covers
the six preset defaults, every curated heading option, the Zine callout face, and the fixed admin
pairing. It supersedes the earlier 8-to-12 count, which was written before the option sets existed.
Reuse across presets is deliberate: Hold the count by picking a face the repo already bundles
wherever a story allows it.

**A deployed site loads only the faces its active preset and its picked options use.** The bundle
lives in the repo. It never lands on a reader in full. A build that ships all 22 families to one
event site fails review.

### 4.1 Broadsheet — `data-theme="broadsheet"`

**Type.** Heading: Libre Caslon Display. Body: Libre Caslon Text. Data: Source Serif 4, the agate
face for captions and metadata. Mono: Source Serif 4 with tabular figures, so times, room numbers,
and counts stay in the agate column the story asks for. Broadsheet is the one preset that runs a
serif in the mono role, and it costs the font budget nothing.

**Shape and texture.** Radius: Sharp. Rules: Hairline, high count. Texture: Flat paper tone in
light, flat ink tone in dark. Density: Tight.

**Motifs.** Default `none`. A client may enable `botanical` or `fauna` in the engraving style.

**Light palette.** Near-white paper. Near-black ink. One deep ink-blue accent. Warm-grey rules.

**Dark palette.** Deep neutral ground, not pure black. Warm off-white text. The same accent, lifted
in lightness so it holds contrast on the dark ground.

**Personality.** Broadsheet reads like a serious daily paper. The nameplate is the loudest element
on the page, and nothing competes with it. Rules do the dividing work that boxes do elsewhere.
Column measure is tight and the type is set close, so a long schedule reads as a document rather
than as a feed. Use Broadsheet for an event that wants authority and a long record.

### 4.2 Newsroom modern — `data-theme="newsroom"`

**Type.** Heading: Fraunces. Body: Newsreader. Data: IBM Plex Sans for captions, labels, and desk
furniture. Mono: IBM Plex Mono for figures, timestamps, and counts, with tabular figures.

**Shape and texture.** Radius: Small, 2px to 4px. Rules: Hairline with one strong rule per section.
Texture: Flat. Density: Comfortable.

**Motifs.** Default `none`. An enabled set renders in the restrained flat style.

**Light palette.** Cool white ground. Near-black text. One saturated editorial accent. A second
muted accent for data.

**Dark palette.** Charcoal ground. Soft white text. Both accents retuned for the dark ground, not
reused from light.

**Personality.** Newsroom modern reads like a contemporary digital news site. Fraunces gives the
headlines a designed voice, and Newsreader keeps long text calm underneath it. Plex Sans handles
captions and data so numbers never borrow the headline face. This is the preset for a client who
wants the site to feel current without feeling like software. Use it as the default preset for new
deployments.

### 4.3 Zine / indie — `data-theme="zine"`

**Type.** Settled. Heading: Karrik, the default. Bagnard and Avara ship bundled as
client-selectable heading alternates. Body: Fragment Mono. Data: Fragment Mono. Mono: Fragment
Mono with tabular figures. Zine runs one mono across body, data, and values on purpose: The even
typewriter rhythm is the story.

**Callout.** Zine adds one component token, `--callout-font`. It defaults to Caveat, a bundled
script face, and it carries the handwritten callout only: One callout per page, real copy, at one
fixed angle. A component token is not a semantic role (§3.1), so this adds no fifth font role. A
client may point `--callout-font` at `--font-heading` instead and drop the script face.

**Shape and texture.** Radius: Sharp. Rules: Strong, low count. Texture: Paper grain allowed at low
opacity, applied with `pointer-events: none` (interface guidelines, Accessibility). Density: Loose.

**Stamp.** Zine is the one preset that may print a session block twice, off register. The stamp is
a flat, unblurred, ink-tinted offset layer behind the block. It is a printing artefact, not depth.
It ships under the §2.4 exception and only there. The flat-block variant turns it off and needs no
exception.

**Motifs.** Default `none`. An enabled set renders in the hand-drawn style.

**Light palette.** Bright paper. Hard black ink. One high-chroma accent used at full strength in
few places.

**Dark palette.** Near-black ground. Bright paper-white text. The same accent, held at a chroma
that stays legible.

**Personality.** Zine reads as playful and hand-made without becoming messy. A mono body face sets
an even rhythm, and a loud display face carries all the personality on its own. The palette is
small and the accent is rare, so the loudness stays deliberate. Use Zine for unconferences,
community events, and student work.

### 4.4 Civic / institutional — `data-theme="civic"`

**Type.** Heading: Merriweather. Body: Public Sans. Data: Public Sans for labels, captions, and
table headings. Mono: IBM Plex Mono for times, room codes, identifiers, and code, with tabular
figures. This is the USWDS pairing.

**Shape and texture.** Radius: Small. Rules: Hairline, even. Texture: Flat. Density: Comfortable,
with larger hit areas.

**Motifs.** Default `none`. An enabled set renders in the restrained flat style.

**Light palette.** White ground. Very dark neutral text. One restrained institutional accent.
Semantic colors set for maximum clarity, not for style.

**Dark palette.** Dark neutral ground. High-contrast text. The same restrained accent, retuned.

**Personality.** Civic is calm, plain, and highly legible. It targets the highest accessibility bar
of the six presets and never trades contrast for mood. Merriweather gives the headings weight
without drama, and Public Sans keeps every control and label unambiguous. Use Civic for
universities, government partners, and any client with a formal accessibility policy.

### 4.5 Field Guide — `data-theme="field-guide"`

**Inspiration.** Nature, plants, ecosystems, animals, and insects. The register is the scientific
plate and the specimen label.

**Type.** Settled. Heading: Besley, a Clarendon revival whose blunt bracketed serifs are the
lettering of a printed plate. Body: Vollkorn, a warm text serif that reads long and never competes
with linework. Data and mono: IBM Plex Mono with tabular figures, the specimen-label hand. Field
Guide points both value roles at one face on purpose: A label in this world is a tag, and a tag is
set in the exact hand.

**Devices.** Field Guide adds two devices to the §2.1 set:

- **Botanical plate.** A framed drawing with a hairline border and a plate number in the folio
  style. Use it as a page opener or a section opener.
- **Specimen label.** A small ruled block that states a name, a date, and a place. Use it for
  session metadata and for speaker credit lines.

Both devices follow the §2.1 rules. A plate never becomes a hero image. A specimen label never
becomes a chip.

**Shape and texture.** Radius: Sharp. Rules: Hairline, even, with a double rule at the plate frame.
Texture: Flat with an optional light paper tone. Density: Comfortable.

**Light palette.** Warm off-white ground. Dark bark-brown ink. One deep leaf-green accent. One
muted clay second accent for data. Earth-tone rules.

**Dark palette.** Deep forest-neutral ground. Warm bone-white text. Both accents lifted in lightness
for the dark ground. Never reuse the light values.

**Motifs.** Default `botanical`, on by default. `fauna` is the supported alternate. Draw both in
engraving and botanical-plate linework.

**Personality.** Field Guide reads like a naturalist's handbook. Plates and labels give the page a
patient, observed quality that a normal card grid cannot. The earth-tone palette stays quiet so the
linework carries the character. Use Field Guide for environmental events, science communication,
regional gatherings, and any client whose subject is the living world.

### 4.6 Atlas — `data-theme="atlas"`

**Inspiration.** City, geography, and maps. The register is the survey map and the transit
wayfinding sign.

**Two registers, both first-class.** Atlas is a sheet and a network at once, and the transit
register carries equal weight with the cartographic one. Bind the vocabulary, because it is the
theme's whole idea:

- The schedule is a **departure board**. Time runs down the left as departures. Lines run across
  the head. A cell is a service. A parent session and its children read as a service and its
  calling points.
- Concurrent tracks are **lines**, lettered A, B, C. Each line carries a route mark: The letter in
  the heading face inside a survey-drawn shape, always with the line's name beside it.
- Rooms and venues are **stations**. A station has a name, a symbol, and a place on the sheet.
- Moving between sessions is a **transfer**, and the site states it plainly in signage voice:
  "Transfer to Line B · Hall 2 · 6 min walk." State where you are, where it is, and how long it
  takes.

Bind the safety rule: A line is told apart by its letter and its name first. A line colour, where a
client sets one, is a second signal and never the only one (§8.1). Read the Atlas visual story in
`docs/plans/2026-08-27-preset-visual-stories.md` before building either register.

**Type.** Settled. Heading: Overpass, drawn from highway sign lettering, which is the voice a
network uses to tell you where to go. Body: Libre Franklin, the Franklin Gothic lineage that has
set public signage and timetables for a century. Data and mono: Overpass Mono with tabular figures,
for departure times, room codes, walking minutes, and distances. Atlas points both value roles at
one face on purpose: A timetable and a coordinate are the same kind of value.

**Devices.** Atlas adds three devices to the §2.1 set:

- **Map grid.** A faint coordinate grid behind a section. Keep it below the hairline contrast
  level. Give it `pointer-events: none`.
- **Contour lines and coordinate marks.** Thin survey marks at section corners and at the
  nameplate. Use them as position marks, never as filler.
- **Wayfinding icons.** A small, consistent icon set for venue, room, track, and transit. An icon
  that carries meaning needs a label (interface guidelines, Accessibility).

**Shape and texture.** Radius: Sharp. Rules: Hairline grid with one strong rule per section.
Texture: Flat. Density: Tight.

**Light palette.** Cool paper ground. Near-black ink. One route-marker accent. One second accent
for the grid and the contour lines, held at low contrast.

**Dark palette.** Deep slate ground. Cool white text. Grid and contour tokens retuned so the grid
stays felt rather than seen.

**Motifs.** Default `cartographic`, on by default. Draw it in precise survey linework. The set
carries the transit slots too: Route marks, station symbols, and Beck-style schematic line-diagram
dividers (§3.8). A mark that names a specific line, venue, or room is a labelled icon, not a motif.

**Personality.** Atlas reads like a well-made map. The grid and the coordinate marks give the page
an underlying order that the reader senses before they read a word. Wayfinding icons make a
multi-venue event legible at a glance. Use Atlas for city-wide events, multi-venue conferences,
travel-heavy programs, and any client whose event is spread across a place.

---

## 5. Surfaces

### 5.1 Public event site

Restyle the public site in full. Move it onto the new base system and the preset system.

Bind these:

- Every public page gets one of the four headers in §2.5.1. The active theme names which. Remove
  the hero-banner pattern.
- A page may open with one lead image beside its opening copy (§2.5.2). Text never sits over it.
- Every section boundary uses rules and folios. Remove decorative card chrome.
- `SessionCard` loses the colored left edge. `TypeBadge` loses the pill radius. This closes #113.
- The schedule page gains the grid layout at wide viewports and keeps the list at narrow ones.
- Past events and past days get the back-issue treatment.
- Stat blocks take their editorial treatment in PR1 and meet the §2.1.1 contract in full from PR3.

### 5.2 Admin CMS

The admin CMS gets its own fixed Event Runner identity. The admin stops mirroring the client theme.

Build out the reserved `admin-*` palette from ADR §7.3. It is operator tooling, and letting a
client theme it is a support liability. Bind:

- Ship a complete `admin-*` token set with light and dark values. The admin obeys `data-mode`. It
  ignores `data-theme`.
- The admin carries exactly two client-owned elements: The client logo in the top-left slot, and
  one client accent token (`--admin-client-accent`). Use the accent in two named places: The
  active-navigation marker and the page-header mark. Use it nowhere else.
- The admin identity uses one type pairing for all deployments. Do not make it configurable. The
  UI face is Source Sans 3, which the repo already bundles. The data face is IBM Plex Mono with
  tabular figures.

**The full admin spec is `docs/plans/2026-08-27-admin-identity-story.md`.** Read it before any
admin work starts in PR2. It carries the story, the vocabulary, the three moments, the palette
words, what the identity refuses, and the whole `admin-*` token contract. Four of its decisions are
settled here, because they bind:

- **The docket replaces the tab row.** Navigation is a standing list of words down the leading
  edge, grouped by what the operator came to do: Content, people, operations, system. Group heads
  are folios on a hairline. No icon rail. No collapse to glyphs. No counts in bubbles.
- **Three state words, everywhere.** A record is `Draft`, `Live`, or `Live with unpublished
  changes`. Use these exact words in every editor: Pages, content, speakers, sessions, badges, and
  branding. One term per flow (§8.5). The state is always a word, never a coloured pill and never
  colour alone.
- **The client accent has a legibility floor.** A client picks the value, so it may be unreadable
  on an admin ground. Test the resolved accent against `--admin-ground` in each mode. When it
  fails, both accent slots fall back to `--admin-ink`, and the theme editor states plainly that the
  accent is too low-contrast for the admin marker and names what it fell back to. Never clamp the
  client's value silently. Never render an invisible position marker.
- **A dialog scrim is a tinted ink overlay.** Modals, pickers, and dialogs get tint elevation plus
  a strong rule plus a scrim. The scrim carries no blur, because glassmorphism is rejected (§2.4).
  No `--admin-shadow-*` family ships.

**The theme editor becomes a live-preview editor.** Rebuild
`apps/web/src/admin/pages/AdminBranding.jsx` as a split view:

- Controls sit on one side. A rendered site preview sits on the other.
- The preview renders real pages, not swatches. The operator picks which page to preview.
- The editor keeps a draft. The operator publishes the draft. The published document replaces
  `config/theme` whole, as it does today.
- A preset picker sets the base. The picker states plainly that a preset overwrites unmodified
  tokens.
- **The editor has two depths.** The first depth is the curated option pickers from §4: The preset,
  then its heading face, its nameplate treatment, and its component variants. Most operators never
  leave this depth. The second depth is raw per-mode token override, and it is the advanced path.
  Put it behind its own disclosure. Never make raw token editing the first thing an operator meets.
- Token overrides are per mode. The editor shows a light tab and a dark tab.
- **A contrast failure is an error, not a warning.** Where a defined token pair names a foreground
  and a background, the pair must clear the §8.1 bar in both modes. `updateTheme` validates every
  such pair on publish and rejects the write when one fails. The rejection names the pair, the
  mode, and the measured ratio. The editor shows the same failure inline in the control that caused
  it, and it keeps rendering the preview so the operator can see what they did. A draft may hold a
  failing value. A published document may not.
- **Publish materializes the legacy colors map.** Email and PDF render outside the browser and read
  `config/theme.colors` directly. A client who runs a preset with no overrides has no stored
  colors, so those two consumers would render from nothing. On publish, one shared resolver in
  `packages/shared` resolves the preset plus the overrides down to the legacy colors map and writes
  it into the stored `config/theme` document. One resolver serves the browser runtime, the
  generator, and the publish path. Never add a second.
- Keep the existing preview mechanism. `applyThemePreview` and `buildRuntimeThemeCss` stay the one
  path from a candidate document to rendered CSS.
- Keep the logo slots and the media-library picker unchanged.

### 5.3 Documentation and marketing site

Align the documentation site to the new language in a later phase. Build on the #105, #109, and
#112 work. Do not start it before PR1 through PR3 land.

Bind these when it lands:

- Reuse the token names. The documentation site does not mint its own palette.
- Keep the `main:/docs` GitHub Pages publishing model.
- Keep `docs/docs/**` generated. Edit the Markdown, run `node scripts/build-pages.cjs`, and commit
  both (CONTRIBUTING).
- Keep the favicon, canonical URL, and full Open Graph and Twitter metadata on every generated
  page.

---

## 6. Structure

### 6.1 The hybrid model

A system page keeps its core feature component. A system page also gains two new abilities.

**Layout variants.** A system page can change shape from data. The variants are:

- `header` — which of the four headers in §2.5.1 the page renders.
- `arrangement` — grid or list.
- `density` — tight, comfortable, or loose.
- `navPlacement` — top or side.

**Composable sections.** A system page can hold sections above the core component and below it.
Those sections use the existing block registry and the existing `SectionBlocks` renderer.

A custom page keeps full block composition. Nothing changes for custom pages.

### 6.2 Schema changes

Extend the `cmsPages` schema. The server validates it. The admin mirrors it.

Add a page-level `layout` object:

```ts
layout: {
  header: 'standard' | 'masthead' | 'compact' | 'minimal',
  arrangement: 'grid' | 'list',
  density: 'tight' | 'comfortable' | 'loose',
  navPlacement: 'top' | 'side'
}
```

Add a `slot` field to each section:

```ts
slot: 'above' | 'below' | 'main'
```

**The header enum has no `none`.** `minimal` is the minimum. Every public page carries the site
identity and the navigation (§2.5.1), so a page that renders no header at all is not a layout
variant. It is a page that lost its identity. Reject the value on write.

**A page states a header only to differ from its theme.** The value a page omits resolves to the
theme's default, and a stored value outside the enum resolves to `standard` rather than to no
header at all.

**`main` is the default, and it has stated semantics.** On a system page, sections in the `main`
slot render immediately after the core feature component and before every `below` section. The
order down the page is: Header, `above` sections, core component, `main` sections, `below`
sections.

That default is what keeps existing data working. A section stored before this schema landed
carries no `slot`, so it reads as `main` and renders in the old position. No migration runs, and no
seeded page changes shape on upgrade.

A custom page ignores `slot` because it has no core component.

Bind the implementation:

- Add `layout` to `PAGE_KEYS` and `slot` to `SECTION_KEYS` in `functions/src/cms/pages.cjs` and in
  `apps/web/src/admin/pageDoc.js`. The two lists must stay in step. `validatePageDoc` rejects
  unknown keys by name, so a one-sided change breaks every save of a seeded page.
- Validate every enum value on write. Reject an unknown value.
- Treat a missing `layout` as the default layout. Existing documents must keep working with no
  migration.
- Keep `BLOCK_TYPES` in code (ADR §5.2). A block type is a contract with a React renderer.

---

## 7. Phased delivery

Ship four phases as four stacked pull requests. Each phase stays in its own pull request. Never
stack two phases in one pull request.

Stacking means each phase starts from the phase before it, not from `main`:

- **PR1** runs on the current branch, `claude/product-design-style-overhaul-1dii7o`. It targets
  `main`.
- **PR2** branches off PR1's head as `claude/product-design-style-overhaul-1dii7o-pr2`. It targets
  PR1's branch.
- **PR3** branches off PR2's head as `claude/product-design-style-overhaul-1dii7o-pr3`. It targets
  PR2's branch.
- **PR4** branches off PR3's head as `claude/product-design-style-overhaul-1dii7o-pr4`. It targets
  PR3's branch.

A stacked pull request shows only its own phase's diff, so a reviewer reads one phase at a time.
When a lower pull request merges, retarget the one above it at `main` or let the platform retarget
it. Never rebase a phase onto `main` while the phase below it is still open.

### PR1 — Token foundation and editorial base restyle

- Add `design/tokens/` and the generator.
- Add the three tiers, the four font roles, the type scale, the spacing scale, and the rule scale.
- Add the motif token layer and the `none` set. Ship no motif art yet.
- Add `data-mode`, the mode policy in `config/theme`, and the first-paint blocks from §3.3.
- Map Tailwind to the new tokens.
- Restyle the public site on the base system, with a neutral seeded palette (§2.5.4).
- Ship the four headers from §2.5.1, the nameplate device behind two of them, and the theme field
  that names the default.
- Ship the lead image from §2.5.2.
- Apply §2.1 devices: Nameplate, rules, folios.
- Restyle stat presentation and render both stat shapes. Legacy stat blocks keep rendering. The
  §2.1.1 contract is not enforced in this phase.
- Ship the §8.2 dark-mode completeness test against the base tokens.
- Close #113.

### PR2 — Presets, live-preview theme editor, and admin identity

- Add all six preset files, the curated option sets from §4, and the bundled fonts.
- Add `data-theme` and the preset picker.
- Add `data-motif-set` and the per-set slot blocks (§3.8).
- Ship the `botanical`, `fauna`, and `cartographic` motif sets. Draw each set in the style §2.3
  assigns. Include the cartographic transit slots.
- Turn `botanical` on for Field Guide. Turn `cartographic` on for Atlas.
- Add the Field Guide devices and the Atlas devices from §4.5 and §4.6, including the Atlas transit
  register.
- Ship the Zine stamp under the §2.4 exception, plus the flat-block variant.
- Extend the §8.2 dark-mode completeness test to every preset in every mode, and to the `admin-*`
  set.
- Rebuild the Branding tab as the live-preview editor with draft and publish.
- Add the curated option pickers, per-mode token overrides behind the advanced path, and a
  motif-set control.
- Make a contrast failure on a defined foreground and background pair a publish-time error in
  `updateTheme`.
- Add the shared publish resolver that materializes the legacy colors map into `config/theme`.
- Ship the fixed `admin-*` identity, the docket navigation, and the three state words. Stop
  mirroring the client theme.
- Remove the `--font-accent` alias.

### PR3 — Layout variants and hybrid composition

- Extend the `cmsPages` schema with `layout` and `slot`.
- Render variants on the system pages.
- Render `above`, `main`, and `below` sections on the system pages in the §6.2 order.
- Land the §2.1.1 stat contract in full: The four-part schema, the editor fields, the seed
  migration, and write-time enforcement.
- Add the schedule grid and its signature interaction.
- Add the back-issue treatment.

### PR4 — Documentation site alignment

- Move the documentation and marketing site onto the token names.
- Regenerate `docs/docs/**`.
- Keep every check in CONTRIBUTING green.

### Landing conditions

Every pull request must land green. Each one runs:

- `npm run lint`, including the hex sweep.
- The web unit tests, and the functions and shared unit tests where touched.
- The Firestore and Storage rules tests where rules or validators changed.
- The demo hygiene checks, with `docs/demo/` regenerated.
- The documentation checks where Markdown or `docs/**` changed.

---

## 8. Quality gates

A reviewer applies these gates to every pull request in §7. A gate failure blocks the merge.

### 8.1 Accessibility

- Meet the contrast bar in **both** modes. Measure against the actual rendered background, not the
  page background (interface guidelines, Colors).
- Give every interaction a keyboard path.
- Style `:focus-visible`. Never remove an outline without replacing it.
- Keep heading order semantic. Never pick a heading level for its size.
- Support `prefers-reduced-motion` with a truly static state.
- Meet the hit-area minimums: 24×24px, 44×44px on touch.
- Never signal status with color alone.

### 8.2 Complete dark mode

Every color token must resolve in both modes. A half-applied mode is a bug, not a polish item. Add
a test that loads a theme in each mode and asserts that no color token falls back to its inherited
light value.

The test lands in two phases, because the presets do not exist in PR1:

- **PR1 ships the test against the base tokens.** It covers the whole semantic set in light and
  dark, plus the first-paint blocks from §3.3.
- **PR2 extends the same test to every preset in every mode**, and to the `admin-*` set. The admin
  blocks are emitted once per mode, never once per theme-and-mode pair. Assert that too: It is the
  mechanical statement of "the admin ignores `data-theme`".

### 8.3 Documentation stays true

`docs/interface-guidelines.md` is the standing rulebook. This brief contradicts parts of it. Update
the guidelines in the **same** pull request that changes the behavior. Never leave the two out of
step across a merge. Record the anti-pattern list from §2.4 in the guidelines so future reviews
have one place to look.

### 8.4 Tests move with the restyle

Update a component's tests in the same pull request that restyles it. A test that asserts a removed
class must change, not get deleted. Regenerate `docs/demo/` whenever the demo output changes.

### 8.5 Copy

Write all copy in plain language. Use short sentences. Use active voice. Start a button label with
a verb. Repeat the consequence in a confirmation button. Use one term per flow. Address the reader
as "you" (interface guidelines, Writing).

---

## 9. Settled type decisions

Nothing in this document is open. This section is the record of the type decisions, and of the four
tests every future face must pass.

**The four tests.** Judge every candidate face against all four. They bind a heading option and a
callout face exactly as they bind a preset default:

1. It carries the SIL Open Font Licence or an equivalent libre licence.
2. It subsets to a Latin `woff2` under 60KB.
3. It stays legible at nameplate size and at `--text-h3`.
4. It holds contrast in both modes.

**1. Zine.** Heading: **Karrik** (Velvetyne, drawn by Jean-Baptiste Morizot and Lucas Le Bihan).
**Bagnard** (Love Letters, drawn by Sebastien Sanfilippo, from Napoleonic-era prisoner graffiti)
and **Avara** (Velvetyne, drawn by Raphael Bastide) ship bundled as client-selectable heading
alternates. Body, data, and mono: **Fragment Mono**. The callout component token `--callout-font`
defaults to **Caveat**.

The earlier audition list of FT88, Bagnard, and Trickster is superseded. Bagnard survived it.

**2. Field Guide.** Heading: **Besley**. Body: **Vollkorn**. Data and mono: **IBM Plex Mono** with
tabular figures.

**3. Atlas.** Heading: **Overpass**. Body: **Libre Franklin**. Data and mono: **Overpass Mono**
with tabular figures.

**4. Broadsheet, Newsroom, and Civic** keep the pairings in §4.1, §4.2, and §4.4. Each one gains
its mono role there.

**The curated heading options** for all six presets are named in
`docs/plans/2026-08-27-preset-visual-stories.md`, part 6 of each page. Every one of them must clear
the four tests when it is bundled. Verify each licence and each Latin-subset size at bundling time,
in PR2. Nothing here blocks PR1.
