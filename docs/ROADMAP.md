# Roadmap

v1 is five phases. The architecture spec and triage record are the contract. Issues in this repo are the queue.

## M1: Prerequisites and repo bootstrap — effectively complete

Legal and operator setup that gated the public repo. Two residual operator tasks are closing today.

- [x] Copyright holder and LICENSE grantor: Center for Cooperative Media
- [x] CCM GitHub organization with operator admin
- [x] Trademark screen and domain acquisition for the working name
- [x] Postmark account (one account, per-client message streams)
- [x] Workspaces layout, day-one legal files, credential-free CI

## M2: Scaffold and core port — complete

A fresh Firebase project boots to a working generic event site, including event-neutral emailed-code login.

- [x] Event configuration layer (deploy-time env + runtime `config/*`)
- [x] Shared workspace package with functions vendor packing
- [x] Email core and adapters (Postmark, webhook, console)
- [x] Operator notifier and telemetry
- [x] OTP authentication with tokenized templates
- [x] CMS content with two-revision draft/publish
- [x] Pages-as-data
- [x] Admin config mutation endpoints
- [x] Theming
- [x] Schedule and bookmarks
- [x] Attendee profiles
- [x] `init-event` bootstrap
- [x] Credential-free CI and per-client deploy matrix

## M3: Feature port wave — complete

- [x] Speaker canonical store and invite pipeline
- [x] Speaker profile wizard and public pages
- [x] Session materials (two collections, embargo)
- [x] Media library with Storage rules hardening
- [x] Session reactions
- [x] Badges from per-event config
- [x] Schedule PDF and `updatesMeta` SSR
- [x] Live-updates admin form and feedback inbox

## M4: Ticketing adapter — complete

Last, because everything else has to be stable first.

- [x] TicketingProvider core (tickets collection, webhook dedup, sync queue)
- [x] Eventbrite adapter
- [x] Manual/CSV adapter
- [x] Registration state machine
- [x] Provider-owned registration prompts and ticket templates

## M5: Packaging and transfer — in progress

Issues #92 and #79 moved to a new milestone, M5.1: Operator follow-ups, because they wait on a third party.

- [x] Operator documentation (deploy runbook, client onboarding, admin guide)
- [x] Cloud Run site-publisher
- [x] Community scaffolding completion
- [x] E2E suite on emulators in CI
- [x] First public push and issue migration (this repository)

Five items remain. Each needs an operator account this sandbox does not have.

- [ ] Public demo instance with synthetic event (#35)
- [ ] Complete Postmark deployment, webhook setup, and delivery tests (#91)
- [ ] Demo discoverability: crawlable public demo routes (#96)
- [ ] Claim the Eventrunner npm package names and scopes (#99)
- [ ] Complete Eventrunner operator provisioning and launch readiness (#100)

## M5.1: Operator follow-ups

Items that wait on a third party.

- [ ] Trademark counsel review of the Eventrunner rename (#92)
- [ ] Verify the Eventbrite adapter against a real sandbox event (#79)

## M6: Agent-ready operations + WebMCP

Read-only diagnostics done. Write tools wait on a separate security and product review.

## Parity milestones

Prospective clients asked for the platform they used at CJS 2026. CJS parity is now the product target. See [docs/plans/2026-09-09-cjs-parity-gap.md](plans/2026-09-09-cjs-parity-gap.md) for the full gap analysis and issue list.

### M7: Public site completeness — complete

A visitor can reach and read every page the seed creates, and the site presents itself correctly to search engines and social previews.

- [x] Render the navigation from page documents (#147)
- [x] Add the sign-in and account control to the header (#148)
- [x] Build the footer link list and organizer links (#149)
- [x] Serve per route metadata from the server (#150)
- [x] Generate a sitemap, a robots file, and a web manifest at publish time (#151)
- [x] Reset scroll position on route change and add a back to top control (#152)
- [x] Add a countdown and a lifecycle aware home lead (#153)
- [x] Add a configured registration action (#154)
- [x] Add an information card arrangement to the home page (#155)
- [x] Add a sponsor strip section to the home page (#156)
- [x] Seed a recap page and a guidelines page (#157)
- [x] Seed a city guide page (#158)
- [x] Add an uploaded venue map with labelled rooms (#159)
- [x] Add search and a section index to long content pages (#160)
- [x] Add a session recording link field (#161)

Follow-ups filed while the milestone ran, carried into later milestones rather
than held against M7: #218, #219, #226, #227, #230, #231, #233, #234, #236.

### Design system: the editorial desk and the vocabulary expansion — in progress

The admin CMS moved onto the editorial desk on 2026-09-10 (#245): a dark rail, a
white title band, tinted state badges, 44px controls, and the event's own colours
worked into the admin's action family. The design vocabulary then expands in six
waves so a site and its admin read as designed. Tracking issue #249; direction
record `docs/plans/2026-09-10-design-vocabulary-expansion.md`. Every wave is one
pull request stacked on the wave below.

- [x] The admin CMS on the editorial desk, in the event's own colours (#245)
- [x] The direction record (#250)
- [ ] Wave 1: the state grammar, the motion grammar and its test, eight shared
      controls, the stage and measure width system, the specimen book and its
      capture script; closes #219, #233, #236 (in review)
- [ ] Wave 2: text, feedback and input devices; block types; option groups
- [ ] Wave 3: four illustration sets (a first pass sits on its branch)
- [ ] Wave 4: schedule devices on the schedule (#162 to #167) and the dashboard
      shells (#168, #210)
- [ ] Wave 5: three site styles: Gallery, Playbill, Listings
- [ ] Wave 6: admin devices on the M9 to M11 pages

### M8: Attendee and schedule experience

An attendee can find a session, build a personal schedule, and take it with them.

- [ ] Add schedule search (#162)
- [ ] Add format and track filters (#163)
- [ ] Add a sort control and put filter state in the URL (#164)
- [ ] Show bookmark counts on session rows (#165)
- [ ] Add the print control, the PDF control, and a plain text view (#166)
- [ ] Mark running and finished sessions during the event (#167)
- [ ] Build the attendee dashboard shell (#168)
- [ ] Add the personal schedule and resource cards to the dashboard (#169)
- [ ] Add per session private notes (#170)
- [ ] Generate a personal schedule PDF (#171)
- [ ] Share a personal schedule from its own projection (#172)
- [ ] Add the public shared schedule page (#173)
- [ ] Add search and an organization filter to the attendee directory (#174)
- [ ] Add photo cropping and default avatars to the photo fields (#175)
- [ ] Add free text custom badges behind a flag (#176)
- [ ] Add optional calendar sync of saved sessions (#177)

### M9: Admin overview and operations

An organizer can see how the event is going and act on it without leaving the admin.

- [ ] Add a server side event statistics endpoint (#178)
- [ ] Add the admin overview page (#179)
- [ ] Add milestones and goals to the event settings (#180)
- [ ] Add the registration funnel and content readiness panels (#181)
- [ ] Add session popularity to the admin (#182)
- [ ] Add the outbound email log (#183)
- [ ] Add attendee export (#184)
- [ ] Extend attendee administration (#185)
- [ ] Add operator and staff admin tiers (#186)
- [ ] Add the admin access page (#187)
- [ ] Add the change request queue (#188)
- [ ] Add bulk material download and coverage tracking to the materials page (#189)

### M10: CMS editors and publishing

Every collection the site renders can be edited and published from the admin.

- [ ] Add the updates editor (#190)
- [ ] Add an update category and featured flag (#191)
- [ ] Add the organizations editor (#192)
- [ ] Add a sponsor detail page and package blocks (#193)
- [ ] Add the timeline editor and the history section (#194)
- [ ] Add the version history page (#195)
- [ ] Add the pending changes page and banner (#196)
- [ ] Add rich text editing for rich text fields (#197)
- [ ] Add an editor tour and section edit links (#198)

### M11: Communication, social, and billing

Organizers can announce, message, and bill, and attendees can talk to each other where a client wants that.

- [ ] Add the announcement store and the site banner (#199)
- [ ] Extend live updates with categories, audience, and key dates (#200)
- [ ] Add batch send to the email provider interface (#201)
- [ ] Add the announcement email composer (#202)
- [ ] Add saved templates and a send history to the composer (#203)
- [ ] Add an editable speaker mail template (#204)
- [ ] Add the social feed read surface and moderation store (#205)
- [ ] Add the post composer and thread view (#206)
- [ ] Add the notification inbox (#207)
- [ ] Add the invoice record and the admin invoice form (#208)
- [ ] Add invoice output and the invoice list (#209)

### M12: Speaker experience

A speaker has one place that shows their session, what is still owed, and where to send it.

- [ ] Build the speaker dashboard shell (#210)
- [ ] Add the speaker countdown and status header (#211)
- [ ] Add the session hub with details and co-speaker tabs (#212)
- [ ] Give speakers their own material upload path (#213)
- [ ] Add speaker action items and a completion meter (#214)
- [ ] Add the speaker resources card (#215)
- [ ] Add discussion points submission (#216)

See [docs/adr/0001-event-platform-v1.md](adr/0001-event-platform-v1.md) and [docs/plans/2026-08-16-event-platform-v1-triage.md](plans/2026-08-16-event-platform-v1-triage.md).
