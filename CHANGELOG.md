# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Change requests, off by default behind the `changeRequests` feature flag. With the flag on, a
  signed-in visitor can select **Request a change** in the footer, and staff can send one from the
  new Change requests page under Operations. Both reach one store through `submitChangeRequest`,
  which takes the sender from the ID token, refuses every request while the flag is off, and
  allows 5 requests per account in 15 minutes. The page lists the requests newest first with a
  status filter kept in the address, moves each one through New, In progress, Done, or Declined,
  and removes a request and its text outright. Every request, status change, and removal commits
  with its admin log row, which never holds the text. Only admins read the store, and deleting an
  account deletes its change requests (#188).
- Bulk material download and coverage on the Materials page, for staff and operators. One ruled table lists
  the materials for every session, hidden sessions included, up to 2,000 (past that it says so), with session
  and review filters and sortable columns that state their order in words. Each file row has **Download** and
  a checkbox; **Download as archive** saves the selected files as `session-materials.zip`, one folder per
  session, at most 50 files and 9 MB (the platform stops a streamed response at 10 MB). The archive is not a
  signed URL, which the issue named: Signing needs an IAM grant a fresh client project lacks, so the new
  staff-tier `downloadSessionMaterialsArchive` endpoint builds a stored zip with `yazl` and streams it through
  the function, as the single-file download already does. No link to a file is written anywhere. The server
  writes one admin log entry per file before the first byte and refuses the archive without them, and a
  transfer that fails part way saves nothing. A **Coverage** panel names the sessions and speakers with no
  materials, from the same list the table shows: A pending or approved material counts, and only published
  sessions with a speaker who is not removed are counted. The new `listAllSessionMaterials` endpoint reads the
  list (#189).
- The timeline editor, under Content, for staff and operators, and the past editions on the home
  page. Each timeline entry is a year, a title, and an optional description. The list shows the
  entries oldest first with each state in words, and the editor saves a draft or saves and
  publishes through `cmsPublish`. The home page's History section draws its own blocks, then the
  published entries as an ordered list, oldest first, with the year beside each title and no
  counter. The site subscribes to `cmsTimeline` at runtime, so an entry published from the admin
  appears on an open home page with no rebuild, and a new `timelineData.js` snapshot draws the
  list on first paint, before any listener answers. The content save checks each field: a year that is not a whole
  number from 1900 to 2100, a title that is not text on one line, a description longer than 600
  characters, or a field the entry does not store is refused with the field named, and nothing is
  written. The demo carries two fictional past editions (#194).
- A page for each sponsor at `/sponsors/<slug>`, with the logo, the name, the description as the
  standfirst, the tier as a term and its description, and the link to the sponsor's website. The
  slug is the organization's document id, set once from its name in the editor, so the address
  is unique by construction: a second organization claiming the same slug is refused with a 409
  that names it when it is saved, not when it is published, and deleting an organization frees
  it. The tier line above the name is gone, and the About section draws only when there is a
  biography, so the description no longer prints twice. A new `sponsor_package` block type
  (name, price, limit, and what the package includes) draws on the Sponsors page, in a
  Sponsorship packages section the seed adds after the logo wall and leaves empty until an
  operator adds a package. The demo carries three illustrative packages (#193).
- The organizations editor, under Content, for staff and operators: a table of the organizations in
  the order the Sponsors page draws them, with each state in words, and an editor for the name,
  tier, order, logo, website, and description. Publishing goes through `cmsPublish`, as every
  other editor does. The content save now checks each organization field's type and length: a
  name that is not text, an order that is not a number, a website that does not start with
  `http://` or `https://`, or a logo path that leaves the site's own files (a web address, a
  leading `/`, or `..`) is refused with the field named, and nothing is written. The server does
  not check that the logo file exists. The public site still drops a malformed organization that
  reaches the collection another way (#192).
- The updates editor, under Content, for staff and operators: a list of every update on the site's
  Updates page with its state in the admin's three words, its date on the event's clock, and
  whether it is pinned or hidden, and an editor for the title, the text, the date, the pin, and
  whether the update shows. Save writes a draft through `cmsSaveUpdate`, and **Save and publish**
  then calls `cmsPublish`, as every other editor does. The date is display scheduling only: a date
  in the future never holds a publish back. A new update's id is made in the browser once per
  form, so a retry after a failed publish rewrites the same draft. An update's picture and content
  blocks are kept as they are on every save (#190).
- An update category and a featured flag. `cmsSaveUpdate` takes `category` (null, or one line of
  1 to 24 characters once trimmed, stored trimmed) and `featured` (a boolean), and refuses a bad
  value by field name; both are optional on the wire and always stored. The rule lives in
  `shared/update` (`validUpdateCategory`, `UPDATE_CATEGORY_MAX`), which the server and the Updates
  page both read. The editor has a Category field that suggests the categories in use and a
  Feature checkbox, and the list shows both. The Updates page sets a category as a plain tag
  beside the title and opens with the first featured update in the feed's order under its own
  Featured head, with a dateline and a standfirst. The demo updates carry four categories and one
  featured update (#191).
- Version history, under Content, for staff and operators. Pick a collection and a record to read
  every version the record has had, newest first: the time of the publish on the event's clock,
  the account that published it, and a table of each field that changed, with its value before
  and after. Versions cannot be changed or restored. Every stored value shows as text.
  `cmsGetVersionHistory` now sends named fields only. Each entry holds `id`, `docPath`,
  `revision`, `visible`, `publishedAt` in milliseconds, `publishedBy`, `publishedByUid`,
  `previousRevision`, and `changes`: each changed field path with its value before and after, a
  time as milliseconds, at most 50, with `moreChanges` counting the rest. The server compares
  each version with the one before it at no extra read. The stored field snapshot is no longer
  sent (#195).
- Unpublished changes, under Content, for staff and operators: every page, content block, session,
  organization, update, and timeline entry that is saved and not yet on the site, in one ruled
  table per collection with its state, when it was saved, and by whom. **Publish all** and a
  publish per table call `cmsPublish`; a table's button waits while the list cannot be refreshed,
  so a stale row is never published twice. Under the tables, **Recent publishes** lists the last 10
  publish runs and the 20 newest runs still marked Failed, with **Resume publish** on a failed
  run. A banner above every other admin page states the same count in one sentence and links to
  the page. The banner and the page read one live source, the dirty drafts of each collection,
  never the publish run rows, so they always agree. No endpoint or rule changed; one composite
  index on `cmsPublishQueue` (`status`, `requestedAt` descending) orders the failed runs (#196).
- The email log, under Operations, for staff and operators: every message the site sent, newest
  first, in a ruled table with the recipient, the subject, the kind of message, and its state as a
  word. Search looks in the recipient and the subject across the 500 most recent messages at a
  time; the source and status filters stay in the page address, and the search text never does.
  A preview opens the stored body in an empty sandboxed frame under a content policy that blocks
  script, remote images, and every other fetch, with every link shown as its words only, so opening
  a message or clicking in it sends nothing to any other site. HTML that cannot be shown safely is
  replaced by the plain text version. Sign-in codes and speaker invitations still store no body. Two staff-tier endpoints,
  `listSentEmails` and `getSentEmail`, are the only readers of `sent_emails`, whose rules stay
  closed to every browser; each preview read is recorded in the admin log by account and record
  only (#183).
- `docs/adr/0003-optional-google-calendar-sync.md`, the proposed decision record for the optional
  Google Calendar sync of saved sessions (#177). It supersedes the one row of ADR 0001 §9 that
  removed the feature, names the client's own Google Cloud project as the owner of the consent
  screen and the OAuth client, picks the `calendar.app.created` scope, adds no secret, and says
  how the `calendarSync` flag behaves when a client has not finished the Google setup: the `.ics`
  download stays and nothing is written. The record is proposed, not accepted, and the flag stays
  off. The documentation site lists it under Decisions.
- Two admin tiers. An admin account is an operator or a staff member. Operators keep branding,
  feature flags, access, and the deployment settings; staff run content, the schedule, speakers,
  attendees, media, materials, and the operations pages. `config/bootstrap.adminEmails` keeps
  its meaning as the operator list, so every existing deployment keeps full access with no
  migration, and `config/bootstrap.staffEmails` is the new staff list. The database rules, the
  server's admin gate (`requireAdmin` takes a `tier` option and defaults to operator), and the
  admin rail all read the same two lists: the rail shows only the sections the signed-in tier can
  open and refuses the route of any other. Event settings admit staff; the sender block and the
  social sharing image are shown read-only to staff, and a staff save that would change either is
  refused by name. Branding is the operator's in the media library too: an upload into
  `branding/`, and a delete or relabel of a branding asset or of any asset a theme slot or the
  social sharing image uses, is refused for staff, and the Branding drawer is read-only for them. `init-event.cjs` takes
  `--staff` beside `--admin`; a re-run never removes a grant made in the admin and never puts back
  an address removed there, because only `--admin` and `--staff` add on a re-run.
- The Access page, under System, for operators: a ruled table of every admin account with its tier
  word. An operator grants staff or operator access to a new address, changes a tier, or removes
  access, and every change asks for a confirmation first, is written by the server with the
  address lowercased, and is recorded in the admin log. The server refuses a change that would
  leave the deployment with no operator, including an operator removing their own last grant.
- `getEventStats`, a staff-tier endpoint for the admin overview (#178). It answers the event's
  figures as server aggregates: accounts by registration status and completed profiles, ticket
  records by status, speakers by pipeline status, records on the site and records with unpublished
  changes for each content collection, and unresolved errors. Every figure is a Firestore
  `count()`, so no document leaves the database. A caller who is not an admin is refused.
- The admin overview (#179). `/admin` now opens on **Overview**, the first item on the rail, above
  the four groups and with no folio. It prints the endpoint's figures as sentences, each number in
  the data face beside the words that say what it counts, with the time they were read on the
  event's clock. **Refresh figures** counts again; while it runs it says so and ignores another
  press. A failed first read shows the server's words and no figures; a failed refresh keeps the
  figures and says when they were read. Staff and operators both open it.
- Milestones and a registration goal in the event settings (#180). `config/event.milestones` holds
  up to 20 named dates and `config/event.registration.goal` a whole number of approved attendees;
  the shared schema refuses anything else by field, and staff can save both. The Event page edits
  them in a **Milestones** panel and a **Registration goal** field, and says that anyone can read
  them. The overview lists the milestones in date order with the days left, sets the approved
  count against the goal as a sentence and a bar, and shows nothing when neither is set.
- The registration funnel and content readiness panels on the overview (#181). The funnel states
  accounts, then ticketed or approved, then approved, each as a number of all accounts beside a
  native progress bar, with revoked accounts named beside it; `getEventStats` sums the stages on the
  server. The readiness table lists, for pages, content blocks, sessions, organizations, the
  timeline, and updates, the records on the site and the records with unpublished changes. Both
  state zero in words: "No one has signed up yet." and "Nothing is on the site yet."
- A **Most saved** panel on the admin Sessions page (#182). It ranks sessions by the public
  bookmark counts, most saved first, in a scrolling ruled table with the session (a link to its
  editor), its day heading, and the count. It says how many sessions on the site have no saves,
  says "No session has been saved yet." when none has, says so when saving sessions is switched
  off, and keeps the last counts under a notice if the listener fails. `useBookmarkCounts` now
  also answers `ready` and `error`.
- Attendee export (#184). The Attendees page saves the rows on screen as a CSV file through the
  staff-tier `exportAttendees` endpoint. The file carries exactly the approved field set: name,
  email, organization, role, registration status, badges, past attendance, social handles, and
  profile visibility. A cell that a spreadsheet would run as a formula starts with an apostrophe.
  Every export writes an `admin_logs` row with the actor, the row count, the status filter, and
  whether a search was used, never the search text; the server refuses the file when that row
  cannot be written, and keeps no copy of it.
- Attendee records and a guarded account delete (#185). **Edit record** on an Attendees row opens
  the organizer-owned past attendance list, saved through the staff-tier `updateAttendee`
  endpoint; the rules deny the field to every client, its owner included. The same panel deletes
  an account through `deleteAttendee`: one transaction checks that the account is not the
  caller's, not an admin's, and not linked to a speaker, then removes the account, its directory
  profile, and its schedule share, releases its ticket claims, and writes the audit row. The
  sign-in, saved sessions, notes, and profile photos are cleared after it, and a part-way delete
  keeps a "Try the delete again" action that resumes it. Approve and revoke are unchanged.

- A `fact` block for a fact that is not a number (#234): The term, the fact itself, and one
  optional line under it. It renders through the new definition list device, a real `<dl>` ruled
  between pairs, and it asks for none of the evidence parts a statistic must carry. The home page's
  key facts now seed as three facts (when, where, who) with the dates and the venue taken from the
  event settings; the stat block's six-part contract is unchanged, and a statistic can still open a
  card. A `quote` block renders a quoted sentence and its attribution through the new pull quote
  device, whose sentence is Zine's handwritten callout in every style and whose frame each style
  remaps. Both blocks are in the admin palette with a hint under each field.
- Four more devices of the design vocabulary's second wave, each with a tier 3 contract every
  site style remaps and a figure in the specimen book: a timeline (an ordered list on the same
  spine the updates feed draws, dated by real dates), a ruled table (a real table with row rules,
  tabular figures, a horizontal scroll region at narrow widths, and a sortable head whose button
  sorts while the column carries `aria-sort`), a progress device (a
  native `<progress>` with "3 of 5 tasks done" stated beside it, never a ring), and a notice bar (a
  ruled band with a level as a word and a rule weight, `status` or `alert`, with a dismiss control
  remembered per browser).
- The rest of the second wave's devices: a dropzone (a ruled region around a real file input, with a
  stated progress line and a sent list with a state word per file), a repeater (rows a person adds
  and removes, each field labelled, focus following the change), an avatar (square on the brand
  radius, the initial in the heading face; the attendee photo now draws through it), a count and a
  figure sentence (figures in tabular numerals with their label, in place of a badge or a tile), a
  legend (one line at the head of a list), a session state marker (a word with an ink change and a
  rule; a finished session takes the back-issue ink), a standfirst, a byline and a dateline, and the
  long read opening (a drop cap, a standfirst, or plain, on the first paragraph of a Long read page).
  Each has a tier 3 contract, a rule set, a specimen, and a remap in the styles whose story differs.
- Five option groups on every site style, under Advanced: Long read opening, Quote device,
  Directory style, Section boundary and Table rules. A group remaps tokens the style already
  declares, and a choice may now move a component face too, which is how Zine's toner-block quote
  drops the script face. The updates feed's spine and the speaker shelf's rule read the new
  `timeline` and `directory` contracts, so the option reaches them.
- The tabs and the segmented control take an unavailable state. An unavailable tab or segment stays
  in its row with `aria-disabled`, so the arrow keys can land on it and a reader hears why; it opens
  nothing and is never chosen, and the tests prove it.
- A specimen book at `/specimen`: every device the system has, drawn in the site style and display
  mode the page is set to, with the component file and the tier 3 contract beside each one.
  Thirteen sections cover type, colour, rules and spacing, layout, headers, editorial devices,
  illustrations, sessions and schedule, directories, controls, inputs, feedback and print. The
  event content on the page — names, days, rooms, sessions, speakers — comes from the committed
  synthetic snapshot; the words inside the control examples are written for the book. The route
  ships in the demo build and in a development server and never in a client production build, it
  is `noindex`, and the sitemap builder refuses to list it. `scripts/dev/capture-specimen.mjs` writes one full-page capture per
  style, mode and width. The record is `docs/plans/2026-09-10-design-vocabulary-expansion.md` §7.
- The specimen book's layout section: the two page widths with the value each one resolves to in
  the style on screen, the margin column, and the composed first screen the home page opens on.
- Every shared control has an entry in the specimen book, and each one accounts for all ten
  interaction states — it draws the states it has and says which ones it does not have, and why.
  A state that is missing looks the same as a state somebody decided against, and only one of
  those is a defect.
- Event settings has a Social accounts panel. An operator adds, edits, and removes the event's own
  accounts there: A service name, an optional handle, and a link. The site footer lists them, and
  so does the footer of every built-in email: A link per service in the formatted copy, and one
  "Service: address" line per account in the plain-text copy. An event with no account gets no
  row and no blank line. The form and the server both refuse a link that is not an absolute
  `http://` or `https://` address, and each names the field; the event settings form no longer
  lets the browser's own check stop a save before the form can mark the field. `init-event` asks
  for the accounts as `service=link` pairs and asks again for a pair the schema would refuse. The
  shared event schema now validates the `legal` and `social` blocks and refuses an unknown field
  in either by name. The email footer drops a stored link that fails the same check, as the site
  footer already did (#231).
- The web manifest lists two raster app icons, 192 and 512 pixels square, so Chrome and Android can
  install the site. When the square icon slot holds an uploaded square PNG of 512 to 4096 pixels,
  the site publisher and the deploy build resample it to both sizes. Any other slot value ships
  neutral placeholder icons drawn from the default mark, and the job log names the reason. The
  placeholders are listed as `any maskable`; an uploaded icon is listed as `any`, because its safe
  zone is unknown. The manifest no longer lists the SVG mark or favicon. The deploy build reads the
  upload over its public download URL (`--storage-bucket`), so it needs no credentials. A PNG
  decoder and resampler in `scripts/lib/png.cjs` use only `node:zlib`, so no new dependency ships.
  The Branding page hint for the square icon states the rule: a square PNG from 512 to 4096 pixels
  on a side also becomes the app icon. An end-to-end test asks Chromium whether the default site is
  installable (#218).

### Fixed

- The speaker and session editors now return to their own list after a delete or **Cancel**, and
  a new speaker opens its own editor. They went to the admin index, which is now the Overview,
  because a relative link from an editor resolved against the admin layout, not the list.
- The second wave's devices, after an adversarial review of the branch. The ruled table's scroll
  region carries its own overflow, so a wide table scrolls inside it and the page never scrolls
  sideways; the head no longer claims to stick, because a head pinned inside a region that scrolls
  only sideways pins to nothing. A notice bar keys its dismissal to the notice it is showing now, so
  a new or urgent notice in the same slot shows after an earlier one was dismissed, and it hands
  focus to the main landmark rather than the body. One pull quote per page is enforced at render:
  the first quote block in reading order is the pull quote and any later one is set as a plain
  quotation, and every site style draws quotation marks (the large opening mark or an inline pair).
  An unavailable tab or segment holds the row's one tab stop while it has focus, takes a dashed rule
  a sighted reader sees, and shows its reason under the row while it has focus or the pointer. The
  dropzone says it is busy while files go, announces its progress and its sent list through one
  status region, draws the strong rule in the danger ink on a refusal, and invites the drop in one
  sentence with the control's own label beside it. The repeater keeps its add control at the cap,
  unavailable and named with the limit. Zine's urgent notice doubles the rule and Zine's and Atlas's
  dropzone widens it while a file is held over it, so neither state is colour alone. An update's
  dateline is formatted on the event's clock, not the reader's. The home page's seeded When fact
  reads the dates live from the event settings for as long as it is still the seed's.
- Upgrading a launched site to the fact block (#234) no longer states the venue twice or publishes a
  new placeholder onto the home page: a seeded replacement is withheld while the blocks it replaces
  survive as the client's (and those blocks are kept whole), and a placeholder is not created in a
  section the client has already written. Both are reported by init as kept.

### Changed

- The admin loads the Branding page and the block editor when someone opens them, not with the
  rest of the admin. Together with the tiers work, the wave 2 block forms had pushed the admin
  entry chunk past its 50,000-byte gzip ceiling; it is now about 35,000.
- The preset catalog is split by who needs it. `shared/presetCatalog` carries the palettes, the
  type maps and every option group's default and choice ids; `shared/presetRemaps` carries what a
  style moves (its own token remaps, what each choice moves, and the component defaults a style
  change resets), and only a path that resolves a style at runtime loads it: the web app fetches it
  as a lazy chunk when a live theme overlay, the demo style switcher, the admin or the specimen book
  asks, and a Node caller requires it once. The chunk every visitor downloads for first paint no
  longer carries the remaps of every style, and the resolver refuses to resolve a style's tokens or
  picks until the remaps are loaded rather than dropping a choice silently.
- Every control on the public site now answers the same ten interaction states: rest, hover, focus,
  press, selected, disabled, busy, error, success and empty. The hover, press and selected tints
  come from a new `state` family in the design tokens, so a site style retunes every control at
  once and dark mode carries its own share. A colour change no longer fades — a state a reader
  caused has to land at once — and the only things that animate are transform and opacity.
- Hover states are behind `@media (hover: hover)`. A touch screen reports a tap as a hover and
  holds it, so a tapped control on a phone used to stay lit as though it had been selected.
- The site has two motion moves and no third: an enter at 160ms and an exit at 120ms, both fading
  over at most 8px, both switched off entirely for a reader who asks for less motion. The admin
  takes neither: a state change there is instant.
- A toast now states its tone in a word and a rule weight rather than in colour, and a toast that
  only repeats a result the page already states no longer announces it a second time.
- A loading state holds the space the content will take, with a block of hairline rules. The page
  no longer jumps when the content lands. Nothing pulses and nothing spins.
- The public site is now built on two widths instead of one column. The stage is the frame — the
  header, the navigation, the schedule, the speaker shelf, the sponsor wall, the footer and every
  section heading run to it — and the measure is running text, which never exceeds it. At wide
  screen sizes a margin opens beside the measure for a label, a picture or a line of detail. The
  home page opens on the masthead, then the lead sentence at the measure, then one ruled row of
  three: the dates, the key facts and the clock, side by side and separated by hairlines. The
  speaker shelf runs three portraits across at large screen sizes and four at extra large, each
  portrait square. The sponsor wall runs about four marks across in its first tier and six in its
  third. Both widths are tokens a site style retunes.
- The public site no longer scrolls sideways on a phone. The title block's corner mark is drawn
  outside the block and the page gutter is now wide enough to hold it, which was the 4px every
  style scrolled by; and the event name in the header and the title block now takes the room that
  is left and breaks a word too long for it, which was another 8px on Field Guide. Measured on a
  built demo at 320px and at 390px: six styles across six routes, none of them scrolling sideways.
- Clearing a search or a filter keeps a keyboard reader where they were working. The clear control
  removes itself once there is nothing left to clear, and an element removed while it holds focus
  drops focus to the top of the document; the search field now takes focus on its input and the
  filter group on the first box in the group.
- A refused feedback submit now marks the field that refused, states the message under it, and
  moves focus there, instead of putting one sentence at the head of the form and leaving the reader
  on the submit control. The submit control stays enabled, as it does everywhere else.
- The admin's "Preview draft" link says that it opens a new tab, in the same words every other
  link on the site uses.
- The demo band's content lines up with the header, the page and the footer. It ran to its own
  width before, ending 60px inside the frame at either end.
- The demo band is now the showcase's own device: the style's name in the heading face, the line
  that describes it under the name, a hairline, and the four controls on one row at the shared
  control height. The `style` and `mode` values still round-trip through the query string.
- The admin CMS takes the editorial desk: a dark navigation rail against a cool-grey canvas, a
  white title band that holds the page's name and its save actions while the page scrolls, white
  panels, one action colour for every primary control and focus ring, a record's state as a
  word in a tinted badge, 2.75rem controls, and the admin's own six-step type scale. Source Sans 3
  and IBM Plex Mono stay the two faces. The client accent keeps one slot, the mark beside the page
  title, and its legibility floor is measured against the title band. Every admin token pair is
  measured in both modes. The record is `docs/plans/2026-09-10-admin-editorial-desk.md`.
- The landing page and the documentation site now use the product's own design language: the same
  token names the app ships, the editorial type scale, rules and folios instead of cards, and a
  complete dark palette that follows the reader's system setting. The page content, links, and
  social-card metadata are unchanged (design brief §5.3).
- Admin documentation now uses the words staff see rather than the names the code uses: site style,
  header, illustrations, page preview, and advanced color settings. The interface guidelines
  keep the internal names and mark them as internal.
- The product documentation is now two depths. `docs/ADMIN_GUIDE.md` is the operator path — a
  six-step visual setup, then every admin screen in the order the work happens — and the new
  `docs/design-reference.md` is the complete engine: all six site styles as first-class
  capabilities with a recommended configuration each, the four header treatments, the page
  templates and the axes under them, site-level navigation, the illustration sets, the three token
  tiers, the composition rules, print behaviour, the fixed admin identity, and the extension points.
- The Pages site's scale and palette are generated from `design/tokens/` into `docs/tokens.css`
  rather than hand-copied into `docs/styles.css`; `build-pages --check` fails on a stale copy.
- The Pages site has a mark again — a stem and the system's three rule weights — carried by the
  masthead, the favicon, and both regenerated social cards. Section boundaries now vary by weight
  instead of drawing one identical rule each, and the folio floor is caption size.
- Updated canonical repository and GitHub Pages paths to `CenterCoopMedia/eventrunner` (#97).
- Whether a page is public — visible, with its route's feature on — is one predicate in the shared
  package, read by the header navigation, the sitemap and robots builders, and the server-rendered
  route metadata. The contract is the strict `visible === true` the sitemap and the server already
  applied; the navigation now reads the field the same way. No generated output changed.
- The admin guide now covers the Places, Movements, and Venue map panels in event settings: What a
  place is, how a session names one, how a one-way movement is entered and where the site shows
  it, how the map lists and marks places, and every rule the save checks. It also covers the new
  Social accounts panel (#226).
- The profile and speaker photo fields, and the shared avatar and missing-asset components, now
  read the same tier 2 role tokens (`--color-*`, `--rule-*`) every other public component reads,
  instead of the retired brand-* utility names. Rendered colour is pixel-identical in every site
  style and mode (#247).

### Fixed

- Shared schedules no longer survive account deletion or regain public visibility after a
  concurrent privacy change. Owners can revoke sharing after losing attendee access (#172).
- Custom badges now have profile, directory, and moderation controls. Disabling the feature
  removes badges from public projections without blocking other profile edits (#176).
- Private notes save in order and flush pending edits when the attendee leaves the field or page
  (#170). Desktop popularity sorting preserves rank, stale filters clear, and plain-text export
  omits an unknown end time (#164, #166).
- Optional calendar sync uses a dedicated-calendar grant, reuses its calendar after a reload,
  reads all event pages, and retries incomplete writes. It remains off pending client setup and
  verification (#177).
- Pull requests now have a connector completion check for the current commit and unresolved
  review threads. The main branch requires this check and CI, including for administrators.
- In event settings, a new place's id kept only the first letter of the name typed into it, and a
  change to a place, movement, or map marker field moved keyboard focus out of the row. The id now
  follows the whole name until you type in the id field, and focus stays in the field. Until the
  save, a movement or map marker that already picked a new place follows its id when it changes.

- Pressing Save in an admin editor with an invalid field did nothing and said nothing, because the
  control was disabled. Save now stays enabled until the request starts, sends nothing while a
  field is wrong, and moves the operator to the first field that refused.
- The feedback form was an overlay, so Tab walked out of it and into the page behind. It is now a
  real dialog: focus stays inside it, the page behind is inert, Escape closes it, and focus goes
  back to the control that opened it.
- A link that opens a new tab now says so, so a reader using a screen reader is not moved to a tab
  with no history and no way back. Every outbound link carries it, the sponsor wall included —
  the wall is the one place on the site where outbound links run one after another, which is
  where a silent change of context costs a reader the most.
- The profile page's visibility choices and badge picks were painted by the operating system, so a
  client's palette and dark mode both stopped at their edge. They are drawn from the design tokens
  now, and the control under the paint is unchanged.

- A site restyled after deployment printed the palette it shipped with, not the one on screen —
  and only from a dark screen, because the generated print block outranked the runtime one. The
  runtime theme element now emits its own print block from the live resolved light palette at the
  same specificity, and the generated block stays as the no-JavaScript fallback.
- A heading containing a long identifier scrolled a whole documentation page sideways at 320px.

### Added

- Eight shared controls the site had no answer for: a switch, a segmented control, tabs, a drawn
  checkbox and radio, a search field with a spoken result count, a sort control, and a filter group
  with an active count and one clear control. Each holds one place in the tab order and moves
  inside itself with the arrow keys.
- A motion contract test. It reads the stylesheet and every class string the app ships and fails
  the build on a transition over every property, a spinner, a pulse, a looping animation, a raw
  duration, a hover rule outside the hover query, a shadow, a blurred panel, or a shading gradient.

- `config/theme.adminScheme` and the **Admin colours** control on Settings → Branding. The admin's
  rail, buttons, links and focus ring follow the main brand colour by default, worked into a
  contrast-safe family for both modes, or take one of six house schemes: navy, graphite, forest,
  oxblood, teal or plum. The public site never uses it.
- Public repository under the Center for Cooperative Media, Apache-2.0.
- Shared workspace package: deploy-env validation, event config schema, lifecycle clock, event-timezone time helpers, registration state machine, badge validation, slug and URL-safety utilities.
- Day-one legal and community files: LICENSE, NOTICE, SECURITY.md, CODE_OF_CONDUCT.md, CONTRIBUTING.md, issue and pull request templates.
- Credential-free CI for the shared-package test suite.
- Product site on GitHub Pages.
- Three-workspace layout: `apps/web` and `functions` join `packages/shared` as npm workspaces (spec §1.1–1.2).
- ESLint flat config with the hex-literal ban and its three-path allowlist (spec §7.6) plus `react-hooks/rules-of-hooks`.
- Firestore and Storage security-rules tests running on the Firebase emulators, and CI lint + rules jobs — still credential-free and fork-runnable (spec §8.1).
- CMS content endpoints under the two-revision publish model: draft-only create/update/delete, version history reads, and the chunked resumable publish pipeline over the six publishable collections and their `_drafts` siblings (spec §8.4, #12).
- Pages-as-data and live-updates admin endpoints: `cmsSavePage`/`cmsDeletePage` against the block-type registry, `cmsSaveUpdate`/`cmsDeleteUpdate`, all writing drafts only (spec §5.2, #13).
- Validated `config/*` writers — `updateEventConfig`, `updateFeatures`, `updateTheme`, `updateBadges` — gated by the server-only admin list, rejecting deploy-mirrored read-only fields, with audit rows on every write (spec §1.3, #14).
- `apps/web` foundation: Vite 5 + React 18 + Tailwind 3 attendee site with a committed synthetic snapshot (`src/generated/`) for zero-network first paint, an `EventConfigProvider` → `AuthProvider` → `ContentProvider` → `ToastProvider` provider chain overlaying live `config/*` and published CMS collections (`?preview=1` for drafts, gated by `firestore.rules`), and the runtime theming chain — `theme.css` RGB-triple custom properties overridden live by a `<style id="event-theme-runtime">` tag from `config/theme` (spec §2.4, §7.2–7.5, #11, #12, #13, #16).
- Pages, Schedule, Speakers, and Sponsors surfaces, plus a block-type renderer registry covering all eight CMS block types, config-driven event-timezone schedule times, sanitized rich text/URLs, and a Google-popup + emailed-code sign-in page.
- Attendee accounts and profiles: server-owned `users/{uid}` documents seeded at sign-in (`registrationStatus` from the four-value §3.4 vocabulary, `speakerId` replacing `isSpeaker`/`sessionIds`), a `users_public` projection trigger that publishes only public-safe fields and rewrites badges to the intersection with `config/badges`, and a self-update rule that denies every server-owned field (spec §3.4, §4.1, §4.5, #17).
- Directory privacy enforced in `firestore.rules`, not the UI: `attendees_only` profiles are readable only by a requester whose own account shows approved, speaker, or admin — previously any authenticated pending account could enumerate the directory — with emulator tests pinning each branch.
- Attendee-facing profile surfaces: first-sign-in profile setup, profile editing, the attendee directory, individual profile pages, and a profile sidebar, all behind `config/features.attendeeDirectory` / `publicAttendeeProfiles`.
- One canonical `speakers/{speakerId}` store replacing the name-joined tri-sync: admin `createSpeaker`/`updateSpeaker`/`deleteSpeaker` endpoints, a one-way `speakers_public` projection trigger, and referential integrity enforced at the three write seams — session saves reject a `speakerIds` entry naming a missing speaker, `deleteSpeaker` unlinks every session, draft, and account link in one transaction (refusing above the transaction limit and naming the `status: 'removed'` soft delete as the fallback), and the `users.speakerId` ↔ `speakers.uid` pair is set or cleared in a single commit. No reverse trigger, no `sessionInfo` map, no periodic reconciliation (spec §4.3, #20).
- Admin speakers list and create/edit/delete form; the public speaker directory and the generated content snapshot now render the `speakers_public` projection, so speaker email addresses and invite tokens cannot reach the browser bundle.
- Three self-hosted open-license (SIL OFL 1.1) font sets under `apps/web/public/fonts/` and neutral placeholder branding assets under `apps/web/public/branding/` — no font CDN or product-identity leakage at runtime.
- Media library and the hardened Storage rules (spec §8.5, §9, #24): `profile-photos/{uid}/**` is the only client-writable namespace — owner-bound, image-only, under 2 MiB — while `cms-images/`, `branding/`, and `speaker-photos/` accept writes only from admin-verified server endpoints, `session-materials/` stays closed on both verbs, and everything else is denied. `mediaUpload`, `mediaDelete`, `mediaUpdateMetadata`, and `scanMediaUsage` index every upload in `media_assets` and report which content documents reference an asset, so a delete warns instead of blanking a live page.
- Admin Media tab: a browsable library per namespace with upload, alt-text editing, and delete-with-usage-warning, plus a reusable `ImagePicker` that now backs the Branding tab's five logo slots (closing its upload TODO) and an owner-bound photo field on the attendee profile.
- `scripts/dev/login-smoke.mjs`: a Playwright-driven, credential-free live smoke test for the emailed-code sign-in flow against the Firebase emulators.
- `functions` emulator wired into `firebase.json` alongside `firestore`/`auth`/`storage` for the local dev loop.
- Ticketing provider core (spec §3.3–§3.4, #29): a provider registry dispatching on `EVENT_TICKETING_PROVIDER` with contract-checking of whatever adapter it constructs, a `none` provider, atomic webhook-dedup-and-enqueue (`ticketingWebhook` commits the delivery claim and the `ticket_sync_queue` row in one transaction) and a `processTicketSyncQueue` drain with a six-attempt bound and an operator alert on exhaustion, `ticketingVerifyOrder`/`createUserFromTicket` claim paths ending in a single-document transaction on `tickets/{externalId}`, deny-all `firestore.rules` on all three ticketing collections, and `recomputeEntitlement` — the first caller of the shared registration state machine's `isValidTransition`/`computeEntitlement` — wired as an `onTicketWritten` trigger so a refund or a new claim re-evaluates a user's whole claimed-ticket set (#32).
- Eventbrite ticketing adapter (`functions/src/ticketing/providers/eventbrite.cjs`, spec §3.3, §3.5, #30): HMAC-SHA256 webhook signature verification, `fetchOrder`/`listTickets`/`lookupByOrderNumber`, an idempotent `registerWebhook`, and `getRegistrationPrompt`; covered by a webhook→claim→entitlement end-to-end test running the real adapter against synthetic fixtures for the placed/refunded/wrong-event/unsigned cases.
- Manual/CSV ticketing adapter (`functions/src/ticketing/providers/manual.cjs`, spec §3.3, §3.5, #31) reading `tickets/{externalId}` directly, with `ticketingImportCsv` (admin-gated, dependency-free RFC 4180 parser, flexible column mapping, shared validate → normalize → dedupe → classify pipeline behind a dry-run preview) and `ticketingListTickets` admin endpoints, and an `/admin/ticketing` tab exposing provider status, the CSV import flow, and an exact-match ticket search.
- Admin registration approval (#32): `approveUser`/`revokeUser` endpoints for the two §3.4 edges no ticket can produce — admin approval pins `approvalSource: 'admin'` so it survives a later ticket refund, and revocation clears it — each checked against the shared transition table, audit-logged, and backed by an Attendees tab with per-row Approve/Revoke; `firestore.rules` pins `registrationStatus` and `approvalSource` as server-owned, denying even the account owner's own write.
- `scripts/register-ticketing-webhook.cjs` (#30): an operator command wrapping `TicketingProvider.registerWebhook()`, capability-gated so a provider without one (manual, none) exits 0 with an explanation instead of failing a checklist item; the admin ticketing-status card surfaces the resulting webhook registration state.
- Registration-prompt email flow (#33): `ticket.get_ticket`/`ticket.claim_prompt` templates (spec §6.2) driven by `TicketingProvider.getRegistrationPrompt()`'s cta_label/cta_url/provider_note, `sendRegistrationPrompt` sending them via an `onUserRegistrationPromptCreated` trigger on new-account creation across the eventbrite/manual/none matrix, and a self-service `/ticket/claim` page whose `ticketingVerifyOrder` call collapses every failure (unknown order, wrong event, address mismatch, already claimed) to the same generic 404. `init-event.cjs` seeds `email_templates` overrides for both client-visible templates (spec §5.1 step f).
- On-demand static-snapshot refresh after a CMS publish (spec §8.4 phase 5, §10 Q7, #36): a `site-publisher` Cloud Run job in the client's own project — `generate-content.cjs` → vite build → `firebase deploy --only hosting`, under the job's own service account with no GitHub coupling and no cross-project credential — provisioned by a `publisher` job in `deploy-client.yml` (per-client Artifact Registry, create-or-update of the job, and `run.invoker` on that one job for the functions runtime identity). `cmsPublish` invokes it fail-soft after the revision copy commits and tracks the outcome on the same `cmsPublishQueue` row; a `cleanupStrandedPublishRows` sweep times out rows neither party reported on. Off unless a client sets `EVENT_SITE_PUBLISHER_ENABLED`; setup, verification, rollback interaction, and cost are `docs/DEPLOY_RUNBOOK.md` §9.
- `docs/CLIENT_ONBOARDING.md`: the operator's start-to-finish checklist for standing up one client event, cross-linking `docs/DEPLOY_RUNBOOK.md` rather than repeating it (spec §5.6, #34).
- `docs/ADMIN_GUIDE.md`: staff-facing task reference for every admin surface, cross-linking the wiki handbook's narrative version (#34).
- `docs/DEPLOY_RUNBOOK.md`: a rollback section — hosting, functions, rules/indexes, content-snapshot implications, and when not to roll back (#34).
- Custom-domain naming in the operator-facing readiness output: `init-event.cjs`'s printed §5.6 Auth checklist and `scripts/lib/checklist.cjs` now name the client's custom domain when `EVENT_PUBLIC_URL` is configured, and `docs/DEPLOY_RUNBOOK.md` gets a short custom-domain/readiness note pointing at the fuller flow issue (#66 sliver).
- DCO enforcement: `CONTRIBUTING.md` documents `git commit -s` and what the sign-off attests; a credential-free `dco` CI job (`scripts/check-dco.cjs`) fails a pull request carrying an unsigned commit, fork PRs included (spec §1.5, #37).
- `RELEASING.md`: version scheme, CHANGELOG hygiene, and the tag-cutting process for this Keep a Changelog project (#37).
- Credential-free secret scanning: a `secrets` CI job runs the gitleaks CLI (checksum-verified download, no marketplace action, no license secret) over the pull request range and, on push to `main`, the full history; `.gitleaks.toml` allowlists two known-synthetic test fixture values by exact string match (#39 sliver).
- Playwright end-to-end suite on the Firebase emulators (#38): four critical journeys — OTP sign-in, CMS publish/isolation, the speaker invite pipeline, and ticket-claim-to-bookmark — seeded once per run via the same `init-event.cjs`/`seed-demo-event.cjs` operator scripts a real deployment uses, driven through `scripts/dev/run-e2e.sh` (`firebase emulators:exec` wrapping `vite`) and a new `e2e` CI job that clones the rules job's emulator/Java setup. OTP and invite-token capture reads a dedicated `E2E_MAIL_FILE` sink the console email provider appends to, replacing an unreliable scrape of colorized emulator stdout.
- `docs/POSTMARK_PROVISIONING.md`: an end-to-end Postmark account/server/stream provisioning runbook plus the missing `EMAIL_ACCOUNT_API_KEY` secret documentation in `.env.example` and the ADR/deploy-runbook secret tables (#4).
- M7, public site completeness (CJS parity plan): a visitor can now reach and read every page the
  seed creates, and the site presents itself correctly to search engines and link unfurlers.
  - The header navigation is built from the page documents, ordered by each page's `order`, with
    system pages still gated on their own feature flags (#147).
  - One account control ends the navigation on every page: sign in when signed out, your profile
    when signed in (#148).
  - The footer lists the same pages under the same rules, and names the operator, the support
    address, and any social accounts the event configuration records (#149).
  - Every public route is served with its own title, description, canonical URL, Open Graph tags,
    and Event structured data, injected server-side so a crawler that never runs the app still
    reads them (#150).
  - A publish writes `sitemap.xml`, `robots.txt`, and a web manifest, listing only routes a
    stranger can actually reach and disallowing the rest (#151).
  - Navigation resets the scroll position to the top, and a back-to-top control appears after a
    scroll threshold. Both respect reduced motion (#152).
  - The home lead follows the event's lifecycle phase: it counts down before the event, says the
    event is running during it, and states that it has finished afterwards (#153).
  - A registration action is configuration, not content: set a destination and a label in
    `config/event.registration` and the control appears on the home lead and in the header. Leave
    it unset and nothing is rendered — never a dead button (#154).
  - The home page seeds a card group for the event's own facts, built from the existing `stat` and
    `list_item` blocks rather than a new block type (#155).
  - The home page seeds a sponsor strip drawing the same tiered logo wall the sponsors page does,
    and rendering nothing when there are no published organizations (#156).
  - The seed ships a recap page and a speaker guidelines page, both empty sections and placeholder
    descriptions, with no event-specific copy (#157).
  - The seed ships a city guide page for places to eat, things to see, and getting around — empty
    lists, and no copy about any city (#158).
  - An operator can upload a venue map through the media library and attach it to the travel page;
    the rooms it shows are listed as text beside it, so a reader with images off learns every room
    name (#159).
  - A long content page shows a keyword filter and a same-page section index once it has at least
    three populated sections, or two sections carrying eight or more blocks between them. The
    filter narrows the page to matching blocks and says so plainly when nothing matches; the index
    marks the section in view and moves focus to a chosen section. Generic to any long content
    page, not specific to FAQ (#160).
  - A session can carry an optional recording URL, validated as a safe link and shown on the
    session row and the session detail page as a plain labelled link (#161).
- Seeded page labels are short — Home, Travel, FAQ, Conduct, Privacy, Terms, Recap, Guidelines —
  so fifteen of them fit the header navigation and the footer page list. A page may now state a
  `title` beside its `label`, which is what heads the page, titles the browser tab, and titles a
  shared link; the four whose short label reads oddly as a heading state one.

### Fixed

- Firebase deployment validation no longer requires `VITE_FIREBASE_MEASUREMENT_ID` when Google Analytics is disabled (#101).
- The admin sessions list showed a day's raw document id ("day-2") as its heading whenever the day
  had no label, or whenever a session pointed at a day no longer in the event's configured list. A
  heading now falls back to the day's own date, then to its position ("Day 2") when it has no date,
  and to a plain "Not on a configured day" line when the day itself is missing — never to the id
  (#248).
- The venue editor's payload helper sent a blank walking-minutes field as `0`, a real distance an
  operator can mean, instead of failing to save. It now sends `null` (#227).

The feature set itself is specified in [docs/adr/0001-event-platform-v1.md](docs/adr/0001-event-platform-v1.md). Ticketing (Eventbrite and manual/CSV adapters, registration approval, and the end-to-end test suite) has landed; release packaging and operator-documentation work is in progress.
