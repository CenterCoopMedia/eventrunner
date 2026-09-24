'use strict';

/**
 * GENERATED FILE — do not edit by hand.
 *
 * WHAT EVERY PATH READS. Palettes, type maps, shape, the motif default,
 * and the option ids and defaults — what the config validator, the
 * contrast check and the palette resolver read on every path, and
 * nothing a human reads. What a style MOVES — its token and
 * component-font remaps, what each choice moves, the component defaults
 * a style change resets — is `presetRemaps.cjs`, which only a path that
 * resolves a style at runtime loads. The style names and the reasons
 * behind each curated choice are copy: they live in
 * `apps/web/src/admin/presetCopy.js`, which rides the admin chunk, and
 * the design prose lives in `design/tokens/presets/README.md`.
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
    options: {
      headingFace: {
        default: 'merriweather',
        choices: [
          {
            id: 'merriweather',
          },
          {
            id: 'source-serif-4',
          },
          {
            id: 'public-sans-bold',
          },
        ],
      },
      nameplate: {
        default: 'institutional-letterhead',
        choices: [
          {
            id: 'institutional-letterhead',
          },
          {
            id: 'two-part-lockup',
          },
          {
            id: 'compact-standing-head',
          },
        ],
      },
      component: {
        default: 'posted-agenda',
        choices: [
          {
            id: 'posted-agenda',
          },
          {
            id: 'numbered-agenda',
          },
        ],
      },
      longReadOpening: {
        default: 'plain',
        choices: [
          {
            id: 'drop-cap',
          },
          {
            id: 'standfirst',
          },
          {
            id: 'plain',
          },
        ],
      },
      quote: {
        default: 'ruled-minute',
        choices: [
          {
            id: 'ruled-minute',
          },
          {
            id: 'plain-rules',
          },
        ],
      },
      directory: {
        default: 'ruled-entries',
        choices: [
          {
            id: 'ruled-entries',
          },
          {
            id: 'portrait-plates',
          },
        ],
      },
      sectionBoundary: {
        default: 'rule-and-folio',
        choices: [
          {
            id: 'rule-and-folio',
          },
          {
            id: 'rule-only',
          },
          {
            id: 'folio-in-margin',
          },
        ],
      },
      tableRules: {
        default: 'full-grid',
        choices: [
          {
            id: 'hairline-rows',
          },
          {
            id: 'ruled-head',
          },
          {
            id: 'full-grid',
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
    options: {
      headingFace: {
        default: 'fraunces',
        choices: [
          {
            id: 'fraunces',
          },
          {
            id: 'newsreader-display',
          },
          {
            id: 'archivo-condensed',
          },
        ],
      },
      nameplate: {
        default: 'rule-bounded-bar',
        choices: [
          {
            id: 'rule-bounded-bar',
          },
          {
            id: 'stacked-with-deck',
          },
          {
            id: 'section-aware-bar',
          },
        ],
      },
      component: {
        default: 'hairline-row',
        choices: [
          {
            id: 'hairline-row',
          },
          {
            id: 'lead-and-rest',
          },
        ],
      },
      longReadOpening: {
        default: 'standfirst',
        choices: [
          {
            id: 'drop-cap',
          },
          {
            id: 'standfirst',
          },
          {
            id: 'plain',
          },
        ],
      },
      quote: {
        default: 'ruled-with-mark',
        choices: [
          {
            id: 'ruled-with-mark',
          },
          {
            id: 'side-rule',
          },
          {
            id: 'mark-only',
          },
        ],
      },
      directory: {
        default: 'portrait-shelf',
        choices: [
          {
            id: 'portrait-shelf',
          },
          {
            id: 'tall-portraits',
          },
        ],
      },
      sectionBoundary: {
        default: 'rule-and-folio',
        choices: [
          {
            id: 'rule-and-folio',
          },
          {
            id: 'rule-only',
          },
          {
            id: 'folio-in-margin',
          },
        ],
      },
      tableRules: {
        default: 'ruled-head',
        choices: [
          {
            id: 'hairline-rows',
          },
          {
            id: 'ruled-head',
          },
          {
            id: 'full-grid',
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
    options: {
      headingFace: {
        default: 'libre-caslon-display',
        choices: [
          {
            id: 'libre-caslon-display',
          },
          {
            id: 'libre-baskerville',
          },
          {
            id: 'spectral',
          },
        ],
      },
      nameplate: {
        default: 'full-measure',
        choices: [
          {
            id: 'full-measure',
          },
          {
            id: 'centred-double-rule',
          },
          {
            id: 'compact-standing-edition',
          },
        ],
      },
      component: {
        default: 'ruled-programme',
        choices: [
          {
            id: 'ruled-programme',
          },
          {
            id: 'agate-block',
          },
        ],
      },
      longReadOpening: {
        default: 'drop-cap',
        choices: [
          {
            id: 'drop-cap',
          },
          {
            id: 'standfirst',
          },
          {
            id: 'plain',
          },
        ],
      },
      quote: {
        default: 'centred-mark',
        choices: [
          {
            id: 'centred-mark',
          },
          {
            id: 'column-rule',
          },
        ],
      },
      directory: {
        default: 'agate-directory',
        choices: [
          {
            id: 'agate-directory',
          },
          {
            id: 'plate-portraits',
          },
        ],
      },
      sectionBoundary: {
        default: 'rule-and-folio',
        choices: [
          {
            id: 'rule-and-folio',
          },
          {
            id: 'rule-only',
          },
          {
            id: 'folio-in-margin',
          },
        ],
      },
      tableRules: {
        default: 'full-grid',
        choices: [
          {
            id: 'hairline-rows',
          },
          {
            id: 'ruled-head',
          },
          {
            id: 'full-grid',
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
    options: {
      headingFace: {
        default: 'overpass',
        choices: [
          {
            id: 'overpass',
          },
          {
            id: 'libre-franklin-extrabold',
          },
          {
            id: 'archivo-condensed',
          },
        ],
      },
      nameplate: {
        default: 'corner-title-block',
        choices: [
          {
            id: 'corner-title-block',
          },
          {
            id: 'sheet-header-scale-line',
          },
          {
            id: 'departure-board-header',
          },
        ],
      },
      component: {
        default: 'departure-board',
        choices: [
          {
            id: 'departure-board',
          },
          {
            id: 'line-diagram',
          },
          {
            id: 'gazetteer-list',
          },
        ],
      },
      longReadOpening: {
        default: 'plain',
        choices: [
          {
            id: 'drop-cap',
          },
          {
            id: 'standfirst',
          },
          {
            id: 'plain',
          },
        ],
      },
      quote: {
        default: 'route-line',
        choices: [
          {
            id: 'route-line',
          },
          {
            id: 'boxed-sign',
          },
        ],
      },
      directory: {
        default: 'gazetteer',
        choices: [
          {
            id: 'gazetteer',
          },
          {
            id: 'station-index',
          },
        ],
      },
      sectionBoundary: {
        default: 'rule-and-folio',
        choices: [
          {
            id: 'rule-and-folio',
          },
          {
            id: 'rule-only',
          },
        ],
      },
      tableRules: {
        default: 'full-grid',
        choices: [
          {
            id: 'hairline-rows',
          },
          {
            id: 'ruled-head',
          },
          {
            id: 'full-grid',
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
    options: {
      headingFace: {
        default: 'besley',
        choices: [
          {
            id: 'besley',
          },
          {
            id: 'vollkorn-display',
          },
          {
            id: 'spectral',
          },
        ],
      },
      nameplate: {
        default: 'framed-title-page',
        choices: [
          {
            id: 'framed-title-page',
          },
          {
            id: 'ruled-title-no-frame',
          },
          {
            id: 'plate-and-label',
          },
        ],
      },
      component: {
        default: 'specimen-label',
        choices: [
          {
            id: 'specimen-label',
          },
          {
            id: 'field-notes-column',
          },
        ],
      },
      marginalia: {
        default: 'off',
        choices: [
          {
            id: 'off',
          },
          {
            id: 'on',
          },
        ],
      },
      longReadOpening: {
        default: 'drop-cap',
        choices: [
          {
            id: 'drop-cap',
          },
          {
            id: 'standfirst',
          },
          {
            id: 'plain',
          },
        ],
      },
      quote: {
        default: 'field-note',
        choices: [
          {
            id: 'field-note',
          },
          {
            id: 'pressed-page',
          },
        ],
      },
      directory: {
        default: 'specimen-plates',
        choices: [
          {
            id: 'specimen-plates',
          },
          {
            id: 'field-list',
          },
        ],
      },
      sectionBoundary: {
        default: 'rule-and-folio',
        choices: [
          {
            id: 'rule-and-folio',
          },
          {
            id: 'rule-only',
          },
          {
            id: 'folio-in-margin',
          },
        ],
      },
      tableRules: {
        default: 'ruled-head',
        choices: [
          {
            id: 'hairline-rows',
          },
          {
            id: 'ruled-head',
          },
          {
            id: 'full-grid',
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
    shape: {
      radius: 'sharp',
      texture: 'paper',
      density: 'loose',
    },
    motifSet: 'none',
    options: {
      headingFace: {
        default: 'karrik',
        choices: [
          {
            id: 'karrik',
          },
          {
            id: 'bagnard',
          },
          {
            id: 'avara',
          },
        ],
      },
      nameplate: {
        default: 'full-sheet',
        choices: [
          {
            id: 'full-sheet',
          },
          {
            id: 'stacked-block',
          },
          {
            id: 'boxed-bill',
          },
        ],
      },
      component: {
        default: 'flat-block',
        choices: [
          {
            id: 'flat-block',
          },
          {
            id: 'stamped-block',
          },
          {
            id: 'struck-folio',
          },
        ],
      },
      marginalia: {
        default: 'off',
        choices: [
          {
            id: 'off',
          },
          {
            id: 'on',
          },
        ],
      },
      longReadOpening: {
        default: 'plain',
        choices: [
          {
            id: 'drop-cap',
          },
          {
            id: 'standfirst',
          },
          {
            id: 'plain',
          },
        ],
      },
      quote: {
        default: 'handwritten',
        choices: [
          {
            id: 'handwritten',
          },
          {
            id: 'toner-block',
          },
          {
            id: 'cut-out',
          },
        ],
      },
      directory: {
        default: 'contact-sheet',
        choices: [
          {
            id: 'contact-sheet',
          },
          {
            id: 'cut-outs',
          },
        ],
      },
      sectionBoundary: {
        default: 'rule-and-folio',
        choices: [
          {
            id: 'rule-and-folio',
          },
          {
            id: 'rule-only',
          },
        ],
      },
      tableRules: {
        default: 'ruled-head',
        choices: [
          {
            id: 'hairline-rows',
          },
          {
            id: 'ruled-head',
          },
          {
            id: 'full-grid',
          },
        ],
      },
    },
  },
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

module.exports = { PRESETS, ADMIN_TOKENS, MOTIF_SET_IDS };
