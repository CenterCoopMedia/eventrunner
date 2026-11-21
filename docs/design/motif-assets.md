# Motif asset rules

Motifs are small interface drawings, not full-size illustrations. Author each file for its smallest live slot and remove detail that cannot survive that size.

## Live sizes

- `section-mark.svg`: 20 × 20 CSS pixels.
- `nameplate-mark.svg`: 24 × 24 CSS pixels in the compact nameplate.
- `divider.svg`: 32 CSS pixels high; measure at a 320-pixel content width.
- `empty-state.svg`: 128 CSS pixels high.
- `wait-body.svg` and `wait-part.svg`: 32 × 32 CSS pixels, the held-up figure's slot.

## Drawing rules

- Every rendered stroke must be at least 0.5 CSS pixels after `mask-size: contain` scales the SVG into its smallest slot. Prefer a larger margin when a form permits it.
- Draw each stroke at its final size in the viewBox. Use translation, rotation or reflection to position it. Put any scaling into the path coordinates so the asset check can measure the stroke from the viewBox.
- Simplify the drawing before increasing line weight. Hatching, stipple, feathers, and fur marks that collapse into grey noise do not belong in a small slot.
- Use `currentColor` only. The motif is painted through the theme mask and must work in light and dark mode without a second asset.
- Keep the viewBox tight enough that the drawing uses the slot. Empty canvas reduces every effective stroke.
- Decorative motifs carry no text or meaning. They remain hidden from assistive technology and cannot replace a labelled icon.

## Wait drawings

The held-up figure is two files per set: The body, and the part that moves. Draw both on the same 32 × 32 viewBox so they stack, as solid silhouettes with no strokes, filled with `currentColor`. A silhouette has no stroke width to measure, so the measure is its ink: Rendered at 32px, every visible pixel must sit beside a solid one, which rejects any part thinner than about a pixel. Blunt fine points rather than letting them fade. Record the moving part's pivot and swing in `design/tokens/motifs.json`. The generator inlines both files as data URIs, so a stalled load never fetches them.

`motifAssets.test.js` checks inherited ink for every registered static drawing. At these slot sizes, it checks stroke widths for the Fauna and Cartographic sets and the Botanical divider and empty-state drawing. It also checks the ink and silhouettes of the wait drawings.
