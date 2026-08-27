# The site style catalog

<!-- GENERATED FILE - do not edit by hand.
     Source: design/tokens/presets/*.json.
     Regenerate: node scripts/build-preset-catalog.cjs
     scripts/build-preset-catalog.test.cjs fails when this is stale. -->

Every style Event Runner ships, what it is for, and what each of its curated
choices does. This is the prose half of the catalog: the values that render live
in `packages/shared/src/presetCatalog.cjs`, and the words the theme editor puts
on screen live in `apps/web/src/admin/presetCopy.js`. All three come from the
same JSON, so none of them can quietly disagree.

All six styles are first-class. The order below is the order the style picker
offers them, which is a recommendation and not a ranking: a fresh deployment
starts on the first one, and every style ships one recommended configuration —
the choices marked *recommended* here — that works the moment it is picked.

The narrative behind each style is `docs/plans/2026-08-27-preset-visual-stories.md`.
The binding rules are `docs/plans/2026-08-27-design-system-overhaul.md`.

## Institutional

`data-theme="civic"`

The public record of a public event. Plain, patient, unambiguous, with nothing between the reader and the information.

**Best for.** Universities, government partners, and any client with a formal accessibility policy.

| | |
|---|---|
| Headings | `merriweather` |
| Body | `public-sans` |
| Data | `public-sans` |
| Figures and code | `plex-mono` |
| Corners | small |
| Surface | flat |
| Density | comfortable |
| Illustrations | none |

**schema-note.** One theme preset (design brief 2026-08-27, §4.4). A preset is a complete designed look: two authored palettes, a type map for all four roles, shape and texture and density, a motif default, and the curated option sets from the visual story.

**story.** docs/plans/2026-08-27-preset-visual-stories.md, page 4.

**palette-note.** Channels are [r, g, b] numbers, never hex strings — the generator writes the RGB triples (brief §3.6). The dark palette is authored value by value; no dark value is derived from its light twin. Civic targets the highest contrast bar of the six presets and never trades contrast for mood.

**first-class-note.** Every one of the six styles is first-class (owner calibration, 2026-08-27). There is no stability tier and no experimental group: each style is complete, and each ships one recommended configuration — the option defaults below — that works the moment it is picked. The picker's ORDER is the only ranking, and it lives in scripts/build-preset-catalog.cjs.

**default-note.** Institutional is what a fresh deployment starts on: it is the plainest of the six, it targets the highest accessibility bar, and it is the look a client is least likely to have to undo. That is an onboarding decision, not a verdict on the other five.

**palette-words-light.** document off-white, statute near-black, restrained civic blue, form-grey rule, hearing-room slate, plain caution amber, plain confirm green, record grey

**palette-words-dark.** evening-office neutral, high-contrast bone text, retuned civic blue, lamp-grey rule, night slate, caution amber held bright, confirm green held bright, archive grey

**font-note.** Brief §4.4. This is the USWDS pairing: Merriweather headings, Public Sans body and labels, IBM Plex Mono for times, room codes, and identifiers.

**tokens-note.** Preset-level remaps of existing tier 2 and tier 3 tokens. No new property name (brief §3.4). Civic runs larger hit areas, so the session row keeps a comfortable block pad.

### Heading face — `headingFace`

The institution's register.

- **Merriweather** *(recommended)* — Weight without drama. It is the USWDS pairing and it reads as a body that has existed for a while.
- **Source Serif 4** — The same document, lighter on its feet: a university or a cultural institution rather than an agency, and the repo already bundles it for Broadsheet.
- **Public Sans bold** — The all-sans document. One face for headings, labels, and data is the plainest possible public notice, which is the story taken to its logical end.

### Header style — `nameplate`

The letterhead.

- **Institutional letterhead** *(recommended)* — The top of an official document. The organisation line sits below the name, never above it.
- **Two-part lockup** — The co-signed notice of a partnership, which is the common Civic case: logo slot left, event name and dates right, divided by a vertical hairline.
- **Compact standing head** — For inner pages, where the reader wants the content and not the letterhead again.

### Schedule style — `component`

How the agenda is posted.

- **Posted agenda** *(recommended)* — Hairline rows, fixed column order, tabular figures. The list is first-class at every width.
- **Numbered agenda** — The numbers are content, not decoration, and they are never zero-padded, so this matches how a formal programme is published.

## Newsroom

`data-theme="newsroom"`

A well-made news site on a good day. Named sections, one strong rule each, numbers that never borrow the headline face.

**Best for.** Publications, media summits, and newsrooms that put something out every day.

| | |
|---|---|
| Headings | `fraunces` |
| Body | `newsreader` |
| Data | `plex-sans` |
| Figures and code | `plex-mono` |
| Corners | small |
| Surface | flat |
| Density | comfortable |
| Illustrations | none |

**schema-note.** One theme preset (design brief 2026-08-27, §4.2). A preset is a complete designed look: two authored palettes, a type map for all four roles, shape and texture and density, a motif default, and the curated option sets from the visual story.

**story.** docs/plans/2026-08-27-preset-visual-stories.md, page 2.

**palette-note.** Channels are [r, g, b] numbers, never hex strings — the generator writes the RGB triples (brief §3.6). The dark palette is authored value by value; no dark value is derived from its light twin.

**first-class-note.** See design/tokens/presets/civic.json: all six styles are first-class, each with one recommended configuration.

**palette-words-light.** cool newsprint white, desk black, one saturated editorial accent, muted data slate, hairline silver, section-rule graphite, caption grey, archive fog

**palette-words-dark.** charcoal desk, screen-lit soft white, night-retuned editorial accent, dimmed data slate, graphite rule, ash grey, low-lamp caption grey, archive slate

**font-note.** Brief §4.2. Plex Sans handles captions and data so numbers never borrow the headline face; Plex Mono carries the figure column.

**tokens-note.** Preset-level remaps of existing tier 2 and tier 3 tokens. No new property name (brief §3.4).

### Heading face — `headingFace`

The desk's headline voice.

- **Fraunces** *(recommended)* — The designed headline. Its soft-serif wonk is what makes the site read as edited rather than generated.
- **Newsreader at display weights** — The wire-service desk. Running the body face up to headline size gives a quieter, more traditional publication that still belongs to the same newsroom.
- **Archivo bold condensed** — Grotesque headlines are a real newsroom tradition, and they keep the story while letting a client trade warmth for punch.

### Header style — `nameplate`

The masthead bar.

- **Rule-bounded bar** *(recommended)* — Name left, dates right, the strong rule under the whole bar. The standing masthead of a site that publishes every day.
- **Stacked with a deck** — The deck is a newsroom device, not marketing copy, so it must state a fact about the event.
- **Section-aware bar** — The running head of a news site; it reinforces the table-of-contents idea the section rules set up.

### Schedule style — `component`

How a session listing is set.

- **Hairline row** *(recommended)* — A hairline-separated row with title, time, track, speaker. The listing of a publication.
- **Lead and rest** — The lead story and the digest under it, which is how a news page ranks things without cards, shadows, or colored edges.

## Broadsheet

`data-theme="broadsheet"`

The paper of record. The nameplate is the loudest thing on the page and rules do the dividing.

**Best for.** Formal programmes, anniversary editions, and events that want the paper-of-record voice.

| | |
|---|---|
| Headings | `caslon-display` |
| Body | `caslon-text` |
| Data | `serif-editorial` |
| Figures and code | `serif-editorial` |
| Corners | sharp |
| Surface | flat |
| Density | tight |
| Illustrations | none |

**schema-note.** One theme preset (design brief 2026-08-27, §4.1). A preset is a complete designed look: two authored palettes, a type map for all four roles, shape and texture and density, a motif default, and the curated option sets from the visual story.

**story.** docs/plans/2026-08-27-preset-visual-stories.md, page 1.

**palette-note.** Channels are [r, g, b] numbers, never hex strings — the generator writes the RGB triples (brief §3.6). The dark palette is authored value by value; no dark value is derived from its light twin.

**first-class-note.** See design/tokens/presets/civic.json: all six styles are first-class, each with one recommended configuration.

**palette-words-light.** newsprint white, press black, deep ink-blue, warm rule grey, gutter grey, agate grey, margin white, archive grey

**palette-words-dark.** late-edition charcoal, warm bone type, lifted ink-blue, smoke-grey rule, banked ink, press-room grey, dim agate grey, muted archive grey

**font-note.** Brief §9.4 and §4.1. Broadsheet is the one preset that runs a serif in the mono role: a listings column in a paper is set in agate, not in a typewriter face.

**tokens-note.** Preset-level remaps of existing tier 2 and tier 3 tokens. No new property name (brief §3.4).

### Heading face — `headingFace`

The paper's era.

- **Libre Caslon Display** *(recommended)* — The paper of record founded in the 1820s. It is the canonical masthead voice and the reason the story reads as authority.
- **Libre Baskerville** — The same paper, founded sixty years later. Its more even colour and open counters keep the authority while reading a shade less antique.
- **Spectral semibold** — The paper of record that redesigned in this century. It holds the serious register while giving a modern client a masthead that does not look inherited.

### Header style — `nameplate`

The masthead layout.

- **Full measure** *(recommended)* — Name across the full column width, the nameplate rule under it, edition slug below. The front page of a broadsheet, exactly.
- **Centred with a double rule** — The ceremonial masthead a paper uses on an anniversary edition, so it stays inside the story while reading more formal.
- **Compact left with a standing edition line** — The running head on an inside page, which is why it fits inner pages and the nameplate-compact header variant.

### Schedule style — `component`

How the programme is set.

- **Ruled programme** *(recommended)* — Hairline rows, times in the agate column. The printed programme page.
- **Agate block** — The classified and listings page of the same paper, so the density reads as another part of the document rather than a different design.

## Atlas

`data-theme="atlas"`

A mapped city on its transit network. A survey sheet and a departure board at once: lines, stations, transfers.

**Best for.** Multi-venue events, city festivals, and anything a visitor has to navigate.

| | |
|---|---|
| Headings | `overpass` |
| Body | `libre-franklin` |
| Data | `overpass-mono` |
| Figures and code | `overpass-mono` |
| Corners | sharp |
| Surface | flat |
| Density | tight |
| Illustrations | cartographic |

**schema-note.** One theme preset (design brief 2026-08-27, §4.6). A preset is a complete designed look: two authored palettes, a type map for all four roles, shape and texture and density, a motif default, and the curated option sets from the visual story.

**story.** docs/plans/2026-08-27-preset-visual-stories.md, page 6.

**palette-note.** Channels are [r, g, b] numbers, never hex strings — the generator writes the RGB triples (brief §3.6). The dark palette is authored value by value; no dark value is derived from its light twin.

**safety-note.** Lines are told apart by their letter and their name first. A line colour, where a client sets one, is a second signal and never the only one (brief §8.1).

**first-class-note.** See design/tokens/presets/civic.json: all six styles are first-class, each with one recommended configuration.

**palette-words-light.** surveyor's paper, india ink, route red, contour grey, graticule pale blue, key-box white, platform slate, benchmark silver

**palette-words-dark.** deep slate ground, cool white ink, lit route marker, sunken contour grey, felt-grid blue, map-case grey, signal-white label, night platform blue

**font-note.** Brief §9.3. Atlas points both value roles at Overpass Mono on purpose: a timetable and a coordinate are the same kind of value.

**tokens-note.** Preset-level remaps of existing tier 2 and tier 3 tokens. No new property name (brief §3.4). The map grid is held below hairline contrast and never becomes an image.

### Heading face — `headingFace`

The sign face. Body stays Libre Franklin and data stays Overpass Mono under every option. Every option must hold at nameplate size, at the h3 step, and inside a route mark.

- **Overpass** *(recommended)* — The highway sign. It is drawn from road lettering, so route marks, station names, and transfer lines all speak in the voice the story needs.
- **Libre Franklin extrabold** — Franklin Gothic set American transit and news signage for a century, so running the body face up to heading size keeps the system whole and costs nothing extra.
- **Archivo Condensed** — Sheet space is scarce on a real map, and condensed headings pull the page toward the drawn sheet, which suits a dense multi-venue programme.

### Header style — `nameplate`

The title block.

- **Corner title block** *(recommended)* — Hairline frame, coordinate marks at two corners, city and date range below, schematic line-diagram divider under it. The corner of a survey sheet that carries a network.
- **Sheet header with a scale line** — A scale bar states an extent, which is what a date span is, so the device stays honest.
- **Departure board header** — The concourse board rather than the sheet, for events whose story is movement more than geography. The line updates on load and on user action only.

### Schedule style — `component`

How the board is drawn.

- **Departure board** *(recommended)* — Time down, lettered lines across, faint map grid behind, traced-line signature interaction. The theme's clearest idea.
- **Line diagram** — The strip map inside a carriage: one line at a time as a Beck-style vertical run, which serves a visitor following one track all day.
- **Gazetteer list** — A gazetteer indexes a map by place, which serves a visitor choosing where to stand rather than where to go.

## Field Guide

`data-theme="field-guide"`

A naturalist's expedition handbook. Plates, specimen labels, and observation notes, with the linework carrying the character.

**Best for.** Environmental events, science communication, and regional gatherings.

| | |
|---|---|
| Headings | `besley` |
| Body | `vollkorn` |
| Data | `plex-mono` |
| Figures and code | `plex-mono` |
| Corners | sharp |
| Surface | flat |
| Density | comfortable |
| Illustrations | botanical |

**schema-note.** One theme preset (design brief 2026-08-27, §4.5). A preset is a complete designed look: two authored palettes, a type map for all four roles, shape and texture and density, a motif default, and the curated option sets from the visual story.

**story.** docs/plans/2026-08-27-preset-visual-stories.md, page 5.

**palette-note.** Channels are [r, g, b] numbers, never hex strings — the generator writes the RGB triples (brief §3.6). The dark palette is authored value by value; no dark value is derived from its light twin. The palette stays quiet and earthy so the linework carries the character.

**first-class-note.** See design/tokens/presets/civic.json: all six styles are first-class, each with one recommended configuration.

**palette-words-light.** near-neutral plate stock with a trace of warmth, soft bark ink, deep leaf green, muted clay, lichen-grey rule, herbarium cream, pressed archive, pencil grey

**palette-words-dark.** near-neutral night ground with a trace of warmth, bone-white text, lifted moss green, lifted clay, moth-grey rule, lantern warmth, nocturne slate, faded field-note grey

**ground-note.** Owner review, 2026-08-27: the ground was too warm. A tan canvas paired with earthy ink reads as the look #109 rejected, and it fought every client logo that was not itself brown. Surface, alt surface, and both inks move most of the way to neutral. Warmth is kept as a trace — a few channels of red over blue, no more — so the story is still a paper handbook and not a spreadsheet. The leaf-green primary and the clay accent are untouched: they are the theme's colour, and the ground is what had to get out of their way.

**font-note.** Brief §9.2. Field Guide points both value roles at IBM Plex Mono on purpose: a label in this world is a tag, and a tag is set in the exact hand.

**shape-note.** Texture is flat by default (owner review, 2026-08-27). Brief §4.5 already called it "flat with an optional light paper tone"; the optional tone was on. Flat surfaces are the shared default everywhere, and the tone is one advanced setting away.

**motif-note.** Botanical illustrations are ON by default, as brief §3.8 binds. An earlier pass turned them off on the grounds that drawings appear "on every page"; that was wrong about the wiring. The site renders a motif in three places only — the masthead mark, the masthead's closing divider, and the public empty state — and the masthead mark yields to a client logo whenever one is set. Two small drawings on a page is the observational vocabulary this style is FOR, not decoration on top of it, and brief §2.3 caps the page at three. A client who wants none picks `none` in Illustrations; `fauna` is the supported alternate.

**tokens-note.** Preset-level remaps of existing tier 2 and tier 3 tokens. No new property name (brief §3.4). The plate frame is a hairline; the double rule is the plate device's own doubling. The specimen label is the one preset that turns its rules and its field names on: a label in this world is a tag, and a tag states what each field is.

### Heading face — `headingFace`

The plate caption. Body stays Vollkorn and data stays IBM Plex Mono under every option.

- **Besley** *(recommended)* — The printed plate caption. Its Clarendon weight holds a title page and still sits calmly under a drawing, which is the core Field Guide relationship.
- **Vollkorn bold at display size** — The one-face volume: a pocket handbook rather than a plate book, quieter and closer to the reading, and it adds nothing to the font budget.
- **Spectral semibold** — The collector's volume. Its finer, sharper serifs read as the frontispiece of a formal edition, so the story gains a more scholarly opening.

### Header style — `nameplate`

The title page.

**default-note.** The framed title page is the default, as it was before. An earlier pass moved it to the alternate on the grounds that a frame belongs only on "content that supports it" — but the framed treatment renders on the HOME page alone (Layout.jsx builds the compact nameplate on every inner page), and the opening page of a handbook is exactly the content a frontispiece supports. The plain ruled head stays one pick away for a text-heavy event.

- **Framed title page** *(recommended)* — Name and dates inside a hairline frame with the nameplate-mark motif above the name. The opening plate of the handbook.
- **Ruled title, no frame** — The title page of a cheaper printing of the same book; quieter, and better for text-heavy events.
- **Plate and label** — It states the book's subject the way a frontispiece plate does, and the plate stays drawn linework, never a photo.

### Schedule style — `component`

How a session is labelled.

- **Specimen label** *(recommended)* — A small ruled block: name, date, place. The collection tag.
- **Field notes column** — The observation notebook rather than the mounted collection; it suits a single-track event where the day reads as one sitting.

### Pencil line — `marginalia`

The one piece of marginalia this theme allows. Its own control, so a client can keep the plates clean.

- **Off** *(recommended)* — The plates stay clean. This is the default, because a field notebook is written by someone being careful.
- **On** — A thin hand-drawn underline under a specimen label or a note line: a pencil mark in a notebook, never a highlighter.

## Zine

`data-theme="zine"`

Made by hand, at a copier, the week before. One loud display face, an even mono rhythm under it, and an accent spent twice a page.

**Best for.** Unconferences, community events, and student work.

| | |
|---|---|
| Headings | `karrik` |
| Body | `sans-humanist` |
| Data | `fragment-mono` |
| Figures and code | `fragment-mono` |
| Corners | sharp |
| Surface | paper |
| Density | loose |
| Illustrations | none |

**schema-note.** One theme preset (design brief 2026-08-27, §4.3). A preset is a complete designed look: two authored palettes, a type map for all four roles, shape and texture and density, a motif default, and the curated option sets from the visual story.

**story.** docs/plans/2026-08-27-preset-visual-stories.md, page 3.

**palette-note.** Channels are [r, g, b] numbers, never hex strings — the generator writes the RGB triples (brief §3.6). The dark palette is authored value by value; no dark value is derived from its light twin.

**first-class-note.** See design/tokens/presets/civic.json: all six styles are first-class, each with one recommended configuration.

**palette-words-light.** bright flyer paper, toner black, one hot accent, xerox grey, paper grain, staple silver, cut-edge white, faded archive grey

**palette-words-dark.** night toner black, paper-white ink, held-back hot accent, ghost grey, low-light grain, streetlight silver, matte rule black, sun-faded archive grey

**font-note.** Brief §9.1, retuned by the owner review (2026-08-27). Zine ran one mono across body, data, and mono. A mono body is a poor face for long-form prose: a rich-text page or a session description set in Fragment Mono is slow to read at any length. Body moves to Source Sans 3, the bundled neutral. Data and mono stay Fragment Mono, so times, room codes, and identifiers keep the typewriter rhythm the story is built on — the mono is now the VALUE face rather than the whole page.

**component-fonts-note.** --callout-font is a component token, not a fifth semantic role (brief §3.1, §4.3). It carries the one handwritten callout a page may hold. A client may point it at var(--font-heading) and drop the script face.

**shape-note.** The copier grain is ON by default, as brief §4.3 allows ("paper grain allowed at low opacity"). An earlier pass turned it off in the name of flat surfaces; that confused two different fixes. The real fix was the CSS gate — the overlay now paints only under [data-texture='paper'], so an opt-in cannot leak onto a style that never asked for it (apps/web/src/index.css). Zine is the one style that DID ask: a page made at a copier has copier grain, and it is the cheapest, quietest way this style says so — a ground treatment, not a per-card artefact. The misregistered stamp stays the alternate, which is the right place for a printing artefact. A client who wants a clean sheet picks Flat under Advanced.

**tokens-note.** Preset-level remaps of existing tier 2 and tier 3 tokens. No new property name (brief §3.4). Zine uses the strong rule where the others use hairlines, so the page reads as cut-and-pasted blocks.

### Heading face — `headingFace`

The hand-cut poster lettering.

- **Karrik** *(recommended)* — Its deliberately mismatched shapes come from found and copied lettering, which is exactly the made-at-a-copier voice the story needs.
- **Bagnard** — The same hand-cut origin with more weight and menace, for a louder, rougher event.
- **Avara** — A transitional serif with the curves replaced by straight segments, so every bowl reads as a cut facet: a poster cut from flat stock rather than drawn.

### Header style — `nameplate`

The flyer headline.

- **Full sheet** *(recommended)* — Name at the nameplate step across the full measure, wrapping to two or three lines, on a strong rule. The stapled poster.
- **Stacked block** — This is how hand-lettering fills a sheet, so it stays hand-made without any rotation or collage.
- **Boxed bill** — The show bill pinned to a noticeboard; a box drawn in strong rules is a printing device here, not a card.

### Schedule style — `component`

How a session block is printed.

**default-note.** Flat is the default (owner review, 2026-08-27). The stamp is the theme's signature and it still ships under the brief §2.4 exception, but a printing artefact is a thing a client turns ON, not a thing they discover on their own schedule page.

- **Flat block** *(recommended)* — The single-pass photocopy, so it stays in the story and gives a client an option that needs no exception to §2.1.
- **Stamped block** — Misregistration is what a two-pass print looks like, which is the story's whole production method. It ships under the brief §2.4 exception, Zine only.
- **Struck folio** — The typewriter section break of a photocopied programme; plain text plus rules, no chip or badge.

### Pen marks — `marginalia`

The pen that went over the page afterwards. Its own control, because a client may want the stamp without the pen.

- **Off** *(recommended)* — The page as printed, with no pen marks. This is the default so marginalia stays a deliberate choice.
- **On** — Two drawn marks per page and one callout, never on a headline word, which keeps the theme clear of the banned headline-underline trick.
