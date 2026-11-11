# Showreel teaser

A 45-second motion graphics teaser for Event Runner, 1920 × 1080 at 30 fps with
an original score. It is a separate piece from the [public set](../README.md):
it is not on the public allowlist, the videos page does not list it, and its
MP4 and WAV are not committed. Adding it to the public page is an owner decision.

The picture is code. Each frame is a function of its frame number, drawn on a
Canvas in Chromium and encoded with FFmpeg, in the same way as the kit's trailer.

## Build

Do the kit's setup first (`npm ci --prefix video`, repository workspace
dependencies, FFmpeg). Run these from the repository root:

```sh
node video/showreel/make-score.mjs          # video/out/showreel.wav, -16 LUFS
node video/showreel/render.mjs --workers 4  # video/out/showreel.mp4, about 5 minutes on 4 cores
node video/showreel/render.mjs --check-mark # the rig at rest against the official mark
python video/flash.py video/out/showreel.mp4
npm --prefix video run check
```

`--frames A-B` renders an inclusive range for review, `--stills 0,56,112`
writes PNG stills, and `--sheet 9` writes contact sheets of every ninth frame
with the frame number on each tile. Frames are cached in `video/.cache/showreel`
under a key of every input (scene code, data, fonts, the mark, the renderer
and the lockfile); frames from other inputs are deleted. The renderer refuses
a score that was not composed from the current clock. Set `VIDEO_CHROMIUM` to a Chromium binary
when the pinned Playwright does not have its own.

## Clock

[`timeline.ts`](timeline.ts) is the one clock for picture, score and tests:
24 bars of 4/4 at 128 BPM, which is exactly 1,350 frames. A beat is 14.0625
frames; every cue is a whole frame.

| Bars | Frames | Scene | Picture |
| --- | --- | --- | --- |
| 1–2 | 0–112 | Open | A name badge is built on the beat: eyes, smile, outline, clip, lanyard. The framing widens in cuts on the beat. It comes alive as Badger, crouches and runs. The lines it leaves become the rules of the schedule. |
| 3–6 | 113–337 | Plan | Sessions rise out of the rules. Two speakers dock on a session. One start time changes, the list sorts and makes room, and the draft is published. |
| 7–10 | 338–562 | Shape | The style picker changes the site through six styles, each with a different wipe. The dark mode sweeps in, then all twelve looks show as a wall. |
| 11–14 | 563–787 | Gather | A ticket is bought in five steps and torn. Its main part becomes the first badge at check-in. Sessions are saved to a phone. One announcement goes to everyone registered. |
| 15–18 | 788–1012 | One site | Five parts float as an exploded stack and are named. On the build they close one at a time, turn to face the viewer and become the published page. |
| 19–20 | 1013–1124 | Montage | A run sheet: eight ruled colour bands, one for each part of the product, are lit from the top on seven beats. On the eighth beat they fold into a point. Half a beat of silence. |
| 21–24 | 1125–1349 | Title | On the chord Badger is large and running on the spot. The landing cuts to the official lockup, and the name is uncovered beside the mark. "Make room for your event." and "Plan. Shape. Gather." follow. The layout is at rest from frame 1252; after that only one blink at frame 1294 and the grain move. |

## What the picture claims, and where it comes from

| Shown | Source |
| --- | --- |
| Event name, sessions, times, rooms, speakers, hero text | The fictional Harborlight Forum fixture, read by [`data.mjs`](data.mjs). The canvas code holds no event names, dates, people or site address; a test scans it. Interface words such as "Publish", "My schedule" and "Doors open at 08:30." are illustration copy. A standing label says "Sample event". No faces: people are initials or Badger icons. |
| Sessions sort by start time; draft and live are separate | [Admin schedule workflow](../../docs/design/admin-schedule-workflow.md) and the [staff handbook](../../docs/handbook/for-event-staff.md). |
| Six styles, light and dark, with their heading faces and corner shapes | `design/tokens/presets/*.json`. The seventh style belongs to one client and is left out. |
| Checkout steps, check-in, saved sessions, announcements to registered attendees | The feature list in the repository [README](../../README.md) and the [attendee handbook](../../docs/handbook/for-attendees.md). |
| Mark, lockup, colours, site address | `design/brand/`. The rig at rest is the official mark; `--check-mark` and a test hold it to the SVG. The end lockup uses the geometry of `badger-lockup.svg`. Colours are the dark Institutional preset, which has the mark's values. The address is the one `social-preview.svg` prints. |
| "Make room for your event." "Plan. Shape. Gather." | The approved phrases in the [production plan](../../docs/video-production.md). |

The piece is an illustration of these capabilities, not a recording of the
interface. It makes no claim about numbers, clients or results.

## How it is made

- [`kit.ts`](kit.ts): easing, a closed-form spring, an integer hash, glyph-by-glyph type, curves that objects can follow.
- [`badger.ts`](badger.ts): the character rig. A four-pose stride through a periodic spline, lean, squash, blink, lanyard sway, and part-by-part build.
- [`page.ts`](page.ts): one event page drawn for each style and mode from preset values, drawn once and shared.
- `scene-*.ts`: one file for each scene. [`stage.ts`](stage.ts) orders them and sets the shutter.
- [`main.ts`](main.ts): font gate, then a 180-degree shutter of 8 samples a frame (16 in fast moves, 1 when still) averaged with equal weight, halation, vignette and seeded grain.
- [`shared.ts`](shared.ts): the flat ground, the narrator's type, the part colours, and the `SOFT` opacity limit described below.
- [`score.mjs`](score.mjs) and [`audio-kit.mjs`](audio-kit.mjs): the music, the sound design and the mix. See "Sound" below.

## Design rules

The owner's list of generated-looking design signs is used as a lens, not as a
deny list. Each element must have a reason in this product. The second pass
made these choices:

- **No label above a headline.** The scene words stand alone. Nothing is
  numbered 01, 02, 03.
- **State in words.** "Draft, 1 change" and "Live" are text, as the admin
  schedule shows record state. There is no chip and no status dot.
- **No decoration on an edge.** Cards, the ticket and the style picker have no
  coloured side bar.
- **Mono type is for data.** Times and step numbers use IBM Plex Mono, as the
  product does. Captions and notes are Source Sans at 26 px or more.
- **Product corners.** Cards and buttons use the 4 px radius token.
- **A flat ground.** No glow, no gradient and no dot grid. Depth comes from
  motion blur, shadow under lifted cards and grain.
- **One motif.** The speed lines of the opening become the rules of the
  schedule, and the montage is a run sheet of eight ruled bands, not a grid
  of cards.
- **Colour has a meaning.** Each part of the product has one preset colour in
  both the stack and the montage (`PARTS` in [`shared.ts`](shared.ts)).

A test holds the first four rules.

## Design rules

The owner's list of generated-looking design signs is used as a lens, not as a
deny list. Each element must have a reason in this product. The second pass
made these choices:

- **No label above a headline.** The scene words stand alone. Nothing is
  numbered 01, 02, 03.
- **State in words.** "Draft, 1 change" and "Live" are text, as the admin
  schedule shows record state. There is no chip and no status dot.
- **No decoration on an edge.** Cards, the ticket and the style picker have no
  coloured side bar.
- **Mono type is for data.** Times and step numbers use IBM Plex Mono, as the
  product does. Captions and notes are Source Sans at 26 px or more.
- **Product corners.** Cards and buttons use the 4 px radius token.
- **A flat ground.** No glow, no gradient and no dot grid. Depth comes from
  motion blur, shadow under lifted cards and grain.
- **One motif.** The speed lines of the opening become the rules of the
  schedule, and the montage is a run sheet of eight ruled bands, not a grid
  of cards.
- **Colour has a meaning.** Each part of the product has one preset colour in
  both the stack and the montage (`PARTS` in [`shared.ts`](shared.ts)).

A test holds the first four rules.

## Where this piece departs from the public-set plan

The [production plan](../../docs/video-production.md) was approved for the
public set. This piece is not in that set, and it differs in three ways. Each
is an owner decision before any public use.

- **Badger is a character.** The plan records "no mascot". It was written
  before the Badger mark. Here the official mark is built, runs and lands.
- **"Plan.", "Shape." and "Gather." are large words.** The plan uses them as
  small labels, not as large kinetic words.
- **Captions are short and quick.** They hold for 1.6 to 3 seconds. The plan's
  two-second minimum is for instruction lines; four captions in the Gather
  scene are below it.

## Flash safety shapes the motion

`video/flash.py` counts a rise and a fall of bright picture area as one flash
pair, and allows three pairs in a second. A bright shape that travels is a rise
at its front and a fall at its back on every frame, so a fast camera move across
white type fails the screen. The first cut of this film failed it in most
scenes. The motion now follows four rules:

1. **Travel dim, arrive bright.** A shape that moves far is at or below the
   `SOFT` opacity while it moves, and is lit when it stops. Badger leaves the
   opening as a dim streak, his running legs are a soft smear, and cards dim
   their type while they change places.
2. **Uncover, do not slide.** Large type and bright panels are uncovered where
   they stay: letters from the baseline up, the wordmark from the mark outward,
   a ticket from the left edge.
3. **Cut or dip for a camera move.** The opening changes framing with cuts on
   the beat, and the landing in the title is a cut. Later moves happen inside a short exposure dip set in
   [`stage.ts`](stage.ts): the picture goes dim, moves, and comes back at rest.
4. **Decoration is soft.** Rings, rays, trails and streaks stay at or below
   `SOFT`, which keeps their change under the screen's threshold.

Run the screen again after any change to motion, colour or timing. Screen the
whole film, not a clip: the screen keeps history, and a clip of the title
passed with 4 transitions while the same frames in the full film had 7. The
cause was Badger at title size. His body rose 4 px on each stride and his legs
were above `SOFT`, and both count at that size, so he now holds still with
limbs at `SOFT`.

## Sound

One WAV serves both cuts, because both use the same clock. Everything is
calculated in [`score.mjs`](score.mjs) with the tools in
[`audio-kit.mjs`](audio-kit.mjs): band-limited oscillators, seeded noise,
filters, a plate reverb, an echo, a compressor and a limiter. There is no
recording, sample pack, loop or borrowed melody.

### Music

Filter house at 128 BPM in A major. The harmony is one loop, a chord a bar:
D maj9, E 6/9, C♯ m7, F♯ m9. A scene is four bars, so each scene is one turn
of the loop. The loop never rests on A, the home chord. A arrives once, on the
title, after 37 seconds.

The hook is four bars. Each bar opens with the same 3 + 3 + 2 figure, and the
bass plays that figure too.

| Bars | Scene | What plays |
| --- | --- | --- |
| 1–2 | Open | No drums. The four parts of the badge play the first four notes of the hook. A riser and a snare fill lead to the drop. |
| 3–6 | Plan | The drop: kick on every beat, claps, hats, the bass line, off-beat chord stabs that open their filter bar by bar, and the hook. |
| 7–9 | Shape | One chord for each style change, two beats apart. The six chords climb (top line E, F♯, A, B, C♯, E). |
| 10 | Shape | Dark mode: the band goes under a low-pass filter, with one kick and a held bass note. |
| 11–12 | Gather | Lighter: a bouncing pluck, a shaker, two kicks a bar. |
| 13–14 | Gather | The full groove returns and the hook plays its second half, with a harmony. |
| 15–16 | One site | Open bars: a wide pad, and the hook at half speed as bells. |
| 17–18 | One site | The build: snare from quarters to sixteenths, stabs from eighths to sixteenths, a climbing pluck line and a riser. |
| 19–20 | Montage | The peak: the hook with an octave above it, and a tuned drum that climbs with each band. Everything stops at beat 79.5. |
| 21–24 | Title | The A chord, held. "Plan. Shape. Gather." are C♯, E and A: the chord of home, one note a word. |

### Sound design

Each picture event has a sound of its own, built from one small family so the
film has one voice:

- a **knock** (a tuned wooden bar) when something is placed: a session card, a checkout step, a closing plate;
- a **pop** when something appears: an eye, a docked speaker, each of the forty badges at check-in;
- a **bell** when something is confirmed: published, saved to the phone, delivered;
- a **tick** when a control is pressed: Publish, the dark-mode switch, Send;
- a **whoosh** when something travels, loudest where the move is fastest.

Sounds with a pitch are in the key, and the score records each pitch it plays
so the test can check them all. Each sound is panned to where its event is on
screen, inside ±0.6 so the two cuts agree. A sound starts on the frame of its
event: the forty check-in pops and the fourteen delivery bells use the same
formulas as the picture. A hit that shares its moment with a drum sits on the
beat with the drum, which is within half a frame of the cue. Each exposure dip
of the picture is a quick low-pass dip in the music.

Some events have a sound made only for them: a pen for the badge outline, a
printer for the ticket, torn paper for the stub, a different texture for each
of the six wipes, and a fold that pulls the sound down into the silence.

### Mix

Music ducks under each kick (the pump of house music). The bass is mono and
keeps harmonics above 200 Hz, so a phone speaker can play it. The music dips a
little under loud effects. The master is a gentle compressor, a soft clip and
a look-ahead limiter, then FFmpeg sets −16 LUFS.

A phone plays the sum of the two channels, so the low end must be in phase.
Three things keep it there: pad notes below A3 are the same on both sides, the
hall returns nothing below 180 Hz, and the master removes the difference
between the channels below 150 Hz.

Measured on the mastered WAV: −15.9 LUFS integrated, loudness range 5.8 LU,
true peak −3.9 dBTP.

| Part | Loudness |
| --- | --- |
| Open | −20.2 LUFS |
| Plan (the drop) | −14.8 LUFS |
| Shape | −15.4 LUFS |
| Dark-mode bar | −20.0 LUFS |
| Gather, first half | −19.2 LUFS |
| Gather, second half | −14.7 LUFS |
| One site, open bars | −18.6 LUFS |
| The build | −15.0 LUFS |
| Montage (the peak) | −13.2 LUFS |
| Title | −17.7 LUFS |

In the drop the energy falls evenly from 63 Hz to 8 kHz, about 1 to 3 dB an
octave, which is the slope of a finished dance record. In every two-bar span, left and right agree below 120 Hz (correlation 0.89 for
the last chord, 0.99 or more everywhere else), and the whole mix stays
compatible with mono.

Nobody has listened to this score. The numbers show that the mix has the
planned shape and a balanced spectrum; they do not show that it is good. A
person must listen on headphones, laptop speakers and a phone before release.

## Checks and their limits

`npm --prefix video run check` runs `tests/showreel.test.mjs` (clock, cue order,
fixture-only content, contrast, the rig against the mark, the run cycle) and
`tests/showreel-score.test.mjs` (length, determinism, headroom, exact silences,
a sound for each cue, every note in the key, the shape of the arrangement, a
mono low end, and the signal tools).

The flash screen, loudness numbers, contact sheets and spectrogram are
measurements. Nobody has listened to the score or watched the film at speed on
a display. A person must do both on headphones and laptop speakers before this
piece is published anywhere.
