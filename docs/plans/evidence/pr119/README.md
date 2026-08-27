# PR #119 — review evidence

Screenshots taken from real builds of this branch, not mockups. Two paths
through the product are photographed side by side, because the calibration
asks the system to serve both: an operator who only ever picks a named
template, and one who opens the axes underneath and sets them by hand.

## How these were made

Three sources, and it matters which is which:

| Source | Files | What it is |
|---|---|---|
| **Emulator + real admin session** | `01`, `02`, `20` | `firebase emulators:exec` with the seeded project, signed in as the bootstrapped admin through the real OTP flow. The page editor as an operator meets it. |
| **Production build, dense fixture** | `03`–`17` | A production `vite build` of this branch against an enlarged copy of the committed demo fixture: four tracks, thirteen day-two sessions, nine speakers, ten sponsors across three tiers, seven updates, and a surveyed venue with five places and eight one-way movements. Big enough to judge the compositions under load. |
| **The shipped demo bundle** | `18`, `19` | `docs/demo` exactly as committed, for the empty states a fresh deployment actually meets. |

Everything on screen is fictional. The dense fixture lives outside the repo:
it exists to put enough on screen to judge, and nothing in it ships. Two
consequences worth naming so nothing here reads as better than it is — every
speaker and every sponsor carries the same placeholder mark, because the demo
has one, so the portrait shelf and the logo wall are photographed with nine
copies of one image; and the attendee fixture marks its fictional names with a
trailing `(demo)` rather than the usual leading `[Demo]`, because a leading
bracket files every name in the index under `#`, which is correct behaviour and
a useless screenshot.

## Two frames are older than the branch

`04-schedule-list-390.png` and `10-updates-feed-1440.png` were taken before the
time and the date moved BELOW the title they label. Both showed the caption
stacked above the heading, which is an eyebrow and banned at every size (design
brief §2.4); the shipped order is the title first, then the date. Everything
else in both frames — the spine, the heads, the runs, the column order — is
what ships. They are kept rather than reshot because the dense fixture behind
them lives outside the repo and a half-rebuilt set would be harder to trust
than a named exception.

## The two paths

| File | What it shows |
|---|---|
| `01-staff-path-template-only.png` | **The staff path.** One control: *Template*, set to "Long read", with the template's own words under it. Nothing else touched. The axes are behind one closed button. |
| `02-expert-path-axes-in-advanced.png` | **The expert path.** The same panel with Advanced open: Header, Arrangement, Density and *Navigation on this page*, all four settable, Template correctly reading "Custom" because the page no longer matches one. Nothing was removed to make the templates possible. |
| `12-expert-axes-rendered-1440.png` | What the expert path renders: full masthead, tight density, grid arrangement, and the page-level navigation exception — a rail down the leading edge on this page alone, while the site is set to a top row. |
| `11-long-read-1440.png` | What the staff path renders: a page that states only "Long read", holding the prose measure at 1440. |
| `20-admin-pages-list.png` | Where both paths start. |

## The schedule, on both axes

| File | What it shows |
|---|---|
| `03-schedule-grid-dense-1440.png` | Four concurrent lines, thirteen sessions, a plenary spanning every line. Time down the left in the data face, lines across the head in the operator's order. |
| `16-schedule-768.png` | The same day at 768. |
| `04-schedule-list-390.png` | The same day at 390: the time-ordered list, which is the accessible baseline and not a lesser view. |
| `15-schedule-reduced-motion-1440.png` | The signature interaction under `prefers-reduced-motion: reduce`. Line B's column has come forward — the tint lands — and nothing moved. |
| `17-schedule-dark-1200.png` | The same page in dark mode. |
| `14-print-from-dark-1200.png` | **Print, from a dark screen.** The print edition is its own view and it is light: the handout a desk gives out does not inherit the reader's dark theme. Calling points print as calling points. |

## The movement model

| File | What it shows |
|---|---|
| `05-transfer-from-recorded-movement.png` | **The transfer, rendered only from recorded data.** A closing plenary in the Main hall with one calling point in Room A. The line states both ends, the destination's floor, the walk in whole minutes, and the step-free route in the operator's own words — every value read from `config/event.venue.movements`, none of it computed. |

Note what is *not* in `03`: the fixture records the walk between the rooms in
two consecutive grid rows, and the grid still says nothing about it. A recorded
movement says what a move costs, never that this reader is making it.

## The four directories

Each is a different composition on the same tokens.

| File | What it shows |
|---|---|
| `06-speakers-portrait-shelf-1440.png` | **Speakers — a shelf of portraits.** The face leads, at a size a face survives. Nothing is boxed: the frame holds the picture, and the name and credit sit on the open page under a hairline. |
| `07-speakers-shelf-768.png` | The shelf at 768. |
| `08-attendee-index-1440.png` | **Attendees — an index.** One compact line per person under letter heads with counts, because a reader here is searching for a name they already know. `3Sixty Media Collective` files under `#`, not under `A`. |
| `13-attendee-index-320.png` | The index at 320. The page does not scroll sideways. |
| `09-sponsors-logo-wall-1440.png` | **Sponsors — a tiered logo wall.** Three tiers, three mark sizes, standing taken from the operator's own ordering and never from ranking the words they typed. |
| `10-updates-feed-1440.png` | **Updates — a feed with a spine.** "Pinned" first, because pinned is not a date, then one head per month. A hairline runs down the leading edge and each entry hangs a tick off it. |

## Empty states

| File | What it shows |
|---|---|
| `18-empty-updates-off.png` | Updates with the feature off: a designed state that says what the page would be and where to go instead. |
| `19-empty-attendees-signed-out.png` | The attendee directory to a signed-out visitor at an event with no public profiles: a way in, not an empty list that reads as "nobody came". |
