# Tutorial: Save a personal schedule

Status: approved by Joe, October 11, 2026. Production in progress.
Apply the shared [production plan](video-production.md).

## Task and source

Teach an attendee to find and bookmark one session, then find it in “My
schedule”. Start on the event homepage, signed in with an approved registration.
Sources: [attendee handbook: Schedule](handbook/for-attendees.md#schedule),
`apps/web/src/pages/Schedule.jsx`, `apps/web/src/pages/MySchedule.jsx`, and
`apps/web/src/components/session/BookmarkAction.jsx`.

Exact source labels: “Search this day”, “Bookmark”, “Bookmarked”, and “My
schedule”. Bookmarking requires attendee access and the enabled feature.
The capture must verify these labels and the actual navigation on screen.
Use only the synthetic event and local approved attendee. No public-data
exception, calendar sync, sharing, exported files, or ticket purchase.

## Script and clock

60 seconds, 1,800 frames, 30 fps, 120 BPM. Ranges are inclusive.

| Frames / time | Step and action | On-screen text |
| --- | --- | --- |
| 0–149 / 0–5s | Title over the sample homepage. | “Save your personal schedule.” / “Sign in with an approved registration.” |
| 150–389 / 5–13s | 1. Open “Schedule” from the actual site navigation. | “Open Schedule.” |
| 390–689 / 13–23s | 2. Select the fixture's first event day. | “Choose your event day.” |
| 690–869 / 23–29s | 3. Type “Listening” in “Search this day”. | “Search for your session.” |
| 870–959 / 29–32s | Open “Listening to your community” to reach its detail controls. | “Open the session.” |
| 960–1169 / 32–39s | 4. Press “Bookmark” on that session. Hold “Bookmarked” after the write resolves. | “Select Bookmark.” |
| 1170–1259 / 39–42s | 5. Return from the session detail. | “Return to the schedule.” |
| 1260–1409 / 42–47s | Open “My schedule”. | “Open My schedule.” |
| 1410–1619 / 47–54s | 6. Show the same session in the personal schedule. | “Your saved session appears here.” |
| 1620–1799 / 54–60s | Result and small settled Event Runner lockup. | “Make room for your event.” |

The registration line is the one eligibility note. Do not add further
safeguards. The planner assigns exact press and typing frames after capture,
including separate motion and reading intervals. End layout settles by
frame 1740. Preserve at least one second of an unobstructed result.

## Two cuts

Landscape shows the day selector, search field, and a whole schedule entry in
one flat browser frame. Vertical uses the real phone menu and stacked schedule
entry, each at a readable size. Keep the search result, its full title, and its
Bookmark control together where they fit. Otherwise pan between measured
targets and hold each. Type and controls remain in the y=250–1540 safe band.
Use the real URL, one pointer, no tilt, and no decorative transitions.

## Sound, inputs, and delivery

Use the shared seed with bookmarks enabled, an approved local attendee, and
no existing bookmarks. Reach the signed-in precondition through local UI sign-in.
Wait for the bookmark subscription to confirm the write; an optimistic star
alone is not success. Reopen “My schedule” to check the persisted result.
Capture artifacts include measured boxes for day, search, result, bookmark,
and personal-schedule entry. Synthesized audio targets -19 LUFS and ducks for
reading, with one click per visible press. No narration.

Source: `video/save-schedule/`. Deliver
`save-schedule-landscape.mp4`, `save-schedule-vertical.mp4`, and a descriptive
`save-schedule-transcript.md`. Use the shared command sequence with
`--piece save-schedule` and both formats. The transcript includes every line
above, the search term, session title, and state change.

- [ ] Feature and account prerequisites are true and stated accurately.
- [ ] Search, bookmark, and personal-schedule states persist in the real UI.
- [ ] No real name, face, contact detail, or external request enters capture.
- [ ] Phone menu path, type size, safe area, and reading holds are verified.
- [ ] Transcript, muted comprehension, flash analysis, and final audio pass.
- [ ] Independent review complete; human watch/listen remains identified.
