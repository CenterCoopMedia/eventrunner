# Delivery verification — October 11, 2026

The public package contains eight full cuts: a 45-second illustrated trailer,
a 75-second page-publishing guide, a 60-second personal-schedule guide, and an
84-second site-style guide, each in landscape and vertical.

## Encoded files

Every MP4 was decoded in full and checked against its current render inputs,
score dependencies, SHA-256, and flash-analyzer hash. All use H.264, yuv420p,
30 fps, AAC stereo at 48 kHz, and the exact planned frame count. Landscape is
1920 × 1080; vertical is 1080 × 1920. Export repeats the freshness checks.

The final-file measurements below use FFmpeg `ebur128=peak=true` / BS.1770.
The flash columns give the maximum general / red spatial transitions in any
rolling second, not a count of flashes. This native-resolution internal screen
also checks recurring pixels and cumulative red transitions. All files have
zero hazardous frames. It is a conservative screen, not a WCAG certificate.

| Cut | Length | LUFS | dBTP | General / red transitions | Flash screen |
| --- | --- | --- | --- | --- | --- |
| general-trailer · landscape | 45 s | -15.9 | -4.0 | 6 / 0 | Pass |
| general-trailer · vertical | 45 s | -15.9 | -4.0 | 2 / 0 | Pass |
| publish-page · landscape | 75 s | -19.1 | -4.2 | 2 / 0 | Pass |
| publish-page · vertical | 75 s | -19.1 | -4.2 | 2 / 0 | Pass |
| save-schedule · landscape | 60 s | -19.1 | -4.6 | 2 / 0 | Pass |
| save-schedule · vertical | 60 s | -19.1 | -4.1 | 2 / 0 | Pass |
| change-style · landscape | 84 s | -19.1 | -4.1 | 2 / 1 | Pass |
| change-style · vertical | 84 s | -19.1 | -4.1 | 2 / 1 | Pass |

The trailer target is −16 LUFS and the tutorial target is −19 LUFS, each with
±0.5 LU tolerance and a −1 dBTP ceiling. The committed per-file JSON reports
contain the measurements and file hashes. PCM analysis found no clipped
samples, negligible DC offset, silent first/last samples, and less than
0.18 dB loss when folded to mono. The trailer's pre-title pause is silent;
previous chord releases and delay taps cannot spill across the resolving chord.

## Picture, capture, and source review

Both formats were inspected as contact sheets sampled every ninth frame,
with important frames inspected at full size. Separate fast-motion and ending
partials were screened before the final files. Review corrected a discontinuous
camera move, moving high-contrast type, an outgoing caption crossing the final
tagline, and incomplete source-freshness checks. The final title settles four
seconds before the end. [Landscape](trailer-landscape-storyboard.jpg) and
[vertical](trailer-vertical-storyboard.jpg) storyboards show the current trailer.

Fresh local captures repeated all three UI workflows in both formats. All 79
landscape and 81 vertical crop/target records used by delivery match exactly.
Full screenshots are not claimed to be byte-identical: focus, hover and carets
can differ outside the selected region. The capture guard checked every shot;
external requests were blocked and the public fixture is fictional throughout.
See [capture-review.json](capture-review.json).

An independent read-only reviewer checked semantic relationships, real theme
presets, bookmark retention, timing, geometry, privacy, cache keys and export
freshness. Confirmed findings were fixed and rechecked. See the
[design review](design-review.md).

## Software checks

- Video suite: 47 tests passed; TypeScript and targeted ESLint passed.
- Flash analyzer: 30 controlled fixtures passed, including invalid flashes,
  moving detail, cumulative red, single wipes and permitted slow transitions.
- Repository unit tests: 2,946 passed. Web suite: 3,253 passed in 278 files.
- Firestore/Storage rules: 364 passed.
- End-to-end: 73 of 74 passed in the full run. The phone admin test timed out
  during concurrent rendering, then passed in an isolated rerun. This is not
  reported as a clean 74-test run.
- Root lint had zero errors and one existing AccountMenu cleanup-ref warning.
  Copy checks, production dependency audit, web build and budget, generated demo,
  documentation and token checks passed.
- Meaningful bad-input cases reject invalid relationships, overlapping geometry,
  mistimed actions, privacy residue, stale audio, partial renders and stale
  verification reports. The export case rejects five deliberately bad records.

## Preview and remaining human review

The [public preview](../../docs/videos/index.html) contains native players,
settled-frame posters, MP4 downloads and the three full descriptive transcripts.
The accompanying preview report records desktop and 390-pixel layout, keyboard
access, resource availability, no autoplay, and no initial MP4 requests.

The available Chromium build cannot decode H.264/AAC. Browser playback is not
claimed; FFmpeg decoded and measured each full export. No subjective listening
session is claimed. A person must watch and listen to every complete cut on
headphones and laptop speakers before release, including the opening groove,
section transitions, bookmark effects, title pause and resolving chord.

No confirmed product defect prevented the demonstrated workflows. The existing
development documentation described a historical demo seed as synthetic; this
production uses its own fictional fixture. Application behavior was not changed.
