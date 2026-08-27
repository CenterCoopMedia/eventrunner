# The site style catalog

<!-- GENERATED FILE - do not edit by hand.
     Source: design/tokens/presets/*.json.
     Regenerate: node scripts/build-preset-catalog.cjs
     scripts/build-preset-catalog.test.cjs fails when this is stale. -->

This catalog lists each site style, its default configuration, and the options
staff can select. Runtime values are in `packages/shared/src/presetCatalog.cjs`.
Admin labels and explanations are in `apps/web/src/admin/presetCopy.js`.
All three outputs are generated from the same JSON source files.

The picker uses the order shown below. A new deployment starts with Institutional.
Each style includes one default configuration. Options marked *default* are selected
when staff choose the style.

Design rationale is in `docs/plans/2026-08-27-preset-visual-stories.md`.
Implementation requirements are in `docs/plans/2026-08-27-design-system-overhaul.md`.

## Institutional

`data-theme="civic"`

A formal, accessible layout with clear hierarchy, restrained decoration, and large control targets.

Use this style for universities, public agencies, and organizations with formal accessibility requirements.

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

**schema-note.** Defines one complete site style. The file supplies two color palettes, four font roles, shape, texture, density, a default illustration set, and curated options.

**story.** Design rationale source: docs/plans/2026-08-27-preset-visual-stories.md, page 4.

**palette-note.** Color channels use [r, g, b] numbers. The generator writes RGB triples. The dark palette is authored separately. Institutional uses the highest contrast targets among the six styles.

**first-class-note.** All six styles are complete and supported. Each has one default configuration. scripts/build-preset-catalog.cjs defines the picker order.

**default-note.** A new deployment starts with Institutional because it uses the simplest layout and the strongest accessibility defaults. Clients can select any other style.

**palette-words-light.** document off-white, statute near-black, restrained civic blue, form-grey rule, hearing-room slate, plain caution amber, plain confirm green, record grey

**palette-words-dark.** evening-office neutral, high-contrast bone text, retuned civic blue, lamp-grey rule, night slate, caution amber held bright, confirm green held bright, archive grey

**font-note.** Uses Merriweather for headings, Public Sans for body text and labels, and IBM Plex Mono for times, room codes, and identifiers.

**tokens-note.** Remaps existing tier 2 and tier 3 tokens. The schedule uses comfortable vertical padding and the data font for folio text.

### Heading face: `headingFace`

Choose the heading typeface.

- **Merriweather** *(default)*: Uses the standard USWDS serif and sans pairing. It gives headings more weight while Public Sans keeps body text and controls clear.
- **Source Serif 4**: Uses a lighter serif for headings. It suits universities and cultural organizations that need a less formal tone.
- **Public Sans bold**: Uses one sans-serif family for headings, body text, labels, and data. This is the simplest type hierarchy.

### Header style: `nameplate`

Choose the site header layout.

- **Institutional letterhead** *(default)*: Places the event name first and the organization line below it. Use it for a formal single-organization event.
- **Two-part lockup**: Places the logo at the left and the event details at the right. A vertical rule separates the two parts.
- **Compact standing head**: Reduces the header size on content-heavy pages so the page title appears sooner.

### Schedule style: `component`

Choose the schedule layout.

- **Posted agenda** *(default)*: Uses fixed columns, hairline row rules, and tabular figures. It keeps the same order at each screen width.
- **Numbered agenda**: Adds plain sequence numbers to the schedule. The numbers are not zero-padded.

## Newsroom

`data-theme="newsroom"`

A modern editorial layout with strong section rules, compact data, and restrained color.

Use this style for publications, media conferences, and newsroom events.

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

**schema-note.** Defines one complete site style. The file supplies two color palettes, four font roles, shape, texture, density, a default illustration set, and curated options.

**story.** Design rationale source: docs/plans/2026-08-27-preset-visual-stories.md, page 2.

**palette-note.** Color channels use [r, g, b] numbers. The generator writes RGB triples. The dark palette is authored separately.

**first-class-note.** All six styles are complete and supported. Each has one default configuration.

**palette-words-light.** cool newsprint white, desk black, one saturated editorial accent, muted data slate, hairline silver, section-rule graphite, caption grey, archive fog

**palette-words-dark.** charcoal desk, screen-lit soft white, night-retuned editorial accent, dimmed data slate, graphite rule, ash grey, low-lamp caption grey, archive slate

**font-note.** Uses Fraunces for headings, Newsreader for body text, Plex Sans for labels and data, and Plex Mono for figures and identifiers.

**tokens-note.** Remaps existing tier 2 and tier 3 tokens. The style uses the data font for folio text and a strong rule below each section heading.

### Heading face: `headingFace`

Choose the headline typeface.

- **Fraunces** *(default)*: Uses a distinctive soft-serif heading face. It separates headlines from Newsreader body text and Plex data text.
- **Newsreader at display weights**: Uses Newsreader for both headings and body text. This creates a quieter and more traditional publication style.
- **Archivo bold condensed**: Uses condensed sans-serif headlines. It fits longer titles in less vertical space and increases visual contrast.

### Header style: `nameplate`

Choose the masthead layout.

- **Rule-bounded bar** *(default)*: Places the event name at the left and dates at the right. A strong rule closes the header.
- **Stacked with a deck**: Places the event name above a short factual description. A hairline rule closes the header.
- **Section-aware bar**: Uses a smaller running header for inner pages and keeps the active section visible.

### Schedule style: `component`

Choose the schedule row style.

- **Hairline row** *(default)*: Uses one row for the title, time, track, and speaker. Hairline rules separate the rows.
- **Lead and rest**: Makes the first session larger than the remaining sessions. Use it when one session must lead the list.

## Broadsheet

`data-theme="broadsheet"`

A newspaper layout with large serif headings, strong rules, and dense programme listings.

Use this style for formal programmes, anniversary editions, and events that need a traditional newspaper layout.

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

**schema-note.** Defines one complete site style. The file supplies two color palettes, four font roles, shape, texture, density, a default illustration set, and curated options.

**story.** Design rationale source: docs/plans/2026-08-27-preset-visual-stories.md, page 1.

**palette-note.** Color channels use [r, g, b] numbers. The generator writes RGB triples. The dark palette is authored separately.

**first-class-note.** All six styles are complete and supported. Each has one default configuration.

**palette-words-light.** newsprint white, press black, deep ink-blue, warm rule grey, gutter grey, agate grey, margin white, archive grey

**palette-words-dark.** late-edition charcoal, warm bone type, lifted ink-blue, smoke-grey rule, banked ink, press-room grey, dim agate grey, muted archive grey

**font-note.** Uses serif type for headings, body text, programme data, and figures. The data roles use compact editorial type instead of a typewriter face.

**tokens-note.** Remaps existing tier 2 and tier 3 tokens. The schedule uses tight vertical padding and the data font for folio text.

### Heading face: `headingFace`

Choose the masthead typeface.

- **Libre Caslon Display** *(default)*: Uses a high-contrast display serif for the most traditional masthead.
- **Libre Baskerville**: Uses a more open serif with even letter shapes. It keeps a formal tone and improves clarity at smaller sizes.
- **Spectral semibold**: Uses a contemporary serif with strong screen rendering. It keeps the formal hierarchy without an antique appearance.

### Header style: `nameplate`

Choose the masthead layout.

- **Full measure** *(default)*: Runs the event name across the full content width. The edition line appears below the nameplate rule.
- **Centred with a double rule**: Centers the event name between two rules. Use it for a formal or commemorative edition.
- **Compact left with a standing edition line**: Uses a smaller left-aligned masthead and places the edition line beside it. Use it on inner pages.

### Schedule style: `component`

Choose the programme density.

- **Ruled programme** *(default)*: Uses hairline rows and a separate time column at the standard body leading.
- **Agate block**: Reduces type size, row leading, and vertical padding to fit more sessions on one page.

## Atlas

`data-theme="atlas"`

A navigation-focused layout with map grids, route marks, and compact schedule data.

Use this style for multi-venue events, city festivals, and events where visitors move between locations.

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

**schema-note.** Defines one complete site style. The file supplies two color palettes, four font roles, shape, texture, density, a default illustration set, and curated options.

**story.** Design rationale source: docs/plans/2026-08-27-preset-visual-stories.md, page 6.

**palette-note.** Color channels use [r, g, b] numbers. The generator writes RGB triples. The dark palette is authored separately.

**safety-note.** Each route uses a letter and a name. Color is an additional signal and is never the only identifier.

**first-class-note.** All six styles are complete and supported. Each has one default configuration.

**palette-words-light.** surveyor's paper, india ink, route red, contour grey, graticule pale blue, key-box white, platform slate, benchmark silver

**palette-words-dark.** deep slate ground, cool white ink, lit route marker, sunken contour grey, felt-grid blue, map-case grey, signal-white label, night platform blue

**font-note.** Uses Overpass for headings, Libre Franklin for body text, and Overpass Mono for schedule data, coordinates, and identifiers.

**tokens-note.** Remaps existing tier 2 and tier 3 tokens. The schedule trace connects entries vertically. The grid remains below hairline contrast. Other styles set the trace width to zero.

### Heading face: `headingFace`

Choose the sign typeface. Body text stays Libre Franklin. Data stays Overpass Mono.

**bar-note.** Each option must remain clear at masthead size, heading level three, and inside a route mark.

- **Overpass** *(default)*: Uses a road-sign typeface for headings, route marks, and location names.
- **Libre Franklin extrabold**: Uses the body typeface at a heavier weight for headings. This reduces the number of type families in the layout.
- **Archivo Condensed**: Uses condensed headings to fit long location and route names in limited space.

### Header style: `nameplate`

Choose the title-block layout.

- **Corner title block** *(default)*: Places the event name, city, and dates in a framed corner block with coordinate marks.
- **Sheet header with a scale line**: Uses an unframed header with a scale-line rule and puts the date range on the same line.
- **Departure board header**: Uses a strong header rule and stacked event details. Use it when schedule movement matters more than map detail.

### Schedule style: `component`

Choose the schedule map.

- **Departure board** *(default)*: Places times in the left column and keeps the coordinate grid behind the schedule.
- **Line diagram**: Removes the grid and links the day as one vertical route. Rows use more line spacing.
- **Gazetteer list**: Removes the grid and uses a compact place index. Use it when visitors choose a location before a time.

## Field Guide

`data-theme="field-guide"`

A natural-history layout with serif type, line drawings, specimen labels, and optional paper texture.

Use this style for environmental events, science programs, and regional gatherings.

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

**schema-note.** Defines one complete site style. The file supplies two color palettes, four font roles, shape, texture, density, a default illustration set, and curated options.

**story.** Design rationale source: docs/plans/2026-08-27-preset-visual-stories.md, page 5.

**palette-note.** Color channels use [r, g, b] numbers. The generator writes RGB triples. The dark palette is authored separately. The neutral ground keeps the botanical line drawings clear.

**first-class-note.** All six styles are complete and supported. Each has one default configuration.

**palette-words-light.** near-neutral plate stock with a trace of warmth, soft bark ink, deep leaf green, muted clay, lichen-grey rule, herbarium cream, pressed archive, pencil grey

**palette-words-dark.** near-neutral night ground with a trace of warmth, bone-white text, lifted moss green, lifted clay, moth-grey rule, lantern warmth, nocturne slate, faded field-note grey

**ground-note.** The light and dark surfaces stay close to neutral so client logos do not compete with a brown ground. Leaf green and clay provide the main color accents.

**font-note.** Uses Besley for headings, Vollkorn for body text, and IBM Plex Mono for labels, data, and identifiers.

**shape-note.** Flat texture is the default. A client can enable the light paper texture in the advanced settings.

**motif-note.** Botanical line drawings are enabled by default. The site can show them in the masthead mark, masthead divider, and public empty state. A client logo replaces the masthead mark. Clients can select no illustrations or the fauna set.

**tokens-note.** Remaps existing tier 2 and tier 3 tokens. The style uses a hairline plate frame, visible specimen-label rules, visible field names, the data font for folio text, and no marginalia by default.

### Heading face: `headingFace`

Choose the plate-caption typeface. Body text stays Vollkorn. Data stays IBM Plex Mono.

- **Besley** *(default)*: Uses a heavy slab serif for headings and plate captions. It remains clear beside line drawings.
- **Vollkorn bold at display size**: Uses Vollkorn for both headings and body text. This reduces the number of type families and gives the layout a quieter tone.
- **Spectral semibold**: Uses a finer serif for headings. It suits research, museum, and academic events.

### Header style: `nameplate`

Choose the title-page layout.

**default-note.** The framed title page is the default on the home page. Inner pages use the compact header. Clients can select the unframed option for text-heavy events.

- **Framed title page** *(default)*: Centers the event name and dates inside a hairline frame. The selected illustration appears above the name.
- **Ruled title, no frame**: Left-aligns the event name and removes the frame. Use it for text-heavy pages.
- **Plate and label**: Pairs the title with a line drawing and a compact metadata row.

### Schedule style: `component`

Choose the session-label layout.

- **Specimen label** *(default)*: Uses a ruled block for the session name, date, and location.
- **Field notes column**: Uses tighter rows and more line spacing. Use it for a single-track schedule.

### Pencil line: `marginalia`

Show or hide the optional pencil mark.

- **Off** *(default)*: Does not show pencil marks.
- **On**: Shows one thin underline or note mark. It does not underline headings.

## Zine

`data-theme="zine"`

A high-contrast layout with bold display type, monospaced data, paper grain, and limited accent color.

Use this style for unconferences, community events, and student programs.

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

**schema-note.** Defines one complete site style. The file supplies two color palettes, four font roles, shape, texture, density, a default illustration set, and curated options.

**story.** Design rationale source: docs/plans/2026-08-27-preset-visual-stories.md, page 3.

**palette-note.** Color channels use [r, g, b] numbers. The generator writes RGB triples. The dark palette is authored separately.

**first-class-note.** All six styles are complete and supported. Each has one default configuration.

**palette-words-light.** bright flyer paper, toner black, one hot accent, xerox grey, paper grain, staple silver, cut-edge white, faded archive grey

**palette-words-dark.** night toner black, paper-white ink, held-back hot accent, ghost grey, low-light grain, streetlight silver, matte rule black, sun-faded archive grey

**font-note.** Uses Karrik for headings, Source Sans 3 for body text, and Fragment Mono for data and identifiers. The sans-serif body face improves long-form reading while data keeps the monospaced treatment.

**component-fonts-note.** The callout font is a component token, not a fifth semantic font role. A client can point it at the heading font to remove the script face.

**shape-note.** Paper grain is enabled by default and appears only when data-texture is paper. A client can select Flat in the advanced settings. The optional stamped schedule remains off by default.

**tokens-note.** Remaps existing tier 2 and tier 3 tokens. The style uses strong rules, the monospaced font for folio text, a small callout angle, and no marginalia by default.

### Heading face: `headingFace`

Choose the poster typeface.

- **Karrik** *(default)*: Uses irregular letter shapes for a cut-and-copy poster effect.
- **Bagnard**: Uses a heavier display face for shorter and louder headings.
- **Avara**: Uses angular serif shapes for a cut-paper effect.

### Header style: `nameplate`

Choose the poster header.

- **Full sheet** *(default)*: Runs the event name across the full width and allows it to wrap to several lines. A strong rule closes the header.
- **Stacked block**: Uses tighter line spacing so a long event name fills a compact block.
- **Boxed bill**: Places the event name and details inside a strong rectangular rule.

### Schedule style: `component`

Choose the session-block treatment.

**default-note.** Flat is the default. The stamped option is available for clients that want a visible second-print effect.

- **Flat block** *(default)*: Uses flat session blocks with strong rules and no print offset.
- **Stamped block**: Adds a small offset accent layer behind each session block to simulate a second print pass.
- **Struck folio**: Uses monospaced section labels and strong rules. It does not add a background layer.

### Pen marks: `marginalia`

Show or hide the optional pen marks.

- **Off** *(default)*: Does not show pen marks.
- **On**: Shows up to two small marks and one callout on a page. It does not mark headline words.
