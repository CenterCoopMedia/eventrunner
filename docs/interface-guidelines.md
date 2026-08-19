# Interface guidelines

Foundational rules for every `apps/web` surface — attendee pages, admin panel, speaker wizard. Adapted from [interfaces.dev/cheat-sheet](https://interfaces.dev/cheat-sheet) and bound to this repo's own machinery where the two meet (theme tokens, the hex sweep, the a11y bar in CONTRIBUTING). PRs that touch UI are reviewed against this document.

## How this connects to the rest of the repo

- **Colors are theme tokens, never literals.** The ESLint hex sweep (spec §7.6) enforces the mechanical half; this document covers the design half. Every color you use must be a custom property from `config/theme` (spec §7) with a role-based name.
- **Accessibility is a merge requirement, not a nicety.** CONTRIBUTING already requires a keyboard path and visible focus for UI changes; the Accessibility section below is the working checklist behind that line.
- **Event-neutrality applies to design too.** No hardcoded brand color, font stack "for this event," or copy that assumes one venue or city. If a design decision varies per client, it belongs in `config/theme` or CMS content.

## User interface

- Apply concentric border radius across nested elements (inner radius = outer radius − padding).
- Prioritize optical alignment over geometric alignment.
- Add a `1px` outline to images, offset by `-1px`: black at 8% opacity in light mode, white at 8% in dark mode.

## Animation

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
- Dark mode is its own palette, not light mode reversed.
- One theme mechanism, used consistently. This repo's choice: the `config/theme`-driven custom-property chain (spec §7.2) — not ad-hoc `.dark` classes per component.
- Define gradient interpolation: `in oklab` for even brightness, `in oklch` for vivid midtones.

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

- The gap between groups is at least twice the gap inside one: 8px within, 16px+ between.
- Logical properties (`margin-inline-start`, `padding-inline-end`), not directional values.
- No fixed widths or heights on text containers.

## Writing

- Button labels start with verbs: "Save draft", "Delete project".
- Confirmation buttons repeat the consequence: "Delete project" / "Cancel" — never "Yes" / "No".
- One term per flow: "Continue" or "Next", not both.
- Links describe their destination: "Read the schedule", never "Click here".
- Consistent capitalization everywhere; sentence case is the default.
- Toggles are labeled by their enabled state: "Send read receipts", not "Disable read receipts".
- Empty states orient the reader and offer exactly one next action.
- Address readers as "you", not "the user".
