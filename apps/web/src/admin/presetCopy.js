// GENERATED FILE — do not edit by hand.
//
// THE WORDS STAFF READ while picking a site style: the style names, the
// one-line summaries, who each style suits, and the label and reason for
// every curated choice. Nothing here renders anything — the values that
// render are `packages/shared/src/presetCatalog.cjs`, and the design
// prose is `design/tokens/presets/README.md`. This file rides the admin's
// lazily-loaded chunk, so no public page and no Cloud Function carries it.
//
// Source of truth: design/tokens/presets/*.json.
// Regenerate with `node scripts/build-preset-catalog.cjs`.
// `scripts/build-preset-catalog.test.cjs` fails when this file is stale.

export const PRESET_COPY = Object.freeze({
  civic: {
    label: 'Institutional',
    summary: 'A formal, accessible layout with clear hierarchy, restrained decoration, and large control targets.',
    bestFor: 'Use this style for universities, public agencies, and organizations with formal accessibility requirements.',
    options: {
      headingFace: {
        label: 'Heading face',
        prompt: 'Choose the heading typeface.',
        choices: {
          merriweather: {
            label: 'Merriweather',
            why: 'Uses the standard USWDS serif and sans pairing. It gives headings more weight while Public Sans keeps body text and controls clear.',
          },
          'source-serif-4': {
            label: 'Source Serif 4',
            why: 'Uses a lighter serif for headings. It suits universities and cultural organizations that need a less formal tone.',
          },
          'public-sans-bold': {
            label: 'Public Sans bold',
            why: 'Uses one sans-serif family for headings, body text, labels, and data. This is the simplest type hierarchy.',
          },
        },
      },
      nameplate: {
        label: 'Header style',
        prompt: 'Choose the site header layout.',
        choices: {
          'institutional-letterhead': {
            label: 'Institutional letterhead',
            why: 'Places the event name first and the organization line below it. Use it for a formal single-organization event.',
          },
          'two-part-lockup': {
            label: 'Two-part lockup',
            why: 'Places the logo at the left and the event details at the right. A vertical rule separates the two parts.',
          },
          'compact-standing-head': {
            label: 'Compact standing head',
            why: 'Reduces the header size on content-heavy pages so the page title appears sooner.',
          },
        },
      },
      component: {
        label: 'Schedule style',
        prompt: 'Choose the schedule layout.',
        choices: {
          'posted-agenda': {
            label: 'Posted agenda',
            why: 'Uses fixed columns, hairline row rules, and tabular figures. It keeps the same order at each screen width.',
          },
          'numbered-agenda': {
            label: 'Numbered agenda',
            why: 'Adds plain sequence numbers to the schedule. The numbers are not zero-padded.',
          },
        },
      },
      longReadOpening: {
        label: 'Long read opening',
        prompt: 'Choose how the first paragraph of a Long read page opens.',
        choices: {
          'drop-cap': {
            label: 'Drop cap',
            why: 'Enlarges the first letter of the first paragraph to the height of three lines, in the heading typeface.',
          },
          standfirst: {
            label: 'Standfirst',
            why: 'Sets the first paragraph at the lead size, as a summary of the page.',
          },
          plain: {
            label: 'Plain',
            why: 'Keeps the first paragraph at body size with no drop cap.',
          },
        },
      },
      quote: {
        label: 'Quote device',
        prompt: 'Choose how a quoted sentence is set.',
        choices: {
          'ruled-minute': {
            label: 'Ruled minute',
            why: 'Sets the quote between two hairlines with a strong rule at its start, like a quoted minute.',
          },
          'plain-rules': {
            label: 'Plain rules',
            why: 'Sets the quote between two hairlines with no side rule.',
          },
        },
      },
      directory: {
        label: 'Directory style',
        prompt: 'Choose how the speaker shelf and the attendee index are set.',
        choices: {
          'ruled-entries': {
            label: 'Ruled entries',
            why: 'Sets square portraits and rules each entry at the hairline.',
          },
          'portrait-plates': {
            label: 'Portrait plates',
            why: 'Sets taller portraits on the alternate ground and gives each index row more room.',
          },
        },
      },
      sectionBoundary: {
        label: 'Section boundary',
        prompt: 'Choose how a section heading is ruled and labelled.',
        choices: {
          'rule-and-folio': {
            label: 'Rule and folio',
            why: 'Draws the section rule with the folio at the far end of the heading line.',
          },
          'rule-only': {
            label: 'Rule only',
            why: 'Draws the section rule and hides the folio beside the heading.',
          },
          'folio-in-margin': {
            label: 'Folio in the margin',
            why: 'Places the folio where the margin column opens beside the text measure on wide screens. On narrow screens it returns to the end of the line.',
          },
        },
      },
      tableRules: {
        label: 'Table rules',
        prompt: 'Choose how a table is ruled.',
        choices: {
          'hairline-rows': {
            label: 'Hairline rows',
            why: 'Rules the rows and the head at the hairline and draws no column rules.',
          },
          'ruled-head': {
            label: 'Ruled head',
            why: 'Closes the head with a strong rule and rules the rows at the hairline, with no column rules.',
          },
          'full-grid': {
            label: 'Full grid',
            why: 'Rules the rows and the columns at the hairline, with the head closed at the width the style sets.',
          },
        },
      },
    },
  },
  newsroom: {
    label: 'Newsroom',
    summary: 'A modern editorial layout with strong section rules, compact data, and restrained color.',
    bestFor: 'Use this style for publications, media conferences, and newsroom events.',
    options: {
      headingFace: {
        label: 'Heading face',
        prompt: 'Choose the headline typeface.',
        choices: {
          fraunces: {
            label: 'Fraunces',
            why: 'Uses a distinctive soft-serif heading face. It separates headlines from Newsreader body text and Plex data text.',
          },
          'newsreader-display': {
            label: 'Newsreader at display weights',
            why: 'Uses Newsreader for both headings and body text. This creates a quieter and more traditional publication style.',
          },
          'archivo-condensed': {
            label: 'Archivo bold condensed',
            why: 'Uses condensed sans-serif headlines. It fits longer titles in less vertical space and increases visual contrast.',
          },
        },
      },
      nameplate: {
        label: 'Header style',
        prompt: 'Choose the masthead layout.',
        choices: {
          'rule-bounded-bar': {
            label: 'Rule-bounded bar',
            why: 'Places the event name at the left and dates at the right. A strong rule closes the header.',
          },
          'stacked-with-deck': {
            label: 'Stacked with a deck',
            why: 'Places the event name above a short factual description. A hairline rule closes the header.',
          },
          'section-aware-bar': {
            label: 'Section-aware bar',
            why: 'Uses a smaller running header for inner pages and keeps the active section visible.',
          },
        },
      },
      component: {
        label: 'Schedule style',
        prompt: 'Choose the schedule row style.',
        choices: {
          'hairline-row': {
            label: 'Hairline row',
            why: 'Uses one row for the title, time, track, and speaker. Hairline rules separate the rows.',
          },
          'lead-and-rest': {
            label: 'Lead and rest',
            why: 'Makes the first session larger than the remaining sessions. Use it when one session must lead the list.',
          },
        },
      },
      longReadOpening: {
        label: 'Long read opening',
        prompt: 'Choose how the first paragraph of a Long read page opens.',
        choices: {
          'drop-cap': {
            label: 'Drop cap',
            why: 'Enlarges the first letter of the first paragraph to the height of three lines, in the heading typeface.',
          },
          standfirst: {
            label: 'Standfirst',
            why: 'Sets the first paragraph at the lead size, as a summary of the page.',
          },
          plain: {
            label: 'Plain',
            why: 'Keeps the first paragraph at body size with no drop cap.',
          },
        },
      },
      quote: {
        label: 'Quote device',
        prompt: 'Choose how a quoted sentence is set.',
        choices: {
          'ruled-with-mark': {
            label: 'Ruled with an opening mark',
            why: 'Sets the quote between strong rules with a large opening mark in the heading typeface.',
          },
          'side-rule': {
            label: 'Side rule',
            why: 'Sets the quote beside one strong rule with no rules above or below; the quotation marks sit inline around the sentence.',
          },
          'mark-only': {
            label: 'Opening mark only',
            why: 'Sets the quote with the large opening mark and no rules.',
          },
        },
      },
      directory: {
        label: 'Directory style',
        prompt: 'Choose how the speaker shelf and the attendee index are set.',
        choices: {
          'portrait-shelf': {
            label: 'Portrait shelf',
            why: 'Sets square portraits on the alternate ground, ruled at the hairline.',
          },
          'tall-portraits': {
            label: 'Tall portraits',
            why: 'Sets portraits at three by four, like a profile picture in a print feature.',
          },
        },
      },
      sectionBoundary: {
        label: 'Section boundary',
        prompt: 'Choose how a section heading is ruled and labelled.',
        choices: {
          'rule-and-folio': {
            label: 'Rule and folio',
            why: 'Draws the section rule with the folio at the far end of the heading line.',
          },
          'rule-only': {
            label: 'Rule only',
            why: 'Draws the section rule and hides the folio beside the heading.',
          },
          'folio-in-margin': {
            label: 'Folio in the margin',
            why: 'Places the folio where the margin column opens beside the text measure on wide screens. On narrow screens it returns to the end of the line.',
          },
        },
      },
      tableRules: {
        label: 'Table rules',
        prompt: 'Choose how a table is ruled.',
        choices: {
          'hairline-rows': {
            label: 'Hairline rows',
            why: 'Rules the rows and the head at the hairline and draws no column rules.',
          },
          'ruled-head': {
            label: 'Ruled head',
            why: 'Closes the head with a strong rule and rules the rows at the hairline, with no column rules.',
          },
          'full-grid': {
            label: 'Full grid',
            why: 'Rules the rows and the columns at the hairline, with the head closed at the width the style sets.',
          },
        },
      },
    },
  },
  broadsheet: {
    label: 'Broadsheet',
    summary: 'A newspaper layout with large serif headings, strong rules, and dense programme listings.',
    bestFor: 'Use this style for formal programmes, anniversary editions, and events that need a traditional newspaper layout.',
    options: {
      headingFace: {
        label: 'Heading face',
        prompt: 'Choose the masthead typeface.',
        choices: {
          'libre-caslon-display': {
            label: 'Libre Caslon Display',
            why: 'Uses a high-contrast display serif for the most traditional masthead.',
          },
          'libre-baskerville': {
            label: 'Libre Baskerville',
            why: 'Uses a more open serif with even letter shapes. It keeps a formal tone and improves clarity at smaller sizes.',
          },
          spectral: {
            label: 'Spectral semibold',
            why: 'Uses a contemporary serif with strong screen rendering. It keeps the formal hierarchy without an antique appearance.',
          },
        },
      },
      nameplate: {
        label: 'Header style',
        prompt: 'Choose the masthead layout.',
        choices: {
          'full-measure': {
            label: 'Full measure',
            why: 'Runs the event name across the full content width. The edition line appears below the nameplate rule.',
          },
          'centred-double-rule': {
            label: 'Centred with a double rule',
            why: 'Centers the event name between two rules. Use it for a formal or commemorative edition.',
          },
          'compact-standing-edition': {
            label: 'Compact left with a standing edition line',
            why: 'Uses a smaller left-aligned masthead and places the edition line beside it. Use it on inner pages.',
          },
        },
      },
      component: {
        label: 'Schedule style',
        prompt: 'Choose the programme density.',
        choices: {
          'ruled-programme': {
            label: 'Ruled programme',
            why: 'Uses hairline rows and a separate time column at the standard body leading.',
          },
          'agate-block': {
            label: 'Agate block',
            why: 'Reduces type size, row leading, and vertical padding to fit more sessions on one page.',
          },
        },
      },
      longReadOpening: {
        label: 'Long read opening',
        prompt: 'Choose how the first paragraph of a Long read page opens.',
        choices: {
          'drop-cap': {
            label: 'Drop cap',
            why: 'Enlarges the first letter of the first paragraph to the height of three lines, in the heading typeface.',
          },
          standfirst: {
            label: 'Standfirst',
            why: 'Sets the first paragraph at the lead size, as a summary of the page.',
          },
          plain: {
            label: 'Plain',
            why: 'Keeps the first paragraph at body size with no drop cap.',
          },
        },
      },
      quote: {
        label: 'Quote device',
        prompt: 'Choose how a quoted sentence is set.',
        choices: {
          'centred-mark': {
            label: 'Centred with an opening mark',
            why: 'Centres the quote between hairlines with a large opening mark and a small-capitals attribution.',
          },
          'column-rule': {
            label: 'Column rule',
            why: 'Sets the quote beside one hairline, like a boxed paragraph in a column, with the quotation marks inline around the sentence.',
          },
        },
      },
      directory: {
        label: 'Directory style',
        prompt: 'Choose how the speaker shelf and the attendee index are set.',
        choices: {
          'agate-directory': {
            label: 'Agate directory',
            why: 'Sets square portraits and tight index rows, like a newspaper directory.',
          },
          'plate-portraits': {
            label: 'Plate portraits',
            why: 'Sets tall portraits between strong rules, like a photograph page.',
          },
        },
      },
      sectionBoundary: {
        label: 'Section boundary',
        prompt: 'Choose how a section heading is ruled and labelled.',
        choices: {
          'rule-and-folio': {
            label: 'Rule and folio',
            why: 'Draws the section rule with the folio at the far end of the heading line.',
          },
          'rule-only': {
            label: 'Rule only',
            why: 'Draws the section rule and hides the folio beside the heading.',
          },
          'folio-in-margin': {
            label: 'Folio in the margin',
            why: 'Places the folio where the margin column opens beside the text measure on wide screens. On narrow screens it returns to the end of the line.',
          },
        },
      },
      tableRules: {
        label: 'Table rules',
        prompt: 'Choose how a table is ruled.',
        choices: {
          'hairline-rows': {
            label: 'Hairline rows',
            why: 'Rules the rows and the head at the hairline and draws no column rules.',
          },
          'ruled-head': {
            label: 'Ruled head',
            why: 'Closes the head with a strong rule and rules the rows at the hairline, with no column rules.',
          },
          'full-grid': {
            label: 'Full grid',
            why: 'Rules the rows and the columns at the hairline, with the head closed at the width the style sets.',
          },
        },
      },
    },
  },
  atlas: {
    label: 'Atlas',
    summary: 'A navigation-focused layout with map grids, route marks, and compact schedule data.',
    bestFor: 'Use this style for multi-venue events, city festivals, and events where visitors move between locations.',
    options: {
      headingFace: {
        label: 'Heading face',
        prompt: 'Choose the sign typeface. Body text stays Libre Franklin. Data stays Overpass Mono.',
        choices: {
          overpass: {
            label: 'Overpass',
            why: 'Uses a road-sign typeface for headings, route marks, and location names.',
          },
          'libre-franklin-extrabold': {
            label: 'Libre Franklin extrabold',
            why: 'Uses the body typeface at a heavier weight for headings. This reduces the number of type families in the layout.',
          },
          'archivo-condensed': {
            label: 'Archivo Condensed',
            why: 'Uses condensed headings to fit long location and route names in limited space.',
          },
        },
      },
      nameplate: {
        label: 'Header style',
        prompt: 'Choose the title-block layout.',
        choices: {
          'corner-title-block': {
            label: 'Corner title block',
            why: 'Places the event name, city, and dates in a framed corner block with coordinate marks.',
          },
          'sheet-header-scale-line': {
            label: 'Sheet header with a scale line',
            why: 'Uses an unframed header with a scale-line rule and puts the date range on the same line.',
          },
          'departure-board-header': {
            label: 'Departure board header',
            why: 'Uses a strong header rule and stacked event details. Use it when schedule movement matters more than map detail.',
          },
        },
      },
      component: {
        label: 'Schedule style',
        prompt: 'Choose the schedule map.',
        choices: {
          'departure-board': {
            label: 'Departure board',
            why: 'Places times in the left column and keeps the coordinate grid behind the schedule.',
          },
          'line-diagram': {
            label: 'Line diagram',
            why: 'Removes the grid and links the day as one vertical route. Rows use more line spacing.',
          },
          'gazetteer-list': {
            label: 'Gazetteer list',
            why: 'Removes the grid and uses a compact place index. Use it when visitors choose a location before a time.',
          },
        },
      },
      longReadOpening: {
        label: 'Long read opening',
        prompt: 'Choose how the first paragraph of a Long read page opens.',
        choices: {
          'drop-cap': {
            label: 'Drop cap',
            why: 'Enlarges the first letter of the first paragraph to the height of three lines, in the heading typeface.',
          },
          standfirst: {
            label: 'Standfirst',
            why: 'Sets the first paragraph at the lead size, as a summary of the page.',
          },
          plain: {
            label: 'Plain',
            why: 'Keeps the first paragraph at body size with no drop cap.',
          },
        },
      },
      quote: {
        label: 'Quote device',
        prompt: 'Choose how a quoted sentence is set.',
        choices: {
          'route-line': {
            label: 'Route line',
            why: 'Sets the quote beside one strong rule, like a route on the map, with the attribution in the monospaced font.',
          },
          'boxed-sign': {
            label: 'Boxed sign',
            why: 'Sets the quote between strong rules above and below with the strong rule at its start, like a sign.',
          },
        },
      },
      directory: {
        label: 'Directory style',
        prompt: 'Choose how the speaker shelf and the attendee index are set.',
        choices: {
          gazetteer: {
            label: 'Gazetteer',
            why: 'Sets square portraits with tight index rows, like a place index.',
          },
          'station-index': {
            label: 'Station index',
            why: 'Sets tall portraits and rules each entry at the strong width, like a departure board.',
          },
        },
      },
      sectionBoundary: {
        label: 'Section boundary',
        prompt: 'Choose how a section heading is ruled and labelled.',
        choices: {
          'rule-and-folio': {
            label: 'Rule and folio',
            why: 'Draws the section rule with the folio at the far end of the heading line.',
          },
          'rule-only': {
            label: 'Rule only',
            why: 'Draws the section rule and hides the folio beside the heading.',
          },
        },
      },
      tableRules: {
        label: 'Table rules',
        prompt: 'Choose how a table is ruled.',
        choices: {
          'hairline-rows': {
            label: 'Hairline rows',
            why: 'Rules the rows and the head at the hairline and draws no column rules.',
          },
          'ruled-head': {
            label: 'Ruled head',
            why: 'Closes the head with a strong rule and rules the rows at the hairline, with no column rules.',
          },
          'full-grid': {
            label: 'Full grid',
            why: 'Rules the rows and the columns at the hairline, with the head closed at the width the style sets.',
          },
        },
      },
    },
  },
  'field-guide': {
    label: 'Field Guide',
    summary: 'A natural-history layout with serif type, line drawings, specimen labels, and optional paper texture.',
    bestFor: 'Use this style for environmental events, science programs, and regional gatherings.',
    options: {
      headingFace: {
        label: 'Heading face',
        prompt: 'Choose the plate-caption typeface. Body text stays Vollkorn. Data stays IBM Plex Mono.',
        choices: {
          besley: {
            label: 'Besley',
            why: 'Uses a heavy slab serif for headings and plate captions. It remains clear beside line drawings.',
          },
          'vollkorn-display': {
            label: 'Vollkorn bold at display size',
            why: 'Uses Vollkorn for both headings and body text. This reduces the number of type families and gives the layout a quieter tone.',
          },
          spectral: {
            label: 'Spectral semibold',
            why: 'Uses a finer serif for headings. It suits research, museum, and academic events.',
          },
        },
      },
      nameplate: {
        label: 'Header style',
        prompt: 'Choose the title-page layout.',
        choices: {
          'framed-title-page': {
            label: 'Framed title page',
            why: 'Centers the event name and dates inside a hairline frame. The selected illustration appears above the name.',
          },
          'ruled-title-no-frame': {
            label: 'Ruled title, no frame',
            why: 'Left-aligns the event name and removes the frame. Use it for text-heavy pages.',
          },
          'plate-and-label': {
            label: 'Plate and label',
            why: 'Pairs the title with a line drawing and a compact metadata row.',
          },
        },
      },
      component: {
        label: 'Schedule style',
        prompt: 'Choose the session-label layout.',
        choices: {
          'specimen-label': {
            label: 'Specimen label',
            why: 'Uses a ruled block for the session name, date, and location.',
          },
          'field-notes-column': {
            label: 'Field notes column',
            why: 'Uses tighter rows and more line spacing. Use it for a single-track schedule.',
          },
        },
      },
      marginalia: {
        label: 'Pencil line',
        prompt: 'Show or hide the optional pencil mark.',
        choices: {
          off: {
            label: 'Off',
            why: 'Does not show pencil marks.',
          },
          on: {
            label: 'On',
            why: 'Shows one thin underline or note mark. It does not underline headings.',
          },
        },
      },
      longReadOpening: {
        label: 'Long read opening',
        prompt: 'Choose how the first paragraph of a Long read page opens.',
        choices: {
          'drop-cap': {
            label: 'Drop cap',
            why: 'Enlarges the first letter of the first paragraph to the height of three lines, in the heading typeface.',
          },
          standfirst: {
            label: 'Standfirst',
            why: 'Sets the first paragraph at the lead size, as a summary of the page.',
          },
          plain: {
            label: 'Plain',
            why: 'Keeps the first paragraph at body size with no drop cap.',
          },
        },
      },
      quote: {
        label: 'Quote device',
        prompt: 'Choose how a quoted sentence is set.',
        choices: {
          'field-note': {
            label: 'Field note',
            why: 'Sets the quote beside one hairline, like a note in the margin of a field book.',
          },
          'pressed-page': {
            label: 'Pressed page',
            why: 'Centres the quote between hairlines with a large opening mark, like an epigraph.',
          },
        },
      },
      directory: {
        label: 'Directory style',
        prompt: 'Choose how the speaker shelf and the attendee index are set.',
        choices: {
          'specimen-plates': {
            label: 'Specimen plates',
            why: 'Sets tall portraits on the page ground with square corners, like mounted plates.',
          },
          'field-list': {
            label: 'Field list',
            why: 'Sets square portraits on the alternate ground with hairline rules.',
          },
        },
      },
      sectionBoundary: {
        label: 'Section boundary',
        prompt: 'Choose how a section heading is ruled and labelled.',
        choices: {
          'rule-and-folio': {
            label: 'Rule and folio',
            why: 'Draws the section rule with the folio at the far end of the heading line.',
          },
          'rule-only': {
            label: 'Rule only',
            why: 'Draws the section rule and hides the folio beside the heading.',
          },
          'folio-in-margin': {
            label: 'Folio in the margin',
            why: 'Places the folio where the margin column opens beside the text measure on wide screens. On narrow screens it returns to the end of the line.',
          },
        },
      },
      tableRules: {
        label: 'Table rules',
        prompt: 'Choose how a table is ruled.',
        choices: {
          'hairline-rows': {
            label: 'Hairline rows',
            why: 'Rules the rows and the head at the hairline and draws no column rules.',
          },
          'ruled-head': {
            label: 'Ruled head',
            why: 'Closes the head with a strong rule and rules the rows at the hairline, with no column rules.',
          },
          'full-grid': {
            label: 'Full grid',
            why: 'Rules the rows and the columns at the hairline, with the head closed at the width the style sets.',
          },
        },
      },
    },
  },
  zine: {
    label: 'Zine',
    summary: 'A high-contrast layout with bold display type, monospaced data, paper grain, and limited accent color.',
    bestFor: 'Use this style for unconferences, community events, and student programs.',
    options: {
      headingFace: {
        label: 'Heading face',
        prompt: 'Choose the poster typeface.',
        choices: {
          karrik: {
            label: 'Karrik',
            why: 'Uses irregular letter shapes for a cut-and-copy poster effect.',
          },
          bagnard: {
            label: 'Bagnard',
            why: 'Uses a heavier display face for shorter and louder headings.',
          },
          avara: {
            label: 'Avara',
            why: 'Uses angular serif shapes for a cut-paper effect.',
          },
        },
      },
      nameplate: {
        label: 'Header style',
        prompt: 'Choose the poster header.',
        choices: {
          'full-sheet': {
            label: 'Full sheet',
            why: 'Runs the event name across the full width and allows it to wrap to several lines. A strong rule closes the header.',
          },
          'stacked-block': {
            label: 'Stacked block',
            why: 'Uses tighter line spacing so a long event name fills a compact block.',
          },
          'boxed-bill': {
            label: 'Boxed bill',
            why: 'Places the event name and details inside a strong rectangular rule.',
          },
        },
      },
      component: {
        label: 'Schedule style',
        prompt: 'Choose the session-block treatment.',
        choices: {
          'flat-block': {
            label: 'Flat block',
            why: 'Uses flat session blocks with strong rules and no print offset.',
          },
          'stamped-block': {
            label: 'Stamped block',
            why: 'Adds a small offset accent layer behind each session block to simulate a second print pass.',
          },
          'struck-folio': {
            label: 'Struck folio',
            why: 'Uses monospaced section labels and strong rules. It does not add a background layer.',
          },
        },
      },
      marginalia: {
        label: 'Pen marks',
        prompt: 'Show or hide the optional pen marks.',
        choices: {
          off: {
            label: 'Off',
            why: 'Does not show pen marks.',
          },
          on: {
            label: 'On',
            why: 'Shows up to two small marks and one callout on a page. It does not mark headline words.',
          },
        },
      },
      longReadOpening: {
        label: 'Long read opening',
        prompt: 'Choose how the first paragraph of a Long read page opens.',
        choices: {
          'drop-cap': {
            label: 'Drop cap',
            why: 'Enlarges the first letter of the first paragraph to the height of three lines, in the heading typeface.',
          },
          standfirst: {
            label: 'Standfirst',
            why: 'Sets the first paragraph at the lead size, as a summary of the page.',
          },
          plain: {
            label: 'Plain',
            why: 'Keeps the first paragraph at body size with no drop cap.',
          },
        },
      },
      quote: {
        label: 'Quote device',
        prompt: 'Choose how a quoted sentence is set.',
        choices: {
          handwritten: {
            label: 'Handwritten',
            why: 'Sets the quote in the script typeface at a small angle between strong rules.',
          },
          'toner-block': {
            label: 'Toner block',
            why: 'Sets the quote in the poster typeface, level, between strong rules.',
          },
          'cut-out': {
            label: 'Cut-out',
            why: 'Sets the quote in the script typeface beside one strong rule, with no rules above or below.',
          },
        },
      },
      directory: {
        label: 'Directory style',
        prompt: 'Choose how the speaker shelf and the attendee index are set.',
        choices: {
          'contact-sheet': {
            label: 'Contact sheet',
            why: 'Sets square portraits with square corners between strong rules.',
          },
          'cut-outs': {
            label: 'Cut-outs',
            why: 'Sets tall portraits on the page ground with square corners and hairline rules.',
          },
        },
      },
      sectionBoundary: {
        label: 'Section boundary',
        prompt: 'Choose how a section heading is ruled and labelled.',
        choices: {
          'rule-and-folio': {
            label: 'Rule and folio',
            why: 'Draws the section rule with the folio at the far end of the heading line.',
          },
          'rule-only': {
            label: 'Rule only',
            why: 'Draws the section rule and hides the folio beside the heading.',
          },
        },
      },
      tableRules: {
        label: 'Table rules',
        prompt: 'Choose how a table is ruled.',
        choices: {
          'hairline-rows': {
            label: 'Hairline rows',
            why: 'Rules the rows and the head at the hairline and draws no column rules.',
          },
          'ruled-head': {
            label: 'Ruled head',
            why: 'Closes the head with a strong rule and rules the rows at the hairline, with no column rules.',
          },
          'full-grid': {
            label: 'Full grid',
            why: 'Rules the rows and the columns at the hairline, with the head closed at the width the style sets.',
          },
        },
      },
    },
  },
});

/**
 * The words for one style. A style the catalog does not know returns
 * null, so a caller states the id rather than rendering `undefined`.
 *
 * @param {string} id
 * @returns {object|null}
 */
export function presetCopy(id) {
  return Object.prototype.hasOwnProperty.call(PRESET_COPY, id) ? PRESET_COPY[id] : null;
}

/**
 * The words for one choice in one option group.
 *
 * @param {string} id a style id
 * @param {string} group an option group id
 * @param {string} choiceId
 * @returns {{ label: string, why: string }|null}
 */
export function choiceCopy(id, group, choiceId) {
  return presetCopy(id)?.options?.[group]?.choices?.[choiceId] ?? null;
}
