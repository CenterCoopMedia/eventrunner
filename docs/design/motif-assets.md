# Motif asset rules

Motifs are small interface drawings, not full-size illustrations. Author each file for its smallest live slot and remove detail that cannot survive that size.

## Live sizes

- `section-mark.svg`: 20 × 20 CSS pixels.
- `nameplate-mark.svg`: 24 × 24 CSS pixels in the compact nameplate.
- `divider.svg`: 32 CSS pixels high; measure at a 320-pixel content width.
- `empty-state.svg`: 128 CSS pixels high.

## Drawing rules

- Every rendered stroke must be at least 0.5 CSS pixels after `mask-size: contain` scales the SVG into its smallest slot. Prefer a larger margin when a form permits it.
- Simplify the drawing before increasing line weight. Hatching, stipple, feathers, and fur marks that collapse into grey noise do not belong in a small slot.
- Use `currentColor` only. The motif is painted through the theme mask and must work in light and dark mode without a second asset.
- Keep the viewBox tight enough that the drawing uses the slot. Empty canvas reduces every effective stroke.
- Decorative motifs carry no text or meaning. They remain hidden from assistive technology and cannot replace a labelled icon.

`motifAssets.test.js` measures the committed fauna drawings against these slot sizes so later edits cannot reintroduce sub-pixel strokes.
