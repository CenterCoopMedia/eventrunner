# Design vocabulary expansion — direction and waves

Date: 2026-09-10. Owner request: make the template read as the work of a top-tier design studio, first by expanding the variety of interactive elements, components, motion, styles, and assets, then by iterative improvement. This record sets the direction, the grammar, the device families, the waves, and the gates. It sits under the binding brief, `2026-08-27-design-system-overhaul.md`, and changes none of its rules. Where this record and the brief disagree, the brief wins.

## 1. The bar

The site and the admin must read as designed, not assembled. A reviewer who can mistake a page for a template has found a defect. The test is the brief's own: typographic hierarchy does the work, rules replace borders, colour decorates very little, shadow decorates nothing, and every device has one job.

Variety in this system comes from multiplication, not accumulation. A device is a tier 3 contract that every site style remaps to its own story. One new device therefore produces six looks, twelve with both modes, and more with each option group. A device that renders the same in every style has been added to the codebase, not to the system.

The inventory that grounds this record was taken on 2026-09-10 from the merged main branch:

| Measure | Now |
|---|---|
| Tier 3 contracts | 15, of which `callout` has no call site |
| Option groups per style | 3, plus a fourth on Zine and Field Guide |
| Interaction states with a defined style on public controls | rest, hover, focus-visible; no toggle, no tabs, no busy state, no success state |
| Hover rules inside `@media (hover: hover)` | 0 |
| Motion tokens in use | 4 of 5; `--motion-slow` unused; no keyframes |
| Illustration sets | 3 drawn, plus `none` |
| Component gallery | none |

## 2. The grammar

Two grammars come first, because every later device reads them.

### 2.1 Interaction states

Every control and every interactive row defines these states, in both modes, on both surfaces. A state is a word, an ink change, a weight change, or a rule change. A state is never colour alone and never a pill.

| State | Public site | Admin |
|---|---|---|
| Rest | The style's own ink and ground | The desk's ink and ground |
| Hover | An ink-mixed tint of the ground at a fixed share, inside `@media (hover: hover)` | The same device, with the desk's tints |
| Focus-visible | The 3px ring in the accent, outside the element, never removed | The 3px action ring; the light ring on the rail |
| Active (pressed) | Scale 0.98 over 200ms ease-out; static under reduced motion | The pressed action ground; no scale |
| Selected or current | Weight plus a rule or a filled ground plus `aria-pressed`, `aria-current`, or `aria-selected` | The rail's four signals; a filled row marker elsewhere |
| Disabled | Native `disabled` on a control that must not act, with the disabled ink; `aria-disabled="true"` only on a control that must stay focusable to explain itself, and then its handler suppresses every activation path and a test proves it. A submit control is never disabled before the request starts. Never a removed control | The same |
| Busy | `aria-busy="true"` and a stated word beside or inside the control ("Saving…"); never a spinner, never a shimmer | The same, and the result stays in place after |
| Error | `aria-invalid="true"`, the alarm rule, a message under the field named by `aria-describedby`, focus moved to the first error on submit | The same |
| Success | A stated line in place that stays, in a `role="status"` region so it is announced; a toast may repeat it visually, and then the toast carries no live role, so one result is announced once | The same |
| Empty | A sentence that names what was searched or filtered, plus one action | The desk's empty state |

New controls, all shared, all keyboard first: a switch (`role="switch"` with `aria-checked` tracking its value), a segmented control (a radio group set as one row of words with the selected word on the filled ground), tabs (the ARIA tab pattern with a roving tab index and arrow keys; the selected tab carries the strong rule), a styled checkbox and radio on the token system, a search field with a clear control and a result count in a `role="status"` line, a sort control, and a filter group with an active count and one clear control.

Dialogs trap focus, mark the page behind them `inert`, return focus to the opener, and scrim with tinted ink and no blur. A link that opens a new tab carries a shared marker with hidden text.

### 2.2 Motion

The brief allows two classes. This record assigns each class its tokens and its choreography.

| Move | Duration token | Easing | Properties | Where |
|---|---|---|---|---|
| Enter (menu, disclosure, toast, dialog) | `--motion-base` (160ms) | `--motion-ease` (ease-out) | opacity, transform ≤ 8px | public only |
| Exit | `--motion-fast` (120ms) | `--motion-ease` (ease-out) | opacity, transform | public only |
| Press | `--motion-slow` (200ms) | `--motion-ease` (ease-out) | transform (scale 0.98) | public only |
| Filter or sort resolve | `--motion-base` | ease-out | opacity of the list; the count updates in place | public only |
| Signature | `--motion-signature` (560ms) | ease-out | transform, opacity | public only, one per style |
| Mode swap | none | none | transitions disabled for the swap | both |
| Navigation, route change, focus move | none | none | instant | both |

Bind these:

- Every animated rule sits inside `@media (prefers-reduced-motion: no-preference)`. The reduced state is static and complete: the element is already in its end state.
- Enter and exit are asymmetric in duration only: exit is faster than enter, and both use the one ease-out curve the brief names. No second easing token ships.
- The admin has no enter, exit, or press motion. Its state changes are instant, as the admin story binds; the one existing resolve of the proof tint stays as the desk record documents it. A shared device such as the toast renders without motion inside the admin.
- Nothing moves more than 8px on enter. Nothing scales beyond 0.98 to 1.
- Nothing loops. Nothing starts from scroll position. Nothing counts up.
- `@starting-style` and `transition-behavior: allow-discrete` may be used for dialogs and toasts as an enhancement. Their absence must leave the element in its end state.
- A test reads `apps/web/src/index.css` and every class string and rejects: `transition: all`, a duration outside the token set, an animated property outside `transform` and `opacity`, a hover rule outside the hover query, and any `animate-pulse`, `animate-spin`, or infinite keyframe. The interface guidelines' icon cross-fade line, which names a blur, is corrected in the same wave to opacity and scale only.

The public site's one signature is the schedule column coming forward, in every style; Atlas draws it as the traced line. Zine's stamp peek stays functional motion at the timing the brief fixes and never takes the signature token. The admin owns none.

## 3. The device families

Each device below lands as one tier 3 contract in `design/tokens/components.json`, one component or block, one rule set in `index.css`, a remap in every style whose story differs, a test that renders it in every style and both modes, an entry in the specimen book, and a line in `docs/design-reference.md`. A device with no remap in any style must say in its contract note why it is the same everywhere.

### 3.1 Text devices

| Device | One job | Rule |
|---|---|---|
| Standfirst | The one sentence under a heading that says what the page or session is | Sits below the heading, never above it. Set at `--text-lead`. Each style names its face and its rule. |
| Pull quote | A quoted sentence from a speaker or a session, with its attribution | One per page at most. Attribution below the quote in the data face. Zine draws it through the callout device, which gives `Callout.jsx` its call site. |
| Byline and dateline | Who, in what role, and when | Data face. A dateline carries the event's clock, never the reader's. |
| Drop cap | The opening of a long read | One per page. An option on the Long read template: drop cap, standfirst, or plain. Broadsheet and Field Guide default to the cap; Zine and Atlas default to plain. |
| Definition list | Term and description pairs: venue, dates, format, room | A real `<dl>`, ruled between pairs. This is the answer to a non-numeric fact (#234): a fact is a term and a description, never a stat block. |
| Timeline | Dated entries in order: past editions, key dates, milestones | An ordered list with a spine, the same spine the updates feed draws. Numbers are years and dates, never sequence ornaments. |
| Ruled table | Rows and columns a reader compares | A real `<table>` with row rules, tabular figures, sticky head, and a horizontal scroll region at narrow widths. A sortable head holds a `<button>` that sorts, and the `<th>` carries `aria-sort`. |

### 3.2 Feedback and state devices

| Device | One job | Rule |
|---|---|---|
| Count | A labelled figure beside the thing it counts: "12 saved" | Data face, tabular figures. Never a bubble. The label is always present. |
| Legend | Names what a marker or a count means on a page | One line at the head of the list, in the data face. |
| Session state marker | "Now", "Next", "Finished" on a session row during the event | A word in the data face with an ink change and a rule. Finished sessions take the back-issue ink. |
| Progress | How much of a set of tasks is done: "3 of 5 done" | A native `<progress>` with a stated fraction beside it. `<meter>` is not used: it measures a quantity in a range, not completion. Never a ring. |
| Notice bar | A site-wide message with a level | A ruled band under the header. `role="status"` for information, `role="alert"` for urgent. A dismiss control, remembered per browser. |
| Toast | Repeats a result the page already states | The tone is a rule and a word. Enter and exit per the grammar. |
| Loading | Says what is loading, and holds the space | A stated line and a reserved block of hairline rows, both static. |
| Empty | Says what is missing and what to do | One sentence that names the filter or query, one action, and the style's empty-state motif where the style has one. |

### 3.3 Input devices

| Device | One job | Rule |
|---|---|---|
| Search field | Narrow a list by words | Clear control, result count in a `role="status"` line, the query kept in the URL. |
| Filter group | Narrow a list by a facet | Checkboxes or a segmented control, an active count, one clear control, the state kept in the URL. |
| Sort control | Order a list | A select or a segmented control; the choice kept in the URL. |
| Switch | A setting that is on or off | `role="switch"`, the word beside it, 44px on touch. |
| Segmented control | One choice from a short set | A radio group in a ruled row; the selected word on the filled ground. |
| Tabs | One panel from a short set | The ARIA tab pattern. The selected tab carries the strong rule. Never pills. |
| Dropzone | Send a file | A ruled region around a real file input, a stated progress line with a `<progress>` element, a sent list with a state word. |
| Avatar | A person's picture, or their initials where there is none | Square on the brand radius. Initials in the heading face on the alternate ground. Never a circle. |
| Repeater | A short list of rows a person adds and removes | Add and remove controls with a keyboard path; each row's fields labelled. |

### 3.4 Admin devices

The admin keeps its refusals. Its new devices are the ruled table with sort, filter, and a bulk-action row; the queue row with a state word and one action; the figure sentence ("412 registered, 38 in the last day, read at 09:14") in place of a tile; the log row with a preview frame; the version list with a what-changed entry; the pending-changes banner; the access matrix; the invoice form and list; and the rich text toolbar limited to the allowed tags. Every one is words, rules, and the desk's tints.

## 4. Option groups

Each style gains groups where its story has room. A group is a data change in the preset file; it remaps declared tokens only.

| Group | Choices | Styles |
|---|---|---|
| Long read opening | drop cap, standfirst, plain | all six |
| Quote device | the style's own two or three | all six |
| Directory style | the style's own two | all six |
| Section boundary | rule and folio, rule only, folio in the margin | all six where the story allows |
| Table rules | hairline, ruled head, full grid | all six |

## 5. Illustration sets

Four new sets, drawn as original monochrome SVG that reads `currentColor`, four slots each, guarded by the asset test, which is extended to every set.

| Set | Contents | Suits |
|---|---|---|
| `typographic` | fleurons, printers' flowers, a manicule, an ornament rule | Broadsheet, Playbill, Newsroom when enabled |
| `registration` | crop and registration marks, a colour bar, halftone dots | Zine |
| `celestial` | stars, moon phases, an orbit, a comet | evening and festival events on any style |
| `architectural` | a plan symbol, a column, an arch, a stair | Civic, Gallery |

## 6. New site styles

Three styles. There is no tier: the catalog withdrew stability tiers on 2026-08-27 (`packages/shared/src/theme.cjs`), every style in it is first-class, and picker order is the only ranking. A new style is built to completion on its branch and joins the catalog only when every gate passes; until then it is not registered. The design reference still describes a "being proved" tier and is corrected with the first new style. Each style lands with two authored palettes, a type pairing that passes the four font tests, its own devices, three heading faces, three header styles, two or three schedule styles, a visual story page, contrast measurements in both modes, and demo evidence.

| Style | What an event is for | Devices |
|---|---|---|
| Gallery | An exhibition, a design conference, a museum programme | The wall label; wide measures; one sans at two weights; the schedule as a floor plan list |
| Playbill | A festival, a performing-arts programme, an awards evening | The cast list; the running order; the ornament rule; a display serif |
| Listings | A media event, a broadcast conference, a public-media convening | The listings grid with channels as lines; the lower-third device for the running marker |

Font candidates come from the research brief on editorial devices and fonts. A face joins the bundle only after its licence and its Latin subset size are recorded in `apps/web/public/fonts/README.md`.

## 7. The specimen book

A route that renders every device in every state, switched by the demo's style and mode controls, so a reviewer sees the whole vocabulary on one page. It ships in the demo build and in development, never in a client production build. It is `noindex`. It is a lazy chunk inside the lazy-chunk budget, split into sections if it must be.

Every device lands with its specimen entry. A committed capture script renders each style and mode at 1440px and 390px into `docs/plans/evidence/specimen/`, so evidence stops being one-off work.

## 8. What the milestones consume

| Element | Issues |
|---|---|
| Search field, filter group, sort control, URL state | 162, 163, 164, 174, 183, 188, 195, 209 |
| Count, legend, figure sentence | 163, 165, 179, 181, 182, 196, 202, 206 |
| Session state marker | 167, 211 |
| Tabs | 212 |
| Progress | 181, 214 |
| Timeline | 180, 194 |
| Notice bar | 196, 199 |
| Ruled table | 182, 183, 187, 189, 190, 192, 195, 196, 203, 205, 207, 209 |
| Dropzone, avatar | 175, 213 |
| Definition list | 234 |
| Dialog focus trap, external link marker, field error focus | 233, 236, 219 |
| Dashboard shell | 168, 179, 210 |

## 9. Waves

| Wave | Branch | Content |
|---|---|---|
| 1 | `claude/admin-cms-design-language-ub69gr` | The state grammar, the motion grammar and its test, the new controls, the specimen book and its capture script; closes #219, #233, #236 |
| 2 | `…-w2` | The text, feedback, and input devices of §3, the new block types, the option groups of §4 |
| 3 | `…-w3` | The four illustration sets of §5 |
| 4 | `…-w4` | The schedule devices wired on the schedule (#162 to #167) and the two dashboard shells (#168, #210) |
| 5 | `…-w5` | The three styles of §6 |
| 6 | `…-w6` | The admin devices of §3.4 on the M9 to M11 pages |

Every wave is one pull request, stacked on the wave below, regenerated on its own tip, reviewed once by an independent agent before it opens, and captured in the specimen book. After each wave a "feels wrong to humans" pass runs on the captures and its findings are fixed before the next wave starts.

## 10. Refusals, as tests

The brief's §2.4 list stands. This record adds the mechanical checks that a wave must leave green:

- No `transition: all`, no `animate-pulse`, no infinite keyframe, no hover rule outside the hover query, no duration outside the token set (the motion test).
- No `rounded-full` on any element but the ring of a focus outline (the tag test, widened).
- No text node directly above a heading (the eyebrow test, widened to the new devices).
- No zero-padded sequence number rendered by any device (the schedule number test, widened).
- No decorative gradient: a gradient whose colour stops differ is rejected; a single-colour or transparent-stop gradient that draws a rule, a frame, a grid, or a texture is a device mechanic and passes. No `backdrop-filter`. No `box-shadow` anywhere; the Zine stamp is a flat layer, not a shadow (a stylesheet scan).
- Every colour token in both mode blocks (the dark-mode test, extended to every new token).
- Every font in the bundle allowlist with a recorded licence (the token test).

## 11. Defects noticed on the way

Recorded so the wave that owns the surface fixes them:

- Admin sessions list: a day with no label renders its id ("day-2"). Wave 6, with a seed fix.
- Admin lists: the "Live" badge repeats on every row. Wave 6 sets the default state at lower weight and keeps the word.
- Admin title band: the description paragraph wraps to an orphaned word. Wave 6 sets `text-wrap: pretty`.
- Media widgets read `brand-*` names instead of tier 2 roles. Filed as an issue.
- The motif asset test measures only the fauna set. Wave 3 extends it.
