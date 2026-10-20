# Tutorial: Change the site style

Status: approved by Joe, October 11, 2026. Production in progress.
Apply the shared [production plan](video-production.md).

## Task and source

Teach an operator to choose a site style, review the actual pages, publish the
theme, and see the public result. Start signed in on the admin Overview.
Sources: [admin tiers](ADMIN_GUIDE.md#who-can-do-what-operator-and-staff),
[Branding guide](ADMIN_GUIDE.md#settings--branding),
[site styles](design-reference.md#the-six-site-styles), and
`apps/web/src/admin/pages/AdminBranding.jsx`.

Branding requires operator access. Staff do not have this permission. Current
source opens Branding on “Identity”; select “Page style” to reach “Site style”.
The publish button is “Publish the theme”. The guide's first-control wording
predates that task navigation. Follow the captured UI; do not amend the product
or guide in this video task.

Use only fictional event data. Start with the default Institutional style and
choose Newsroom with no custom overrides in the fixture. No real-data exception.
Show one complete preset change, not a promise that every custom palette will
pass contrast. Do not teach asset uploading or app-icon deployment here.

## Script and clock

84 seconds, 2,520 frames, 30 fps, 120 BPM. Ranges are inclusive.

| Frames / time | Step and action | On-screen text |
| --- | --- | --- |
| 0–179 / 0–6s | Title on the sample admin Overview. | “Change your site style.” / “Start signed in as an operator.” |
| 180–509 / 6–17s | 1. Open “Branding” under Settings, then “Page style”. On phone, open “Menu” first. | “Open Branding, then Page style.” |
| 510–839 / 17–28s | 2. Choose “Newsroom” in “Site style”. | “Choose a Site style.” |
| 840–1199 / 28–40s | 3. Review the real Home and Schedule page previews in desktop mode. | “Review Home and Schedule.” |
| 1200–1559 / 40–52s | 4. Switch the preview to “Phone”; check its light and dark views with separate holds. | “Check Phone, Light, and Dark.” |
| 1560–1829 / 52–61s | 5. Check the actual validation area. The fixture must have no blocking contrast failure. | “Resolve any warnings before you publish.” |
| 1830–2099 / 61–70s | 6. Select “Publish the theme”. Wait for the real success result. | “Select Publish the theme.” |
| 2100–2339 / 70–78s | 7. Open the public homepage and show the published style. | “Check the public site.” Then: “Your site style is published.” |
| 2340–2519 / 78–84s | Clean result and small Event Runner lockup. | “Make room for your event.” |

The warning instruction is the one safeguard. Never insert a fabricated “all
clear” badge into the product. The planner budgets reading time separately
for each mode and page change. End layout settles by frame 2460.

## Two cuts

One flat browser frame and one pointer. Landscape can show controls and the
real preview together when readable. Vertical records the actual phone admin
layout, scrolls between controls and preview, and rests during reading.
The phone preview is the product's own view, not a resized desktop capture.
Essential text and controls stay in y=250–1540. Crop to complete select fields,
buttons, and warnings. Browser chrome shows the capture's actual URL.

## Sound, inputs, and delivery

The synthetic operator fixture has a valid preset with no overrides. The
capture records the source theme, draft choice, preview state, published theme,
and public result. All changes go to loopback emulators. Do not represent
preview changes as published before the actual action and successful response.
The shared seeded music targets -19 LUFS, ducks during reading, and follows
the planner's real clicks. No narration.

Source: `video/change-style/`. Deliver
`change-style-landscape.mp4`, `change-style-vertical.mp4`, and the full
`change-style-transcript.md`. Rebuild with the production plan's commands,
`--piece change-style`, and both formats. The transcript describes all view
changes, seven steps, overlay text, and final confirmation.

- [ ] Operator role and actual Branding → Page style path are verified.
- [ ] Labels on previews match the rendered controls; no invented status.
- [ ] Public result uses the persisted theme after publication.
- [ ] Every preview mode gets its own readable hold in both cuts.
- [ ] Transcript, muted comprehension, flash analysis, and final audio pass.
- [ ] Independent review complete; human watch/listen remains identified.
