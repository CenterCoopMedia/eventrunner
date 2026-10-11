# Video production plan

Status: approved by Joe, October 11, 2026. Production in progress.
Source baseline: `8349898b5674514f43b2fcf8a6d508c84ccbc9c3`.

Creative direction update, October 11: after reviewing the Boardwalk PR #24
reference and the 20-second study, Joe asked for an original visual language,
not screenshot cutouts or a copy of Boardwalk. The current trailers decompose
features into type, time, place, speaker and bookmark elements, then reconstruct
a coherent event experience. Their new 112 BPM composition combines modeled
keyboard and percussion with original synthesis and tactile effects. See the
[current direction](../video/trailer/assembly-direction.md). The audience,
formats, privacy boundaries, phrases and tutorial tasks remain the brief.

## The public set

Make Event Runner understandable to event staff and prospective clients. Show
how the event’s parts connect, then teach three tasks in separate videos.

| Piece | Duration | Spec |
| --- | --- | --- |
| General trailer | 45 seconds | [Trailer](video-general-trailer.md) |
| Publish a page update | 75 seconds | [Publishing tutorial](video-publish-page.md) |
| Save a personal schedule | 60 seconds | [Schedule tutorial](video-save-schedule.md) |
| Change the site style | 84 seconds | [Style tutorial](video-change-style.md) |

Each piece has a 1920 × 1080 cut and a separately composed 1080 × 1920 cut.
Both run at 30 fps, with H.264 video, yuv420p pixels, and stereo AAC audio.
The public set contains eight MP4s. Each tutorial also has a full descriptive
transcript. These are production assets, not a video generator in the product.

## Decisions recorded October 11, 2026

- Joe chose event staff and prospective clients as the lead audience.
- Joe chose a 45-second trailer and three tutorials of 60–90 seconds each.
- Joe chose “Plan. Shape. Gather.” and “Make room for your event.”
- Joe chose brighter, playful electronic music. Tutorials have no narration.
- Joe chose both formats, a new video folder in this repository, and a preview page.
- Joe allowed tools beyond Remotion, including F-Frames and Blender.
- Joe approved the proposed timing and production details: 75/60/84-second tutorial
  durations, the Harborlight Forum fixture, no mascot, and the capture/render architecture below.
- Joe superseded the ruled-page and literal-interface trailer treatment with
  original constituent-part transformations and a richer musical arrangement.
  Tutorials continue to use exact recorded controls.

## What discovery established

Read the [README](../README.md), [contributor guide](../CONTRIBUTING.md),
[web setup](../apps/web/README.md), [admin guide](ADMIN_GUIDE.md),
[staff handbook](handbook/for-event-staff.md),
[attendee handbook](handbook/for-attendees.md),
[interface rules](interface-guidelines.md), and [design reference](design-reference.md).
No AGENTS.md, CLAUDE.md, or existing video kit was found in the checkout.
Existing Playwright capture helpers provide useful loopback and asset controls.

The retained environment has Node 22, Java 21, Firebase emulators, Chromium,
FFmpeg, and Blender. The normal Vite dev server can use the local emulators.
Production Vite builds do not use those emulator connections.

The committed demo and the current public demo seed contain real historical
content. Neither is an acceptable seed for this public set's invented data.
The retained setup guide still describes the seed as synthetic; the current
source takes precedence. The public fixture is isolated from that demo. Real UI capture, synthesis, still review and partial rendering are implemented; final verification records accompany the delivery.

## Production tools

Use a small, frame-addressed Canvas compositor driven by Playwright, with
FFmpeg for encoding, audio analysis, and contact sheets. Keep the composition
in code. Use the same browser font engine for capture and output typography.
This adapts the requested architecture under Joe's tool-choice permission.

| Tool | Fit and decision |
| --- | --- |
| Playwright + Canvas + FFmpeg | Implemented primary path: exact frame seeking, local fonts, real screen crops, and Node tests. One browser worker renders unique frames; unchanged holds reuse frame bytes. |
| Remotion | Good fit for React compositions. Not required for this set. Its [current commercial terms](https://www.remotion.dev/docs/license/pricing) depend on organization eligibility, which this task has not established. |
| [F-Frames](https://github.com/dmtrKovalenko/fframes) | Rust/SVG framework with GPU rendering. Consider if a measured vector shot benefits. GPU suitability and build requirements have not been tested here. |
| Blender | Installed. Available for a restrained paper/rule hero shot if it improves the result. Tutorials remain flat and use real captures. |

Tutorial screens are captured from the running product. Trailer imagery is an
idealized illustration of verified capabilities under Joe’s later direction;
it is built from semantic records and geometry, not screenshots. A renderer
change must preserve timing, input hashes,
font loading, privacy checks, and the same final-file review gates.

## Brand and visual system

Use the official four-stroke Event Runner mark from `docs/index.html` and
`docs/favicon.svg`, unchanged. The generic files under `apps/web/public/branding/`
are event placeholders, not the product identity.

Use Bricolage Grotesque 700–800 for trailer words, Source Sans 3 for instructions,
and IBM Plex Mono for small timing or chapter labels. Read color values from
`docs/tokens.css` and the underlying design tokens. The [font record](fonts/README.md)
identifies SIL OFL 1.1 for these faces. The OFL permits use in rendered artwork;
preserve applicable notices when bundling font files with source.

The trailer’s visual idea is making room: components separate in space, travel
along shared paths and settle into useful relationships. A session becomes a
program; one style choice reaches the page and speaker record; selected
sessions also appear in a personal schedule. The public program remains intact.
Large moving letterforms soften while traveling and become sharp at rest.
The unchanged official mark appears on a contrasting surface.

“Plan”, “Shape”, and “Gather” label the three capabilities. They are not the
large kinetic-word transitions used in the retired studies. Each format has
its own bookmark-copy path: sideways in landscape, downward in vertical.

## Capture and invented data

Build a compact fictional Harborlight Forum fixture from the existing shared
configuration and seed builders. Use invented sessions, organizations, and
people, with `example.test` email addresses and no faces or stock photos.
Use the event-name fallback where an event has no logo. Mark the fixture as
sample content in the video introduction or persistent browser label.

Create separate staff, operator, and approved attendee accounts in the local
Auth/Firestore emulators. Save their roles in the fixture manifest. The
publishing tutorial uses staff access; the style tutorial uses operator access.
The schedule tutorial starts signed in with an approved registration.

Seed only a `demo-*` project with explicit loopback emulator addresses. Do not
run the current public-demo seed as part of this fixture. Emit a complete
first-paint snapshot to an external scratch directory through the existing
emitter and select it with `GENERATED_DIR`. This prevents real demo content
from flashing into the first frame. Do not alter committed generated files.

Use fixed desktop and 390 × 844 phone viewports at device scale 2, `en-US`,
`America/New_York`, reduced motion, and a frozen browser clock. Use a fixed
fixture date; normalize local emulator timestamps used on screen and record
that choice. Wait for every font, image, and required data subscription.

Block requests outside loopback hosts. Disable service workers
and block external WebSockets. Fail before navigation for a non-loopback URL.
Do not visit production or send actual email. Sign in through the real local
UI; console-delivered codes are supplied from the local test inbox and this
precondition is recorded. Drive the demonstrated actions through clicks and
typing, then wait for real persisted results.

One privacy module owns known real names and their invented replacements.
Before every screenshot it scans and replaces text, relevant attributes,
form values, accessible same-origin frames, and open shadow roots, then scans
again and refuses any remaining forbidden name. Inaccessible content fails
closed. Also inspect URLs, capture metadata, and image provenance: a DOM scan
cannot find a name or face baked into an image. Public assets use an explicit
fixture allowlist; do not mutate buttons, status labels, or product behavior.

Save `boxes.json` beside every capture. Include the selector, CSS box, scroll
offset, viewport, device scale, route, fixture hash, and state. Scene crops
and pointer targets read those measured boxes. Hold entire controls and
sentences. Stack separate crops when a long sentence cannot fit. Two capture
runs must produce the same boxes. Record any locally supplied state.

## Code and timing contract

Source root: `video/`, isolated from the application runtime. Each piece has an
import-free `timeline.ts`. A shared Canvas entry point reads it and the capture
manifest. Pure `tutorialRects`, `trailerRects`, and `endRects` functions describe
the resting layouts; the shared score builder reads the same clock.
The shared kit holds typography, browser/phone frames, crops, pointer paths,
transitions, motion, the seeded synthesizer, and tests.

The clock defines 30 fps, integer cue frames, moves, visible actions,
motion-blur samples, and the settled end frame. Picture, audio, and tests read
the same clock. Tutorial scripts define targets, actions, and text; a planner
creates their clock and descriptive transcript.

The compositor exposes an asynchronous frame seek. It resolves only after
fonts and decoded images are ready and layout is stable. Do not measure type
before that font gate. All animation is a function of the requested frame.
There are no wall-clock CSS animations or unseeded random values.

Use 1–16 integer samples per frame. A 180-degree shutter samples fast motion;
still frames use one sample. Discrete text changes use the integer output
frame for all samples. Grain is seeded and applied after blur. The pointer
arrives before a press, settles on the measured control, and makes one ring
on the press. Show the real hover state. Finish typing before the next move.

## Two formats and reading

Trailers animate semantic vector elements and their relationships. Tutorials
place their instruction above one real browser frame. Vertical tutorials
use the real phone layout, with essential text and UI between y=250 and
y=1540. All cards have at least a 24px outer margin. Separate crops retain
their place in one flat browser frame in tutorials; they do not become a
fictional product layout. Show the actual captured localhost URL in browser
chrome and identify the site as sample data. Do not substitute a production URL.

Headlines are about seven words, callouts about eight. Every instructional
line holds for `max(2, words / 2.6 + 0.6)` seconds. Camera motion finishes before
the reading hold. Important UI remains readable at the final delivery size.
Tutorials finish on a clean visible result for more than one second. End-card
layout settles at least two seconds before the last frame.

## Sound

The original trailer composition has 21 bars at 112 BPM, exactly 45 seconds.
It combines modeled electric piano and synthesized percussion with modeled bass,
a detuned harmonic ensemble, stereo room, and seeded tactile effects. Every sound is made from oscillators and seeded noise in Node.
No reference track, borrowed melody, instrument bank, music loop, or speech is used. Tutorial music remains the quiet oscillator/noise score.
Both paths master 48 kHz, 16-bit stereo PCM through FFmpeg’s BS.1770 measurement.

Trailers target -16 LUFS integrated, tutorials -19 LUFS, tolerance ±0.5 LU.
Every final MP4 must remain at or below -1 dBTP; leave headroom before AAC
encoding and remeasure afterwards. The score uses a bright electronic pulse
and a resolving chord on the title. Tutorial music ducks during reading.
Tutorial clicks and keys correspond to exact visible actions. Trailer foley
follows component arrivals, style propagation, theme publication, bookmarks,
and the arriving copies. The groove has ghost notes, velocity variation,
breakdowns, close chord voicings, and a sustained title resolution. No narration.

Each WAV gets a JSON record with the clock, exact sample count, loudness,
true peak, seed, and hashes of the clock and score sources. Reject stale audio.

## Verification and delivery gates

- Typecheck, lint, and test the video kit. Run the repository's applicable
  checks and the full matrix required by its path classifier before a PR.
  The retained environment records a pre-existing missing vendor-tarball
  test failure; recheck and report it separately. Do not repair product
  packaging or alter integrity checks as part of video production.
- Test cue order, movement boundaries, pointer/action order, word periods,
  planner reading time, score sync, integer blur samples, end-pose stability,
  both safe areas, every card's tallest state, overlap, and capture existence.
- Validate privacy failures and public-export allowlists. Keep any private
  project inputs, renders, posters, review sheets, and metadata outside this
  checkout. An unlisted artifact cannot enter the public page or PR.
- Test the audio format, exact duration, loudness, peak, and source hashes.
  Prove defect tests by introducing a controlled bad input, seeing failure,
  then restoring it. Do not leave mutations in the working tree.
- Render half-scale review stills for both cuts, inspect every contact-sheet
  panel, and inspect critical frames at full size. Render fast acts as short
  video ranges before full rendering.
- Run a WCAG 2.3.1 general-flash analysis on those ranges and every final MP4;
  check saturated red transitions too. Validate the analyzer on known pass
  and fail sequences, including moving high-contrast detail. Save thresholds,
  tool version, area measurements, and worst rolling one-second counts.
  A mean-brightness or scene-cut detector alone is not a conformance check.
  At most three qualifying flashes may occur in any one-second interval.
- Verify at least 4.5:1 for video text. Build full-render contact sheets with
  a frame step coprime to the worker count, such as 9 for four workers.
  Measure every final MP4 with `ffmpeg -af ebur128=peak=true`, and inspect
  codec, frame rate, pixel format, dimensions, and duration with ffprobe.
- Get a focused independent read-only diff review with the available Codex
  CLI; use a separate review agent if that CLI cannot run. Verify findings,
  fix real defects, and repeat the affected render/review loop.
- Review crops, line breaks, pointer position, spacing, phone readability,
  on-screen sound causes, and result holds. Record product bugs without
  changing the product.
- A person must still watch and listen to each complete cut on headphones
  and laptop speakers before release. Automated checks do not replace this.

Cache keys include scene code, shared kit, captures, fonts, fixture data,
score inputs, and renderer settings. Preview-page prose is outside that key.

Create `docs/videos/index.html` with native controls, no autoplay, end-card
posters, eight download links, transcript links, the SVG favicon, and complete
canonical/Open Graph/Twitter metadata. Public output uses an explicit allowlist
of the four pieces above. Keep the page and its outputs reviewable in a PR;
this task does not merge the PR or send messages to prospective clients.

## Rebuild and current evidence

The exact setup and executable command sequence are in [video/README.md](../video/README.md).
Committed captures allow rendering without running the product. Re-capture uses
the real local UI and an isolated synthetic snapshot, with console-only sign-in.

The [motion and sound review](../video/review/design-review.md) records the
additional pass Joe requested before final exports and the comparison with the
public Boardwalk/NJ PBS trailer and teaser. Effects are tested against exact
visible events. Scores have separate music, UI and accent buses, smooth reading
automation, a true title silence and a clean resolving chord. Trailers use a
measured opening push, restrained card entrances and staggered final assembly;
tutorials retain a flat stage. No 3D asset or stock scene was needed.

Verification requires current input hashes at both the final-file check and
public export. A stale video, stale flash analysis or partial render cannot be
approved by reusing an old verification report. The public preview remains a
reviewable repository change until the pull request is merged and deployed.
