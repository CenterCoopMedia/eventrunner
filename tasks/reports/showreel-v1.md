# Showreel v1: native vertical cut (builder V1)

Branch `jawn/youthful-meitner-ts84kk-3-vertical`, working tree only. No git
writes were made. The director commits.

## Summary

The showreel now renders in two formats from one set of scene files:
landscape (1920 × 1080, unchanged) and vertical (1080 × 1920). Every scene is
composed again for the tall frame through one `LAYOUT` table per scene file.
Nothing is cropped or letterboxed. The landscape picture is pixel-identical to
the reference stills, except for the title fix the director asked me to take
over from commit f0a1fff (frames 1125 to 1152). The vertical film passes the
native flash screen.

## Changes, file by file

- `kit.ts`: `Format` type, `FRAME` sizes, `export let FORMAT, W, H` and
  `setFormat(format)`. `Project` has `format`.
- `data.mjs`: `project(format = 'landscape')` checks the format and puts it in
  the payload.
- `render.mjs`: `--format vertical` (default landscape). It sets the page
  canvas and the viewport, passes the format to `project()`, and names the
  outputs `showreel-vertical.mp4`, `showreel-vertical-A-B.mp4`,
  `showreel-vertical-sheet-NN.jpg` (270 × 480 tiles, 5 × 6) and
  `showreel-stills-vertical/`. Landscape names are unchanged. The frame cache
  key still covers the data, which now holds the format. Vertical frame folders
  have a `vertical-` prefix. A render deletes only stale folders of its own
  format, so the two cuts do not delete each other's cache.
- `main.ts`: `load` calls `setFormat(project.format)` first, checks that the page
  canvas has that size, then makes the sample, shutter and halation buffers at
  the current size. The vignette radius follows the short side
  (`Math.min(W, H)`), which is the same number in landscape.
- `shared.ts`: `LAYOUT` with the rails and the sample-note position per format.
  `sample()` reads it through `FORMAT`. `RAIL_Y`, `RAIL_X0` and `RAIL_X1` are gone.
- `page.ts`: `LAYOUT` (page size and `phone`). `drawPage` is unchanged.
  `drawMobilePage` draws the new 1080 × 1220 phone page for each style and
  mode, with the same per-style details (Broadsheet double rule, Newsroom
  primary rule, Zine heavy rule, upper case and the "2 DAYS" sticker at −2.5°,
  Field Guide sprig, Atlas graticule and route discs). `pages(p)` picks the
  drawing from `LAYOUT[p.format].phone`.
- `scene-open.ts`, `scene-plan.ts`, `scene-shape.ts`, `scene-gather.ts`,
  `scene-stack.ts`, `scene-montage.ts`, `scene-title.ts`: each has an exported
  `LAYOUT = {landscape, vertical}` that is read as `const L = LAYOUT[p.format]`.
  Landscape values are the old numbers. Where a value scales a group (phone
  slots, ticket, stepper, under-row), the landscape factor is 1, so the
  arithmetic is the same to the bit. Structural differences branch on layout
  values: `crop` (shape tiles and window show the top of the page),
  `wall.pages` (which pages make the wall), `arc.side` (the saved copy swings
  sideways), `down` (darts fly down), `phone` (page drawing). Timing, easing,
  cue use and drawing order are unchanged.
- `badger.ts` and `scene-title.ts`: the director's flash fix from f0a1fff (`bob`
  in `Pose`, `bob: 0` and limbs at `SOFT` while Badger runs at title size), in
  both formats.
- `README.md`: the vertical commands and output names in "Build", a cache note,
  a new "Two formats" section (scene by scene), and "run the screen on both
  cuts". The clock table is unchanged. The "Sound" section in the same file
  came from the other engineer while I worked. I did not edit it.
- `video/tests/showreel.test.mjs`: five new tests (see below). All old tests
  are unchanged.

## Gates (final run, after the last code and doc edit)

All were run in this order by one script after my last change to code and to
the README. Log: `scratchpad/v1/final.log`.

| # | Command | Result |
| --- | --- | --- |
| 1 | `cd video && npx tsc --noEmit --noUnusedLocals --noUnusedParameters -p tsconfig.json 2>&1 \| grep showreel` | no output (0 lines) |
| 2 | `node --test tests/showreel.test.mjs` | 17 tests, 17 pass, 0 fail |
| 3 | `npx eslint video/showreel video/tests` | exit 0, no messages |
| 4 | landscape identity: `render.mjs --stills <93 frames>` then `compare_ref.py` | `frames 93 missing 0 different 0` |
| 5 | `node video/showreel/render.mjs --check-mark` | `Mark difference 0.008` (limit 0.4) |
| 6 | `render.mjs --format vertical --silent --workers 4` (full film), then `--sheet 9` | rendered, 5 sheets |
| 7 | `flashdiag.py video/out/showreel-vertical.mp4 0 360 640` (full film, downscaled) | `pass True episodes 5`, nothing over 6, nothing at 6, no hazards |
| 8 | `python3 video/flash.py video/out/showreel-vertical.mp4 --output video/out/showreel-vertical-flash.json` (full film, native) | exit 0; `pass: true`, 1350 frames, native resolution, `maxGeneralEpisodeTransitionsInOneSecond: 6` (limit 6), red episodes 0, max general pixel transitions 16, max red pixel transitions 12, `maxRapidPixelAreaFraction: 0.002783`, 0 hazard frames |

About gate 4: the title fix from f0a1fff changes landscape frames 1125 to
1152, as the director said it would. Before I refreshed the reference, the gate
showed exactly three differing stills, all in that range: 1127 (max 207, 5.30%
of pixels), 1134 (max 207, 4.95%) and 1152 (max 203, 4.80%). I replaced those
three files in `scratchpad/ref-landscape/` with stills from the new code. The
old files are kept in `scratchpad/v1/ref-before-title-fix/`. The other 90
reference stills are the original ones and match exactly. Before the title fix
the gate was `different 0` against the original reference. I ran it after
each scene refactor and after the director's size changes.

All flash numbers are for the full film. Clips were used only to find causes.

New tests:

1. Every `LAYOUT` table (shared, page and the seven scenes) has both formats
   with the same keys, recursively.
2. `FRAME` sizes, `setFormat` (and that it refuses an unknown format), the
   vertical page size 1080 × 1220, and `project('vertical').format`.
3. Named essential boxes and baselines of the vertical tables sit inside x 60
   to 1020 and y 250 to 1540: rails, the sample note, the mark centre, the
   publish button, words and captions, the push framing, the site window,
   picker lines, the mode row, every wall tile, the ticket, the step labels,
   the check-in grid, the saved rows, the phone, the message card, all
   fourteen recipients, the merged page, the part names, band labels (x), the
   hero, the lockup top, the tagline lines, the three words and the address.
4. Vertical secondary type is 32 px or more (20 named sizes), and the picker
   is 40 px or more.
5. Landscape numbers are unchanged: rails and sample note, open framings, plan
   publish, card and push values, shape window, tiles and wall order, gather
   stage, card, phone and fan, stack plates, montage, and title scale, top,
   hero and tagline.

## Where the vertical cut departs from the director's layout, and why

- **Rails and sample note.** Rails are y 700, 900, 1100, 1300, 1500 (not 905 to
  1520), and the note baseline is 1536 (not 1520). With a rule at 1520 from x 60
  to 1020, the note at x 60, baseline 1520, would sit on the rule. Cards are
  172 high in 200 px steps.
- **Open framings.** The whole figure is at zoom 1.2 (not about 1.5) and the
  crouch at 1.12 (not 1.15). At 1.5 the opening had 8 transitions in a second.
  The build and the cut at the crouch flip more area when Badger is larger.
  1.2 and 1.12 measured 5 in that range. The trailing lines are drawn so that,
  through the last framing, they land on the vertical rails.
- **Plan push.** No zoom (the camera holds still at the push cue). A zoom of
  1.25 put the time and the speaker circles outside the safe width. Even 1.06
  moved "Plan." and its caption to x 23. The word and the cards already span
  the safe width, so any zoom breaks the safe area. The focus outline on the
  second card still marks the beat, and the speakers still fly in and dock.
- **Shape window.** 960 wide (as the director asked in review) but 640 high
  (y 610 to 1250), not to y 1380. At 832 high the style wipes made 8
  transitions in a second (each heading-face change flipped 6 to 8% of the
  frame). At 640 high the window is 30% of the frame, about the landscape
  share. The window shows the top of the phone page; the schedule panel is
  below the crop. The mobile headline is 84 px (Broadsheet 94, Zine 90), not
  104, for the same reason. It is still two lines.
- **Wall.** Eight tiles, 2 × 4 (Institutional, Broadsheet, Zine, Atlas, each
  light and dark), as the director allowed in review. Newsroom and Field Guide
  are shown in the six wipes but not on the wall. So the wall no longer shows
  "all twelve looks".
- **Gather.** Phone 600 × 676 (not 620 wide and phone-shaped): a taller phone
  would run into the sample note or out of the safe band under the rows. The
  ticket is about 680 wide (the review measured it; the table's 860 was for the wrong base width). Steps have 34 px labels. The message card is
  860 wide with 48 px type. Badges are 102 px (1.6 ×) on three arcs from x 70
  to 1010, down to about y 1420.
- **Title hero.** Badger is at the landscape size (7.6 times mark size), not
  larger, for the flash screen.
- **Montage labels.** The first and last of eight 240 px bands lie outside y 250
  to 1540, so "Pages" and "Styles" are outside the safe band. This follows from
  eight full-height bands; I kept the director's bands.
- **Type.** Following the director's review, no vertical secondary type is under
  32 px; the sample note is 26 px.

## What looks weak in the vertical picture

- The tiles of the wall are 468 × 268 crops at 0.43 scale. The headline reads,
  but the page's small type does not. They read as pictures, not text.
- The band from y 1340 to 1540 is empty in Shape, because of the window height.
- The phone in Gather is wider than a real phone's proportion.
- The plan push no longer moves, so that beat is quieter than in landscape.
- Hero Badger's speed bars run to the left edge of the frame on the chord.
  They are decoration at `SOFT` or brighter accent; they are not essential, but
  they leave the safe band.
- The vertical flash margin is zero: the native screen finds 6 transitions in
  its worst second, the limit (the downscaled measure finds 5). The Shape wipes
  and the opening dash are the tightest parts. Any change to motion, colour or
  layout in those needs the full-film screen again.

## Not finished, or not checked

- Nobody watched the vertical film at speed on a phone. The checks are
  measurements and contact sheets.
- `tasks/todo.md` was not edited (it is outside my allowed files). I wrote no
  model name in the README or in this report.
- The full-film landscape flash screen was not re-run by me after the title
  fix. The director reports 6 for the fixed landscape film. My landscape check
  is the pixel gate only.

## Vertical contact sheets

`video/out/showreel-vertical-sheet-01.jpg` to `showreel-vertical-sheet-05.jpg`
(every ninth frame, 270 × 480 tiles). Native screen report:
`video/out/showreel-vertical-flash.json`.

## Director's review, after the report

An independent review of this diff found no landscape regression and no stale
frame size. Changes made from it, before the commit:

- `scene-gather.ts`: the badges that leave the check-in grid aim at the row
  centre from the table (`L.rows.h / 2`), not the landscape literal 46.
- `render.mjs`: `--format` with no value is an error, not a silent landscape
  render. The cache-folder rule is two exported functions with a test.
- `tests/showreel-landscape-layout.json` records every landscape table, and the
  test compares the whole of each table with it.
- README: the ticket width, the shape window share and the type-size rule now
  say what the code does.

Both films were rendered again after these changes and screened at native
size. The numbers are in the pull request.
