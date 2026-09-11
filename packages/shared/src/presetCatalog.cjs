'use strict';

/**
 * GENERATED FILE — do not edit by hand.
 *
 * RENDERING VALUES ONLY. Palettes, type maps, shape, the motif default,
 * token remaps, and the option ids and defaults — everything the one
 * resolver and the config validator read, and nothing a human reads.
 * The style names and the reasons behind each curated choice are copy:
 * they live in `apps/web/src/admin/presetCopy.js`, which rides the admin
 * chunk, and the design prose lives in
 * `design/tokens/presets/README.md`. This file is the only one of the
 * three that ships to Cloud Functions, where prose could never be read.
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
  civic: {
    id: 'civic',
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
      '--hero-art-width': '58%',
      '--hero-art-position': '80% 50%',
      '--hero-title-size': 'clamp(2.5rem, 5vw, 5rem)',
      '--hero-title-tracking': '-.035em',
    },
    options: {
      headingFace: {
        default: 'merriweather',
        choices: [
          {
            id: 'merriweather',
            fonts: {
              heading: 'merriweather',
            },
          },
          {
            id: 'source-serif-4',
            fonts: {
              heading: 'serif-editorial',
            },
          },
          {
            id: 'public-sans-bold',
            fonts: {
              heading: 'public-sans',
            },
          },
        ],
      },
      nameplate: {
        default: 'institutional-letterhead',
        choices: [
          {
            id: 'institutional-letterhead',
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-meta-placement': 'block',
              '--nameplate-rule-width': 'var(--rule-hairline-width)',
            },
          },
          {
            id: 'two-part-lockup',
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-meta-placement': 'inline',
              '--nameplate-frame-width': 'var(--rule-hairline-width)',
            },
          },
          {
            id: 'compact-standing-head',
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-size': 'var(--text-h1)',
              '--nameplate-meta-placement': 'inline',
            },
          },
        ],
      },
      component: {
        default: 'posted-agenda',
        choices: [
          {
            id: 'posted-agenda',
            tokens: {
              '--schedule-number-display': 'none',
              '--schedule-row-leading': 'var(--text-body-leading)',
            },
          },
          {
            id: 'numbered-agenda',
            tokens: {
              '--schedule-number-display': 'inline',
              '--schedule-row-leading': 'var(--text-body-leading)',
            },
          },
        ],
      },
    },
  },
  newsroom: {
    id: 'newsroom',
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
      '--hero-art-width': '56%',
      '--hero-copy-pad-inline-start': 'var(--space-md)',
      '--hero-copy-border-inline-start': '.35rem solid rgb(var(--color-accent-rgb))',
      '--hero-veil-background': 'linear-gradient(90deg, rgb(var(--color-surface-rgb)) 38%, rgb(var(--color-surface-rgb) / .95) 45%, rgb(var(--color-surface-rgb) / 0) 67%)',
    },
    options: {
      headingFace: {
        default: 'fraunces',
        choices: [
          {
            id: 'fraunces',
            fonts: {
              heading: 'fraunces',
            },
          },
          {
            id: 'newsreader-display',
            fonts: {
              heading: 'newsreader',
            },
          },
          {
            id: 'archivo-condensed',
            fonts: {
              heading: 'archivo-condensed',
            },
          },
        ],
      },
      nameplate: {
        default: 'rule-bounded-bar',
        choices: [
          {
            id: 'rule-bounded-bar',
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-rule-width': 'var(--rule-strong-width)',
              '--nameplate-meta-placement': 'inline',
            },
          },
          {
            id: 'stacked-with-deck',
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-rule-width': 'var(--rule-hairline-width)',
              '--nameplate-meta-placement': 'block',
              '--nameplate-gap': 'var(--space-xs)',
            },
          },
          {
            id: 'section-aware-bar',
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
        default: 'hairline-row',
        choices: [
          {
            id: 'hairline-row',
            tokens: {
              '--session-card-lead-scale': '1',
              '--session-card-rule-width': 'var(--rule-hairline-width)',
            },
          },
          {
            id: 'lead-and-rest',
            tokens: {
              '--session-card-lead-scale': '1.35',
              '--session-card-rule-width': 'var(--rule-hairline-width)',
            },
          },
        ],
      },
    },
  },
  broadsheet: {
    id: 'broadsheet',
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
      '--hero-rule-block-start': 'var(--rule-strong-width) double rgb(var(--rule-strong-rgb))',
      '--hero-art-width': '75%',
      '--hero-art-position': '85% 50%',
      '--hero-title-style': 'normal',
      '--hero-title-tracking': '-.055em',
    },
    options: {
      headingFace: {
        default: 'libre-caslon-display',
        choices: [
          {
            id: 'libre-caslon-display',
            fonts: {
              heading: 'caslon-display',
            },
          },
          {
            id: 'libre-baskerville',
            fonts: {
              heading: 'baskerville',
            },
          },
          {
            id: 'spectral',
            fonts: {
              heading: 'spectral',
            },
          },
        ],
      },
      nameplate: {
        default: 'full-measure',
        choices: [
          {
            id: 'full-measure',
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-rule-top-width': '0',
              '--nameplate-meta-placement': 'block',
            },
          },
          {
            id: 'centred-double-rule',
            tokens: {
              '--nameplate-align': 'center',
              '--nameplate-rule-top-width': 'var(--rule-hairline-width)',
              '--nameplate-meta-placement': 'inline',
            },
          },
          {
            id: 'compact-standing-edition',
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
        default: 'ruled-programme',
        choices: [
          {
            id: 'ruled-programme',
            tokens: {
              '--schedule-row-leading': 'var(--text-body-leading)',
              '--schedule-data-size': 'var(--text-caption)',
            },
          },
          {
            id: 'agate-block',
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
  atlas: {
    id: 'atlas',
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
      '--schedule-trace-width': 'var(--rule-strong-width)',
      '--route-mark-radius': 'var(--radius-base)',
      '--session-card-pad-block': 'var(--space-xs)',
      '--folio-font': 'var(--font-data)',
      '--section-rule-width': 'var(--rule-strong-width)',
      '--hero-art-width': '100%',
      '--hero-art-position': 'center',
      '--hero-veil-background': 'linear-gradient(90deg, rgb(var(--color-surface-rgb) / .98), rgb(var(--color-surface-rgb) / .88) 38%, rgb(var(--color-surface-rgb) / 0) 72%)',
      '--hero-copy-pad-block-end': '6.5rem',
      '--hero-route-display': 'block',
      '--hero-route-color': 'rgb(255 212 59)',
      '--hero-sign-display': 'flex',
      '--schedule-days-gap': 'var(--space-xs)',
      '--schedule-days-border-block-end': '0',
      '--schedule-day-min-inline-size': '7rem',
      '--schedule-day-pad-inline': 'var(--space-md)',
      '--schedule-day-border': 'var(--rule-hairline-width) solid rgb(var(--rule-hairline-rgb))',
      '--schedule-day-border-block-end': 'var(--rule-hairline-width) solid rgb(var(--rule-hairline-rgb))',
      '--schedule-day-radius': 'var(--space-xs) var(--space-xs) 0 0',
      '--schedule-day-background': 'rgb(var(--color-surface-alt-rgb))',
      '--schedule-day-active-color': 'rgb(var(--color-surface-rgb))',
      '--schedule-day-active-background': 'rgb(var(--color-text-primary-rgb))',
      '--schedule-day-active-border-color': 'rgb(var(--color-text-primary-rgb))',
      '--schedule-route-pad-inline-start': 'var(--space-lg)',
      '--schedule-route-line-width': '2px',
      '--schedule-route-stop-size': '12px',
      '--schedule-route-stop-border-width': '3px',
    },
    options: {
      headingFace: {
        default: 'overpass',
        choices: [
          {
            id: 'overpass',
            fonts: {
              heading: 'overpass',
            },
          },
          {
            id: 'libre-franklin-extrabold',
            fonts: {
              heading: 'libre-franklin',
            },
          },
          {
            id: 'archivo-condensed',
            fonts: {
              heading: 'archivo-condensed',
            },
          },
        ],
      },
      nameplate: {
        default: 'corner-title-block',
        choices: [
          {
            id: 'corner-title-block',
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-frame-width': 'var(--rule-hairline-width)',
              '--nameplate-corner-mark-width': 'var(--rule-hairline-width)',
              '--nameplate-meta-placement': 'block',
            },
          },
          {
            id: 'sheet-header-scale-line',
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-frame-width': '0',
              '--nameplate-meta-placement': 'inline',
              '--nameplate-rule-width': 'var(--rule-hairline-width)',
            },
          },
          {
            id: 'departure-board-header',
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
        default: 'departure-board',
        choices: [
          {
            id: 'departure-board',
            tokens: {
              '--map-grid-size': 'var(--space-xl)',
              '--schedule-data-size': 'var(--text-caption)',
            },
          },
          {
            id: 'line-diagram',
            tokens: {
              '--map-grid-size': '0',
              '--schedule-data-size': 'var(--text-caption)',
              '--schedule-row-leading': '1.5',
            },
          },
          {
            id: 'gazetteer-list',
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
  'field-guide': {
    id: 'field-guide',
    palette: {
      light: {
        surface: [248, 247, 244],
        surfaceAlt: [241, 240, 236],
        ink: [38, 35, 31],
        inkMuted: [96, 91, 84],
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
        surface: [28, 28, 27],
        surfaceAlt: [40, 40, 38],
        ink: [235, 233, 228],
        inkMuted: [172, 170, 164],
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
      texture: 'flat',
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
      '--hero-art-width': '67%',
      '--hero-art-position': '75% 45%',
      '--hero-title-style': 'italic',
      '--hero-title-weight': 'var(--weight-semibold)',
    },
    options: {
      headingFace: {
        default: 'besley',
        choices: [
          {
            id: 'besley',
            fonts: {
              heading: 'besley',
            },
          },
          {
            id: 'vollkorn-display',
            fonts: {
              heading: 'vollkorn',
            },
          },
          {
            id: 'spectral',
            fonts: {
              heading: 'spectral',
            },
          },
        ],
      },
      nameplate: {
        default: 'framed-title-page',
        choices: [
          {
            id: 'framed-title-page',
            tokens: {
              '--nameplate-align': 'center',
              '--nameplate-frame-width': 'var(--rule-hairline-width)',
              '--nameplate-meta-placement': 'block',
            },
          },
          {
            id: 'ruled-title-no-frame',
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-frame-width': '0',
              '--nameplate-rule-top-width': 'var(--rule-hairline-width)',
              '--nameplate-meta-placement': 'block',
            },
          },
          {
            id: 'plate-and-label',
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-frame-width': '0',
              '--nameplate-meta-placement': 'inline',
              '--plate-frame-width': 'var(--rule-strong-width)',
            },
          },
        ],
      },
      component: {
        default: 'specimen-label',
        choices: [
          {
            id: 'specimen-label',
            tokens: {
              '--session-card-rule-width': 'var(--rule-hairline-width)',
              '--session-card-pad-block': 'var(--space-sm)',
            },
          },
          {
            id: 'field-notes-column',
            tokens: {
              '--session-card-rule-width': 'var(--rule-hairline-width)',
              '--session-card-pad-block': 'var(--space-xs)',
              '--schedule-row-leading': '1.4',
            },
          },
        ],
      },
      marginalia: {
        default: 'off',
        choices: [
          {
            id: 'off',
            tokens: {
              '--marginalia-display': 'none',
            },
          },
          {
            id: 'on',
            tokens: {
              '--marginalia-display': 'inline',
            },
          },
        ],
      },
    },
  },
  zine: {
    id: 'zine',
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
      body: 'sans-humanist',
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
      '--hero-art-width': '64%',
      '--hero-title-size': 'clamp(2.8rem, 6vw, 6rem)',
      '--hero-title-tracking': '-.06em',
      '--hero-title-transform': 'uppercase',
      '--hero-press-display': 'block',
    },
    options: {
      headingFace: {
        default: 'karrik',
        choices: [
          {
            id: 'karrik',
            fonts: {
              heading: 'karrik',
            },
          },
          {
            id: 'bagnard',
            fonts: {
              heading: 'bagnard',
            },
          },
          {
            id: 'avara',
            fonts: {
              heading: 'avara',
            },
          },
        ],
      },
      nameplate: {
        default: 'full-sheet',
        choices: [
          {
            id: 'full-sheet',
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-rule-width': 'var(--rule-nameplate-width)',
              '--nameplate-frame-width': '0',
            },
          },
          {
            id: 'stacked-block',
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-leading': '0.86',
              '--nameplate-frame-width': '0',
            },
          },
          {
            id: 'boxed-bill',
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-frame-width': 'var(--rule-strong-width)',
              '--nameplate-meta-placement': 'block',
            },
          },
        ],
      },
      component: {
        default: 'flat-block',
        choices: [
          {
            id: 'flat-block',
            tokens: {
              '--session-card-stamp-offset': '0',
              '--folio-rule-top-width': '0',
            },
          },
          {
            id: 'stamped-block',
            tokens: {
              '--session-card-stamp-offset': '4px',
              '--session-card-stamp-alpha': '0.55',
              '--folio-rule-top-width': '0',
            },
          },
          {
            id: 'struck-folio',
            tokens: {
              '--session-card-stamp-offset': '0',
              '--folio-rule-top-width': 'var(--rule-strong-width)',
              '--folio-font': 'var(--font-mono)',
            },
          },
        ],
      },
      marginalia: {
        default: 'off',
        choices: [
          {
            id: 'off',
            tokens: {
              '--marginalia-display': 'none',
            },
          },
          {
            id: 'on',
            tokens: {
              '--marginalia-display': 'inline',
            },
          },
        ],
      },
    },
  },
});

const COMPONENT_TOKEN_DEFAULTS = Object.freeze({
  '--session-card-rule-width': 'var(--rule-hairline-width)',
  '--session-card-stamp-offset': '0',
  '--session-card-stamp-alpha': '1',
  '--session-card-lead-scale': '1',
  '--session-card-pad-block': 'var(--space-md)',
  '--nameplate-rule-width': 'var(--rule-nameplate-width)',
  '--nameplate-rule-top-width': '0',
  '--nameplate-frame-width': '0',
  '--nameplate-corner-mark-width': '0',
  '--nameplate-align': 'start',
  '--nameplate-meta-placement': 'block',
  '--nameplate-size': 'var(--text-nameplate)',
  '--nameplate-leading': 'var(--text-nameplate-leading)',
  '--nameplate-gap': 'var(--space-sm)',
  '--hero-rule-block-start': 'var(--rule-hairline-width) solid rgb(var(--rule-hairline-rgb))',
  '--hero-art-width': '70%',
  '--hero-art-position': '70% 50%',
  '--hero-veil-background': 'linear-gradient(90deg, rgb(var(--color-surface-rgb)) 0%, rgb(var(--color-surface-rgb)) 35%, rgb(var(--color-surface-rgb) / .92) 43%, rgb(var(--color-surface-rgb) / 0) 73%)',
  '--hero-copy-pad-inline-start': '0',
  '--hero-copy-border-inline-start': '0 solid transparent',
  '--hero-copy-pad-block-end': 'var(--space-2xl)',
  '--hero-title-size': 'clamp(2.7rem, 5.8vw, 5.75rem)',
  '--hero-title-style': 'normal',
  '--hero-title-weight': 'var(--weight-bold)',
  '--hero-title-tracking': '-.045em',
  '--hero-title-transform': 'none',
  '--hero-route-display': 'none',
  '--hero-route-color': 'rgb(var(--color-accent-rgb))',
  '--hero-sign-display': 'none',
  '--hero-press-display': 'none',
  '--section-rule-width': 'var(--rule-strong-width)',
  '--folio-rule-width': 'var(--rule-hairline-width)',
  '--folio-rule-top-width': '0',
  '--folio-font': 'var(--font-data)',
  '--schedule-row-leading': 'var(--text-body-leading)',
  '--schedule-data-size': 'var(--text-caption)',
  '--schedule-number-display': 'none',
  '--schedule-trace-width': '0',
  '--schedule-days-gap': '0 var(--space-md)',
  '--schedule-days-border-block-end': 'var(--rule-hairline-width) solid rgb(var(--rule-hairline-rgb))',
  '--schedule-day-min-inline-size': '2.75rem',
  '--schedule-day-pad-inline': 'var(--space-2xs)',
  '--schedule-day-border': '0 solid transparent',
  '--schedule-day-border-block-end': 'var(--rule-strong-width) solid transparent',
  '--schedule-day-radius': '0',
  '--schedule-day-background': 'transparent',
  '--schedule-day-active-color': 'rgb(var(--color-text-primary-rgb))',
  '--schedule-day-active-background': 'transparent',
  '--schedule-day-active-border-color': 'rgb(var(--rule-strong-rgb))',
  '--schedule-route-pad-inline-start': '0',
  '--schedule-route-line-width': '0',
  '--schedule-route-stop-size': '0',
  '--schedule-route-stop-border-width': '0',
  '--plate-frame-width': '0',
  '--plate-pad': '0',
  '--plate-number-display': 'none',
  '--specimen-label-rule-width': '0',
  '--specimen-label-pad': '0',
  '--specimen-label-key-display': 'none',
  '--map-grid-size': '0',
  '--route-mark-radius': '0',
  '--callout-font': 'var(--font-heading)',
  '--callout-angle': '0deg',
  '--marginalia-display': 'none',
});

const ADMIN_TOKENS = Object.freeze({
  colors: {
    '--admin-ground-rgb': {
      light: [244, 246, 249],
      dark: [24, 27, 33],
    },
    '--admin-ground-raised-rgb': {
      light: [255, 255, 255],
      dark: [32, 36, 44],
    },
    '--admin-ground-soft-rgb': {
      light: [234, 240, 247],
      dark: [42, 48, 58],
    },
    '--admin-ground-proof-rgb': {
      light: [255, 245, 221],
      dark: [54, 46, 28],
    },
    '--admin-ground-input-rgb': {
      light: [255, 255, 255],
      dark: [26, 30, 37],
    },
    '--admin-ground-alarm-rgb': {
      light: [255, 240, 243],
      dark: [58, 30, 34],
    },
    '--admin-ground-ok-rgb': {
      light: [231, 247, 238],
      dark: [26, 52, 40],
    },
    '--admin-ground-info-rgb': {
      light: [237, 245, 255],
      dark: [30, 44, 66],
    },
    '--admin-ink-rgb': {
      light: [19, 34, 59],
      dark: [236, 239, 244],
    },
    '--admin-ink-secondary-rgb': {
      light: [52, 71, 100],
      dark: [186, 196, 210],
    },
    '--admin-ink-data-rgb': {
      light: [82, 101, 129],
      dark: [200, 208, 220],
    },
    '--admin-ink-inverse-rgb': {
      light: [255, 255, 255],
      dark: [17, 21, 28],
    },
    '--admin-ink-disabled-rgb': {
      light: [90, 104, 125],
      dark: [150, 160, 176],
    },
    '--admin-ink-link-rgb': {
      light: [23, 61, 166],
      dark: [142, 182, 234],
    },
    '--admin-rule-hairline-rgb': {
      light: [220, 228, 239],
      dark: [52, 58, 70],
    },
    '--admin-rule-strong-rgb': {
      light: [122, 139, 164],
      dark: [128, 142, 164],
    },
    '--admin-rule-control-rgb': {
      light: [124, 141, 166],
      dark: [134, 148, 170],
    },
    '--admin-rule-header-rgb': {
      light: [124, 141, 166],
      dark: [134, 148, 170],
    },
    '--admin-rule-alarm-rgb': {
      light: [196, 90, 112],
      dark: [232, 120, 136],
    },
    '--admin-state-live-rgb': {
      light: [8, 100, 65],
      dark: [122, 198, 148],
    },
    '--admin-state-draft-rgb': {
      light: [128, 83, 11],
      dark: [228, 178, 94],
    },
    '--admin-state-error-rgb': {
      light: [173, 37, 61],
      dark: [246, 142, 140],
    },
    '--admin-state-caution-rgb': {
      light: [128, 83, 11],
      dark: [232, 182, 96],
    },
    '--admin-state-ok-rgb': {
      light: [8, 100, 65],
      dark: [122, 198, 148],
    },
    '--admin-state-info-rgb': {
      light: [36, 82, 142],
      dark: [142, 182, 234],
    },
    '--admin-action-rgb': {
      light: [29, 78, 166],
      dark: [92, 148, 224],
    },
    '--admin-action-hover-rgb': {
      light: [23, 63, 138],
      dark: [120, 168, 236],
    },
    '--admin-action-pressed-rgb': {
      light: [18, 50, 112],
      dark: [72, 128, 204],
    },
    '--admin-action-soft-rgb': {
      light: [232, 239, 252],
      dark: [30, 44, 66],
    },
    '--admin-action-soft-hover-rgb': {
      light: [217, 229, 250],
      dark: [38, 56, 84],
    },
    '--admin-focus-ring-rgb': {
      light: [29, 78, 166],
      dark: [130, 180, 236],
    },
    '--admin-focus-ring-rail-rgb': {
      light: [183, 206, 255],
      dark: [196, 214, 255],
    },
    '--admin-rail-ground-rgb': {
      light: [17, 29, 48],
      dark: [12, 16, 24],
    },
    '--admin-rail-ground-raised-rgb': {
      light: [30, 45, 70],
      dark: [30, 38, 54],
    },
    '--admin-rail-ground-hover-rgb': {
      light: [38, 55, 84],
      dark: [36, 46, 64],
    },
    '--admin-rail-current-rgb': {
      light: [29, 78, 166],
      dark: [52, 104, 182],
    },
    '--admin-rail-ink-rgb': {
      light: [244, 247, 252],
      dark: [240, 244, 250],
    },
    '--admin-rail-ink-muted-rgb': {
      light: [180, 194, 216],
      dark: [170, 184, 206],
    },
    '--admin-rail-rule-rgb': {
      light: [54, 72, 102],
      dark: [48, 58, 78],
    },
    '--admin-client-accent-ink-rgb': {
      light: [255, 255, 255],
      dark: [17, 21, 28],
    },
  },
  aliases: {
    '--admin-client-accent-rgb': '--admin-ink-rgb',
  },
  components: {
    '--admin-nav-active-marker-rgb': '--admin-rail-ink-rgb',
    '--admin-page-header-mark-rgb': '--admin-client-accent-rgb',
  },
  scalars: {
    '--admin-rule-hairline-width': 'var(--er-width-hairline)',
    '--admin-rule-strong-width': 'var(--er-width-hairline)',
    '--admin-rule-header-width': 'var(--er-width-hairline)',
    '--admin-rule-alarm-width': 'var(--er-width-hairline)',
    '--admin-focus-width': '3px',
    '--admin-focus-offset': '2px',
    '--admin-radius': '6px',
    '--admin-radius-panel': '10px',
    '--admin-radius-small': '4px',
    '--admin-nav-active-marker-width': 'var(--er-width-nameplate)',
    '--admin-control-height': '2.75rem',
    '--admin-rail-width': '14.5rem',
    '--admin-canvas-max': '96rem',
    '--admin-text-xs': '0.8125rem',
    '--admin-text-sm': '0.875rem',
    '--admin-text-base': '0.9375rem',
    '--admin-text-lg': '1.125rem',
    '--admin-text-xl': '1.375rem',
    '--admin-text-title': 'clamp(1.625rem, 2.2vw, 2rem)',
    '--admin-leading-copy': '1.5',
    '--admin-leading-tight': '1.2',
    '--admin-tracking-title': '-0.02em',
    '--admin-tracking-folio': '0.08em',
  },
  fonts: {
    '--admin-font-ui': 'sans-humanist',
    '--admin-font-data': 'plex-mono',
  },
  schemes: {
    navy: {
      light: [29, 78, 166],
      dark: [92, 148, 224],
    },
    graphite: {
      light: [72, 78, 90],
      dark: [164, 172, 188],
    },
    forest: {
      light: [30, 96, 62],
      dark: [110, 186, 140],
    },
    oxblood: {
      light: [138, 30, 52],
      dark: [232, 118, 140],
    },
    teal: {
      light: [20, 104, 116],
      dark: [96, 190, 204],
    },
    plum: {
      light: [96, 50, 140],
      dark: [188, 150, 232],
    },
  },
});

const MOTIF_SET_IDS = Object.freeze([
  'none',
  'botanical',
  'fauna',
  'cartographic',
]);

module.exports = { PRESETS, COMPONENT_TOKEN_DEFAULTS, ADMIN_TOKENS, MOTIF_SET_IDS };
