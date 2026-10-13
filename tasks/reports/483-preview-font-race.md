# Preview font warning race — CI repair during epic #483

## Failed evidence

PR #485 head `ac196a5748ccce1408d5bfb0c91d996f059c43a6`, Actions run
`38336177834`, E2E job `115096737299`, failed the first
`e2e/preview-font-warnings.spec.js` test on both its initial attempt and retry.
The warning matching `/still loading, so the/` never appeared during the
existing 10-second assertion. The report records **73 passed, 1 failed,
0 flaky, 0 skipped**.

The downloaded Playwright artifact `11784687979` was verified against SHA-256
`666d874469fc8bfd024ae2395aa65703377620371fcad493f4563ef767fc18c6`.
Its initial and retry traces show preview-frame Merriweather, Public Sans and
IBM Plex requests held for about 10.2 seconds, then completed only when the
failed assertion's `finally` released them. The rendered preview hero was
present; neither loading nor failure warning appeared in the DOM snapshots.
The requests were actually held, so a cached response or service-worker bypass
does not explain the missing warning.

## Diagnosis and change

The trace does not record FontFaceSet event dispatch. Source inspection and a
deterministic component regression establish a matching timing gap: render
can sample a face as `unloaded`, layout requests the face and emits `loading`,
and only then does the effect attach its font listeners. A pending
`fonts.ready` promise cannot prompt another sample until the held download
finishes.

The effect now resamples once immediately after installing its listeners.
Later events and `fonts.ready` retain their existing behavior and cleanup.
There is no polling, timeout increase, browser-assertion change or broader
font-loading redesign.

## Verification

- Added a regression through the real branding editor and compare preview.
  Its new preview face is initially observed as unloaded, becomes loading
  before listener registration, and has a pending ready promise. The old
  code fails on the missing loading warning, matching the CI symptom.
- With the fix, the warning appears; completing the same face clears it
  without changing the selected theme.
- Full focused `AdminBranding.test.jsx`, `ThemeProof.test.js` and
  `themeRuntime.test.js`: **81 passed, 0 failed**, three files on Node 22.
- Scoped ESLint and `git diff --check`: passed.
- Existing Playwright warning assertions, retries, budgets and browser
  sandbox remain unchanged. The parent will verify them on the new hosted
  head. No browser rerun was requested against the known failing head, and
  no generated output was changed in this commit.
