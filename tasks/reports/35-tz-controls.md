# 35-tz-controls: event lists and time zone controls (#475)

Branch `joe/blissful-einstein-9qvtd1-35-tz-controls`, from `origin/main` 291a8a1.

## What changed

- **Time zone.** The free-text IANA field is gone. `TimeZoneField` is a WAI-ARIA
  editable combobox with list autocomplete. Staff search by city, region, zone name
  ("Eastern Time"), IANA name, or offset ("UTC+05:30", a typed hyphen matches the
  minus sign). Each option shows city, region, zone name, and current offset. The
  saved zone is marked **Current** in words. Down/Up open and move, Page Down/Up move
  ten, Enter chooses (and does not submit the form), Escape or leaving the field puts
  the saved zone back. The list sits in the flow, not over the form. The stored value
  is still the IANA name, stated once under the field. A line states the offset on the
  event days, and names both offsets when the clocks change during the event.
  The zone list comes from `Intl.supportedValuesOf('timeZone')`, with a fixed fallback
  list; old names (Asia/Calcutta, Europe/Kiev) are offered under current names; a stored
  alias that the list leaves out is kept.
- **Days.** No id field. One compact **+ Add day** control in the panel heading. Each
  day has its own **× Remove** control in its heading, named for the day
  ("Remove day 2, Workshops"). A new day gets `day-N`: the next number after the list
  that no day and no live or draft session uses. The id is set when the day is added and
  stays through a refused save and a retry. Saved ids never change. Server errors on
  `days[i].id` show in that day's card.
- **Tracks.** Same controls. A new track starts on the first letter no track has and no
  session uses. Changing a used track's letter shows a non-blocking warning.
- **Removing a used day or track** opens a stated consequence inside the item
  (`RemovalWarning`) with **Remove … anyway** and **Keep …**. Unused items go at once
  with a status line. Nothing is sent until **Save event settings**. Focus moves to the
  next remove control, or the add control.
- **Shape rule.** `motionContract.test.js` no longer bans `rounded-full` everywhere. It
  is allowed only in files listed in `CHIP_FILES`, and each listed file must have a
  remove button named for its value at full control height, plus its own test. A
  self-check proves the contract can fail. `docs/interface-guidelines.md` has a new
  **Chips** rule and rules for the time zone field and record lists.

Files: `apps/web/src/lib/timeZoneOptions.js`,
`apps/web/src/admin/components/{TimeZoneField,EventDaysEditor,EventTracksEditor,listItemControls}.jsx`,
`apps/web/src/admin/pages/AdminEventSettings.jsx`, `apps/web/src/lib/motionContract.test.js`,
`e2e/admin-event-settings-controls.spec.js`, `docs/ADMIN_GUIDE.md`,
`docs/interface-guidelines.md`, `CHANGELOG.md`. No change to `packages/shared`,
`EventDateTimeField.jsx`, or `lib/eventDateTime.js`; their exports are only read.

Tests added: `timeZoneOptions.test.js` (16), `TimeZoneField.test.jsx` (11),
`EventDaysEditor.test.jsx` (10), `EventTracksEditor.test.jsx` (9), three new cases in
`AdminSettings.test.jsx`, the chip contract cases in `motionContract.test.js`, and the
E2E spec.

## Acceptance criteria

| Clause | Proof |
|---|---|
| Add/remove discoverable, keyboard accessible, labelled for the item; × never deletes an unrelated record | `EventDaysEditor.test.jsx` "names the day on its own remove control, inside that day"; tracks equivalent; E2E adds days and tracks from the keyboard and checks focus |
| Keep date/start/end and all fields; no chips for days | `EventDaysEditor.test.jsx` "keeps every day field and shows no id field" |
| Collision-safe ids for new days only; keep existing ids on edits and retries | `nextDayId` test; "keeps the new day's id through later edits"; `AdminSettings.test.jsx` "gives a new day an id, keeps the saved one, and resends the same id after a refusal" |
| Time zone understandable and searchable; store IANA; DST correct | `TimeZoneField.test.jsx`; `timeZoneOptions.test.js` (summer/winter offsets, clock change during the event); `AdminSettings.test.jsx` "chooses the time zone … saves the IANA name"; E2E keyboard path |
| Removing referenced days/tracks explains consequences; save/cancel behaviour kept | "states what happens to the sessions before removing a day they use" (component and page); tracks equivalent; page test shows Keep sends the days unchanged |
| Spacing and wrap at desktop, 390px, 200% zoom; long labels, many items | E2E at 1280, 640 (200% of 1280), 390, and 320 with 4 long-label days and 6 long-name tracks: no sideways scroll, controls inside cards, one button height |
| Update design guidance and rounded-full tests to permit purposeful chips | `motionContract.test.js` chip contract; `docs/interface-guidelines.md` **Chips** |

## Decisions the owner may want to change

1. **No chip ships.** Days and tracks have several fields, so they stay rows; this page
   has no single-value list. The rule now permits a listed chip; `CHIP_FILES` is empty.
2. **Leaving the time zone field without choosing keeps the saved zone.** The APG
   example with automatic selection accepts on Tab; I chose not to, so a half-typed
   search is never saved.
3. **A used day or track can still be removed** after the warning (places stay blocked,
   as before). The server already allows it; the warning says what happens.
4. **New day ids are `day-N`**, matching the seed, not a slug of the date (a date can
   change; the id must not).
5. **Offsets in the list are today's.** The line under the field gives the offsets on
   the event days.
6. Label is now **Time zone** (two words, as `EventDateTimeField` uses).

## Final checks

Run on the committed tree after the last code edit:

| Check | Result |
|---|---|
| `npm run lint` | pass |
| `npm test` | 3483 pass, 0 fail |
| `npm run test -w apps/web` | 310 files, 3654 tests pass |
| `npm run build -w apps/web` + `scripts/ci/bundle-budget.cjs` | pass (281813 gzip bytes initial) |
| `build-demo.cjs --check` | two identical builds, budget pass |
| `generate-content.cjs --demo --check` | 7 files match |
| `build-pages.cjs --check` | 31 files match |
| `check-docs.cjs` | pass |
| `npm run check:copy` | 577 files, no blocked patterns |
| E2E `admin-event-settings-controls.spec.js` | pass (after the last code edit) |
| E2E `admin-workspace-layout.spec.js` | pass (run before the last edit, which only selects the time zone text on focus and click) |
| `test:rules` | not run: no rules, schema, or validation change |

The E2E runs used an untracked Playwright config with `chromiumSandbox: false`,
because this container runs as root. It was deleted after the run.
