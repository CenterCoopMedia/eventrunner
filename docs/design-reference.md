# Site design reference

Everything the look of a client site is made of: the six site styles, the type, the illustrations, the headers, the page templates, the colour, the tokens under all of it, what prints, and where a developer extends it.

**This is the deep end, and you do not need it to run a site.** [`ADMIN_GUIDE.md`](ADMIN_GUIDE.md) is the operator's path — pick a style, add your logo, set your colour, preview, publish — and it is a complete answer for almost every event. Come here when you want to know what a control is doing underneath, when a recommended configuration is not quite right, or when you are adding to the system rather than using it.

Two audiences, one document. Where a section says **Staff** it is about a control somebody clicks; where it says **Engine** it is about the mechanism, and the names in it are internal ones ([`interface-guidelines.md`](interface-guidelines.md), Vocabulary).

## How a look is decided

One chain, four links, and each one only overrides what it names:

1. **The design tokens** (`design/tokens/*.json`) define every scale, contract, and primitive the system has. Nothing outside them is a value.
2. **The site style** picks a base: two authored palettes, a type pairing, a shape, a header, a set of illustrations, and its own remaps of the tokens above.
3. **The options** inside that style retune it — the heading face, the header treatment, the session presentation. An option remaps tokens the style already declares. It never invents a name.
4. **The overrides** are the exceptional path: one colour, one font role, one radius, named outright.

Whatever comes out of that is resolved once, in one place, and everything reads the result: the public site, the admin's page preview, the emails, and the PDF handout.

**Engine.** The stored document is `config/theme`. `packages/shared/src/theme.cjs` is the single resolver — the browser, the build-time generator, and the publish gate all call it, so none of them can disagree about what a document means. `scripts/lib/tokens.cjs` turns the resolved answer into `apps/web/src/generated/theme.css` at build time; `apps/web/src/lib/themeRuntime.js` turns the same answer into a `<style>` element at run time, so a publish restyles an open page with no deploy. `data-theme`, `data-mode`, and `data-motif-set` on the root element pick which blocks win.

**Nothing here is per-client code.** A client's whole visual identity is one Firestore document. There is no branch, no fork, and no build flag per event.

## The six site styles

Every style is finished work: two authored palettes, a type pairing that has been set against real event content, its own devices, and its own answers in every option group. None of them is a skin over another, and none of them is a lesser version of the default. What they differ in is what an event is *for*.

Three of them are the **launch surface** — run against real client content, and the ones the picker offers first. The other three are **still being proved**: fully functional, holding every gate, and grouped behind their own disclosure so staff try them on their own content before an event depends on them.

### Institutional — launch surface, and the default

*The public record of a public event.* Plain, patient, unambiguous, with nothing between the reader and the information.

- **Suits**: a government body, a university, a professional association, a public meeting, anything where the reader is checking a fact rather than being persuaded.
- **Type**: Merriweather over Public Sans. A serif that stays legible at small sizes over a face designed for public documents.
- **Shape**: near-square corners, flat surfaces, comfortable spacing.
- **Devices**: the institutional letterhead header; the posted agenda for the schedule.
- **Illustrations**: none.
- **Why it is the default**: it is the plainest of the six, it targets the highest accessibility bar, and it is the look a client is least likely to have to undo. A fresh deployment starts here.
- **Deeper controls**: the heading face can move to Source Serif 4 (warmer) or to Public Sans bold (drops the serif entirely, for an event that is not a document). The header can become a two-part lockup, for an event run by two organizations, or a compact standing head. The schedule can number its agenda items, which a formal proceeding often wants.

### Newsroom — launch surface

*A well-made news site on a good day.* Named sections, one strong rule each, numbers that never borrow the headline face.

- **Suits**: a conference with a programme worth reading, a summit, a festival — anything with editorial ambition and a lot of sessions.
- **Type**: Fraunces over Newsreader, with IBM Plex Sans carrying data and IBM Plex Mono carrying values. Four roles, four jobs.
- **Shape**: the small radius, flat surfaces, comfortable spacing.
- **Devices**: the rule-bounded bar header; the hairline row for a session.
- **Illustrations**: none.
- **Deeper controls**: the heading face can move to Newsreader at display weights (one family throughout, quieter) or to Archivo bold condensed (more sessions per screen in a headline). The header can stack with a deck, which suits an event whose name needs a sentence after it, or become section-aware so the running header names where the reader is. Sessions can run as "lead and rest", which gives the first session of a day the room a keynote deserves.

### Zine — launch surface

*Made by hand, at a copier, the week before.* One loud display face, an even rhythm under it, and an accent spent twice a page.

- **Suits**: an unconference, a community gathering, a student event, a workshop series — anything whose character is that it is not corporate.
- **Type**: Karrik for headings over Source Sans 3 for reading, with Fragment Mono carrying times, room codes, and identifiers. The mono is the value face, not the page face: a long session description set in a typewriter face is slow to read at any length.
- **Shape**: sharp corners, loose spacing.
- **Devices**: the full-sheet header; the flat block for a session.
- **Illustrations**: none.
- **The one exception in the whole system**: Zine may print a session block off-register, like a stamp that missed. It is the only place the design brief grants a deliberate imperfection, and it is **off by default** — a printing artefact is something a client turns on, not something they discover on their own schedule page.
- **Deeper controls**: the heading face can move to Bagnard or Avara. The header can become a stacked block or a boxed bill. The session block can take the off-register stamp or the struck folio. Marginalia — hand-drawn margin marks — can be turned on.

### Broadsheet — being proved

*The paper of record.* The nameplate is the loudest thing on the page, and rules do the dividing.

- **Suits**: an annual convening with weight behind it, an anniversary edition, an event that wants to look like it has happened many times before.
- **Type**: Libre Caslon Display over Libre Caslon Text, with a serif carrying data too. One voice, all the way down.
- **Shape**: sharp corners, flat surfaces, tight spacing — a broadsheet fits a lot on a page.
- **Devices**: the full-measure nameplate; the ruled programme for the schedule.
- **Illustrations**: none.
- **Deeper controls**: the heading face can move to Libre Baskerville or Spectral semibold. The nameplate can centre itself under a double rule, or compact to the left with a standing edition line. The schedule can drop to an agate block — the dense small-type listing a printed programme uses when the day is long.

### Field Guide — being proved

*A naturalist's expedition handbook.* Plates, specimen labels, and observation notes, with the linework carrying the character.

- **Suits**: a field school, an environmental convening, a residency, a science festival — an event about looking closely at things.
- **Type**: Besley over Vollkorn, with IBM Plex Mono for data.
- **Shape**: sharp corners, comfortable spacing, and the paper tone available as an advanced setting.
- **Devices**: a plain ruled title head; the specimen label for a session.
- **Illustrations**: the botanical set exists for this style and ships **off**. Drawings on every page of a real programme read as decoration rather than as observation. Turn them on for an event where they mean something.
- **Deeper controls**: the heading face can move to Vollkorn at display size or to Spectral semibold. The header can become a framed title page or a plate-and-label lockup. Sessions can run as a field-notes column. A pencil line can be turned on in the margins. The empty-state plate stays framed whatever you pick, because a blank sheet really is one.

### Atlas — being proved

*A mapped city on its transit network.* A survey sheet and a departure board at once: lines, stations, transfers.

- **Suits**: a multi-venue event, a city-wide festival, anything where getting from one thing to the next is part of the problem.
- **Type**: Overpass over Libre Franklin, with Overpass Mono carrying times and codes.
- **Shape**: sharp corners, flat surfaces, tight spacing.
- **Devices**: the corner title block; the departure board for the schedule.
- **Illustrations**: the cartographic set, on by default for this style.
- **Where the grid is drawn**: the coordinate grid and the route marks sit on the schedule surface only. A grid behind the about page, the speaker bios, and the code of conduct is texture; a grid behind a timetable is a reading device.
- **Deeper controls**: the heading face can move to Libre Franklin extrabold or Archivo Condensed. The header can take a scale line or become a departure-board header. The schedule can run as a line diagram or a gazetteer list.

## Headers

Four treatments, and a site picks one. The header is the site's identity, and it repeats on every page — which is exactly why it is **not** a heading: every page owns its own `h1`, and the header sits outside it.

| Treatment | What it draws | Reach for it when |
|---|---|---|
| **Standard** | The event name at normal weight, the dates and place under it, the navigation. | The default. The identity is present and the page's own headline leads. |
| **Masthead** | The full nameplate device: a rule-bounded title block at display size. | The event's name is the point — a front page, a single-day event, an anniversary. |
| **Compact** | The event bar: name and navigation on one line. | A long document site where every pixel above the text is spent. |
| **Minimal** | The mark and the navigation. No name. | The event's mark is well known, or the page is a utility. |

**A page may override the site's choice**, and one usually should not. The site-wide value is what makes the header furniture a reader stops noticing; a page that differs is asking to be noticed, which is right for a front page and wrong for a policy page.

**Engine.** `config/theme.header` names one of `standard`, `masthead`, `compact`, `minimal`; a `cmsPages` document may state its own `layout.header`. `resolveHeader(themeHeader, pageHeader)` returns the one to draw — page first, then theme, then the base. A stored value the validator should never have accepted renders the base rather than no header at all. `Nameplate` is unchanged in shape; it is now the device the masthead treatment draws rather than the shell's only header.

## Typography

**Four roles, never family names.** A component asks for a role and gets whatever the resolved style says that role is.

| Role | What it carries |
|---|---|
| `heading` | Every heading, and the masthead. |
| `body` | Everything a person reads as language. |
| `data` | The voice beside the text: labels, folios, captions. |
| `mono` | Anything a person would copy, paste, or compare character by character. |

There is no fifth role. Zine's handwritten callout runs on a component token, which is a contract for one device rather than a role.

**The scale is fluid and has eight steps** — nameplate, h1, h2, h3, lead, body, caption, folio — and each step carries its own size, line height, and tracking together. Never pick a size without its leading.

**The bundled sets** are the only faces a site can use, and they are self-hosted. No page on a client site asks an external font service for anything, ever: Source Serif 4, Source Sans 3, Caveat, Libre Caslon Display, Libre Caslon Text, Libre Baskerville, Spectral, Fraunces, Newsreader, IBM Plex Sans, IBM Plex Mono, Archivo Condensed, Merriweather, Public Sans, Karrik, Bagnard, Avara, Fragment Mono, Besley, Vollkorn, Overpass, Overpass Mono, Libre Franklin.

**Heading-face options** are the sanctioned way to change type: each style offers three, and they are chosen to still work with that style's body face. Naming a role outright is the override path, and it is where a pairing can go wrong.

**Engine.** Every bundled family is declared in the generated stylesheet, and only the ones a rendered element resolves to are downloaded — see [`interface-guidelines.md`](interface-guidelines.md), Typography, for why that has to be every set.

## Illustrations

A set of small drawings that carry a style's vocabulary, in four slots: a section mark, a divider, a mark inside the header, and an empty state.

- **None** — no drawings. What Institutional, Newsroom, Zine, and Broadsheet ship.
- **Botanical** — leaves, seed heads, specimen sprigs. Built for Field Guide, off by default.
- **Fauna** — the same idea in animals.
- **Cartographic** — compass points, contour fragments, route marks. On for Atlas.

They take the site's own ink and never carry a colour of their own, so a set cannot fight a client's palette.

**Engine.** `config/theme.motifSet` names the set; `data-motif-set` on the root element does the switching, because a custom property cannot rewrite the asset another custom property points at. A motif renders as a `mask-image` painted with the ink token, or as an inline SVG symbol reading `currentColor` — never as an `<img>`, never as a `url()` fill.

## Layout

### Pages are chosen by task

An operator knows "this is a long read" and "this is a directory with an introduction". They do not know, and should not have to work out, what `arrangement` should be. So the page editor asks the question they can answer:

| Template | What it is for |
|---|---|
| **Standard page** | The ordinary page: a running header, one column, normal spacing. Start here. |
| **Feature first** | Opens on its main content under the full masthead, for a page whose subject is the first thing to see. |
| **Directory with introduction** | A few words, then entries in columns. Speakers, sponsors, anything that is a list of people or organizations. |
| **Long read** | One column with air between things, for a page that is mostly text. |
| **Schedule** | Dense and time-led, so a long day fits on one screen. |
| **Landing page** | The full masthead over items in columns. A front page or a section opener. |

Picking one sets every underlying value at once. The individual axes stay reachable behind a disclosure, for the page that genuinely needs to differ — and moving one clears the template, because a page that no longer matches its template should not go on claiming it.

**A template is never inferred.** A page whose values happen to match Long read has not chosen Long read; it has values that coincide. The editor reports absence as absence rather than reporting a decision nobody made.

### The axes underneath (Advanced)

- **Header** — the four treatments above.
- **Arrangement** — `list` or `grid`. Whether the page's items run down or across.
- **Density** — `tight`, `comfortable`, `loose`. A set of token remaps, never raw values: each step maps the page and session contracts onto the spacing scale, and the block nearest an element wins, which is how a page overrides the style for its own subtree and nowhere else.

### Navigation is a site setting, not a page setting

Where the navigation sits is part of what the site *is*. A reader who meets a top navigation on the home page and a rail on the schedule has been handed two sites, and the navigation stops being furniture they can stop noticing. It is one choice — `top` or `side` — and it covers every page.

`side` moves the same navigation to the leading edge at wide viewports. It is one navigation either way: same landmark, same items, same place in the document, and below the wide breakpoint it is the top navigation again.

**Engine.** The value lives in `config/theme` beside the style, the texture, the radius, and the mode policy. A page document's own stored value is still accepted on write and still read as that page's fallback, because deployments made before the move set it per page and an upgrade may not restyle their pages.

### Sections are inserted, not slotted

A system page — home, schedule, speakers, sponsors — keeps its built-in feature and lets you put sections around it. The control asks where relative to that feature: **before the main feature** or **after the main feature**.

**Engine.** The stored positions are `above`, `main`, and `below`. A section with no position is `main`. `below` is a third stored position with no third name in the editor: it renders after every `main` section, and a section stored that way keeps both its value and its place unless the operator moves the control. A custom page has no built-in feature, so it ignores position entirely.

## Colour

### What a client actually sets

**One colour.** The main brand colour, and everything else follows from it:

- The **darker and lighter** steps of it, for the states and the surfaces that need them.
- The **rules** — hairline, strong, nameplate — which are the brand ink mixed into the ground at fixed shares, so a restyled site never keeps build-time rules on a new ground.
- The **form control boundary**, mixed the same way but at a share high enough to clear the non-text contrast bar against either ground.
- The **dark palette**, authored from the light one rather than inverted from it: a dark site is its own palette, and every colour is lifted to clear its bar on the dark ground rather than reused.

Semantic colours — success, warning, danger, and the rest — come from the style and are not part of the brand decision. They mean what they mean, and a client's colour does not get to redefine them.

### Expert overrides

Any single colour can be set by hand, per mode, in Advanced. This is an **exceptional control**: it is there for the client whose brand guide names an exact value that the derivation does not reach, and every use of it takes a token out of the derivation permanently — it will no longer move when the brand colour moves. Most sites should never open it, and a site that has overridden a dozen values has usually picked the wrong style.

### The contrast gate

Publishing is refused when any defined foreground/background pair fails its bar, in either mode. Text holds 4.5:1. A form control's boundary is non-text user interface and holds 3:1, measured against every ground an input actually renders on. Contrast is measured against the real rendered background, not the page background.

**A failure stops a publish, not a save.** A draft may hold two colours too close together to read; publishing that draft is refused, and the message names the pair, the mode, and the ratio it measured.

### Modes

`light`, `dark`, or `system`. Every style defines both palettes, so no choice here leaves the site half-dressed. The mode arrives as `data-mode` on the root element, written by the runtime; a deployment whose policy is not `light` also gets a first-paint block, so the ground is right before that attribute lands and a reader never sees a flash of the other mode.

## Tokens

Three tiers, and each one only reads the one below it.

| Tier | Names look like | What it is |
|---|---|---|
| 1 — primitives | `--er-space-md`, `--er-size-h2-max` | Raw values. Nothing renders against these directly. |
| 2 — semantic | `--space-md`, `--text-h2`, `--color-text-secondary-rgb`, `--rule-hairline-width` | The scales and roles components ask for. |
| 3 — contracts | `--folio-size`, `--section-rule-width`, `--session-card-pad-block` | One device's settings, so a style retunes a device by remapping tokens rather than by changing a component. |

**Rules for using them**, in full in [`interface-guidelines.md`](interface-guidelines.md), Colors:

- Name a token by role, never by appearance or first use.
- Never borrow a token from another role. When a role changes colour, mint a new token.
- Every colour token is defined under both modes. A token missing from either is a bug, not a polish item.
- Rules read the rule tokens. A rule never borrows an ink step and never carries brand colour.
- A form control's boundary reads the control token, never the hairline: a hairline is tuned for low-contrast structure and falls well short of the 3:1 bar.

**Colours are stored as space-separated RGB triples**, so the utility layer's `rgb(var(--…) / <alpha-value>)` keeps its opacity modifiers working.

**Where each is written.** `design/tokens/*.json` is the source. `scripts/lib/tokens.cjs` is the only thing in the repo that mints a token. Never hand-edit a generated stylesheet.

## Composition rules

The devices, and the one job each has. The implementations live in `apps/web/src/components/editorial/`, and each resolves through its tier-3 contract.

- **Header** — the site identity, in one of four treatments. Never a heading, never a photo behind the name.
- **Folio** — a small-caps plain-text label on a hairline. Never a chip, never a pill, never a coloured badge, and **never directly above a heading**.
- **Rule** — hairline, strong, or nameplate. A rule replaces a card border. Where the rule belongs to a row that already exists, put the border on that row instead of adding a node.
- **Section boundary** — one strong rule, then the heading with the folio beside it. Reach for this rather than composing a folio and a heading by hand.
- **Stat block** — four parts, all required: the finding in words, what the number counts and over what period, where it came from and when it was read, and a line describing it for a screen reader. A large number with a small caption under it is not a stat block, and the write path refuses one.
- **Grid schedule** — time down the left, lettered tracks across the head, at wide viewports. A real table, and it degrades to the time-ordered list, which is the accessible baseline and not a lesser view.
- **Back issue** — the archival state of a past day. Reduce the palette to the archive tokens, add the folio, remove the live controls. Never hide the content.
- **Print view** — its own view, not the screen with the controls hidden.

**The eyebrow ban is absolute.** Nothing sits directly above a heading — not a label, not a chip, not a small line of description, not a plain folio. It holds at every size, in every style. Two things are not eyebrows and must never be "fixed": metadata inside the rule-bounded nameplate block, and a form `<label>` above its own input.

**Elevation is tint, not shadow.** Where a surface must sit above another, shift its tone.

**Flat surfaces are the shared default.** The page ground paints no texture on its own; `paper` is a treatment a style opts into. An opt-in cannot leak.

The full list of rejected patterns is in [`interface-guidelines.md`](interface-guidelines.md), Rejected patterns.

## Print

**Paper has no dark mode.** Print any schedule page from a dark screen and you get the light edition: the print rules read the ink and rule tokens and nothing else, so re-pointing those at the light palette is the whole switch, and no print rule has to know a mode exists.

**The handout is its own view.** Every day of the event, every session and every stop under it, tracks named by letter and by name, no buttons, no demo notice. Nothing has to be prepared for it.

**The live palette prints, not the shipped one.** There are two print blocks and they are not redundant. The generated stylesheet carries one whose values are frozen at build time — that is the fallback, for a reader with no JavaScript or one printing before `config/theme` arrives. The runtime element writes its own from the live resolved palette, naming the same selectors so it wins on document order. Without it, a site restyled after deployment printed the palette it shipped with, and only from a dark screen, which is exactly the kind of bug nobody finds until a client hands out a hundred programmes.

## The admin panel is not a site style

The admin CMS is its own design surface and it does not restyle. It reads its own fixed token set, obeys the mode, and ignores the site style entirely — so the room a staff member works in does not change shape every time a client changes their palette.

- **Two faces, fixed.** Source Sans 3 for everything a person reads as language, IBM Plex Mono with tabular figures for everything the machine owns.
- **Navigation is the docket**: a grouped standing list of words down the leading edge. No icon rail, no collapse to glyphs, no counts in bubbles.
- **The active item carries four signals**, never colour alone: the marker, the weight, a ground shift, and the assistive-technology current-page state.
- **The position marker is derived**, from the admin's own ink against the admin ground. It is not a client setting: there is no marker colour to choose, nothing to get wrong, and no failure state to explain.
- **Three state words, everywhere**: Draft, Live, and Live with unpublished changes.
- **A destructive action stands still and states what it costs.** Nothing animates in a destructive moment.

**Engine.** The `admin-*` blocks are emitted once per mode and never once per (style, mode), which is the mechanical form of "the admin ignores the site style". They stay root-only, because the admin never renders inside the page-preview frame.

## Extension points

What a developer can add, and what the system will refuse.

**A new site style.** Add its JSON under `design/tokens/presets/`, with both palettes, its type map, its shape, its option groups, and its tier. A style that names no tier reads as still-being-proved, so a new one cannot reach the launch surface by accident. It must clear the contrast gate in both modes before it ships.

**A new option inside a style.** An option remaps tokens the style already declares. It may not introduce a property name and it may not introduce a class. If it needs a name that does not exist, the thing you are adding is a token, not an option.

**A new font set.** Add the woff2 to the bundle, declare the family, and register the set. It becomes selectable everywhere at once, because the type map is live.

**A new illustration set.** Add it to the motif JSON with all four slots filled. A set with a hole in it renders nothing in that slot, which reads as a bug.

**A new page template.** A template is a named, validated bundle of layout values plus the record of which task the operator meant. Add both, and state every axis: a template that left one unanswered would leave the page following the style for that one value while stating the others, which is the half-configured state templates exist to prevent.

**What a style may never do**: grant itself an exception to a rejected pattern, introduce a property name, ship a remote font, or define a colour in one mode only.
