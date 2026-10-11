# Event Runner videos

A 45-second trailer and three task guides, each in landscape and vertical.
The [production spec](../docs/video-production.md) records the approved story,
brand, data rules and review gates. This folder is a production tool; it is
not shipped as an application feature.

The current trailer uses [constituent-part animation](trailer/assembly-direction.md)
and an original 112 BPM score. It supersedes both the initial screenshot treatment
and the 20-second Boardwalk-inspired study. Tutorials retain literal captures.
The private client concept lives outside this repository and cannot be exported
by the public preview builder.

## Rebuild from the committed captures

Use Node 22, FFmpeg/ffprobe, Python 3 with NumPy, and Playwright Chromium.
Install the repository’s workspace dependencies using the contributor setup
first: the illustrated public data imports the shared fixture builders.
Install this folder’s pinned dependencies with `npm ci --prefix video`, then
`npx --prefix video playwright install chromium` if Chromium is not available.
Run these commands from the repository root:

```sh
node video/plan.mjs
node video/transcripts.mjs
npm --prefix video run score -- --all-public
npm --prefix video run check
npm run lint
npm --prefix video run stills -- --all-public --both
npm --prefix video run render -- --piece general-trailer --frames 0-1199 --both
python video/flash.py video/out/general-trailer-landscape-0-1199.mp4
python video/flash.py video/out/general-trailer-vertical-0-1199.mp4
npm --prefix video run render -- --all-public --both
npm --prefix video run verify -- --all-public
node video/review-sheets.mjs --all-public
python video/audio-quality.py video
npm --prefix video run preview-page
```

Inspect every review sheet and important frames at full size. `--frames A-B`
uses inclusive frame numbers and includes the matching section of the score.
These partial files are review material; the exporter rejects partial renders.
Full-render review sheets sample every ninth frame with one render worker.
The number printed on each tile is its sampled index; multiply it by nine for
the source frame.

The preview is `docs/videos/index.html`. Serve the `docs` directory locally
and visit `/videos/`; native video controls do not autoplay. Publishing that
page is a separate repository deployment decision.

## Capture again from the real product

Follow the repository's [development setup](../CONTRIBUTING.md#dev-setup) first.
Fresh application dependency installation needs `npm run prepare:functions`
before `npm install`. Capture also needs Java 21 for the Firebase emulators.
Use a fresh, task-owned emulator instance. The seed refuses an existing event
other than the fictional Harborlight Forum.

In terminal one, from the repository root:

```sh
source video/local-env.sh
npx firebase emulators:start --only firestore,storage,auth,functions --project demo-run-of-show
```

In terminal two:

```sh
source video/local-env.sh
npm --prefix video run seed
npm run dev -w apps/web -- --host 127.0.0.1 --port 5173 --strictPort
```

In terminal three:

```sh
source video/local-env.sh
npm --prefix video run capture -- --piece general-trailer
```

That capture runs all three workflows in both formats, reseeding each format.
Individual `--piece publish-page`, `save-schedule`, or `change-style` runs are
also supported. Keep `GENERATED_DIR` and `E2E_MAIL_FILE` consistent across
terminals if overriding them. The first-paint snapshot stays in external
scratch storage, not in the application's committed generated files. Local
sign-in reads console-delivered codes from the task's test inbox.

Capture fixes time, locale, timezone, viewport, reduced motion and device scale.
Every visible state comes from actual UI actions. No fabricated success screen
is used. `boxes.json` stores the measured crops and pointer targets. Privacy
checks run before each screenshot and reject external content, unknown images,
remaining real names, and inaccessible closed shadow roots. A harmless Google
connectivity probe from Firebase Auth is blocked; production Firebase endpoints
cause capture to fail.

Stop these servers before running `npm run test:rules` or `npm run test:e2e`;
those commands create their own emulator instances.

## How the kit fits together

- `capture/`: synthetic fixture, emulator seed, real UI journeys and privacy checks.
- Each piece’s `timeline.ts`: shared cue clock. Tutorials are planned from `script.json`; the trailer imports `trailer/assembly/timeline.ts`.
- `trailer/assembly/`: semantic data from the fictional fixture, vector components, curved paths, format-specific composition, and the original score.
- `frame-state.ts`: the discrete captured state shared by picture and timing checks.
- `bootstrap.ts`, `layout.ts`, `ui.ts`, `motion.ts`: font-gated Canvas composition.
- `audio-plan.mjs`, `synth.mjs`: visible-event cues, separate music/UI/accent buses,
  smooth envelopes, original oscillators and seeded noise, and stereo mastering.
- `score-provenance.mjs`: rejects changed or missing audio dependencies, including the complete arrangement.
- `provenance.mjs`: hashes the scene bundle, render helpers, captures, fonts, tokens,
  lockfile and WAV. Verification and export require the current full-render digest.
- `flash.py`: native-resolution luminance and red screening, including remembered
  saturated endpoints and cumulative chromaticity changes. It checks recurring
  pixels and spatial transition episodes at a conservative 2% picture threshold;
  simultaneous opposing regions count as two transitions. Regression fixtures distinguish
  single wipes and 3 Hz flashes from moving pulses, 4–5 Hz flashes, moving detail,
  and gradual red transitions. This internal screen is not a conformance certificate.
- `verify.mjs`: checks codec, dimensions, frame count, loudness, true peak, flash
  results and provenance on every final MP4.

Fonts and the official mark are read from the existing brand assets; see
[the font license record](../docs/fonts/README.md). The original score calculates every sample from oscillators and seeded noise.
No instrument bank, borrowed recording, music loop, stock image or third-party
face is used in public output.

`--private-project /absolute/external/folder --piece approved-id` lets the
shared renderer, score and verification tools read a separate approved project.
The root must be outside this repository, including after resolving symlinks.
Private capture is project-specific. The public page exporter accepts only the
four named public pieces and never accepts a private root.

A person must still watch and listen to the complete pieces on headphones and
laptop speakers before release. Automated checks cannot make that judgment.
