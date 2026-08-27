# Wayfinding icons

These six drawings are **icons, not motifs** (design brief §2.3, §3.8).

Atlas names rooms as stations, concurrent tracks as lettered lines, and a move
between sessions as a transfer (brief §4.6). Each of those marks names a
specific thing, so each one carries meaning. A mark that carries meaning is an
icon, and an icon gets a label.

| File | What it names |
| --- | --- |
| `venue.svg` | A venue. |
| `room.svg` | A room inside a venue. |
| `line.svg` | A line — a concurrent track, lettered A, B, C. |
| `transit.svg` | A transit connection. |
| `walk.svg` | A walking transfer, beside the walking minutes. |
| `step-free.svg` | Step-free access. |

## How to use them

- **Always render an icon with its text label.** "A route mark or wayfinding
  icon without a text label is a puzzle, not a sign" (visual story, Atlas,
  part 5). Icon plus label, in both modes.
- Never `aria-hidden` an icon that carries the only statement of what a thing
  is. Where the label beside it already says the word, mark the drawing
  `aria-hidden="true"` and let the label speak; where the drawing stands alone,
  give it an accessible name.
- These files never render through the motif layer. `--motif-*` slot tokens and
  `data-motif-set` do not reach this directory, and the motif density rule
  (three per page) does not apply — a sign set is not ornament.
- Colour is never the only signal. A line is told apart by its letter and its
  name first; a line colour is a second signal (brief §8.1, §4.6).

## Ink

Every path is `currentColor` or `none`. An icon inherits the ink of the text it
sits beside, in both modes, and it carries no colour of its own. No file here
holds a colour literal — the hex sweep does not lint SVG, so a reviewer checks
it by hand.

Drawn for this repository. Apache-2.0, with the rest of the source.
