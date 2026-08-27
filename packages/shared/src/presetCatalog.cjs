'use strict';

/**
 * GENERATED FILE — do not edit by hand.
 *
 * The design source of truth is `design/tokens/presets/*.json`,
 * `design/tokens/admin.json`, and `design/tokens/motifs.json`. This file
 * mirrors them into `packages/shared` so `updateTheme` can resolve a
 * preset inside Cloud Functions, where only `functions/` is uploaded and
 * the shared package arrives as a packed tarball.
 *
 * Regenerate with `node scripts/build-preset-catalog.cjs`.
 * `scripts/build-preset-catalog.test.cjs` fails when this file is stale.
 */

const PRESETS = Object.freeze({
  broadsheet: {
    id: 'broadsheet',
    label: 'Broadsheet',
    tier: 'experimental',
    summary: 'The paper of record. The nameplate is the loudest thing on the page and rules do the dividing.',
    palette: {
      light: {
        surface: [247, 244, 238],
        surfaceAlt: [239, 235, 227],
        ink: [24, 26, 32],
        inkMuted: [88, 92, 102],
        primary: [26, 58, 110],
        primaryDark: [17, 40, 80],
        primaryLight: [126, 150, 192],
        accent: [72, 84, 102],
        success: [26, 94, 60],
        warning: [138, 84, 12],
        danger: [162, 34, 42],
        highlight: [128, 92, 16],
        keynote: [78, 52, 130],
      },
      dark: {
        surface: [28, 27, 26],
        surfaceAlt: [40, 38, 36],
        ink: [237, 232, 222],
        inkMuted: [170, 165, 155],
        primary: [130, 170, 226],
        primaryDark: [172, 200, 240],
        primaryLight: [70, 96, 138],
        accent: [154, 166, 184],
        success: [124, 198, 148],
        warning: [226, 172, 88],
        danger: [240, 138, 140],
        highlight: [220, 186, 106],
        keynote: [186, 162, 236],
      },
    },
    fonts: {
      heading: 'caslon-display',
      body: 'caslon-text',
      data: 'serif-editorial',
      mono: 'serif-editorial',
    },
    shape: {
      radius: 'sharp',
      texture: 'flat',
      density: 'tight',
    },
    motifSet: 'none',
    tokens: {
      '--session-card-pad-block': 'var(--space-sm)',
      '--folio-font': 'var(--font-data)',
    },
    options: {
      headingFace: {
        label: 'Heading face',
        prompt: 'The paper\'s era.',
        default: 'libre-caslon-display',
        choices: [
          {
            id: 'libre-caslon-display',
            label: 'Libre Caslon Display',
            why: 'The paper of record founded in the 1820s. It is the canonical masthead voice and the reason the story reads as authority.',
            fonts: {
              heading: 'caslon-display',
            },
          },
          {
            id: 'libre-baskerville',
            label: 'Libre Baskerville',
            why: 'The same paper, founded sixty years later. Its more even colour and open counters keep the authority while reading a shade less antique.',
            fonts: {
              heading: 'baskerville',
            },
          },
          {
            id: 'spectral',
            label: 'Spectral semibold',
            why: 'The paper of record that redesigned in this century. It holds the serious register while giving a modern client a masthead that does not look inherited.',
            fonts: {
              heading: 'spectral',
            },
          },
        ],
      },
      nameplate: {
        label: 'Nameplate treatment',
        prompt: 'The masthead layout.',
        default: 'full-measure',
        choices: [
          {
            id: 'full-measure',
            label: 'Full measure',
            why: 'Name across the full column width, the nameplate rule under it, edition slug below. The front page of a broadsheet, exactly.',
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-rule-top-width': '0',
              '--nameplate-meta-placement': 'block',
            },
          },
          {
            id: 'centred-double-rule',
            label: 'Centred with a double rule',
            why: 'The ceremonial masthead a paper uses on an anniversary edition, so it stays inside the story while reading more formal.',
            tokens: {
              '--nameplate-align': 'center',
              '--nameplate-rule-top-width': 'var(--rule-hairline-width)',
              '--nameplate-meta-placement': 'inline',
            },
          },
          {
            id: 'compact-standing-edition',
            label: 'Compact left with a standing edition line',
            why: 'The running head on an inside page, which is why it fits inner pages and the nameplate-compact header variant.',
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-size': 'var(--text-h1)',
              '--nameplate-rule-width': 'var(--rule-hairline-width)',
              '--nameplate-meta-placement': 'inline',
            },
          },
        ],
      },
      component: {
        label: 'Schedule presentation',
        prompt: 'How the programme is set.',
        default: 'ruled-programme',
        choices: [
          {
            id: 'ruled-programme',
            label: 'Ruled programme',
            why: 'Hairline rows, times in the agate column. The printed programme page.',
            tokens: {
              '--schedule-row-leading': 'var(--text-body-leading)',
              '--schedule-data-size': 'var(--text-caption)',
            },
          },
          {
            id: 'agate-block',
            label: 'Agate block',
            why: 'The classified and listings page of the same paper, so the density reads as another part of the document rather than a different design.',
            tokens: {
              '--schedule-row-leading': '1.3',
              '--schedule-data-size': 'var(--text-folio)',
              '--session-card-pad-block': 'var(--space-xs)',
            },
          },
        ],
      },
    },
  },
  newsroom: {
    id: 'newsroom',
    label: 'Newsroom',
    tier: 'stable',
    summary: 'A well-made news site on a good day. Named sections, one strong rule each, numbers that never borrow the headline face.',
    palette: {
      light: {
        surface: [246, 247, 249],
        surfaceAlt: [236, 238, 242],
        ink: [22, 24, 29],
        inkMuted: [88, 95, 108],
        primary: [178, 30, 50],
        primaryDark: [140, 20, 38],
        primaryLight: [224, 148, 158],
        accent: [46, 84, 126],
        success: [22, 96, 62],
        warning: [134, 82, 10],
        danger: [170, 32, 44],
        highlight: [124, 90, 14],
        keynote: [82, 54, 140],
      },
      dark: {
        surface: [23, 25, 30],
        surfaceAlt: [34, 37, 44],
        ink: [232, 235, 240],
        inkMuted: [160, 168, 180],
        primary: [240, 122, 134],
        primaryDark: [248, 168, 176],
        primaryLight: [118, 56, 66],
        accent: [130, 172, 216],
        success: [116, 200, 150],
        warning: [228, 174, 88],
        danger: [242, 136, 142],
        highlight: [222, 190, 108],
        keynote: [186, 164, 240],
      },
    },
    fonts: {
      heading: 'fraunces',
      body: 'newsreader',
      data: 'plex-sans',
      mono: 'plex-mono',
    },
    shape: {
      radius: 'small',
      texture: 'flat',
      density: 'comfortable',
    },
    motifSet: 'none',
    tokens: {
      '--folio-font': 'var(--font-data)',
      '--section-rule-width': 'var(--rule-strong-width)',
    },
    options: {
      headingFace: {
        label: 'Heading face',
        prompt: 'The desk\'s headline voice.',
        default: 'fraunces',
        choices: [
          {
            id: 'fraunces',
            label: 'Fraunces',
            why: 'The designed headline. Its soft-serif wonk is what makes the site read as edited rather than generated.',
            fonts: {
              heading: 'fraunces',
            },
          },
          {
            id: 'newsreader-display',
            label: 'Newsreader at display weights',
            why: 'The wire-service desk. Running the body face up to headline size gives a quieter, more traditional publication that still belongs to the same newsroom.',
            fonts: {
              heading: 'newsreader',
            },
          },
          {
            id: 'archivo-condensed',
            label: 'Archivo bold condensed',
            why: 'Grotesque headlines are a real newsroom tradition, and they keep the story while letting a client trade warmth for punch.',
            fonts: {
              heading: 'archivo-condensed',
            },
          },
        ],
      },
      nameplate: {
        label: 'Nameplate treatment',
        prompt: 'The masthead bar.',
        default: 'rule-bounded-bar',
        choices: [
          {
            id: 'rule-bounded-bar',
            label: 'Rule-bounded bar',
            why: 'Name left, dates right, the strong rule under the whole bar. The standing masthead of a site that publishes every day.',
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-rule-width': 'var(--rule-strong-width)',
              '--nameplate-meta-placement': 'inline',
            },
          },
          {
            id: 'stacked-with-deck',
            label: 'Stacked with a deck',
            why: 'The deck is a newsroom device, not marketing copy, so it must state a fact about the event.',
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-rule-width': 'var(--rule-hairline-width)',
              '--nameplate-meta-placement': 'block',
              '--nameplate-gap': 'var(--space-xs)',
            },
          },
          {
            id: 'section-aware-bar',
            label: 'Section-aware bar',
            why: 'The running head of a news site; it reinforces the table-of-contents idea the section rules set up.',
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-size': 'var(--text-h1)',
              '--nameplate-rule-width': 'var(--rule-strong-width)',
              '--nameplate-meta-placement': 'inline',
            },
          },
        ],
      },
      component: {
        label: 'Session card',
        prompt: 'How a session listing is set.',
        default: 'hairline-row',
        choices: [
          {
            id: 'hairline-row',
            label: 'Hairline row',
            why: 'A hairline-separated row with title, time, track, speaker. The listing of a publication.',
            tokens: {
              '--session-card-lead-scale': '1',
              '--session-card-rule-width': 'var(--rule-hairline-width)',
            },
          },
          {
            id: 'lead-and-rest',
            label: 'Lead and rest',
            why: 'The lead story and the digest under it, which is how a news page ranks things without cards, shadows, or colored edges.',
            tokens: {
              '--session-card-lead-scale': '1.35',
              '--session-card-rule-width': 'var(--rule-hairline-width)',
            },
          },
        ],
      },
    },
  },
  zine: {
    id: 'zine',
    label: 'Zine',
    tier: 'stable',
    summary: 'Made by hand, at a copier, the week before. One loud display face, an even mono rhythm under it, and an accent spent twice a page.',
    palette: {
      light: {
        surface: [250, 249, 244],
        surfaceAlt: [240, 238, 230],
        ink: [20, 19, 18],
        inkMuted: [86, 84, 80],
        primary: [198, 26, 84],
        primaryDark: [156, 16, 64],
        primaryLight: [240, 148, 182],
        accent: [44, 58, 110],
        success: [24, 92, 58],
        warning: [136, 80, 8],
        danger: [176, 28, 40],
        highlight: [126, 88, 12],
        keynote: [88, 48, 142],
      },
      dark: {
        surface: [21, 20, 22],
        surfaceAlt: [33, 32, 35],
        ink: [242, 240, 236],
        inkMuted: [168, 164, 160],
        primary: [244, 124, 166],
        primaryDark: [250, 170, 198],
        primaryLight: [118, 42, 74],
        accent: [144, 160, 226],
        success: [122, 202, 150],
        warning: [230, 176, 90],
        danger: [244, 138, 142],
        highlight: [224, 192, 110],
        keynote: [190, 166, 244],
      },
    },
    fonts: {
      heading: 'karrik',
      body: 'fragment-mono',
      data: 'fragment-mono',
      mono: 'fragment-mono',
    },
    componentFonts: {
      '--callout-font': 'script-casual',
    },
    shape: {
      radius: 'sharp',
      texture: 'paper',
      density: 'loose',
    },
    motifSet: 'none',
    tokens: {
      '--session-card-rule-width': 'var(--rule-strong-width)',
      '--folio-rule-width': 'var(--rule-strong-width)',
      '--folio-font': 'var(--font-mono)',
      '--callout-angle': '-2.5deg',
      '--marginalia-display': 'none',
    },
    options: {
      headingFace: {
        label: 'Heading face',
        prompt: 'The hand-cut poster lettering.',
        default: 'karrik',
        choices: [
          {
            id: 'karrik',
            label: 'Karrik',
            why: 'Its deliberately mismatched shapes come from found and copied lettering, which is exactly the made-at-a-copier voice the story needs.',
            fonts: {
              heading: 'karrik',
            },
          },
          {
            id: 'bagnard',
            label: 'Bagnard',
            why: 'The same hand-cut origin with more weight and menace, for a louder, rougher event.',
            fonts: {
              heading: 'bagnard',
            },
          },
          {
            id: 'avara',
            label: 'Avara',
            why: 'A transitional serif with the curves replaced by straight segments, so every bowl reads as a cut facet: a poster cut from flat stock rather than drawn.',
            fonts: {
              heading: 'avara',
            },
          },
        ],
      },
      nameplate: {
        label: 'Nameplate treatment',
        prompt: 'The flyer headline.',
        default: 'full-sheet',
        choices: [
          {
            id: 'full-sheet',
            label: 'Full sheet',
            why: 'Name at the nameplate step across the full measure, wrapping to two or three lines, on a strong rule. The stapled poster.',
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-rule-width': 'var(--rule-nameplate-width)',
              '--nameplate-frame-width': '0',
            },
          },
          {
            id: 'stacked-block',
            label: 'Stacked block',
            why: 'This is how hand-lettering fills a sheet, so it stays hand-made without any rotation or collage.',
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-leading': '0.86',
              '--nameplate-frame-width': '0',
            },
          },
          {
            id: 'boxed-bill',
            label: 'Boxed bill',
            why: 'The show bill pinned to a noticeboard; a box drawn in strong rules is a printing device here, not a card.',
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-frame-width': 'var(--rule-strong-width)',
              '--nameplate-meta-placement': 'block',
            },
          },
        ],
      },
      component: {
        label: 'Session block',
        prompt: 'How a session block is printed.',
        default: 'stamped-block',
        choices: [
          {
            id: 'stamped-block',
            label: 'Stamped block',
            why: 'Misregistration is what a two-pass print looks like, which is the story\'s whole production method. It ships under the brief §2.4 exception, Zine only.',
            tokens: {
              '--session-card-stamp-offset': '4px',
              '--folio-rule-top-width': '0',
            },
          },
          {
            id: 'flat-block',
            label: 'Flat block',
            why: 'The single-pass photocopy, so it stays in the story and gives a client an option that needs no exception to §2.1.',
            tokens: {
              '--session-card-stamp-offset': '0',
              '--folio-rule-top-width': '0',
            },
          },
          {
            id: 'struck-folio',
            label: 'Struck folio',
            why: 'The typewriter section break of a photocopied programme; plain text plus rules, no chip or badge.',
            tokens: {
              '--session-card-stamp-offset': '0',
              '--folio-rule-top-width': 'var(--rule-strong-width)',
              '--folio-font': 'var(--font-mono)',
            },
          },
        ],
      },
      marginalia: {
        label: 'Marginalia',
        prompt: 'The pen that went over the page afterwards. Its own control, because a client may want the stamp without the pen.',
        default: 'off',
        choices: [
          {
            id: 'off',
            label: 'Off',
            why: 'The page as printed, with no pen marks. This is the default so marginalia stays a deliberate choice.',
            tokens: {
              '--marginalia-display': 'none',
            },
          },
          {
            id: 'on',
            label: 'On',
            why: 'Two drawn marks per page and one callout, never on a headline word, which keeps the theme clear of the banned headline-underline trick.',
            tokens: {
              '--marginalia-display': 'inline',
            },
          },
        ],
      },
    },
  },
  civic: {
    id: 'civic',
    label: 'Institutional',
    tier: 'stable',
    summary: 'The public record of a public event. Plain, patient, unambiguous, with nothing between the reader and the information.',
    palette: {
      light: {
        surface: [250, 250, 249],
        surfaceAlt: [240, 240, 239],
        ink: [23, 24, 26],
        inkMuted: [80, 83, 89],
        primary: [26, 82, 150],
        primaryDark: [16, 56, 106],
        primaryLight: [126, 164, 208],
        accent: [64, 80, 98],
        success: [20, 92, 56],
        warning: [124, 74, 6],
        danger: [162, 26, 36],
        highlight: [116, 84, 10],
        keynote: [76, 48, 132],
      },
      dark: {
        surface: [25, 26, 28],
        surfaceAlt: [37, 39, 42],
        ink: [238, 238, 236],
        inkMuted: [174, 178, 184],
        primary: [128, 178, 238],
        primaryDark: [172, 208, 248],
        primaryLight: [56, 90, 134],
        accent: [152, 168, 184],
        success: [126, 204, 152],
        warning: [234, 180, 92],
        danger: [246, 142, 146],
        highlight: [228, 196, 114],
        keynote: [190, 168, 244],
      },
    },
    fonts: {
      heading: 'merriweather',
      body: 'public-sans',
      data: 'public-sans',
      mono: 'plex-mono',
    },
    shape: {
      radius: 'small',
      texture: 'flat',
      density: 'comfortable',
    },
    motifSet: 'none',
    tokens: {
      '--session-card-pad-block': 'var(--space-md)',
      '--folio-font': 'var(--font-data)',
    },
    options: {
      headingFace: {
        label: 'Heading face',
        prompt: 'The institution\'s register.',
        default: 'merriweather',
        choices: [
          {
            id: 'merriweather',
            label: 'Merriweather',
            why: 'Weight without drama. It is the USWDS pairing and it reads as a body that has existed for a while.',
            fonts: {
              heading: 'merriweather',
            },
          },
          {
            id: 'source-serif-4',
            label: 'Source Serif 4',
            why: 'The same document, lighter on its feet: a university or a cultural institution rather than an agency, and the repo already bundles it for Broadsheet.',
            fonts: {
              heading: 'serif-editorial',
            },
          },
          {
            id: 'public-sans-bold',
            label: 'Public Sans bold',
            why: 'The all-sans document. One face for headings, labels, and data is the plainest possible public notice, which is the story taken to its logical end.',
            fonts: {
              heading: 'public-sans',
            },
          },
        ],
      },
      nameplate: {
        label: 'Nameplate treatment',
        prompt: 'The letterhead.',
        default: 'institutional-letterhead',
        choices: [
          {
            id: 'institutional-letterhead',
            label: 'Institutional letterhead',
            why: 'The top of an official document. The organisation line sits below the name, never above it.',
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-meta-placement': 'block',
              '--nameplate-rule-width': 'var(--rule-hairline-width)',
            },
          },
          {
            id: 'two-part-lockup',
            label: 'Two-part lockup',
            why: 'The co-signed notice of a partnership, which is the common Civic case: logo slot left, event name and dates right, divided by a vertical hairline.',
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-meta-placement': 'inline',
              '--nameplate-frame-width': 'var(--rule-hairline-width)',
            },
          },
          {
            id: 'compact-standing-head',
            label: 'Compact standing head',
            why: 'For inner pages, where the reader wants the content and not the letterhead again.',
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-size': 'var(--text-h1)',
              '--nameplate-meta-placement': 'inline',
            },
          },
        ],
      },
      component: {
        label: 'Schedule presentation',
        prompt: 'How the agenda is posted.',
        default: 'posted-agenda',
        choices: [
          {
            id: 'posted-agenda',
            label: 'Posted agenda',
            why: 'Hairline rows, fixed column order, tabular figures. The list is first-class at every width.',
            tokens: {
              '--schedule-number-display': 'none',
              '--schedule-row-leading': 'var(--text-body-leading)',
            },
          },
          {
            id: 'numbered-agenda',
            label: 'Numbered agenda',
            why: 'The numbers are content, not decoration, and they are never zero-padded, so this matches how a formal programme is published.',
            tokens: {
              '--schedule-number-display': 'inline',
              '--schedule-row-leading': 'var(--text-body-leading)',
            },
          },
        ],
      },
    },
  },
  'field-guide': {
    id: 'field-guide',
    label: 'Field Guide',
    tier: 'experimental',
    summary: 'A naturalist\'s expedition handbook. Plates, specimen labels, and observation notes, with the linework carrying the character.',
    palette: {
      light: {
        surface: [247, 243, 234],
        surfaceAlt: [240, 235, 223],
        ink: [42, 33, 25],
        inkMuted: [102, 90, 74],
        primary: [43, 86, 54],
        primaryDark: [27, 60, 37],
        primaryLight: [140, 172, 136],
        accent: [136, 72, 40],
        success: [34, 88, 52],
        warning: [140, 86, 12],
        danger: [158, 44, 36],
        highlight: [124, 92, 18],
        keynote: [86, 60, 124],
      },
      dark: {
        surface: [26, 30, 26],
        surfaceAlt: [38, 43, 37],
        ink: [237, 232, 220],
        inkMuted: [170, 168, 150],
        primary: [142, 192, 142],
        primaryDark: [180, 216, 176],
        primaryLight: [64, 94, 64],
        accent: [216, 152, 112],
        success: [130, 200, 144],
        warning: [228, 178, 96],
        danger: [238, 142, 128],
        highlight: [220, 192, 118],
        keynote: [186, 168, 232],
      },
    },
    fonts: {
      heading: 'besley',
      body: 'vollkorn',
      data: 'plex-mono',
      mono: 'plex-mono',
    },
    shape: {
      radius: 'sharp',
      texture: 'paper',
      density: 'comfortable',
    },
    motifSet: 'botanical',
    tokens: {
      '--plate-frame-width': 'var(--rule-hairline-width)',
      '--plate-pad': 'var(--space-md)',
      '--plate-number-display': 'inline',
      '--specimen-label-rule-width': 'var(--rule-hairline-width)',
      '--specimen-label-pad': 'var(--space-2xs)',
      '--specimen-label-key-display': 'inline',
      '--folio-font': 'var(--font-data)',
      '--marginalia-display': 'none',
    },
    options: {
      headingFace: {
        label: 'Heading face',
        prompt: 'The plate caption. Body stays Vollkorn and data stays IBM Plex Mono under every option.',
        default: 'besley',
        choices: [
          {
            id: 'besley',
            label: 'Besley',
            why: 'The printed plate caption. Its Clarendon weight holds a title page and still sits calmly under a drawing, which is the core Field Guide relationship.',
            fonts: {
              heading: 'besley',
            },
          },
          {
            id: 'vollkorn-display',
            label: 'Vollkorn bold at display size',
            why: 'The one-face volume: a pocket handbook rather than a plate book, quieter and closer to the reading, and it adds nothing to the font budget.',
            fonts: {
              heading: 'vollkorn',
            },
          },
          {
            id: 'spectral',
            label: 'Spectral semibold',
            why: 'The collector\'s volume. Its finer, sharper serifs read as the frontispiece of a formal edition, so the story gains a more scholarly opening.',
            fonts: {
              heading: 'spectral',
            },
          },
        ],
      },
      nameplate: {
        label: 'Nameplate treatment',
        prompt: 'The title page.',
        default: 'framed-title-page',
        choices: [
          {
            id: 'framed-title-page',
            label: 'Framed title page',
            why: 'Name and dates inside a hairline frame with the nameplate-mark motif above the name. The opening plate of the handbook.',
            tokens: {
              '--nameplate-align': 'center',
              '--nameplate-frame-width': 'var(--rule-hairline-width)',
              '--nameplate-meta-placement': 'block',
            },
          },
          {
            id: 'plate-and-label',
            label: 'Plate and label',
            why: 'It states the book\'s subject the way a frontispiece plate does, and the plate stays drawn linework, never a photo.',
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-frame-width': '0',
              '--nameplate-meta-placement': 'inline',
              '--plate-frame-width': 'var(--rule-strong-width)',
            },
          },
          {
            id: 'ruled-title-no-frame',
            label: 'Ruled title, no frame',
            why: 'The title page of a cheaper printing of the same book; quieter, and better for text-heavy events.',
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-frame-width': '0',
              '--nameplate-rule-top-width': 'var(--rule-hairline-width)',
              '--nameplate-meta-placement': 'block',
            },
          },
        ],
      },
      component: {
        label: 'Session presentation',
        prompt: 'How a session is labelled.',
        default: 'specimen-label',
        choices: [
          {
            id: 'specimen-label',
            label: 'Specimen label',
            why: 'A small ruled block: name, date, place. The collection tag.',
            tokens: {
              '--session-card-rule-width': 'var(--rule-hairline-width)',
              '--session-card-pad-block': 'var(--space-sm)',
            },
          },
          {
            id: 'field-notes-column',
            label: 'Field notes column',
            why: 'The observation notebook rather than the mounted collection; it suits a single-track event where the day reads as one sitting.',
            tokens: {
              '--session-card-rule-width': 'var(--rule-hairline-width)',
              '--session-card-pad-block': 'var(--space-xs)',
              '--schedule-row-leading': '1.4',
            },
          },
        ],
      },
      marginalia: {
        label: 'Pencil line',
        prompt: 'The one piece of marginalia this theme allows. Its own control, so a client can keep the plates clean.',
        default: 'off',
        choices: [
          {
            id: 'off',
            label: 'Off',
            why: 'The plates stay clean. This is the default, because a field notebook is written by someone being careful.',
            tokens: {
              '--marginalia-display': 'none',
            },
          },
          {
            id: 'on',
            label: 'On',
            why: 'A thin hand-drawn underline under a specimen label or a note line: a pencil mark in a notebook, never a highlighter.',
            tokens: {
              '--marginalia-display': 'inline',
            },
          },
        ],
      },
    },
  },
  atlas: {
    id: 'atlas',
    label: 'Atlas',
    tier: 'experimental',
    summary: 'A mapped city on its transit network. A survey sheet and a departure board at once: lines, stations, transfers.',
    palette: {
      light: {
        surface: [245, 247, 247],
        surfaceAlt: [234, 238, 239],
        ink: [20, 26, 30],
        inkMuted: [84, 94, 100],
        primary: [180, 38, 34],
        primaryDark: [142, 26, 24],
        primaryLight: [226, 148, 144],
        accent: [34, 88, 122],
        success: [20, 92, 66],
        warning: [130, 78, 8],
        danger: [168, 30, 34],
        highlight: [118, 86, 12],
        keynote: [72, 54, 138],
      },
      dark: {
        surface: [22, 27, 32],
        surfaceAlt: [33, 40, 46],
        ink: [231, 238, 242],
        inkMuted: [154, 168, 178],
        primary: [244, 122, 112],
        primaryDark: [250, 166, 158],
        primaryLight: [118, 46, 42],
        accent: [124, 178, 216],
        success: [116, 202, 158],
        warning: [230, 178, 92],
        danger: [244, 138, 138],
        highlight: [224, 192, 112],
        keynote: [182, 166, 244],
      },
    },
    fonts: {
      heading: 'overpass',
      body: 'libre-franklin',
      data: 'overpass-mono',
      mono: 'overpass-mono',
    },
    shape: {
      radius: 'sharp',
      texture: 'flat',
      density: 'tight',
    },
    motifSet: 'cartographic',
    tokens: {
      '--map-grid-size': 'var(--space-xl)',
      '--transfer-line-display': 'block',
      '--route-mark-radius': 'var(--radius-base)',
      '--session-card-pad-block': 'var(--space-xs)',
      '--folio-font': 'var(--font-data)',
      '--section-rule-width': 'var(--rule-strong-width)',
    },
    options: {
      headingFace: {
        label: 'Heading face',
        prompt: 'The sign face. Body stays Libre Franklin and data stays Overpass Mono under every option. Every option must hold at nameplate size, at the h3 step, and inside a route mark.',
        default: 'overpass',
        choices: [
          {
            id: 'overpass',
            label: 'Overpass',
            why: 'The highway sign. It is drawn from road lettering, so route marks, station names, and transfer lines all speak in the voice the story needs.',
            fonts: {
              heading: 'overpass',
            },
          },
          {
            id: 'libre-franklin-extrabold',
            label: 'Libre Franklin extrabold',
            why: 'Franklin Gothic set American transit and news signage for a century, so running the body face up to heading size keeps the system whole and costs nothing extra.',
            fonts: {
              heading: 'libre-franklin',
            },
          },
          {
            id: 'archivo-condensed',
            label: 'Archivo Condensed',
            why: 'Sheet space is scarce on a real map, and condensed headings pull the page toward the drawn sheet, which suits a dense multi-venue programme.',
            fonts: {
              heading: 'archivo-condensed',
            },
          },
        ],
      },
      nameplate: {
        label: 'Nameplate treatment',
        prompt: 'The title block.',
        default: 'corner-title-block',
        choices: [
          {
            id: 'corner-title-block',
            label: 'Corner title block',
            why: 'Hairline frame, coordinate marks at two corners, city and date range below, schematic line-diagram divider under it. The corner of a survey sheet that carries a network.',
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-frame-width': 'var(--rule-hairline-width)',
              '--nameplate-corner-mark-width': 'var(--rule-hairline-width)',
              '--nameplate-meta-placement': 'block',
            },
          },
          {
            id: 'sheet-header-scale-line',
            label: 'Sheet header with a scale line',
            why: 'A scale bar states an extent, which is what a date span is, so the device stays honest.',
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-frame-width': '0',
              '--nameplate-meta-placement': 'inline',
              '--nameplate-rule-width': 'var(--rule-hairline-width)',
            },
          },
          {
            id: 'departure-board-header',
            label: 'Departure board header',
            why: 'The concourse board rather than the sheet, for events whose story is movement more than geography. The line updates on load and on user action only.',
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-frame-width': '0',
              '--nameplate-rule-width': 'var(--rule-strong-width)',
              '--nameplate-meta-placement': 'block',
            },
          },
        ],
      },
      component: {
        label: 'Schedule presentation',
        prompt: 'How the board is drawn.',
        default: 'departure-board',
        choices: [
          {
            id: 'departure-board',
            label: 'Departure board',
            why: 'Time down, lettered lines across, faint map grid behind, traced-line signature interaction. The theme\'s clearest idea.',
            tokens: {
              '--map-grid-size': 'var(--space-xl)',
              '--schedule-data-size': 'var(--text-caption)',
            },
          },
          {
            id: 'line-diagram',
            label: 'Line diagram',
            why: 'The strip map inside a carriage: one line at a time as a Beck-style vertical run, which serves a visitor following one track all day.',
            tokens: {
              '--map-grid-size': '0',
              '--schedule-data-size': 'var(--text-caption)',
              '--schedule-row-leading': '1.5',
            },
          },
          {
            id: 'gazetteer-list',
            label: 'Gazetteer list',
            why: 'A gazetteer indexes a map by place, which serves a visitor choosing where to stand rather than where to go.',
            tokens: {
              '--map-grid-size': '0',
              '--schedule-data-size': 'var(--text-folio)',
              '--schedule-row-leading': 'var(--text-body-leading)',
            },
          },
        ],
      },
    },
  },
});

const ADMIN_TOKENS = Object.freeze({
  colors: {
    '--admin-ground-rgb': {
      light: [234, 232, 227],
      dark: [31, 30, 28],
    },
    '--admin-ground-raised-rgb': {
      light: [243, 241, 237],
      dark: [43, 42, 39],
    },
    '--admin-ground-proof-rgb': {
      light: [234, 223, 194],
      dark: [56, 49, 32],
    },
    '--admin-ground-input-rgb': {
      light: [251, 250, 247],
      dark: [23, 22, 21],
    },
    '--admin-ground-alarm-rgb': {
      light: [246, 231, 228],
      dark: [56, 31, 29],
    },
    '--admin-ink-rgb': {
      light: [28, 27, 25],
      dark: [236, 231, 222],
    },
    '--admin-ink-secondary-rgb': {
      light: [82, 79, 74],
      dark: [173, 168, 158],
    },
    '--admin-ink-data-rgb': {
      light: [56, 54, 50],
      dark: [201, 196, 186],
    },
    '--admin-ink-inverse-rgb': {
      light: [246, 244, 240],
      dark: [24, 23, 22],
    },
    '--admin-ink-disabled-rgb': {
      light: [98, 95, 89],
      dark: [150, 145, 136],
    },
    '--admin-ink-link-rgb': {
      light: [26, 70, 126],
      dark: [142, 182, 234],
    },
    '--admin-rule-hairline-rgb': {
      light: [204, 200, 192],
      dark: [63, 61, 57],
    },
    '--admin-rule-strong-rgb': {
      light: [136, 131, 122],
      dark: [114, 110, 102],
    },
    '--admin-rule-header-rgb': {
      light: [92, 88, 81],
      dark: [158, 153, 144],
    },
    '--admin-rule-alarm-rgb': {
      light: [166, 74, 62],
      dark: [186, 100, 90],
    },
    '--admin-state-live-rgb': {
      light: [24, 88, 56],
      dark: [122, 198, 148],
    },
    '--admin-state-draft-rgb': {
      light: [112, 74, 8],
      dark: [228, 178, 94],
    },
    '--admin-state-error-rgb': {
      light: [150, 28, 32],
      dark: [246, 142, 140],
    },
    '--admin-state-caution-rgb': {
      light: [118, 76, 8],
      dark: [232, 182, 96],
    },
    '--admin-state-ok-rgb': {
      light: [24, 88, 56],
      dark: [122, 198, 148],
    },
    '--admin-focus-ring-rgb': {
      light: [26, 66, 116],
      dark: [130, 180, 236],
    },
    '--admin-client-accent-ink-rgb': {
      light: [246, 244, 240],
      dark: [24, 23, 22],
    },
  },
  aliases: {
    '--admin-client-accent-rgb': '--admin-ink-rgb',
  },
  components: {
    '--admin-nav-active-marker-rgb': '--admin-client-accent-rgb',
    '--admin-page-header-mark-rgb': '--admin-client-accent-rgb',
  },
  scalars: {
    '--admin-rule-hairline-width': 'var(--er-width-hairline)',
    '--admin-rule-strong-width': 'var(--er-width-strong)',
    '--admin-rule-header-width': 'var(--er-width-nameplate)',
    '--admin-rule-alarm-width': 'var(--er-width-strong)',
    '--admin-focus-offset': '2px',
    '--admin-radius': '2px',
    '--admin-nav-active-marker-width': 'var(--er-width-strong)',
  },
  fonts: {
    '--admin-font-ui': 'sans-humanist',
    '--admin-font-data': 'plex-mono',
  },
});

const MOTIF_SET_IDS = Object.freeze([
  'none',
  'botanical',
  'fauna',
  'cartographic',
]);

module.exports = { PRESETS, ADMIN_TOKENS, MOTIF_SET_IDS };
