# Specimen captures — wave 1

Twenty-four full-page captures of the specimen book: six site styles, both
display modes, at 1440px and 390px. They are the review evidence for wave 1
of the design vocabulary expansion
([the record](../../2026-09-10-design-vocabulary-expansion.md), §7).

Each file is `<style>--<mode>--<width>.png`, written at a device scale of
0.5 so a page this long stays under about 1.3MB. Regenerate them with the
committed script rather than by hand:

```bash
VITE_DEMO_MODE=1 npm run build -w apps/web -- \
  --base /eventrunner/demo/ --outDir /tmp/specimen-demo
node scripts/dev/capture-specimen.mjs --dist /tmp/specimen-demo \
  --out docs/plans/evidence/specimen --scale 0.5
```

The build needs the six `VITE_FIREBASE_*` placeholders that
`scripts/build-demo.cjs` passes; without them the app fails to start and the
capture times out waiting for the page.

`--only <section-id>` captures one section at full scale, which is how to
read a device closely: `--only specimen-controls`, `--only specimen-layout`,
`--only specimen-feedback`.

## What to look at

- **Layout (section 4).** The stage band runs the full frame and the measure
  band stops short of it, each with the value it resolves to in the style on
  screen. Under them, the composed first screen: dates, key facts and the
  clock as three equal cells with a hairline in the gutter at 1440px, stacked
  at 390px.
- **Controls (section 10).** Every shared control, in the states it has. Read
  down one state across the five shared shapes at the top — rest, hover,
  focus, pressed, unavailable, busy — and check that each one is a different
  picture. The hover and press cells are forced by setting the tint share the
  shared rule reads, so they show the tint the control actually takes rather
  than a colour painted for the capture. Under each grid is the list of
  states that control does not have, with the reason.
- **Feedback (section 12).** Both toast tones on the alternate ground, where
  the rule that carries the tone is visible; the dialog frame on its scrim;
  and the loading rows, which are hairlines rather than a skeleton and do not
  move.
- **Inputs (section 11).** The text field, the select and the text area in
  four states. The drawn checkbox and radio are in Controls, not here.
- **Across the styles.** A device that renders the same in all six is a
  device the system has not remapped. That is a finding, not a pass.
- **At 390px.** Nothing should run off the side. The schedule grid is the one
  region allowed to scroll sideways, inside its own box.

## What the last pass found

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
