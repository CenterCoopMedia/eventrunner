# 27: hero spacing (#345, #478)

Branch `joe/blissful-einstein-9qvtd1-27-hero-spacing`, from `origin/main` 2ef0d8a.

## #345: hero text overlaps the photo

- What changed: the hero copy column is now declared once on `.event-hero`
  (`--hero-copy-column`). The photograph and its veil start where the column
  ends. A new token, `--hero-copy-min-inline-size` (`max(22rem, 50%)`), sets
  the narrowest column, so a style that asks for a wide photograph gets a
  narrower photograph. The veils of the default, Newsroom and Atlas styles now
  soften only the photograph's leading edge. A third token,
  `--hero-title-fit` (`13cqi`, the copy is a size container), caps the title
  size so a long word fits the narrower column.
- Files: `apps/web/src/index.css`, `design/tokens/components.json`,
  `design/tokens/presets/{newsroom,atlas}.json`,
  `packages/shared/src/presetRemaps.cjs` (generated from the presets).
- Test: `e2e/hero-geometry.spec.js`. It measures glyph boxes on Home and
  Program in six styles, two modes, normal and long titles, at 320, 640, 768,
  1024, 1280, 1440 and 1920px. Before the fix it found overlap at every width
  from 640px up in every style (1442 faults); after, none. A later check for
  words broken at a letter found 43 faults with a 42% column and no title cap
  (Newsroom broke "community," at 1024px); after the cap, none.
- Done: yes. NC Local keeps its own rule; it now subtracts the new inset.

## #478: hero inner padding and spacing audit

- What changed: `--hero-inset-inline`
  (`clamp(var(--space-sm), 3vw, var(--space-xl))`) is the copy's inset from
  the hero band's edge, with or without a photograph, on Home and Program. On
  phones the copy keeps the inset on both sides.
- Files: `apps/web/src/index.css`, `apps/web/src/styles/schedule.css`,
  `design/tokens/components.json`, `docs/interface-guidelines.md`.
- Test: the same spec adds the inset checks and a no-photograph pass. Before
  the inset change it found 412 faults; after, none.
- Audit: a scratch script checked every box with its own background or a side
  border on Home, Program, About, FAQ, Speakers and Sponsors in the demo build,
  six styles, two modes, 390 and 1280px. Before: the hero and the compact
  hero touched the edge. After: only the session type badge (5px padding, a
  dense chip, deliberate) is closer than 8px.
- Not met in full: admin cards were not audited, and the 200% zoom check was
  not run. The staff screenshot's deployment and viewport are unknown.

## Decisions the owner may want to change

- The copy column minimum, `max(22rem, 50%)`, makes the photograph at most half
  the hero on desktop, like the NC Local layout. Every style but NC Local gets
  a narrower photograph than before.
- The title cap makes the hero title about 10% smaller than before at 1024 to
  1440px in most styles. Phones are not capped; the long stress title still
  breaks "Neighborhood" at 320px in four styles, as it did before.
- Atlas is no longer a full-width photograph under a veil. It keeps its route
  line and sign.
- Text beside an illustrated hero now sits on the hero band colour
  (`surface-alt`), not the page colour the old veil painted.
