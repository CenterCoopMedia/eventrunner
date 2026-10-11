# Tutorial: Publish a page update

Status: approved by Joe, October 11, 2026. Production in progress.
Apply the shared [production plan](video-production.md).

## Task and source

Teach a signed-in staff member to edit and publish the homepage headline.
Start on the public homepage, where staff can see “Edit section”. End on the
updated public homepage in a visitor context. This is one existing page update,
not creation of a new page or a code deployment.

Sources: [staff handbook](handbook/for-event-staff.md#publish),
[admin guide: Content](ADMIN_GUIDE.md#content-pages--content-editor),
`apps/web/src/components/SectionEditLink.jsx`, and
`apps/web/src/admin/pages/AdminContentBlockEditor.jsx`. The actual buttons
read “Save draft” and “Save and publish”. The capture verifies the labels
on the rendered screen before the script is locked.

Use only the fictional Harborlight Forum and a local staff account. No real
content exception. No sign-in tutorial, bulk publishing, restore, or release
claim. One safeguard: saving a draft does not make it public.

## Script and clock

75 seconds, 2,250 frames, 30 fps, 120 BPM. Ranges are inclusive. Each row's
text is the complete video overlay for that section. The transcript
also describes the UI text entered, every pointer action, and the visible result.

| Frames / time | Step and action | On-screen text |
| --- | --- | --- |
| 0–149 / 0–5s | Title over the sample homepage; staff already signed in. | “Publish a page update.” / “Start signed in as event staff.” |
| 150–389 / 5–13s | 1. Open “Edit section” in the homepage opening. | “Open Edit section.” |
| 390–689 / 13–23s | 2. Select the existing headline block in the real content list. | “Choose the headline block.” |
| 690–989 / 23–33s | 3. Replace the text with “A place to share practical ideas.” Hold the complete field. | “Write your new headline.” |
| 990–1259 / 33–42s | 4. Select “Save draft”; wait for the saved result. | “Select Save draft.” Then: “A saved draft is not public.” |
| 1260–1589 / 42–53s | 5. Select “Save and publish”; wait for publication to complete. | “Select Save and publish.” |
| 1590–2069 / 53–69s | 6. Open the public homepage in a visitor context. Show the exact new headline. | “Check the public page.” Then: “Your headline is published.” |
| 2070–2249 / 69–75s | Hold the result and settle the small Event Runner end lockup. | “Make room for your event.” |

These are six steps. Title and end card are not extra tasks. The data planner
sets the exact press/typing frames from the capture and allocates reading
holds using `max(2, words / 2.6 + 0.6)`. Text changes get separate holds.
End layout settles by frame 2190. The clean result remains visible for at
least one second before the final card.

## Two cuts

Use one flat browser frame with the actual capture URL and one pointer.
Landscape shows the relevant editor area with a short instruction above it.
Vertical captures the real phone UI: open “Menu” only when the actual path
needs it, then show the section list, whole field, and full action in sequence.
Keep type and targets between y=250 and y=1540. Camera movement stops before
reading. Separate measured crops show the field and action at a readable size.

## Sound, inputs, and delivery

Quiet synthesized electronic music, -19 LUFS integrated, ducked for reading.
Keys and clicks follow actual visible actions. No narration. Capture with the
shared synthetic snapshot, local staff account, and emulator-backed CMS writes.
Verify the result through the visitor UI and its live-content state, not only
the admin toast or the first-paint snapshot.

Source: `video/publish-page/`, including the data script and planner
output. Deliver `publish-page-landscape.mp4`, `publish-page-vertical.mp4`, and
`publish-page-transcript.md`. Rebuild through the production plan's commands
with `--piece publish-page`; score, stills, full renders, and verification use
both formats. The transcript includes all overlays and the typed headline.

- [ ] Staff can follow the exact path without operator access.
- [ ] Draft and visitor state are distinct before publish.
- [ ] Visitor result matches the written headline after publish.
- [ ] Every line has sufficient reading time; typing finishes before the press.
- [ ] Both cuts, full transcript, sound-off review, flash test, and audio pass.
- [ ] Independent review complete; human watch/listen remains identified.
