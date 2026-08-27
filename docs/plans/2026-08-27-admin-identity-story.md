# Admin CMS visual story — the seventh surface

**Date:** 2026-08-27
**Status:** Settled. Read before admin work starts (brief §5.2, PR2).
**Binding source:** `docs/plans/2026-08-27-design-system-overhaul.md`. Where this document and the
brief disagree, the brief wins. Brief §5.2 points here for the full spec.
**Companion:** `docs/plans/2026-08-27-preset-visual-stories.md`. This page uses the same six parts
and the same register.

## How to read this document

This is the seventh design surface. It is not a seventh preset. The six presets are what a client
picks; this is what Event Runner *is*, on every deployment, forever.

The shared rules at the top of `docs/plans/2026-08-27-preset-visual-stories.md` apply here in full,
with three changes that come from the brief:

- **The admin has one fixed identity.** It ignores `data-theme`. It obeys `data-mode`, and both
  modes are fully designed (§5.2, §3.3).
- **The admin gets no expressive interaction.** The one-per-surface slot for expressive motion is
  spent on the public site's schedule grid (§2.2). The admin's motion budget is functional motion
  only: 120–200ms, `transform` and `opacity`, `ease-out`, wrapped in
  `@media (prefers-reduced-motion: no-preference)`. There is no admin signature interaction, and
  part 3 below names none.
- **Part 6 is a token contract, not an option list.** The admin is not configurable, so there is
  nothing for a picker to pick. Part 6 states the `admin-*` token families PR2 must ship instead.

Everything else carries over unchanged: Tonal grounds, near-black ink, tint elevation, no eyebrows
anywhere, dark mode authored as its own place.

---

## 7. Admin CMS — the fixed Event Runner identity

### 1. The story

You are not on the paper. You are in the room where the paper gets made.

This is the composing room: The long bench, the steel imposing stone, the standing racks of matter
waiting to run. A page here is a physical thing being assembled — set, proofed, marked up, corrected,
locked, and sent to press. Nothing in this room is for the public. The surfaces are hard and
close-toned, the light is even, the labels are exact, and every measurement is written down because
somebody downstream depends on it being right. The room is dense on purpose. An operator who runs
this event twice a day has earned information, not whitespace.

The room and the paper belong to the same trade — the same rules, the same folios, the same ink
that is never spent on decoration — but they are made of different material. The public presets are
paper: Warm stock, wide measure, generous air. The admin is the *metal* that prints the paper: Lead
alloy, oiled steel, graphite, proof stock pulled rough off the galley. That single material
difference is what keeps the two surfaces recognisably related and never confusable. An operator
switching between them always knows which side of the press they are standing on.

The room's promise is competence. It never sells you anything, never congratulates you, never
performs progress at you. It shows you what is set, what is proofed, what is live, and what will
change if you press the thing you are about to press.

### 2. The vocabulary

- **The room** — the admin shell. One base ground, one ink, hairline rules, one density: Tight. The
  room has no hero, no dashboard, no landing panel. Signing in puts you on a work surface.
- **The docket** — the navigation. Fourteen named sections do not fit a tab row honestly, so they
  read as a standing list down the leading edge, grouped by what the operator came to do: Content,
  people, operations, system. Group heads are folios on a hairline. Every item is a word. No icon
  rail, no collapse-to-mystery-glyphs, no counts in bubbles.
- **The stone** — the main work surface. One column of the current job at full measure, ruled into
  named regions. Regions are separated by rules and by tint, never by floating rounded cards.
- **The job line** — the page header. The section name in the UI face, sitting on
  `--admin-rule-header`, with the record's state and identifiers in the data face **beside** it or
  under it. Never above it. The page header carries the client accent mark and nothing else
  coloured.
- **The copy bench** — forms. A `<label>` in the UI face, its hint under the label, the field on the
  input ground inside a hairline, the error under the field. Labels stay short and say exactly what
  they set. One radius in the whole room, small; nothing is a pill. (A `<label>` above its own input
  is not an eyebrow. The eyebrow ban is on label text stacked above a *title*; it does not touch
  form labels, and a builder must not "fix" them.)
- **The galley** — tables and record lists. Hairline rows, a sticky head on `--admin-rule-strong`,
  fixed column order, data columns in the mono with tabular figures, numbers right-aligned so the
  column edge stays true. No zebra striping — the hairline already does that work, and striping is
  the tell of a default table. No row cards, no row shadows, no hover lift.
- **Set / proofed / live** — the three states of any record, said in exactly these words across every
  editor: **Draft**, **Live**, and **Live with unpublished changes**. One term per flow (§8.5). The
  state is a word in the data face on the row and in the job line, never a coloured pill and never
  colour alone.
- **Lock-up** — publishing. "Save draft" writes the galley. "Publish page" locks the forme and sends
  it to press. Two acts, two buttons, both verb-first, and the confirmation repeats the consequence.
  The admin never blurs the two into one ambiguous "Save".
- **The query** — the error surface. A proofreader's query is written on the proof in a hand you
  cannot mistake for the text. Server rejections render verbatim on the alarm ground inside an alarm
  rule, `role="alert"`, with focus moved to them, exactly as `ServerErrorSummary` does today. Field
  errors sit under their field with a mark and a word. The failed value is never silently discarded.
- **Dead matter** — archived, revoked, disabled, and superseded rows. They drop to the standing-matter
  ink and keep every word. Nothing is hidden to make the room look tidy.
- **The cut file** — the media library. A print shop's cabinet of engravings, not a photo gallery.
  Two drawers, `Page images` and `Branding`, kept apart because they answer different questions. Each
  asset shows its storage path, its size, its dimensions, and what references it, all in the data
  face. The thumbnail is evidence; the metadata is the point.
- **The proof** — the live-preview theme editor. See moment 2.
- **Type roles** — the UI face is **Source Sans 3**, already bundled, and it carries everything a
  person reads as language: Labels, headings, hints, buttons, prose. The data face is **IBM Plex
  Mono** with `font-variant-numeric: tabular-nums`, and it carries everything the machine owns: Ids,
  paths, slugs, timestamps, counts, hex values, token names, storage keys, states. The dividing rule
  is one sentence: **if an operator would ever copy it, paste it, or compare it character by
  character, it is set in the mono.** There is no third face and no configurable face.
- **Motifs** — none, in any slot, ever. `--motif-set` does not reach this surface, and
  `data-motif-set` never lands on an admin root (§3.8). A workroom does not ornament itself.
- **The job mark** — the client logo, in the top-left slot. It is the shop's job ticket: Whose work is
  on the stone right now. One fixed height, on the base ground, no frame, no glow, no card. It
  answers "which deployment am I in" at a glance and does nothing else.
- **The shop's spot ink** — `--admin-client-accent`. A print shop runs one job's spot colour at a time,
  and the ink stays on the job; it never gets spread across the furniture. This accent appears in
  exactly two named places (§5.2): The active-docket marker and the page-header mark. Nowhere else.
  Not on buttons, not on links, not on rules, not on focus rings, not on charts, not on states. Two
  places is a rule a reviewer can grep for.
- **Dark mode** — **the night side.** The day crew has gone and one lamp is over the stone. The
  grounds go to banked lead, the rules lift so they stay felt, the proof ground reads as the one
  lighter panel under the lamp, and the type casts warm bone rather than screen white. It is the same
  room at a different hour, authored value by value. It is never the light palette reversed.

### 3. Three signature moments

None of these is expressive motion. Each is a static composition plus, at most, one functional
transition. The admin has no signature interaction by design.

1. **Draft and live read as two different grounds, and the galley tells you which.**
   Every record list carries a state column in the data face at a fixed position: `Draft`,
   `Live`, or `Live · unpublished changes`, with the timestamp and the operator beside it. A record
   with unpublished changes sits on `--admin-ground-proof` — a distinctly toned band, the rough stock
   a proof is pulled on — while live records sit on the base ground. Bind it: The tint is the second
   signal, never the first; the word is always present; the ground shift is a tint, not a colour
   fill, not a left edge, not a badge. On a successful publish the row resolves from the proof ground
   to the base ground over 160ms on `opacity` only, the state word swaps to `Live`, and a stated line
   appears in place under the action — not only in a toast that leaves. Under
   `prefers-reduced-motion` the resolve is an instant swap. This one device carries the whole
   draft/live distinction across pages, content, speakers, sessions, and branding, so an operator
   learns it once.

2. **The theme editor puts the client's page on the stone.**
   The branding editor is a split view: The controls bench on one side, the client's real rendered
   page on the other. The preview is framed as a forme locked in a chase — a hairline frame on the
   room's ground, held at true scale, with the page identification line set **below** the frame on a
   hairline in the data face: `Home · light · unpublished draft`. Below, not above, because a label
   stacked over the frame would sit above the page's own nameplate and become an eyebrow. The
   light/dark tabs are two proofs of the same forme, and switching them re-renders instantly with no
   animation, because wayfinding is instant (§2.2). The room around the frame never adopts the
   client's theme; the client's design is contained inside the frame, which is precisely the point —
   you can tell at a glance where their work ends and your tooling begins.

   The bench has two depths (§5.2). The curated option pickers come first: The preset, then its
   heading face, its nameplate treatment, and its component variants. Raw per-mode token override
   sits behind its own disclosure as the advanced path. Most operators never open it.

   When a per-mode override fails contrast on a defined foreground and background pair, the failure
   appears inline in the control that caused it, in words, naming the pair, the mode, and the
   measured ratio in the data face, and the frame keeps rendering so the operator can see what they
   have done. A draft may hold a failing value. Publishing one may not: `updateTheme` rejects the
   write and states the same three facts (§5.2). Keep `applyThemePreview` and `buildRuntimeThemeCss`
   as the one path (§5.2).

3. **A destructive action stands still and states what it costs.**
   Deletes, revokes, and overwrites render on `--admin-ground-alarm` inside `--admin-rule-alarm`,
   with the alarm ink on the words. The colour is never the only signal and never the loudest one:
   the sentence names what is removed, where it goes, and whether anything survives ("The draft stays
   in the version history"). The confirm button repeats the consequence — "Delete this page", never
   "Confirm" — and it is a normal-sized button, because an oversized primary action is the pattern
   §2.4 rejects and a destructive one is the worst place to start. Nothing animates in a destructive
   moment: No shake, no pulse, no countdown, no colour transition. A still surface reads as serious;
   a moving one reads as a game. Where an action cannot be undone, the sentence says so in the same
   words every time.

### 4. Palette words

- **Light:** proof-stock grey, type-metal near-black, lead-grey rule, bench graphite, galley tint
  (the proof ground), oiled-steel focus, oxide alarm red, checked green, held caution amber,
  standing-matter grey.
- **Dark:** night-side charcoal, cast-bone type, banked lead rule, lamp graphite, night galley tint,
  lit-steel focus, held oxide red, held green, held amber, dead-matter grey.

Bind: The light ground is a warm-leaning grey pulled toward lead and proof stock, not a cool
blue-grey. The distance from generic dashboard slate is a stated design requirement, not a taste
preference — see part 5.

### 5. What this story refuses

- **Refuses the slate SaaS dashboard, by name.** The CJS2026 production admin fell into it: A
  blue-grey `slate-50` canvas, white rounded cards floating on soft grey shadows, coloured status
  pills, an icon sidebar, and a stat-tile row across the top. It was indistinguishable from every
  template of its year. Every one of those devices is refused here individually: The ground is warm
  lead, not cool slate; panels are ruled and tinted regions, not floating cards; elevation is tint,
  never shadow; states are words in the data face, never pills; navigation is words, never an icon
  rail. If a reviewer can screenshot the admin and mistake it for a generic dashboard, this story has
  failed and the pull request does not merge.
- **Refuses dashboard theatre.** No welcome panel, no KPI tile row, no sparkline wall, no
  activity-feed widget, no progress ring, no empty analytics card waiting for data. If a number
  appears in the admin it is either a plain count in the data face beside the thing it counts, or it
  meets the §2.1.1 stat contract in full. There is no third option.
- **Refuses status colour without a word.** Every state carries its word. No green dot, no amber dot,
  no pulsing "live" indicator — pulse dots are banned outright (§2.4), and a glowing dot in operator
  tooling is a lie about urgency.
- **Refuses the client's theme.** The admin never reads `data-theme`, never mirrors the client
  palette, and never inherits a preset font. The current shell does mirror it (see the note at the
  top of `AdminLayout.jsx`); PR2 ends that. The live preview's frame is the only place a client's
  design renders inside the admin.
- **Refuses accent spread.** Two places. A third use of `--admin-client-accent` is a review failure
  with no discussion, because the accent is an arbitrary client value and every additional use is one
  more contrast surface nobody tested.
- **Refuses expressive motion entirely.** No page transitions, no skeleton shimmer (a shimmer is
  ambient animation, which is banned), no animated save checkmark, no number that counts up. Loading
  is a stated line: "Loading sessions". Saving is a stated line. The room does not perform.
- **Refuses disappearing confirmation.** A result is stated in place, next to the control that caused
  it, and it stays. A toast may repeat it; a toast may never be the only record of what happened.
- **Refuses eyebrows.** No label text above any title, in any panel, at any size — including the
  tempting "SECTION" folio over a panel heading. A folio here sits beside a rule or in the job line,
  the same as everywhere else in the system.
- **Refuses the warm-tan canvas.** #109's rejected look does not return by the side door of "making
  the admin feel friendly". The room is not friendly; it is legible.
- **Refuses mystery-meat density.** Dense is not cramped. Hit areas hold 24×24px, and 44×44px on
  touch. Every icon that carries meaning carries a label. Density comes from tightening the leading
  and the gutters, never from shrinking targets or dropping labels.
- **Declined from the preset stories:** the Zine stamp layer, all marginalia, all motifs, all texture,
  the drop cap, and the multi-column measure. Those are devices of the printed object. This is the
  room that prints it.

### 6. The token contract

The admin is fixed, so there are no client-facing options. This part states instead what PR2 must
ship as tokens. Rules that bind the whole set:

- Every token below resolves under `:root[data-mode='light']` **and** `:root[data-mode='dark']`. The
  §8.2 test covers the `admin-*` set exactly as it covers the presets.
- The admin blocks are emitted **once per mode**, never once per `(theme, mode)` pair. That is the
  mechanical statement of "the admin ignores `data-theme`", and it is the thing to assert in a test.
- Colours keep the RGB-triple form (§3.6) so Tailwind's alpha modifiers keep working.
- The admin reuses the tier-2 type scale and spacing scale. It retunes steps for a tight density; it
  **adds no step**, exactly as a preset may not.
- Component tokens default to the admin semantic tokens (§3.1). Components never read a primitive.
- No `--admin-shadow-*` family ships. Elevation is tint. No gradient token ships. No second radius
  ships.

**(a) Grounds — the surfaces of the room.**

1. `--admin-ground` — the room itself. The base page ground, tonal, never pure white or pure black.
2. `--admin-ground-raised` — a region sitting above the room, reached by tint, not by shadow.
3. `--admin-ground-proof` — the draft / unpublished-changes ground. Carries moment 1.
4. `--admin-ground-input` — the ground inside a form control, distinct from both above so a field
   reads as a field without a heavy border.
5. `--admin-ground-alarm` — the destructive and rejection ground. Low chroma; the words carry the
   weight.

**(b) Inks — what is set on those grounds.**

1. `--admin-ink` — primary text. Near-black in light, cast bone in dark. Never `#000`, never `#fff`.
2. `--admin-ink-secondary` — hints, metadata, and support text. Clears the contrast bar; "muted"
   never means "below the bar".
3. `--admin-ink-data` — the mono role's ink, tuned so a dense mono column does not out-weigh the
   prose beside it.
4. `--admin-ink-inverse` — text on a filled control.
5. `--admin-ink-disabled` — dead matter and disabled controls. Still readable.
6. `--admin-ink-link` — the admin's own link colour, which is never the client accent.

**(c) Rules — the structure.**

1. `--admin-rule-hairline` — row, field, and region separators. The workhorse.
2. `--admin-rule-strong` — region and table-head boundaries. One per region.
3. `--admin-rule-header` — the job line's rule, the heaviest rule in the room.
4. `--admin-rule-alarm` — the rule around a destructive or rejected surface.

Each ships as a colour plus a width pair, as §3.7 requires. No rule ever carries the client accent.

**(d) States — semantic, and never used alone.**

1. `--admin-state-live` — ink and ground for the published state.
2. `--admin-state-draft` — ink and ground for the unpublished state; the ground is
   `--admin-ground-proof`.
3. `--admin-state-error` — ink for a rejection; the ground is `--admin-ground-alarm`.
4. `--admin-state-caution` — ink for a warning that is not a failure: A low-contrast pair the
   publish validator does not cover, an unverified sender, an unreviewed legal template.
5. `--admin-state-ok` — ink for a completed action.

Bind: Every state token pairs with a required word in the UI. A component that renders a state token
without its word fails review (§8.1, never signal status with colour alone).

**(e) Focus — the one ring.**

1. `--admin-focus-ring` — a single visible focus colour that clears **both** `--admin-ground` and
   `--admin-ground-input` in both modes.
2. `--admin-focus-offset` — the offset width, so the ring never collides with a hairline.

Bind: Focus is never the client accent, because the client accent is not guaranteed to clear
anything. `:focus-visible` is styled everywhere; an outline is never removed without a replacement.

**(f) The client slots — exactly two, and named as such.**

1. `--admin-client-accent` — the one client-owned colour, written from `config/theme` through
   `buildRuntimeThemeCss` like any other override.
2. `--admin-client-accent-ink` — the ink that reads *on* the accent, for the rare case the marker is
   filled behind a glyph.
3. `--admin-nav-active-marker` — component token, defaults to `var(--admin-client-accent)`. The
   active docket item's marker: A short solid accent rule at the item's leading edge, full item
   height, 2px. This is not the banned coloured card edge — it marks the operator's current position,
   it never appears on a card or a button, and it never appears on an inactive item. Colour is not
   the only signal: The active item also carries the semibold weight, a ground shift, and
   `aria-current="page"`.
4. `--admin-page-header-mark` — component token, defaults to `var(--admin-client-accent)`. A small
   solid mark sitting **on** `--admin-rule-header` at its leading end, beside the section name. The
   ink dot a compositor puts on the chase. Never above the name.

Bind: These two component tokens exist so the two-places rule is enforceable and greppable. Any other
reference to `--admin-client-accent` in `apps/web` fails review.

Bind: **the accent has a legibility floor.** A client picks the value, so it may be unreadable on one
or both admin grounds. PR2 must test the resolved accent against `--admin-ground` in each mode; when
it fails, both slots fall back to `--admin-ink` and the theme editor states plainly that the accent
is too low-contrast for the admin marker and shows what it fell back to. The admin never renders an
invisible position marker.

**(g) Type and shape — fixed, not configurable.**

1. `--admin-font-ui` — Source Sans 3. Already bundled; costs the font budget nothing.
2. `--admin-font-data` — IBM Plex Mono, `tabular-nums` wherever a value changes (§3.2).

The admin runs two faces where a preset runs four. `--admin-font-ui` covers the heading and body
roles from §3.2. `--admin-font-data` covers the data and mono roles together, which is why the
dividing rule above is a single sentence.

3. `--admin-radius` — one small radius for the whole surface. There is no second radius token and no
   pill radius, which is what stops `rounded-brand` and `TypeBadge`-style shapes from arriving here.

Bind: No `--admin-font-*` token is ever writable from `config/theme`. The pairing is the identity
(§5.2).

---

## Cross-check against the brief

| Rule | How this story complies |
|---|---|
| §5.2 fixed identity | One identity, `data-mode` only, no `data-theme` read. Stated as a token-emission rule so it is testable. |
| §5.2 two client elements | The job mark (logo) and the spot ink (accent) in two named component slots, with a legibility floor and a grep rule. |
| §5.2 type pairing | Source Sans 3 plus IBM Plex Mono, tabular, non-configurable, with a one-sentence rule for which face holds what. |
| §5.2 live-preview editor | Moment 2 keeps the split view, the real-page preview, draft/publish, per-mode tabs, `applyThemePreview`, and the logo slots. It adds the two editing depths and states the contrast failure as a publish-time error. |
| §5.2 publish path | The shared resolver writes the resolved legacy colors map into `config/theme` on publish, so email and PDF keep rendering with no overrides stored. |
| §2.1 devices | Rules, folios, and the stat contract carry over. The nameplate and the drop cap do not apply to tooling and are declined. |
| §2.2 motion | Functional only. No expressive moment claimed. No shimmer, no transitions, no ambient anything. Reduced motion is an instant swap. |
| §2.3 motifs | None on this surface, in any slot. |
| §2.4 anti-patterns | Part 5 names the pills, the icon rail, the KPI tiles, the pulse dots, the shadows, the tan canvas, the coloured edges, and the eyebrows individually. |
| §3.1 tiers | Part 6 ships semantic `admin-*` tokens plus two component tokens. No component reads a primitive. |
| §3.3 dark mode | Dark mode is the night side, authored value by value, with its own palette words. |
| §3.7 scales | The admin reuses the type, spacing, and rule scales and adds no step. |
| §8.1 accessibility | One focus ring clearing both grounds, states never colour-alone, 24/44px hit areas, labels on every meaningful icon, verbatim server errors with `role="alert"` and focus moved. |
| §8.2 complete dark mode | Every `admin-*` token resolves in both modes; the existing test extends to the set. |
| §8.5 copy | STE plain language, verb-first buttons, one term per flow (`Draft` / `Live` / `Live with unpublished changes`), consequences repeated in confirmations. |
| CJS2026 finding | The generic slate dashboard is refused by name, device by device, with a screenshot test stated as the merge bar. |

## What the brief settled

Four questions were open when this document was drafted. All four are settled, and brief §5.2
records each one. Nothing here waits on the user.

1. **The docket replaces the tab row.** `AdminLayout.jsx` renders fourteen sections as a wrapping
   row of tabs today. PR2 sets them as a grouped standing list down the leading edge. The four
   groups are **content**, **people**, **operations**, and **system**. Group heads are folios on a
   hairline.
2. **The state vocabulary is these three words:** `Draft`, `Live`, and `Live with unpublished
   changes`. They replace whatever each tab says today, across pages, content, speakers, sessions,
   badges, and branding. One term per flow (§8.5).
3. **The accent falls back; it is never clamped.** When a client's accent fails contrast on an
   admin ground, both accent slots fall back to `--admin-ink`, and the theme editor states plainly
   that the accent is too low-contrast for the admin marker and names what it fell back to.
   Clamping the value silently changes what the client chose, so the system does not clamp.
4. **A dialog scrim is a tinted ink overlay, never a blur.** Modals and pickers carry tint
   elevation plus a strong rule plus that scrim. Glassmorphism stays rejected (§2.4), and no
   `--admin-shadow-*` family ships.

Two rules from §5.2 land in the admin's PR2 work beside these:

- A contrast failure on a defined foreground and background pair is a publish-time error in
  `updateTheme`, not a warning. Moment 2 carries it.
- On publish, one shared resolver in `packages/shared` materializes the resolved legacy colors map
  into the stored `config/theme` document, so email and PDF keep rendering for a client who runs a
  preset with no overrides.
