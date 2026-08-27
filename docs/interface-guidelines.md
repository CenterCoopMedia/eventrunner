# Interface guidelines

Foundational rules for every `apps/web` surface — attendee pages, admin panel, speaker wizard. Adapted from [interfaces.dev/cheat-sheet](https://interfaces.dev/cheat-sheet) and bound to this repo's own machinery where the two meet (theme tokens, the hex sweep, the a11y bar in CONTRIBUTING). PRs that touch UI are reviewed against this document.

## How this connects to the rest of the repo

- **Colors are theme tokens, never literals.** The ESLint hex sweep (spec §7.6) enforces the mechanical half; this document covers the design half. Every color you use must be a custom property from `config/theme` (spec §7) with a role-based name.
- **Tokens come from `design/tokens/`.** The design system's three tiers, the motif layer, and every scale live in JSON there (design brief §3.5). `scripts/lib/tokens.cjs` turns that JSON into the custom properties `apps/web/src/generated/theme.css` carries, and `tailwind.config.js` maps the utilities onto them. Change a token by editing the JSON and regenerating. Never hand-edit the generated stylesheet.
- **Accessibility is a merge requirement, not a nicety.** CONTRIBUTING already requires a keyboard path and visible focus for UI changes; the Accessibility section below is the working checklist behind that line.
- **Event-neutrality applies to design too.** No hardcoded brand color, font stack "for this event," or copy that assumes one venue or city. If a design decision varies per client, it belongs in `config/theme` or CMS content.
- **The design brief binds.** [`plans/2026-08-27-design-system-overhaul.md`](plans/2026-08-27-design-system-overhaul.md) is the design contract; this document is the standing rulebook that carries it into review. Where the two disagree, the brief wins and this document gets fixed in the same pull request.

## Editorial devices

Typography and rules do the visual work. Color decorates very little, and shadow decorates nothing (design brief §2.1). Each device below has one job: use it where its job applies, and never as decoration. The shared implementations live in `apps/web/src/components/editorial/`, and each one resolves through its tier-3 token contract, so a preset retunes a device by remapping tokens rather than by changing a component.

| Device | Component | What it is | The rule |
|---|---|---|---|
| Masthead nameplate | `Nameplate` | The rule-bounded title block: event name, dates, edition line. | Every public page carries one. Type and rules only — never a hero banner, never a photo behind the name. `full` opens the home page; `compact` runs as a header everywhere else. |
| Folio | `Folio` | A small-caps plain-text label sitting on a hairline rule. | Text plus rule. Never a chip, never a pill, never a colored badge. **Never directly above a heading** — see the eyebrow ban below. |
| Rule | `Rule` | A standalone hairline, strong, or nameplate rule. | A rule replaces a card border. A rule never carries brand color and reads only the `--rule-*` tokens. Where the rule belongs to a row that already exists, put the border on that row instead of adding a node. |
| Section boundary | `SectionHead` | One strong rule, then the section heading with the folio beside it on a hairline. | Reach for this instead of composing a folio and a heading by hand. Its `folio` variant makes the folio itself the heading, which is what a schedule day head needs. |
| Stat and chart anatomy | `StatBlock` | A number the site presents as evidence. | Four parts, and all four are required (design brief §2.1.1). A large number with a small caption under it is not a stat block. |

**Every stat carries four parts, and the write path enforces it.** A stat block states the finding in words (`takeaway`), says what the number counts and over what period (`description`), names where the number came from and the date it was read (`source`), and describes the finding for a screen reader (`alt`). The block editor asks for all four and refuses to save without them, and `cmsCreateContent` / `cmsUpdateContent` reject a stat block that misses one, naming the part. A block already stored in the older `{ value, label }` shape keeps rendering and keeps publishing — what stops is writing one that way.

**The eyebrow ban is absolute.** No text sits directly above a heading. Not an eyebrow label, not a chip, not a small line of description copy, and not a plain small-caps folio — a folio stacked above a headline is still an eyebrow, and a reviewer rejects it. The rule holds at every size, on every surface, in every preset. A folio lives beside a rule at a section boundary, in a margin, or in a running header. Where a label must sit near a title, put it below the title or beside it.

Two things are **not** eyebrows and must never be "fixed" to satisfy this rule:

- Metadata inside the rule-bounded nameplate block. The dates and the edition line are the nameplate device, wherever they sit inside it.
- A form `<label>` above its own input. That is a control label.

Cards, boxes, and chrome: a rule replaces a card border wherever a rule can do the job. Elevation is tint, not shadow — where a surface must sit above another, shift its tone with a low-opacity overlay of the theme's ink or accent.

## User interface

- Apply concentric border radius across nested elements (inner radius = outer radius − padding).
- Prioritize optical alignment over geometric alignment.
- Add a `1px` outline to images, offset by `-1px`: black at 8% opacity in light mode, white at 8% in dark mode.
- Portraits and avatars are square on the brand radius (`rounded-brand`), never a circle (`rounded-full`) — a circular crop is a generic-template tell.

## Animation

The system has two motion classes and there is no third (design brief §2.2).

- **Functional motion** shows a state change: menus, filters, tabs, disclosure, toasts. Keep it between 120ms and 200ms, animate `transform` and `opacity` only, and use `ease-out`. The `duration-fast` / `duration-base` / `duration-slow` and `ease-motion` utilities map to the motion tokens.
- **Expressive motion** is one designed signature interaction per surface. The schedule grid holds that slot on the public site. It starts from a user action, finishes under 600ms, and stays readable at every frame.

Both classes: never trigger motion from scroll position, never run ambient animation, and keep wayfinding instant — navigation, route changes, and focus moves never animate. Support `prefers-reduced-motion` in full; the reduced state is truly static, and a shortened animation is not a fallback.

- Never `transition: all`; list the exact properties that change.
- Scale pressed buttons to 0.95–0.98 with `transition: scale 200ms ease-out`.
- Cross-fade swapped icons: entering scales 0.25→1 with opacity 0→1 and blur 4px→0; exiting reverses.
- CSS transitions for interruptible interactions; keyframes for one-time sequences.
- Disable transitions while switching between light and dark themes.
- `will-change` only on properties that actually change: `transform`, `opacity`, `filter`. Add `will-change: transform` to elements that jitter 1–2px mid-animation (iOS Safari especially).
- Stagger entrance animations by group or element.
- Don't animate frequent interactions (e.g. color changes on list hover).

## Typography

- Ship only `.woff2` — never TTF or OTF on the web. Fonts are self-hosted in `apps/web/public/fonts/` (spec §7.4).
- Set type from the eight-step fluid scale: `text-nameplate`, `text-h1`, `text-h2`, `text-h3`, `text-lead`, `text-body`, `text-caption`, `text-folio` (design brief §3.7). Each step carries its own line height and tracking. Never pick a default Tailwind size instead.
- Name a font by its role, never by its family: `font-heading`, `font-body`, `font-data`, `font-mono` (design brief §3.2). There is no `font-accent`: PR2 removed the retired role. Zine's handwritten callout runs on the `--callout-font` component token, which is a component contract and not a fifth role.
- `font-variant-numeric: tabular-nums` on all dynamic values: timers, counters, prices, schedule columns.
- Long-form text: 60–75 characters per line.
- `text-wrap: balance` on headings, `text-wrap: pretty` on descriptions, neither on long-form.
- `overflow-wrap: break-word` wherever long words, links, or IDs might overflow; `white-space: nowrap` for labels and badges.
- Set `-webkit-font-smoothing: antialiased` and `-moz-osx-font-smoothing: grayscale` once, on the root.
- Store copy in natural case; control presentation with `text-transform`. (This matches the email rule in spec §6 — content and presentation stay separate.)
- Smart punctuation: curly quotes, en dashes for ranges, em dashes for asides, the single ellipsis character.
- `text-underline-position: from-font` with `text-decoration-skip-ink: auto`.
- Truncated text stays fully accessible via tooltip or an expanded view.

## Colors

- Every palette step must earn its place — no unused steps.
- Use semantic tokens (`--color-text-secondary`), never primitives (`blue-500`). This is the same rule the hex sweep enforces in code: colors resolve through `config/theme` custom properties (spec §7.2).
- Name tokens by role, never by appearance or first use. Reserve `accent` for the brand color so `primary` doesn't mean both brand and body text.
- Don't borrow a token from another role; when a role changes color, mint a new token.
- Measure contrast against the actual rendered background, not the page background.
- Dark mode is its own palette, not light mode reversed. Every color token is defined under both `:root[data-mode='light']` and `:root[data-mode='dark']`, and a token missing from either block is a bug (design brief §8.2).
- The mode comes from `data-mode` on the root element. `config/theme.mode` sets the policy — `light`, `dark`, or `system` — and `lib/modeRuntime.js` writes the attribute. Never add a `.dark` class of your own.
- The preset comes from `data-theme` on the root element, and its values are the six preset ids (design brief §3.4). A theme remaps the same custom properties. It never introduces a property name and never introduces a class. `EventConfigProvider` writes the attribute from `config/theme.preset`.
- The motif set comes from `data-motif-set` on the root element (design brief §3.8). A custom property cannot rewrite the asset a second custom property points at, so the set switch is an attribute for the same reason the mode and the theme are. Render a motif as a `mask-image` painted with `--color-ink-motif`, or inline it as an SVG symbol reading `currentColor` — never as an `<img>`, never as a `url()` fill.
- The admin has its own fixed palette: the `admin-*` tokens (design brief §5.2). The admin obeys `data-mode` and ignores `data-theme`, so the `admin-*` blocks are emitted once per mode and never once per theme. `--admin-client-accent` appears in exactly two places, the active-docket marker and the page-header mark, and it falls back to `--admin-ink` when it cannot be read on the admin ground.
- Every palette block matches a scoped element as well as `:root` (`scripts/lib/tokens.cjs`). That is what lets the theme editor's frame render the client's pages inside the admin: the frame carries `data-theme`, `data-mode`, and `data-motif-set` for the draft and resolves the whole set from its own declarations. The `admin-*` blocks stay root-only, because the admin never renders inside that frame.
- Use the rule tokens for rules: `--rule-hairline-*`, `--rule-strong-*`, `--rule-nameplate-*` (design brief §3.7). A rule never borrows an ink step and never carries brand color.
- A form control's boundary (`input`, `select`, `textarea`) uses `--color-border-control`, never `--rule-hairline`. WCAG 1.4.11 needs 3:1 against the ground it renders on; a rule is tuned for low-contrast structure and falls well short of that bar.
- One theme mechanism, used consistently. This repo's choice: the `config/theme`-driven custom-property chain (spec §7.2) — not ad-hoc `.dark` classes per component.
- Define gradient interpolation: `in oklab` for even brightness, `in oklch` for vivid midtones.

## The admin surface

The admin CMS is the seventh design surface and it is not a preset. The full spec is `docs/plans/2026-08-27-admin-identity-story.md`; these are the rules a review checks.

- **It reads `admin-*` tokens only.** A `brand-*` utility, a `font-heading`, or a `rounded-brand` inside the admin shell is a bug: the room would restyle itself every time a client changed their palette. The public site's own controls live in `components/forms/publicForm.jsx` and the admin's in `admin/components/formControls.jsx`; neither imports the other.
- **Navigation is the docket:** a grouped standing list of words down the leading edge — content, people, operations, system — with group heads as folios on a hairline. No icon rail, no collapse to glyphs, no counts in bubbles. The active item carries four signals, never colour alone: the accent marker, the semibold weight, a ground shift, and `aria-current="page"`.
- **A page header is the job line:** the section name on `--admin-rule-header` with the client mark at the rule's leading end, and the record's state and identifiers beside the name or under it — never above it.
- **Three state words, everywhere:** `Draft`, `Live`, and `Live with unpublished changes` (`admin/recordState.js`). A record with a draft sits on `--admin-ground-proof`, and a successful publish resolves that tint to the base ground over 160ms on `opacity` — instantly under `prefers-reduced-motion`. The tint is the second signal; the word is always present.
- **A destructive action stands still and states what it costs** (`DestructiveConfirm`): the alarm ground inside the alarm rule, a sentence naming what is removed and whether anything survives, and a confirm button that repeats the consequence at normal size. Nothing animates in a destructive moment.
- **Two faces, fixed:** Source Sans 3 carries everything a person reads as language, IBM Plex Mono with tabular figures carries everything the machine owns. If an operator would ever copy it, paste it, or compare it character by character, it is set in the mono.
- **Elevation is tint.** No `--admin-shadow-*` family ships, there is one small radius and no second one, and a region is a ruled and tinted band rather than a floating card.

## Accessibility

- Semantically correct native elements: `button` for buttons, `a` for links.
- Style `:focus-visible`; never remove outlines without replacing them.
- Only `tabindex="0"` and `tabindex="-1"` — positive values break tab order.
- Icon-only buttons get a descriptive `aria-label`; never `aria-hidden="true"` on a focusable element.
- Alt text describes purpose ("Search", not "magnifying glass"); decorative images get `alt=""`.
- Every input has a real label, correct `type`, and `inputmode`. (The OTP input is the first test of this: `inputmode="numeric"`, `autocomplete="one-time-code"`.)
- Never block paste — especially not on the OTP code field.
- Tooltips on disabled controls don't open via keyboard or touch; use visible text or `aria-disabled="true"`.
- Keep submit buttons enabled until the request starts; validate on submit with `aria-invalid="true"` and move focus to the error.
- Hit areas: 24×24px minimum, 44×44px on touch, 40×40px desktop where possible.
- `pointer-events: none` on decorative elements (glows, texture overlays).
- Wrap hover styles in `@media (hover: hover)`; wrap motion in `@media (prefers-reduced-motion: no-preference)`.
- `role="status"` for routine updates, `role="alert"` for urgent errors only.
- Never color alone for a status — pair it with an icon, label, or underline.
- Skip-to-content link is the first focusable element; anchored headings get `scroll-margin-top`.

## Layout

- The gap between groups is at least twice the gap inside one: 8px within, 16px+ between. Use the named spacing steps (`--space-3xs` through `--space-3xl`), which are built to that rule: `xs` pairs with `md`, `sm` with `lg`, `md` with `xl`.
- Logical properties (`margin-inline-start`, `padding-inline-end`), not directional values.
- No fixed widths or heights on text containers.
- A system page states its own shape in `cmsPages.layout`: `header` (`nameplate` or `nameplate-compact` — there is no headerless page), `arrangement`, `density`, and `navPlacement`. A page that states none renders the defaults, and nothing migrates.
- Sections carry a `slot`. The order down a system page is nameplate, `above` sections, the page's own core content, `main` sections, `below` sections. A section with no slot is `main`, which is where it has always rendered. A custom page has no core content, so it ignores the slot.

## Rejected patterns

The list the design brief settles in §2.4, recorded here so a review has one place to look. This is holistic guidance, not a checklist to game: a reviewer may reject a pattern this list does not name, and may accept a listed pattern only where the brief grants an exception.

- **Eyebrow furniture.** Nothing sits directly above a heading. See Editorial devices above for the full rule and its two non-exceptions.
- **Decorative gradients.** No gradient blobs, no purple-heavy gradients, no gradient as a background event.
- **Glassmorphism.** No frosted panels, no blurred translucent overlays used as style.
- **Zero-padded decorative numbers.** No `01` / `02` / `03` motifs.
- **Headline tricks.** No italicized or underlined single word in a headline.
- **Carousels.** No sliding text carousels, no auto-advancing content.
- **The tan-canvas look.** No warm-tan canvas paired with an oversized primary action.
- **Colored card edges.** No arbitrary colored left edge on a card, button, or block. No decorative colored rule across the top of a card.
- **Tiny low-contrast subtext.** Body-adjacent text meets the contrast bar in both modes.
- **Pulse dots.** No glowing dots, no pulsing status dots.
- **Fake 3D stacking.** No box-behind-box layering, no pointless depth.
- **Generic SaaS framing.** No startup marketing voice, no self-justifying subheads, no insider-facing copy a visitor does not need.
- **Pill-shaped everything.** No fully rounded decoration across the interface.
- **Default-typeface tells.** Never ship Inter alone, Space Grotesk, or Geist Mono as the design default. Never use the stereotypical AI-site serif treatment.
- **Dead calls to action.** Every action has a stated workflow behind it.
- **Sectionless scroll.** Every page has named, meaningful sections.
- **Pointless forms.** No newsletter slot without a real purpose and a real backend.
- **Inconsistent dark mode.** A half-applied mode is a bug, not a polish item.
- **Semantic color conflicts.** Never use a color against its familiar meaning, and never use color alone for status.
- **Corner errors.** Never let a rounded-box stroke shrink at the corner — apply the concentric radius rule.
- **Cursor and reveal effects.** No oversized cursor animations, no reveal-on-scroll.
- **Repetition.** No verbose sections, no repeated promotional copy.

The brief names exactly two exceptions, both narrow: a bento grid that passes all five tests in §2.4, and the Zine preset's off-register stamp. Nothing else gets one, and a preset may not grant itself one.

## Writing

- Button labels start with verbs: "Save draft", "Delete project".
- Confirmation buttons repeat the consequence: "Delete project" / "Cancel" — never "Yes" / "No".
- One term per flow: "Continue" or "Next", not both.
- Links describe their destination: "Read the schedule", never "Click here".
- Consistent capitalization everywhere; sentence case is the default.
- Toggles are labeled by their enabled state: "Send read receipts", not "Disable read receipts".
- Empty states orient the reader and offer exactly one next action.
- Address readers as "you", not "the user".
