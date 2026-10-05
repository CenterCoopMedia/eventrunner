# NC Local historical demo

The primary `newsroom` style presents a past-event mock-up of the fifth annual
NC News & Information Summit. It is a selected historical program, not an
official NC Local site or an offer of future attendance. The other five preset
definitions keep their own identities. Client draft and publish paths are unchanged.

## Authorized scope and compatibility

Joe requested this complete NC Local rebrand on October 5, 2026, in the existing
primary `newsroom` theme slot: Organization identity, North Carolina context,
locations, documented partner roles and public historical-event speakers. He
requested replacement of the fictional Harborlight/Example City demo, retention
of the other five theme identities and the draft/publish behavior, and an isolated
review-ready PR. This task does not authorize a merge, deployment or public release.

The primary preset definition is intentionally shared. Existing deployments that
select `newsroom` receive the NC Local palette, typography, 4px corners and style
label on their next publish. This is a visual compatibility change to that slot,
not a demo-only token override. Their own content, logo slots and transaction
controls still come from their own configuration. Operators who need to retain
an existing stored palette can use the existing `None` selection. The other five
preset definitions are unchanged.

The approved historical-data exception in ADR 0001 §5.4 covers the public names,
affiliations, session details, documented partner roles, Catherine Komp's public
ecosystem engagement and annual-summit role, official logo, the later
authorized derived dark-mode wordmark treatment and credited documentary photo
listed below. The derived treatment preserves the colored globe, interior arcs,
geometry, transparency and aspect ratio; the light-mode artwork is unchanged.
It supplies no private attendee or contact data
and claims no consent, endorsement or official NC Local ownership of this demo.

Joe's supplied organizational brief and the official NC Local team/Hub sources
provide the Catherine Komp context. This is organizational context; she is not
listed among the 25 speakers in the selected historical sessions.

The fixture in `scripts/lib/demo-event.cjs` owns the event, pages, content,
program, speaker affiliations and partner roles. Regenerate the first paint
snapshot with `node scripts/generate-content.cjs --demo`. The public demo runs
with `VITE_DEMO_MODE=1`, which disables network writes and authentication.
Registration has no destination. Attendee directory and calendar exports are
off. Public email links and the account navigation action are hidden in demo
mode. Client deployments use their own generated content and normal controls;
the primary preset compatibility change described above still applies.

## Historical content

The event took place Friday, March 27, 2026, 8 a.m.–4:30 p.m. Eastern, at
McKimmon Center, 1101 Gorman Street, Raleigh, NC 27606. Eight selected named
sessions and 25 speakers are represented. Breakfast, awards, lunch and the final
concurrent block give the day context. The final block does not invent session
titles or speakers. No keynote room or interior route is inferred.

NC Local and NC Open Government Coalition were co-producers. WUNC participated
with the Due South lunch broadcast. The Assembly sponsored the 5–8 p.m.
afterparty at Trophy Brewing’s The Bend Bar, 853 W Morgan St, Raleigh.

The hero headline is an adaptation for the demo. Speaker text records only the
published session and affiliation; it does not invent biographies or portraits.
The topical track names and session format chips are demo presentation groupings,
not a claim about the organizer's published track system.

## Source and asset provenance

- Organization context: [NC Local](https://nclocal.org/), [About](https://nclocal.org/about/), [Team](https://nclocal.org/about/team/) and [The Hub](https://nclocal.org/hub/).
- Program: [Published 2026 agenda](https://www.eventbrite.com/e/2026-nc-news-information-summit-tickets-1676080575119). Exact eight-session details were supplied from this agenda in the approved task brief; automated access to the ended listing was unavailable during implementation.
- Corroboration: [Elon University recap](https://www.elon.edu/u/news/2026/04/01/nc-news-information-summit-draws-record-attendance-spotlights-ais-impact-on-local-news/), [Catherine Komp post](https://www.linkedin.com/posts/catherinekomp_we-are-less-than-a-week-away-from-the-2026-activity-7440777551871926272-a_42) and [ProJourn listing](https://projourn.org/event/north-carolina-news-information-summit).
- Logo: [Official NC Local horizontal artwork](https://nclocal.org/wp-content/uploads/2025/06/cropped-NCLocal_Logo_Horizontal_Dark_1200px.png), 1200×260, preserved unchanged in `apps/web/public/branding/nclocal-logo.png`. Light mode retains the original artwork and white backing. The official home page and public media search exposed only the dark artwork; Joe confirmed there is no official white variant. The derived `nclocal-logo-dark.svg` embeds that unchanged PNG, preserves the globe colors and interior arcs, and makes only the wordmark white through a color matrix. It preserves the exact geometry, alpha and 1200×260 aspect ratio. It is a demo treatment, not an official logo variant.
- App icons: The same horizontal artwork sits unchanged on a warm square canvas. The demo manifest uses `purpose: any`; it does not claim maskable support. The SVG source and 192px/512px raster exports are in `apps/web/public/branding/`.
- Documentary photo: [Elon University’s opening-panel photograph](https://eloncdn.blob.core.windows.net/eu3/sites/74/2026/04/Summit-Panel-950x535.jpg), shown with visible source credit. This is historical reference imagery for the mock-up; no new photo or endorsement is claimed.
- Cabin: [Google Fonts upstream](https://github.com/google/fonts/tree/main/ofl/cabin), self-hosted Latin variable WOFF2, weights 400–700. SIL Open Font License 1.1 accompanies it as `OFL-cabin.txt`.

The palette and font choices follow the observed styles supplied in the brief.
They are not represented as a published brand manual. White is the NC Local
light editorial canvas; teal provides primary controls and lavender the soft
accent surface. The other five styles keep their existing tonal-ground contract.
