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
structure. Color decorates very little. Shadow decorates nothing.

Use print devices with intent. Each device below has one job. Use a device where its job applies.
Never use a device as decoration.

| Device | What it is | Where to use it | The rule |
|---|---|---|---|
| **Masthead nameplate** | A rule-bounded title block. It holds the event name, the dates, and the edition line. | The page header of every public page. | Never a hero banner with a background image. Never a photo behind the name. The nameplate is type and rules only. |
| **Hairline rules** | Low-contrast 1px rules that separate content. | Section boundaries, table rows, folios, column gutters. | A rule replaces a card border. A rule never carries brand color. Rules use the `--rule-*` tokens only. |
| **Folios** | A small-caps plain-text label beside or above a rule. It states the section, the day, or the page role. | Section heads, schedule day heads, archive labels. | Never a chip. Never a pill. Never a colored badge. Text plus rule only. |
| **Multi-column long form** | Two or three text columns at wide viewports. | Long prose pages: about, travel, code of conduct, policy pages. | Apply columns only above the `lg` breakpoint. Keep 60–75 characters per line (interface guidelines, Typography). Never column-split a list of controls. |
| **Drop cap** | A large first letter that spans two or three lines. | The first paragraph of a long-form page. | One drop cap per page at most. Never on a short intro. Never on a card. |
| **Stat and chart anatomy** | A fixed four-part contract for every data block. | Every stat block, every chart, every number the site presents as evidence. | See §2.1.1. The anatomy is enforced, not advisory. |
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
- A motif inherits theme ink color. A motif never carries its own color.
- A motif is decorative to a screen reader. Give it `aria-hidden="true"` and
  `pointer-events: none`.
- A motif that carries meaning is an icon, not a motif. Give an icon a label.
- Keep motif density low. Use at most three motifs on a page.

### 2.4 Anti-pattern guidance

This section is holistic guidance, not a checklist to game. The goal is a site that a designer
made. A reviewer may reject a pattern that this list does not name. A reviewer may accept a listed
pattern only where this document grants an exception.

Reject these patterns:

- **Eyebrow furniture.** No eyebrow labels above titles. No chips. No pills. No dash-style
  eyebrows. No genre-claim pills. No small description copy above every headline.
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
- **Fake 3D stacking.** No box-behind-box layering. No pointless depth.
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

**The one exception: bento grids.** #105 rejected bento grids. This brief allows one narrow form.
A bento grid is allowed only when it passes all five tests:

1. Cell size follows content rank. A bigger cell holds more important content.
2. Every cell holds real content. No cell holds an icon plus a heading plus one filler line.
3. Hairline rules separate cells. Cards, shadows, and colored edges do not.
4. The page holds at most one bento grid.
5. The grid reflows to a readable single column at narrow viewports.

A bento grid that fails any test is a basic template bento. Reject it.

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

The roles are:

- `--font-heading` — display and headings.
- `--font-body` — running text.
- `--font-data` — tabular data, code, captions, and timestamps. This role is usually a mono or a
  tabular serif.

The current `--font-accent` role stays for one release as an alias of `--font-heading`. PR2 removes
it. `THEME_FONT_ROLES` in `apps/web/src/lib/themeRuntime.js` gains `data` in PR1.

Set `font-variant-numeric: tabular-nums` wherever the data role renders a changing value
(interface guidelines, Typography).

### 3.3 Mode-scoped palettes

Every theme must define a light value and a dark value for every color token. A theme with one
palette is incomplete.

The mode switch is a `data-mode` attribute on the root element. Its values are `light` and `dark`.
The generated stylesheet defines every color token under `:root[data-mode='light']` and under
`:root[data-mode='dark']`.

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
grouping rule: the gap between groups is at least twice the gap inside one (interface guidelines,
Layout).

**Rule scale.** Ship `--rule-hairline`, `--rule-strong`, and `--rule-nameplate` as color plus width
pairs. Rules are structure. Give them tokens of their own.

Map Tailwind to these tokens in `tailwind.config.js`. Do not leave components on default Tailwind
sizes.

### 3.8 Motif token layer

The system has a fourth, optional layer beside the three tiers: the motif layer. A motif set is a
named group of small SVG drawings. `design/tokens/motifs.json` declares the sets. The launch sets
are `botanical`, `fauna`, `cartographic`, and `none`.

Bind the mechanics:

- Store each drawing as an SVG asset under `apps/web/public/motifs/<set>/`. Ship SVG only. Never
  ship a raster motif.
- Every path uses `currentColor` or a theme custom property. A motif file must carry no color
  literal. The hex sweep does not lint SVG, so a reviewer checks this by hand.
- Each set declares named slots. The launch slots are `section-mark`, `divider`, `nameplate-mark`,
  and `empty-state`. A slot may be empty in a set.
- A preset enables a set through one semantic token: `--motif-set`. Component tokens resolve a slot
  to a file path through the generated stylesheet.
- A motif inherits ink color from `--color-ink-motif`. That token defaults to
  `--color-text-secondary`. A preset may retune it per mode.
- Any preset may enable any set. Field Guide ships with `botanical` on by default. Atlas ships with
  `cartographic` on by default. The other four presets ship with `none` by default.
- A client may switch a set or turn motifs off from the theme editor. Treat `--motif-set` as a
  normal overridable token.
- Adding a motif set is a data change plus new SVG assets. It is never a component change.

Draw each set in the style §2.3 assigns to the preset that uses it. One set may ship two style
variants when two presets share it.

---

## 4. Theme presets

Six presets ship at launch. Each preset defines a light palette, a dark palette, a type pairing,
shape and texture and density settings, a motif default, and a personality statement.

A client picks one preset. A client may then override any token. An override applies per mode.

All faces must be self-hosted `woff2` (interface guidelines, Typography). All faces must carry the
SIL Open Font Licence or an equivalent libre licence. No face may load from a CDN. Expand
`apps/web/public/fonts/` in PR2. Subset every face to Latin. Record the licence for each face in
`apps/web/public/fonts/README.md`.

### 4.1 Broadsheet — `data-theme="broadsheet"`

**Type.** Heading: Libre Caslon Display. Body: Libre Caslon Text. Data: Source Serif 4 with tabular
figures.

**Shape and texture.** Radius: sharp. Rules: hairline, high count. Texture: flat paper tone in
light, flat ink tone in dark. Density: tight.

**Motifs.** Default `none`. A client may enable `botanical` or `fauna` in the engraving style.

**Light palette.** Near-white paper. Near-black ink. One deep ink-blue accent. Warm-grey rules.

**Dark palette.** Deep neutral ground, not pure black. Warm off-white text. The same accent, lifted
in lightness so it holds contrast on the dark ground.

**Personality.** Broadsheet reads like a serious daily paper. The nameplate is the loudest element
on the page, and nothing competes with it. Rules do the dividing work that boxes do elsewhere.
Column measure is tight and the type is set close, so a long schedule reads as a document rather
than as a feed. Use Broadsheet for an event that wants authority and a long record.

### 4.2 Newsroom modern — `data-theme="newsroom"`

**Type.** Heading: Fraunces. Body: Newsreader. Data and captions: IBM Plex Sans with IBM Plex Mono
for figures and timestamps.

**Shape and texture.** Radius: small, 2px to 4px. Rules: hairline with one strong rule per section.
Texture: flat. Density: comfortable.

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

**Type.** Heading: display face to be decided. Three candidates are under audition. Body and data:
Fragment Mono or JetBrains Mono. See §9 for the open decision and the audition rules.

**Shape and texture.** Radius: sharp. Rules: strong, low count. Texture: paper grain allowed at low
opacity, applied with `pointer-events: none` (interface guidelines, Accessibility). Density: loose.

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

**Type.** Heading: Merriweather. Body: Public Sans. Data: Public Sans with tabular figures, plus
IBM Plex Mono for code and identifiers. This is the USWDS pairing.

**Shape and texture.** Radius: small. Rules: hairline, even. Texture: flat. Density: comfortable,
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

**Type.** To be decided. The pairing is under audition. The user picks it later. See §9.

**Devices.** Field Guide adds two devices to the §2.1 set:

- **Botanical plate.** A framed drawing with a hairline border and a plate number in the folio
  style. Use it as a page opener or a section opener.
- **Specimen label.** A small ruled block that states a name, a date, and a place. Use it for
  session metadata and for speaker credit lines.

Both devices follow the §2.1 rules. A plate never becomes a hero image. A specimen label never
becomes a chip.

**Shape and texture.** Radius: sharp. Rules: hairline, even, with a double rule at the plate frame.
Texture: flat with an optional light paper tone. Density: comfortable.

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

**Type.** To be decided. The pairing is under audition. The user picks it later. See §9.

**Devices.** Atlas adds three devices to the §2.1 set:

- **Map grid.** A faint coordinate grid behind a section. Keep it below the hairline contrast
  level. Give it `pointer-events: none`.
- **Contour lines and coordinate marks.** Thin survey marks at section corners and at the
  nameplate. Use them as position marks, never as filler.
- **Wayfinding icons.** A small, consistent icon set for venue, room, track, and transit. An icon
  that carries meaning needs a label (interface guidelines, Accessibility).

**Shape and texture.** Radius: sharp. Rules: hairline grid with one strong rule per section.
Texture: flat. Density: tight.

**Light palette.** Cool paper ground. Near-black ink. One route-marker accent. One second accent
for the grid and the contour lines, held at low contrast.

**Dark palette.** Deep slate ground. Cool white text. Grid and contour tokens retuned so the grid
stays felt rather than seen.

**Motifs.** Default `cartographic`, on by default. Draw it in precise survey linework.

**Personality.** Atlas reads like a well-made map. The grid and the coordinate marks give the page
an underlying order that the reader senses before they read a word. Wayfinding icons make a
multi-venue event legible at a glance. Use Atlas for city-wide events, multi-venue conferences,
travel-heavy programs, and any client whose event is spread across a place.

---

## 5. Surfaces

### 5.1 Public event site

Restyle the public site in full. Move it onto the new base system and the preset system.

Bind these:

- Every public page gets a masthead nameplate header. Remove the hero-banner pattern.
- Every section boundary uses rules and folios. Remove decorative card chrome.
- `SessionCard` loses the colored left edge. `TypeBadge` loses the pill radius. This closes #113.
- The schedule page gains the grid layout at wide viewports and keeps the list at narrow ones.
- Past events and past days get the back-issue treatment.
- Every stat block meets the §2.1.1 contract.

### 5.2 Admin CMS

The admin CMS gets its own fixed Event Runner identity. The admin stops mirroring the client theme.

Build out the reserved `admin-*` palette from ADR §7.3. It is operator tooling, and letting a
client theme it is a support liability. Bind:

- Ship a complete `admin-*` token set with light and dark values. The admin obeys `data-mode`. It
  ignores `data-theme`.
- The admin carries exactly two client-owned elements: the client logo in the top-left slot, and
  one client accent token (`--admin-client-accent`). Use the accent in two named places: the
  active-navigation marker and the page-header mark. Use it nowhere else.
- The admin identity uses one type pairing for all deployments. Do not make it configurable. The
  UI face is Source Sans 3, which the repo already bundles. The data face is IBM Plex Mono with
  tabular figures.

**The theme editor becomes a live-preview editor.** Rebuild
`apps/web/src/admin/pages/AdminBranding.jsx` as a split view:

- Controls sit on one side. A rendered site preview sits on the other.
- The preview renders real pages, not swatches. The operator picks which page to preview.
- The editor keeps a draft. The operator publishes the draft. The published document replaces
  `config/theme` whole, as it does today.
- A preset picker sets the base. The picker states plainly that a preset overwrites unmodified
  tokens.
- Token overrides are per mode. The editor shows a light tab and a dark tab. The editor warns when
  an override fails contrast in either mode.
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

- `header` — the nameplate style.
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
  header: 'nameplate' | 'nameplate-compact' | 'none',
  arrangement: 'grid' | 'list',
  density: 'tight' | 'comfortable' | 'loose',
  navPlacement: 'top' | 'side'
}
```

Add a `slot` field to each section:

```ts
slot: 'above' | 'below' | 'main'
```

`main` is the default. A custom page ignores `slot` because it has no core component.

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

Ship four sequential pull requests on one branch. Merge a pull request. Restart the branch from
`main`. Start the next phase. Never stack two phases in one pull request.

### PR1 — Token foundation and editorial base restyle

- Add `design/tokens/` and the generator.
- Add the three tiers, the font roles, the type scale, the spacing scale, and the rule scale.
- Add the motif token layer and the `none` set. Ship no motif art yet.
- Add `data-mode` and the mode policy in `config/theme`.
- Map Tailwind to the new tokens.
- Restyle the public site to the editorial base with the current palette.
- Apply §2.1 devices: nameplate, rules, folios, stat contract.
- Close #113.

### PR2 — Presets, live-preview theme editor, and admin identity

- Get user sign-off on three type pairings during PR2 planning: Field Guide, Atlas, and Zine. Do
  this before any preset work starts.
- Add all six preset files and the bundled fonts.
- Add `data-theme` and the preset picker.
- Ship the `botanical`, `fauna`, and `cartographic` motif sets. Draw each set in the style §2.3
  assigns.
- Turn `botanical` on for Field Guide. Turn `cartographic` on for Atlas.
- Add the Field Guide devices and the Atlas devices from §4.5 and §4.6.
- Rebuild the Branding tab as the live-preview editor with draft and publish.
- Add per-mode token overrides and a motif-set control.
- Ship the fixed `admin-*` identity. Stop mirroring the client theme.
- Remove the `--font-accent` alias.

### PR3 — Layout variants and hybrid composition

- Extend the `cmsPages` schema with `layout` and `slot`.
- Render variants on the system pages.
- Render `above` and `below` sections on the system pages.
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
a test that loads each preset in each mode and asserts that no color token falls back to its
inherited light value. Ship the test in PR1.

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

## 9. Open decisions

Three decisions are open. All three are type decisions. Everything else in this document is
settled.

Judge every candidate face against four tests:

1. It carries the SIL Open Font Licence or an equivalent libre licence.
2. It subsets to a Latin `woff2` under 60KB.
3. It stays legible at nameplate size and at `--text-h3`.
4. It holds contrast in both modes.

**1. The Zine display face.** The audition has run. Three candidates came out of it. Each one
carries the SIL Open Font Licence 1.1, verified.

- **FT88 Bold** — Velvetyne, Degheest collection. A reconstruction of French fairground
  sign-painting.
- **Bagnard** — Love Letters, drawn by Sebastien Sanfilippo. Drawn from Napoleonic-era prisoner
  graffiti.
- **Trickster** — Velvetyne, drawn by Jean-Baptiste Morizot. A bold gothic with a hand-cut edge.

This audition used a specimen sheet. The user may record the pick before PR2 opens.

**2. The Field Guide pairing.** The heading, body, and data faces are all open. Audition a
plate-era serif for headings against a quiet text serif for body. Keep a tabular face for specimen
labels.

**3. The Atlas pairing.** The heading, body, and data faces are all open. Audition a grotesque with
a wayfinding character for headings. Keep a tabular face for coordinates and times.

The user picks the Field Guide pairing and the Atlas pairing during PR2 planning. Present both
auditions with real page mockups, not specimen sheets. Record each decision in this document when
it lands. Do not block PR1 on any of the three.
