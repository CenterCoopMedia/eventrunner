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
    summary: 'The public record of a public event. Plain, patient, unambiguous, with nothing between the reader and the information.',
    bestFor: 'Universities, government partners, and any client with a formal accessibility policy.',
    options: {
      headingFace: {
        label: 'Heading face',
        prompt: 'The institution’s register.',
        choices: {
          merriweather: {
            label: 'Merriweather',
            why: 'Weight without drama. It is the USWDS pairing and it reads as a body that has existed for a while.',
          },
          'source-serif-4': {
            label: 'Source Serif 4',
            why: 'The same document, lighter on its feet: A university or a cultural institution rather than an agency, and the repo already bundles it for Broadsheet.',
          },
          'public-sans-bold': {
            label: 'Public Sans bold',
            why: 'The all-sans document. One face for headings, labels, and data is the plainest possible public notice, which is the story taken to its logical end.',
          },
        },
      },
      nameplate: {
        label: 'Header style',
        prompt: 'The letterhead.',
        choices: {
          'institutional-letterhead': {
            label: 'Institutional letterhead',
            why: 'The top of an official document. The organisation line sits below the name, never above it.',
          },
          'two-part-lockup': {
            label: 'Two-part lockup',
            why: 'The co-signed notice of a partnership, which is the common Civic case: Logo slot left, event name and dates right, divided by a vertical hairline.',
          },
          'compact-standing-head': {
            label: 'Compact standing head',
            why: 'For inner pages, where the reader wants the content and not the letterhead again.',
          },
        },
      },
      component: {
        label: 'Schedule style',
        prompt: 'How the agenda is posted.',
        choices: {
          'posted-agenda': {
            label: 'Posted agenda',
            why: 'Hairline rows, fixed column order, tabular figures. The list is first-class at every width.',
          },
          'numbered-agenda': {
            label: 'Numbered agenda',
            why: 'The numbers are content, not decoration, and they are never zero-padded, so this matches how a formal programme is published.',
          },
        },
      },
    },
  },
  newsroom: {
    label: 'Newsroom',
    summary: 'A well-made news site on a good day. Named sections, one strong rule each, numbers that never borrow the headline face.',
    bestFor: 'Publications, media summits, and newsrooms that put something out every day.',
    options: {
      headingFace: {
        label: 'Heading face',
        prompt: 'The desk’s headline voice.',
        choices: {
          fraunces: {
            label: 'Fraunces',
            why: 'The designed headline. Its soft-serif wonk is what makes the site read as edited rather than generated.',
          },
          'newsreader-display': {
            label: 'Newsreader at display weights',
            why: 'The wire-service desk. Running the body face up to headline size gives a quieter, more traditional publication that still belongs to the same newsroom.',
          },
          'archivo-condensed': {
            label: 'Archivo bold condensed',
            why: 'Grotesque headlines are a real newsroom tradition, and they keep the story while letting a client trade warmth for punch.',
          },
        },
      },
      nameplate: {
        label: 'Header style',
        prompt: 'The masthead bar.',
        choices: {
          'rule-bounded-bar': {
            label: 'Rule-bounded bar',
            why: 'Name left, dates right, the strong rule under the whole bar. The standing masthead of a site that publishes every day.',
          },
          'stacked-with-deck': {
            label: 'Stacked with a deck',
            why: 'The deck is a newsroom device, not marketing copy, so it must state a fact about the event.',
          },
          'section-aware-bar': {
            label: 'Section-aware bar',
            why: 'The running head of a news site; it reinforces the table-of-contents idea the section rules set up.',
          },
        },
      },
      component: {
        label: 'Schedule style',
        prompt: 'How a session listing is set.',
        choices: {
          'hairline-row': {
            label: 'Hairline row',
            why: 'A hairline-separated row with title, time, track, speaker. The listing of a publication.',
          },
          'lead-and-rest': {
            label: 'Lead and rest',
            why: 'The lead story and the digest under it, which is how a news page ranks things without cards, shadows, or colored edges.',
          },
        },
      },
    },
  },
  broadsheet: {
    label: 'Broadsheet',
    summary: 'The paper of record. The nameplate is the loudest thing on the page and rules do the dividing.',
    bestFor: 'Formal programmes, anniversary editions, and events that want the paper-of-record voice.',
    options: {
      headingFace: {
        label: 'Heading face',
        prompt: 'The paper’s era.',
        choices: {
          'libre-caslon-display': {
            label: 'Libre Caslon Display',
            why: 'The paper of record founded in the 1820s. It is the canonical masthead voice and the reason the story reads as authority.',
          },
          'libre-baskerville': {
            label: 'Libre Baskerville',
            why: 'The same paper, founded sixty years later. Its more even colour and open counters keep the authority while reading a shade less antique.',
          },
          spectral: {
            label: 'Spectral semibold',
            why: 'The paper of record that redesigned in this century. It holds the serious register while giving a modern client a masthead that does not look inherited.',
          },
        },
      },
      nameplate: {
        label: 'Header style',
        prompt: 'The masthead layout.',
        choices: {
          'full-measure': {
            label: 'Full measure',
            why: 'Name across the full column width, the nameplate rule under it, edition slug below. The front page of a broadsheet, exactly.',
          },
          'centred-double-rule': {
            label: 'Centred with a double rule',
            why: 'The ceremonial masthead a paper uses on an anniversary edition, so it stays inside the story while reading more formal.',
          },
          'compact-standing-edition': {
            label: 'Compact left with a standing edition line',
            why: 'The running head on an inside page, which is why it fits inner pages and the nameplate-compact header variant.',
          },
        },
      },
      component: {
        label: 'Schedule style',
        prompt: 'How the programme is set.',
        choices: {
          'ruled-programme': {
            label: 'Ruled programme',
            why: 'Hairline rows, times in the agate column. The printed programme page.',
          },
          'agate-block': {
            label: 'Agate block',
            why: 'The classified and listings page of the same paper, so the density reads as another part of the document rather than a different design.',
          },
        },
      },
    },
  },
  atlas: {
    label: 'Atlas',
    summary: 'A mapped city on its transit network. A survey sheet and a departure board at once: Lines, stations, transfers.',
    bestFor: 'Multi-venue events, city festivals, and anything a visitor has to navigate.',
    options: {
      headingFace: {
        label: 'Heading face',
        prompt: 'The sign face. Body stays Libre Franklin and data stays Overpass Mono under every option. Every option must hold at nameplate size, at the h3 step, and inside a route mark.',
        choices: {
          overpass: {
            label: 'Overpass',
            why: 'The highway sign. It is drawn from road lettering, so route marks, station names, and transfer lines all speak in the voice the story needs.',
          },
          'libre-franklin-extrabold': {
            label: 'Libre Franklin extrabold',
            why: 'Franklin Gothic set American transit and news signage for a century, so running the body face up to heading size keeps the system whole and costs nothing extra.',
          },
          'archivo-condensed': {
            label: 'Archivo Condensed',
            why: 'Sheet space is scarce on a real map, and condensed headings pull the page toward the drawn sheet, which suits a dense multi-venue programme.',
          },
        },
      },
      nameplate: {
        label: 'Header style',
        prompt: 'The title block.',
        choices: {
          'corner-title-block': {
            label: 'Corner title block',
            why: 'Hairline frame, coordinate marks at two corners, city and date range below, schematic line-diagram divider under it. The corner of a survey sheet that carries a network.',
          },
          'sheet-header-scale-line': {
            label: 'Sheet header with a scale line',
            why: 'A scale bar states an extent, which is what a date span is, so the device stays honest.',
          },
          'departure-board-header': {
            label: 'Departure board header',
            why: 'The concourse board rather than the sheet, for events whose story is movement more than geography. The line updates on load and on user action only.',
          },
        },
      },
      component: {
        label: 'Schedule style',
        prompt: 'How the board is drawn.',
        choices: {
          'departure-board': {
            label: 'Departure board',
            why: 'Times down the left column, the faint coordinate grid behind the programme. The concourse board, and the theme’s clearest idea.',
          },
          'line-diagram': {
            label: 'Line diagram',
            why: 'The strip map inside a carriage: One run straight down the page. The grid behind the board comes off and the rows close up, so the day reads as one track to follow rather than as separate departures.',
          },
          'gazetteer-list': {
            label: 'Gazetteer list',
            why: 'A gazetteer indexes a map by place, which serves a visitor choosing where to stand rather than where to go.',
          },
        },
      },
    },
  },
  'field-guide': {
    label: 'Field Guide',
    summary: 'A naturalist’s expedition handbook. Plates, specimen labels, and observation notes, with the linework carrying the character.',
    bestFor: 'Environmental events, science communication, and regional gatherings.',
    options: {
      headingFace: {
        label: 'Heading face',
        prompt: 'The plate caption. Body stays Vollkorn and data stays IBM Plex Mono under every option.',
        choices: {
          besley: {
            label: 'Besley',
            why: 'The printed plate caption. Its Clarendon weight holds a title page and still sits calmly under a drawing, which is the core Field Guide relationship.',
          },
          'vollkorn-display': {
            label: 'Vollkorn bold at display size',
            why: 'The one-face volume: A pocket handbook rather than a plate book, quieter and closer to the reading, and it adds nothing to the font budget.',
          },
          spectral: {
            label: 'Spectral semibold',
            why: 'The collector’s volume. Its finer, sharper serifs read as the frontispiece of a formal edition, so the story gains a more scholarly opening.',
          },
        },
      },
      nameplate: {
        label: 'Header style',
        prompt: 'The title page.',
        choices: {
          'framed-title-page': {
            label: 'Framed title page',
            why: 'Name and dates inside a hairline frame with the nameplate-mark motif above the name. The opening plate of the handbook.',
          },
          'ruled-title-no-frame': {
            label: 'Ruled title, no frame',
            why: 'The title page of a cheaper printing of the same book; quieter, and better for text-heavy events.',
          },
          'plate-and-label': {
            label: 'Plate and label',
            why: 'It states the book’s subject the way a frontispiece plate does, and the plate stays drawn linework, never a photo.',
          },
        },
      },
      component: {
        label: 'Schedule style',
        prompt: 'How a session is labelled.',
        choices: {
          'specimen-label': {
            label: 'Specimen label',
            why: 'A small ruled block: Name, date, place. The collection tag.',
          },
          'field-notes-column': {
            label: 'Field notes column',
            why: 'The observation notebook rather than the mounted collection; it suits a single-track event where the day reads as one sitting.',
          },
        },
      },
      marginalia: {
        label: 'Pencil line',
        prompt: 'The one piece of marginalia this theme allows. Its own control, so a client can keep the plates clean.',
        choices: {
          off: {
            label: 'Off',
            why: 'The plates stay clean. This is the default, because a field notebook is written by someone being careful.',
          },
          on: {
            label: 'On',
            why: 'A thin hand-drawn underline under a specimen label or a note line: A pencil mark in a notebook, never a highlighter.',
          },
        },
      },
    },
  },
  zine: {
    label: 'Zine',
    summary: 'Made by hand, at a copier, the week before. One loud display face, an even mono rhythm under it, and an accent spent twice a page.',
    bestFor: 'Unconferences, community events, and student work.',
    options: {
      headingFace: {
        label: 'Heading face',
        prompt: 'The hand-cut poster lettering.',
        choices: {
          karrik: {
            label: 'Karrik',
            why: 'Its deliberately mismatched shapes come from found and copied lettering, which is exactly the made-at-a-copier voice the story needs.',
          },
          bagnard: {
            label: 'Bagnard',
            why: 'The same hand-cut origin with more weight and menace, for a louder, rougher event.',
          },
          avara: {
            label: 'Avara',
            why: 'A transitional serif with the curves replaced by straight segments, so every bowl reads as a cut facet: A poster cut from flat stock rather than drawn.',
          },
        },
      },
      nameplate: {
        label: 'Header style',
        prompt: 'The flyer headline.',
        choices: {
          'full-sheet': {
            label: 'Full sheet',
            why: 'Name at the nameplate step across the full measure, wrapping to two or three lines, on a strong rule. The stapled poster.',
          },
          'stacked-block': {
            label: 'Stacked block',
            why: 'This is how hand-lettering fills a sheet, so it stays hand-made without any rotation or collage.',
          },
          'boxed-bill': {
            label: 'Boxed bill',
            why: 'The show bill pinned to a noticeboard; a box drawn in strong rules is a printing device here, not a card.',
          },
        },
      },
      component: {
        label: 'Schedule style',
        prompt: 'How a session block is printed.',
        choices: {
          'flat-block': {
            label: 'Flat block',
            why: 'The single-pass photocopy, so it stays in the story and gives a client an option that needs no exception to §2.1.',
          },
          'stamped-block': {
            label: 'Stamped block',
            why: 'Misregistration is what a two-pass print looks like, which is the story’s whole production method. It ships under the brief §2.4 exception, Zine only.',
          },
          'struck-folio': {
            label: 'Struck folio',
            why: 'The typewriter section break of a photocopied programme; plain text plus rules, no chip or badge.',
          },
        },
      },
      marginalia: {
        label: 'Pen marks',
        prompt: 'The pen that went over the page afterwards. Its own control, because a client may want the stamp without the pen.',
        choices: {
          off: {
            label: 'Off',
            why: 'The page as printed, with no pen marks. This is the default so marginalia stays a deliberate choice.',
          },
          on: {
            label: 'On',
            why: 'Two drawn marks per page and one callout, never on a headline word, which keeps the theme clear of the banned headline-underline trick.',
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
