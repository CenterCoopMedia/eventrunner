# Audit 05 — apps/web public site (components, pages, App.jsx, main.jsx, index.css, styles, test)

Read-only. Nothing in the repository was changed. No build, browser, emulator or
test suite was run; proofs are greps and `node -e` one-liners.

Thirteen findings, ordered by severity. None is a security or data-loss defect.

---

### 1. Attendee directory splits a letter group when a name starts with an accented letter (duplicate React keys and duplicate DOM ids)

- Category: broken
- Confidence: certain
- Where: `apps/web/src/pages/Attendees.jsx:76-79` (`indexLetter`), `:91-100` (`groupByLetter`), `:157-163` (sort), `:301-318` (render: `key={group.letter}`, `id={`attendee-letter-${group.letter}`}`)
- Evidence: the list is sorted with `a.displayName.localeCompare(b.displayName)`, which files `Édouard` between `Eaa` and `Ezra`. `indexLetter` returns the raw first character upper-cased (`É`), and `groupByLetter` only merges with the *previous* group. Run:
  ```
  node -e "…names=['Eaa','Édouard','Ezra','Zed','Ángel','Adam','Azra','émile'] …"
  → [{"letter":"A",["Adam"]},{"letter":"Á",["Ángel"]},{"letter":"A",["Azra"]},
     {"letter":"E",["Eaa"]},{"letter":"É",["Édouard","émile"]},{"letter":"E",["Ezra"]},{"letter":"Z",["Zed"]}]
  ```
  The comment on `indexLetter` claims "The comparison is the same `localeCompare` the sort uses, so the groups follow the order the list is already in" — it is not the same comparison. `Attendees.test.jsx` has no accented-name case.
- How it is reached / impact: any directory holding e.g. "Eaa…", "Édouard", "Ezra…". The page renders two `<section key="E">` (React duplicate-key warning, unstable reconciliation while filtering), two `<h2 id="attendee-letter-E">` (the second section's `aria-labelledby` resolves to the first heading), and the reader sees E / É / E as three letter heads.
- Proposed fix: in `indexLetter`, fold the letter to its base before returning it: `first.normalize('NFD').replace(/\p{M}/gu, '')` (then `É`→`E`, matching the collation's primary order). Add one accented-name case to `Attendees.test.jsx`.

### 2. Three Tailwind class names in use that the theme does not define (they generate no CSS)

- Category: broken
- Confidence: certain
- Where:
  - `apps/web/src/pages/MyChangeRequests.jsx:71` — `border-t border-border-subtle`
  - `apps/web/src/components/speaker/SpeakerSessionMaterials.jsx:248` — `text-caption text-status`
  - `apps/web/src/pages/SessionPitch.jsx:154` — `text-body-lg text-text-secondary`
- Evidence: `apps/web/tailwind.config.js` `theme.extend.colors` has no `border-subtle` and no `status`; `fontSize` has `folio, caption, body, lead, h3, h2, h1, nameplate` and no `body-lg`. `grep -rn "border-subtle\|text-status\|body-lg" apps/web/src --include=*.css` → no hits; the three lines above are the only occurrences in the repository.
- How it is reached / impact: (a) `/profile/change-requests`: the divider between requests gets Tailwind's preflight default border colour (a fixed light grey), not a theme rule token, so it ignores the preset and dark mode; every other divider in the public site is `border-t-hairline border-t-rule-hairline`. (b) speaker dashboard "Link sent for organizer review." notice inherits the parent colour instead of an intended tone. (c) the pitch page intro renders at inherited size instead of the intended larger step.
- Proposed fix: `border-t-hairline border-t-rule-hairline` in MyChangeRequests; `text-text-secondary` in SpeakerSessionMaterials; `text-lead` in SessionPitch.

### 3. `/updates/:id` never names itself in the tab; the server title is replaced by "Updates" when the app boots

- Category: inconsistent
- Confidence: likely
- Where: `apps/web/src/pages/UpdateDetail.jsx` (no `useDocumentTitle` call); contrast `pages/SessionDetail.jsx:62`, `pages/SpeakerDetail.jsx:69`, `pages/SponsorDetail.jsx:38`; `components/RouteTitle.jsx:11-16`; `lib/useDocumentTitle.js:128-147`; `functions/src/public/og.cjs:200-208`; `firebase.json:21-23`
- Evidence: `updatesMeta` serves `/updates/**` with `<title>${update.title} · ${siteName}</title>`. In the client, `routeTitlePartFor` resolves `/updates/abc` through `systemPageIdForPath` to the `updates` system page and returns that page's heading. `RouteTitle.jsx` says "A page that IS showing a record — a session, a speaker, a content page — names itself through useDocumentTitle and wins over what this derives", and `useDocumentTitle.js` says the derived part exists "so the tab does not change when the app boots". UpdateDetail is the one record page with a server-rendered record title that does not claim it.
- How it is reached / impact: open any shared update link. The tab shows the update's title, then changes to the list page's name once React mounts; history entries and bookmarks made after boot are labelled "Updates".
- Proposed fix: in `UpdateDetail.jsx`, call `useDocumentTitle(features.updates ? update?.title : null)` before the early returns (the `update` lookup has to move above them, as SessionDetail does).

### 4. SpeakerDetail lists a speaker's sessions without the `visible` test every other reader applies

- Category: inconsistent
- Confidence: likely
- Where: `apps/web/src/pages/SpeakerDetail.jsx:103-109`
- Evidence: `scheduleData.filter((session) => Array.isArray(session.speakerIds) && session.speakerIds.includes(speaker.id))`. Every other consumer filters: `Schedule.jsx:155,167` (`session.visible`), `SessionDetail.jsx:56`, `MySchedule.jsx:90`, `SharedSchedule.jsx:83`, `dashboard/MySessionsCard.jsx:47`, `SponsorDetail.jsx:49`, `lib/speakerSessions.js:39` (`visible === true`). `SpeakerDetail.test.jsx` has no hidden-session case.
- How it is reached / impact: the published listener already queries `visible == true` (`lib/contentSource.js:87`), so a live anonymous reader is not affected. It is reached where `scheduleData` is unfiltered: the admin draft preview (`?preview=1`, reads `cmsSchedule_drafts`) and the committed snapshot fallback. There a hidden session appears under "Sessions" on the speaker page with a link to `/schedule/<id>`, which then renders "This session is not available" — so preview disagrees with what publish will show.
- Proposed fix: add `session.visible &&` to the filter at `SpeakerDetail.jsx:106` and one test.

### 5. Schedule page: `columns` is rebuilt every render, which defeats the `plainText` memo

- Category: inefficient
- Confidence: certain
- Where: `apps/web/src/pages/Schedule.jsx:230` (`const columns = resolveTracks(eventConfig);`), `:234-244` (`useMemo(... [days, sessionsByDay, columns, eventConfig, speakerNamesById])`), also `:186` and `:197` (two more `resolveTracks(eventConfig)` calls)
- Evidence: `lib/scheduleGrid.js:44-57` — `resolveTracks` returns a fresh array on every call, so `columns` is a new identity each render and the memo's dependency list never matches. The comment at `:231-233` says the text is "recomputed only when the data changes".
- How it is reached / impact: `schedulePlainText` walks every day and every session. It now runs on every render of the page: each keystroke in the search field (`updateView` → URL change), each filter toggle, and each `useEventClock` tick. Wasted work, proportional to programme size; no wrong output.
- Proposed fix: `const columns = useMemo(() => resolveTracks(eventConfig), [eventConfig]);` placed above the first use, and reuse `columns` at `:186` and `:197`.

### 6. Three lazy pages import a helper from the Schedule page module

- Category: inefficient
- Confidence: likely (not confirmed with a build — builds were out of bounds)
- Where: `apps/web/src/pages/Schedule.jsx:80-87` (`export function sortSessions`); importers `pages/MySchedule.jsx:30`, `pages/SharedSchedule.jsx:34`, `pages/SpeakerDetail.jsx:34`
- Evidence: `App.jsx:54-60` code-splits each page with `lazyPage(() => import(...))`. A static `import { sortSessions } from './Schedule.jsx'` makes the Schedule page module — with its own imports (`ScheduleGrid`, `SchedulePrint`, `schedulePdf`, `scheduleText`, `scheduleView`, `clipboard`, the filter controls) — a dependency of the speaker-detail, shared-schedule and my-schedule chunks.
- How it is reached / impact: a visitor who opens `/speakers/<slug>` downloads and evaluates the schedule page's code to get an eight-line comparator. `dashboard/MySessionsCard.jsx:48-54` already carries its own copy of the same comparator rather than importing the page.
- Proposed fix: move `sortSessions` to `lib/scheduleView.js` (which already owns `sortEntries`) and import it from there in all four pages; `MySessionsCard` can use it too.

### 7. Five components are rendered only by the specimen book

- Category: unneeded
- Confidence: owner-decision
- Where: `components/editorial/FigureSentence.jsx`, `components/editorial/RuledTable.jsx`, `components/forms/Dropzone.jsx`, `components/forms/SegmentedControl.jsx`, `components/forms/Switch.jsx` (about 560 lines, plus a test file each and their CSS in `index.css` / `publicControls.css`)
- Evidence: import graph over `apps/web/src` from `main.jsx`, production edges only, with `pages/specimen/**` removed: these five become unreachable; nothing in `admin/`, `pages/`, or other components imports them. The specimen route is mounted only in the demo build and dev server (`pages/specimen/specimenRoute.js:48`).
- How it is reached / impact: no client deployment renders them on any route. They are a shelf of devices with no consumer; they still cost test time and CSS in the main stylesheet.
- Proposed fix: owner call — keep as design vocabulary, or delete the five with their tests, specimen entries (`pages/specimen/controls/{dropzone,segmented,switch}Control.jsx`, the uses in `sections/`) and CSS.

### 8. Dead CSS rule `.event-hero__action`

- Category: unneeded
- Confidence: certain
- Where: `apps/web/src/index.css:2522`
- Evidence: `grep -rn "event-hero__action" .` over the whole repository (excluding node_modules) returns only that line. The hero's action row is `<div className="no-print mt-lg flex flex-wrap gap-sm">` in `pages/Home.jsx:310`. A class sweep of `index.css`, `styles/schedule.css`, `components/loadingState.css`, `components/publicControls.css`, `components/forms/stepper.css` and `pages/NotFound.css` against every `.js/.jsx/.cjs/.mjs/.html/.json` under apps, packages, scripts, e2e and design found no other unreferenced class (the `ql-*` selectors are Quill's own). No unused custom property was found in those files.
- Proposed fix: delete the line.

### 9. Two small helpers duplicated where a shared one exists

- Category: unneeded
- Confidence: certain
- Where:
  - `components/LaunchGate.jsx:20` — `String(pathname ?? '').split('/').filter(Boolean)[0] ?? ''` is `firstPathSegment` from `shared/routing` (`packages/shared/src/routing.cjs:88-90`), character for character. That file's comment gives the reason it is shared: "Two copies of the same three lines is two places to disagree".
  - `pages/ContentPage.jsx:71` and `components/speaker/SpeakerResourceCard.jsx:20` — both declare `const AREA_MAP_SECTION_ID = 'travel_local'`, while its sibling `VENUE_MAP_SECTION_ID` is exported once from `shared/venue`.
- Impact: none today; two places to change.
- Proposed fix: import `firstPathSegment` in LaunchGate; export `AREA_MAP_SECTION_ID` from `packages/shared/src/venue.cjs` (and its `.mjs` shim) beside `VENUE_MAP_SECTION_ID` and import it in both files.

### 10. Dashboard resource cards use the older page-visibility test and an unchecked path

- Category: inconsistent
- Confidence: likely (low severity)
- Where: `apps/web/src/components/dashboard/ResourceCards.jsx:21-25`
- Evidence: it selects pages with `page.visible !== false && typeof page.path === 'string'` and renders `<Link to={page.path}>`. The speaker dashboard's equivalent (`components/speaker/SpeakerResourceCard.jsx:24-33`) uses `getPublicPage(id, features)` and `isCanonicalPagePath(page.path)`. `contexts/ContentContext.jsx:271-288` explains why `!== false` was replaced for reader-facing lookups, and `packages/shared/src/routing.cjs:116-125` says a renderer should ask `isCanonicalPagePath` before putting a stored path in a link.
- How it is reached / impact: only with data the validators would refuse today (a page whose `visible` is absent in a draft preview, or a stored path written around the validator): the card links to a page that then 404s through `ContentPage`, or to a non-canonical path.
- Proposed fix: use `getPublicPage(id, features)` and `isCanonicalPagePath(page.path)` in ResourceCards, as SpeakerResourceCard does.

### 11. Event-specific wording hardcoded in a shared page

- Category: inconsistent
- Confidence: owner-decision
- Where: `apps/web/src/pages/SponsorDetail.jsx:65` — `<h2 …>At the summit</h2>`
- Evidence: CONTRIBUTING.md "We will bounce: Hardcoded event names, cities, hex colors, or domains". "summit" is the one event-type noun in a production heading in this area (`grep -rni summit components pages` → this line and one comment). Every client's sponsor page with a `supportDescription` shows it.
- Related, demo-only and probably deliberate, listed so nobody re-finds them: `components/Layout.jsx:360,566` (`eventConfig.shortName === 'NC Local'`, `alt="NC Local"`), `components/SponsorWall.jsx:205` and `pages/SponsorDetail.jsx:55` (`'branding/nclocal-logo.png'`), `components/DemoBanner.jsx:208` ("Historical 2026 demo."). All sit behind `IS_DEMO` / `isReadOnlyDemo`.
- Proposed fix: change the heading to "At the event".

### 12. Small leftovers

- Category: unneeded
- Confidence: certain
- Where / evidence:
  - `pages/TicketClaim.jsx:108,193` — `inputRef` is created and attached, never read.
  - `components/media/PhotoCrop.jsx:40,160` — `frameRef`, same.
  - `components/media/ProfilePhoto.jsx:29` — `export { initialOf }` re-export; the only importer is `ProfilePhoto.test.jsx:13`, which repeats the assertions already in `editorial/Avatar.test.jsx:40-42`.
  - Exports nothing imports, production or test (`grep -rlw` over apps, console, e2e, scripts, docs, packages, functions returns only the defining file): `staysOpen` (LaunchGate.jsx), `quoteKey`, `firstQuoteKey` (blocks/pullQuoteBudget.jsx), `SENT_STATE_WORD` (forms/Dropzone.jsx), `STEP_STATE_WORDS` (forms/Stepper.jsx), `buildSpeakerResources` (speaker/SpeakerResourceCard.jsx), `indexLetter` (pages/Attendees.jsx), `SURFACE_TOKEN` (pages/specimen/tokens.js), `useLiveValue` (pages/specimen/useLiveToken.js). Each is used inside its own file; only the `export` keyword is unneeded.
  - The trim-or-null `text()` helper is declared eight times (`blocks/FactBlock.jsx:18`, `QuoteBlock.jsx:16`, `SponsorPackageBlock.jsx:14`, `StatBlock.jsx:30`, `pullQuoteBudget.jsx:21`, `editorial/Byline.jsx:17`, `DefinitionList.jsx:22`, `PullQuote.jsx:38`) and the string-or-empty `text()` three times (`pages/Attendees.jsx:59`, `AttendeeProfile.jsx:31`, `SpeakerDetail.jsx:37`). No shared helper exists yet, so this is a note, not a defect.
  - `pages/Schedule.jsx:217` — a comment starts on the same line as the `const view = …` statement (a lost line break).
- Proposed fix: drop the two refs, the re-export and the `export` keywords; leave the rest.

### 13. Comments in `shared/routing.cjs` that no longer match App.jsx

- Category: inconsistent (code vs comment)
- Confidence: certain
- Where: `packages/shared/src/routing.cjs:11-12` ("imported by BOTH the functions validator … and the web router (apps/web/src/App.jsx)") and `:22-25` ("`admin` is reserved ahead of its own route landing: an authenticated `/admin` area is under construction on a parallel branch")
- Evidence: `apps/web/src/App.jsx` imports nothing from `shared/routing` (the web importers are `pages/ContentPage.jsx:21`, `lib/siteNavigation.js`, `lib/useDocumentTitle.js`); `App.jsx:96-108` mounts `admin/*`.
- Impact: misleads a reader about where the reserved list is enforced.
- Proposed fix: reword the two sentences (name ContentPage.jsx; say the admin route is mounted).

---

## Files read

- `App.jsx`, `main.jsx`: in full.
- `pages/` top level (31 production files, ~7,300 lines): Schedule, Home, Tickets, Profile, ContentPage in full; the other 26 with whole-line comments removed (all code and JSX lines read).
- `components/` (112 production files): Layout, SignInPanel, FeedbackModal, ChangeRequestModal, SessionCard, ScheduleGrid, SchedulePrint, CallingPoints, ScrollReset, EventCountdown, SponsorWall, DemoBanner, NoticeBar, BackToTop, Header, InfoCards, and all of `session/`, `schedule/`, `speaker/`, `media/`, `forms/`, `blocks/`, `editorial/`, `dashboard/`, `tickets/`, `registration/`, `pitch/` with comments removed; static markup lines (tags and literal class attributes with no expression) were skipped in the later batches, so JSX-only layout was not read line by line there.
- `pages/specimen/` (33 production files, demo/dev only): `specimenRoute.js` read; the rest covered by the mechanical checks below only.
- `index.css` (2,860 lines), `styles/schedule.css`, the four component CSS files: not read line by line; covered by the unused-class and unused-custom-property sweeps and by the class-name-exists check.
- `test/` (5 files): confirmed each is imported (3–17 importers); `retiredUtilityNames.js` read.
- Test files (141): read only beside a finding (Attendees, SpeakerDetail, UpdateDetail, SessionActions, SpeakerActionItems, SpeakerResourceCard).

Mechanical checks run over all of `components/` and `pages/`: import graph and reachability from `main.jsx`; unresolved relative imports; exported names with no importer; destructured props never read (699 props); CSS classes and custom properties never referenced; Tailwind colour/size/spacing tokens that the config does not define; callable names against `Object.keys(require('functions/index.js'))`.

## Checked and found correct

- Every component and page is reachable from `main.jsx`; no orphan files; no unresolved import inside `src`.
- App.jsx routes: every lazy import resolves to an existing page; every static first segment is in `RESERVED_PATH_SEGMENTS` and every reserved segment has a route (`p` and `specimen` are documented exceptions); `SYSTEM_PAGE_ROUTES` matches the mounted routes; the catch-all is last.
- Callables named in this area — `mediaDelete`, `mediaUpdateMetadata`, `mediaUpload`, `scanMediaUsage`, `submitSessionPitch`, `ticketingCatalog`, `ticketingCheckout`, `ticketingMyTickets`, `ticketingOrderStatus`, `ticketingPromoPreview` — are all exported by `functions/index.js` (164 exports).
- No destructured prop is unread in any component.
- Effects with async work guard against stale results (request ids, `cancelled` flags or AbortController) in SpeakerProfile, SpeakerDashboard, OrganizationProfile, MyChangeRequests, MyTickets, TicketStatus, Tickets, SpeakerAccept, AttendeeProfile, SpeakerActionItems, SpeakerSessionMaterials, CalendarSyncCard, AreaMap, DemoBanner.
- Constants that mirror the server agree: custom badge length 24 (Profile copy vs `shared/badges`), speaker material file limit 9 MB (`functions/src/materials/policy.cjs`), invitation lifetime "two weeks" (`INVITE_TTL_MS` = 14 days).
- `useSessionMaterialsCount` per schedule row is not an N+1: it shares one listener (`lib/materialsSource.js`).
- Updates/UpdateDetail reading `visible !== false` is deliberate (published query filters server-side; the guard is for draft preview).
- `duration-slow`, `ease-motion`, `rounded-brand(-lg)`, `border-hairline/strong/nameplate`, `max-w-prose/stage` and the other custom utilities used here all exist in `tailwind.config.js`.
