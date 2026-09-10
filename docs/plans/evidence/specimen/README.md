# Specimen captures — wave 1

Twenty-seven section captures of the specimen book, at full scale. They are
the review evidence for wave 1 of the design vocabulary expansion
([the record](../../2026-09-10-design-vocabulary-expansion.md), §7).

Each file is `<style>--<mode>--<width>--<section>.png`:

| Files | What |
|---|---|
| 18 | the controls, layout and feedback sections at 1440px, light mode, all six site styles |
| 6 | the controls section at 1440px, dark mode, all six styles |
| 3 | the same three sections at 390px, Civic |

**Why sections rather than whole pages.** The first pass committed twenty-four
full-page captures at a device scale of 0.5, about 1MB each. A person cannot
read them: the book is around 9,000px long and at half scale a state label is
a smudge. Evidence a person reads is a section at full scale. The full-page
set is not lost — the committed script regenerates it on demand, and the three
sections here are the ones the wave changed.

Regenerate this set with the committed script:

```bash
VITE_DEMO_MODE=1 npm run build -w apps/web -- \
  --base /eventrunner/demo/ --outDir /tmp/specimen-demo
for section in specimen-controls specimen-layout specimen-feedback; do
  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/dev/capture-specimen.mjs \
    --dist /tmp/specimen-demo --out docs/plans/evidence/specimen \
    --scale 1 --widths 1440 --modes light --only "$section"
done
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/dev/capture-specimen.mjs \
  --dist /tmp/specimen-demo --out docs/plans/evidence/specimen \
  --scale 1 --widths 1440 --modes dark --only specimen-controls
for section in specimen-controls specimen-layout specimen-feedback; do
  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/dev/capture-specimen.mjs \
    --dist /tmp/specimen-demo --out docs/plans/evidence/specimen \
    --scale 1 --widths 390 --modes light --styles civic --only "$section"
done
```

The build needs the six `VITE_FIREBASE_*` placeholders that
`scripts/build-demo.cjs` passes; without them the app fails to start and the
capture times out waiting for the page. Drop `--only` for the whole page, and
`--scale 0.5` to keep a full-page file under about 1.5MB.

## What to look at

- **Controls (section 10).** Every shared control, in the states it has. Read
  down one state across the five shared shapes at the top — rest, hover,
  focus, pressed, unavailable, busy — and check that each one is a different
  picture. The hover and press cells are forced by setting the tint share the
  shared rule reads, and the focus cell composes a class that repeats the
  shipped `:focus-visible` declarations, so both show what the control takes
  rather than a colour painted for the capture. The table at the head of the
  section prints the live value of each share and of the ring, so the ring in
  a cell has to match the "Ring width" row above it. Under each grid is the
  list of states that control does not have, with the reason: a boxed control
  says it composes the shared rule, and a field says it takes no tint.
- **Layout (section 4).** The stage band runs the full frame and the measure
  band stops short of it, each with the value it resolves to in the style on
  screen. Under them, the composed first screen: dates, key facts and the
  clock as three equal cells with a hairline in the gutter at 1440px, stacked
  at 390px.
- **Feedback (section 12).** Both toast tones on the alternate ground, where
  the rule that carries the tone is visible; the dialog frame on its scrim;
  and the loading rows, which are hairlines rather than a skeleton and do not
  move.
- **Across the styles.** A device that renders the same in all six is a
  device the system has not remapped. That is a finding, not a pass.
- **In dark mode.** The tint shares are higher there, because the same amount
  of ink is a smaller step on a dark ground. A hover cell that is the same
  picture as its rest cell is a finding.
- **At 390px.** Nothing should run off the side. The schedule grid is the one
  region allowed to scroll sideways, inside its own box.

## What the passes found

Read on the captures of 2026-09-10, and fixed in the same wave:

- The row control's unavailable cell was identical to its rest cell. The text
  register has no ground, so its unavailable ink is the ink it already sits
  in — and the product does not draw a dead row control at all. The book now
  names the state as absent, with the reason.
- The row control's busy moment was silent: both call sites drop the control
  out of the tab order for the length of a write. They mark `aria-busy` now.
- The two toast tones were one picture with two words on the page's own
  ground, because the rule that carries the tone is drawn in that ground. The
  stills moved to the alternate ground, where the halo and its weight show.
- The focus cells drew a 2px ring under a table printing "Ring width 3px".
  The forced state is one class that repeats the shipped rule, and a test
  pins the two together.
- Five control specimens said their hover and their press were the rule every
  boxed control composes. A field composes none of it, and says so now.
- The back-to-top control mounts on scroll and was landing in the middle of
  the 390px captures. The capture script hides what the page fixes to the
  viewport before it shoots.
