'use strict';

/**
 * GENERATED FILE — do not edit by hand.
 *
 * WHAT A STYLE MOVES. `presets` carries, per style, its own token and
 * component-font remaps and what every choice of every option group
 * moves (`options`, keyed group → choice id → { fonts?, componentFonts?,
 * tokens? }); `componentDefaults` carries the contract default of every
 * token some style or choice remaps, which a style change resets before
 * it applies the new style. `presetCatalog.cjs` carries the palettes,
 * type maps and choice IDS every path needs; this file carries what only
 * a path that RESOLVES a style at runtime needs — a live config/theme
 * overlay, the demo style switcher, the admin branding editor, the
 * specimen book, the token generator. The public site's first paint
 * needs none of it, because the generated stylesheet already carries the
 * chosen style with its picks resolved, so the web app loads this module
 * lazily (apps/web/src/lib/presetRemaps.js) and a Node caller requires
 * it once.
 *
 * REQUIRING IT REGISTERS IT. The resolver (theme.cjs) keeps a registry
 * its token and pick resolvers read, and the last line here fills it, so
 * a caller that has required 'shared/presetRemaps' resolves every style
 * in full and one that has not is told so rather than handed a
 * half-resolved style.
 *
 * Source of truth: design/tokens/presets/*.json and
 * design/tokens/components.json.
 * Regenerate with `node scripts/build-preset-catalog.cjs`.
 * `scripts/build-preset-catalog.test.cjs` fails when this file is stale.
 */

const PRESET_REMAPS = Object.freeze({
  componentDefaults: {
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
    '--section-folio-display': 'inline',
    '--section-folio-placement': 'end',
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
    '--definition-list-rule-width': 'var(--rule-hairline-width)',
    '--definition-list-term-font': 'var(--font-data)',
    '--definition-list-term-size': 'var(--text-caption)',
    '--definition-list-term-style': 'normal',
    '--definition-list-term-transform': 'none',
    '--definition-list-term-tracking': '0em',
    '--definition-list-term-width': '9rem',
    '--pull-quote-rule-block-width': 'var(--rule-strong-width)',
    '--pull-quote-rule-inline-width': '0',
    '--pull-quote-mark-display': 'none',
    '--pull-quote-quotes-display': 'inline',
    '--pull-quote-align': 'start',
    '--pull-quote-pad-inline': '0',
    '--pull-quote-pad-block': 'var(--space-md)',
    '--pull-quote-attribution-font': 'var(--font-data)',
    '--pull-quote-attribution-transform': 'none',
    '--timeline-spine-width': 'var(--rule-hairline-width)',
    '--timeline-tick-length': 'var(--space-sm)',
    '--timeline-stop-size': '0',
    '--progress-fill': 'rgb(var(--color-accent-rgb))',
    '--progress-block-size': 'var(--space-xs)',
    '--progress-radius': 'var(--radius-base)',
    '--notice-bar-ground': 'rgb(var(--color-surface-alt-rgb))',
    '--notice-bar-rule-width': 'var(--rule-hairline-width)',
    '--notice-bar-urgent-rule-width': 'var(--rule-strong-width)',
    '--notice-bar-word-font': 'var(--font-data)',
    '--table-head-rule-width': 'var(--rule-strong-width)',
    '--table-column-rule-width': '0',
    '--table-head-font': 'var(--font-data)',
    '--table-head-transform': 'none',
    '--table-head-tracking': '0em',
    '--avatar-ink': 'rgb(var(--color-text-secondary-rgb))',
    '--avatar-frame-width': 'var(--rule-hairline-width)',
    '--avatar-radius': 'var(--radius-base)',
    '--dropzone-rule-width': 'var(--rule-hairline-width)',
    '--dropzone-rule-style': 'dashed',
    '--dropzone-drag-rule-width': 'var(--rule-strong-width)',
    '--repeater-rule-width': 'var(--rule-hairline-width)',
    '--count-figure-weight': 'var(--weight-semibold)',
    '--legend-font': 'var(--font-data)',
    '--legend-transform': 'none',
    '--legend-tracking': '0em',
    '--legend-rule-width': '0',
    '--legend-pad-block': '0',
    '--state-marker-font': 'var(--font-data)',
    '--standfirst-font': 'var(--font-body)',
    '--standfirst-size': 'var(--text-lead)',
    '--standfirst-style': 'normal',
    '--standfirst-weight': 'var(--weight-regular)',
    '--standfirst-ink': 'rgb(var(--color-text-secondary-rgb))',
    '--standfirst-rule-width': '0',
    '--standfirst-pad-block-end': '0',
    '--byline-font': 'var(--font-data)',
    '--byline-transform': 'none',
    '--byline-tracking': '0em',
    '--directory-rule-width': 'var(--rule-hairline-width)',
    '--directory-portrait-aspect': '1 / 1',
    '--directory-portrait-ground': 'rgb(var(--color-surface-alt-rgb))',
    '--directory-portrait-radius': 'var(--radius-base)',
    '--directory-entry-pad-block': 'var(--space-2xs)',
    '--drop-cap-float': 'none',
    '--drop-cap-size': '1em',
    '--drop-cap-pad-inline-end': '0',
    '--long-read-opening-size': 'var(--text-body)',
    '--long-read-opening-leading': 'var(--text-body-leading)',
  },
  presets: {
    civic: {
      tokens: {
        '--session-card-pad-block': 'var(--space-md)',
        '--folio-font': 'var(--font-data)',
        '--definition-list-term-width': '11rem',
        '--pull-quote-rule-block-width': 'var(--rule-hairline-width)',
        '--pull-quote-rule-rgb': 'var(--rule-hairline-rgb)',
        '--pull-quote-rule-inline-width': 'var(--rule-strong-width)',
        '--pull-quote-pad-inline': 'var(--space-md)',
        '--hero-art-width': '58%',
        '--hero-art-position': '80% 50%',
        '--hero-title-size': 'clamp(2.5rem, 5vw, 5rem)',
        '--hero-title-tracking': '-.035em',
        '--standfirst-size': 'var(--text-lead)',
      },
      options: {
        headingFace: {
          merriweather: {
            fonts: {
              heading: 'merriweather',
            },
          },
          'source-serif-4': {
            fonts: {
              heading: 'serif-editorial',
            },
          },
          'public-sans-bold': {
            fonts: {
              heading: 'public-sans',
            },
          },
        },
        nameplate: {
          'institutional-letterhead': {
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-meta-placement': 'block',
              '--nameplate-rule-width': 'var(--rule-hairline-width)',
            },
          },
          'two-part-lockup': {
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-meta-placement': 'inline',
              '--nameplate-frame-width': 'var(--rule-hairline-width)',
            },
          },
          'compact-standing-head': {
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-size': 'var(--text-h1)',
              '--nameplate-meta-placement': 'inline',
            },
          },
        },
        component: {
          'posted-agenda': {
            tokens: {
              '--schedule-number-display': 'none',
              '--schedule-row-leading': 'var(--text-body-leading)',
            },
          },
          'numbered-agenda': {
            tokens: {
              '--schedule-number-display': 'inline',
              '--schedule-row-leading': 'var(--text-body-leading)',
            },
          },
        },
        longReadOpening: {
          'drop-cap': {
            tokens: {
              '--drop-cap-float': 'left',
              '--drop-cap-size': '3.1em',
              '--drop-cap-pad-inline-end': 'var(--space-xs)',
            },
          },
          standfirst: {
            tokens: {
              '--long-read-opening-size': 'var(--text-lead)',
              '--long-read-opening-leading': 'var(--text-lead-leading)',
            },
          },
          plain: {
            tokens: {
              '--drop-cap-float': 'none',
            },
          },
        },
        quote: {
          'ruled-minute': {
            tokens: {
              '--pull-quote-rule-block-width': 'var(--rule-hairline-width)',
            },
          },
          'plain-rules': {
            tokens: {
              '--pull-quote-rule-inline-width': '0',
              '--pull-quote-pad-inline': '0',
            },
          },
        },
        directory: {
          'ruled-entries': {
            tokens: {
              '--directory-portrait-aspect': '1 / 1',
            },
          },
          'portrait-plates': {
            tokens: {
              '--directory-portrait-aspect': '4 / 5',
              '--directory-entry-pad-block': 'var(--space-xs)',
            },
          },
        },
        sectionBoundary: {
          'rule-and-folio': {
            tokens: {
              '--section-folio-display': 'inline',
            },
          },
          'rule-only': {
            tokens: {
              '--section-folio-display': 'none',
            },
          },
          'folio-in-margin': {
            tokens: {
              '--section-folio-placement': 'margin',
            },
          },
        },
        tableRules: {
          'hairline-rows': {
            tokens: {
              '--table-head-rule-width': 'var(--rule-hairline-width)',
            },
          },
          'ruled-head': {
            tokens: {
              '--table-head-rule-width': 'var(--rule-strong-width)',
            },
          },
          'full-grid': {
            tokens: {
              '--table-column-rule-width': 'var(--rule-hairline-width)',
            },
          },
        },
      },
    },
    newsroom: {
      tokens: {
        '--folio-font': 'var(--font-data)',
        '--section-rule-width': 'var(--rule-strong-width)',
        '--definition-list-term-width': '10rem',
        '--pull-quote-mark-display': 'block',
        '--pull-quote-quotes-display': 'none',
        '--pull-quote-pad-block': 'var(--space-lg)',
        '--notice-bar-urgent-rule-width': 'var(--rule-nameplate-width)',
        '--table-head-transform': 'uppercase',
        '--table-head-tracking': '0.04em',
        '--hero-art-width': '56%',
        '--hero-copy-pad-inline-start': 'var(--space-md)',
        '--hero-copy-border-inline-start': '.35rem solid rgb(var(--color-accent-rgb))',
        '--hero-veil-background': 'linear-gradient(90deg, rgb(var(--color-surface-rgb)) 38%, rgb(var(--color-surface-rgb) / .95) 45%, rgb(var(--color-surface-rgb) / 0) 67%)',
        '--standfirst-font': 'var(--font-heading)',
        '--standfirst-weight': 'var(--weight-regular)',
      },
      options: {
        headingFace: {
          fraunces: {
            fonts: {
              heading: 'fraunces',
            },
          },
          'newsreader-display': {
            fonts: {
              heading: 'newsreader',
            },
          },
          'archivo-condensed': {
            fonts: {
              heading: 'archivo-condensed',
            },
          },
        },
        nameplate: {
          'rule-bounded-bar': {
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-rule-width': 'var(--rule-strong-width)',
              '--nameplate-meta-placement': 'inline',
            },
          },
          'stacked-with-deck': {
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-rule-width': 'var(--rule-hairline-width)',
              '--nameplate-meta-placement': 'block',
              '--nameplate-gap': 'var(--space-xs)',
            },
          },
          'section-aware-bar': {
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-size': 'var(--text-h1)',
              '--nameplate-rule-width': 'var(--rule-strong-width)',
              '--nameplate-meta-placement': 'inline',
            },
          },
        },
        component: {
          'hairline-row': {
            tokens: {
              '--session-card-lead-scale': '1',
              '--session-card-rule-width': 'var(--rule-hairline-width)',
            },
          },
          'lead-and-rest': {
            tokens: {
              '--session-card-lead-scale': '1.35',
              '--session-card-rule-width': 'var(--rule-hairline-width)',
            },
          },
        },
        longReadOpening: {
          'drop-cap': {
            tokens: {
              '--drop-cap-float': 'left',
              '--drop-cap-size': '3.1em',
              '--drop-cap-pad-inline-end': 'var(--space-xs)',
            },
          },
          standfirst: {
            tokens: {
              '--long-read-opening-size': 'var(--text-lead)',
              '--long-read-opening-leading': 'var(--text-lead-leading)',
            },
          },
          plain: {
            tokens: {
              '--drop-cap-float': 'none',
            },
          },
        },
        quote: {
          'ruled-with-mark': {
            tokens: {
              '--pull-quote-rule-block-width': 'var(--rule-strong-width)',
            },
          },
          'side-rule': {
            tokens: {
              '--pull-quote-rule-block-width': '0',
              '--pull-quote-rule-inline-width': 'var(--rule-strong-width)',
              '--pull-quote-pad-inline': 'var(--space-md)',
              '--pull-quote-mark-display': 'none',
              '--pull-quote-quotes-display': 'inline',
            },
          },
          'mark-only': {
            tokens: {
              '--pull-quote-rule-block-width': '0',
            },
          },
        },
        directory: {
          'portrait-shelf': {
            tokens: {
              '--directory-portrait-aspect': '1 / 1',
            },
          },
          'tall-portraits': {
            tokens: {
              '--directory-portrait-aspect': '3 / 4',
            },
          },
        },
        sectionBoundary: {
          'rule-and-folio': {
            tokens: {
              '--section-folio-display': 'inline',
            },
          },
          'rule-only': {
            tokens: {
              '--section-folio-display': 'none',
            },
          },
          'folio-in-margin': {
            tokens: {
              '--section-folio-placement': 'margin',
            },
          },
        },
        tableRules: {
          'hairline-rows': {
            tokens: {
              '--table-head-rule-width': 'var(--rule-hairline-width)',
            },
          },
          'ruled-head': {
            tokens: {
              '--table-head-rule-width': 'var(--rule-strong-width)',
            },
          },
          'full-grid': {
            tokens: {
              '--table-column-rule-width': 'var(--rule-hairline-width)',
            },
          },
        },
      },
    },
    broadsheet: {
      tokens: {
        '--session-card-pad-block': 'var(--space-sm)',
        '--folio-font': 'var(--font-data)',
        '--definition-list-term-style': 'italic',
        '--definition-list-term-width': '8rem',
        '--pull-quote-rule-rgb': 'var(--rule-hairline-rgb)',
        '--pull-quote-rule-block-width': 'var(--rule-hairline-width)',
        '--pull-quote-mark-display': 'block',
        '--pull-quote-quotes-display': 'none',
        '--pull-quote-align': 'center',
        '--pull-quote-attribution-transform': 'uppercase',
        '--timeline-spine-width': 'var(--rule-strong-width)',
        '--progress-fill': 'rgb(var(--color-text-primary-rgb))',
        '--progress-block-size': 'var(--space-3xs)',
        '--progress-radius': '0',
        '--notice-bar-ground': 'rgb(var(--color-surface-rgb))',
        '--table-head-transform': 'uppercase',
        '--table-head-tracking': '0.06em',
        '--hero-rule-block-start': 'var(--rule-strong-width) double rgb(var(--rule-strong-rgb))',
        '--hero-art-width': '75%',
        '--hero-art-position': '85% 50%',
        '--hero-title-style': 'normal',
        '--hero-title-tracking': '-.055em',
        '--avatar-ink': 'rgb(var(--color-text-primary-rgb))',
        '--avatar-radius': '0',
        '--legend-transform': 'uppercase',
        '--legend-tracking': 'var(--text-folio-tracking)',
        '--standfirst-style': 'italic',
        '--byline-transform': 'uppercase',
        '--byline-tracking': 'var(--text-folio-tracking)',
      },
      options: {
        headingFace: {
          'libre-caslon-display': {
            fonts: {
              heading: 'caslon-display',
            },
          },
          'libre-baskerville': {
            fonts: {
              heading: 'baskerville',
            },
          },
          spectral: {
            fonts: {
              heading: 'spectral',
            },
          },
        },
        nameplate: {
          'full-measure': {
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-rule-top-width': '0',
              '--nameplate-meta-placement': 'block',
            },
          },
          'centred-double-rule': {
            tokens: {
              '--nameplate-align': 'center',
              '--nameplate-rule-top-width': 'var(--rule-hairline-width)',
              '--nameplate-meta-placement': 'inline',
            },
          },
          'compact-standing-edition': {
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-size': 'var(--text-h1)',
              '--nameplate-rule-width': 'var(--rule-hairline-width)',
              '--nameplate-meta-placement': 'inline',
            },
          },
        },
        component: {
          'ruled-programme': {
            tokens: {
              '--schedule-row-leading': 'var(--text-body-leading)',
              '--schedule-data-size': 'var(--text-caption)',
            },
          },
          'agate-block': {
            tokens: {
              '--schedule-row-leading': '1.3',
              '--schedule-data-size': 'var(--text-folio)',
              '--session-card-pad-block': 'var(--space-xs)',
            },
          },
        },
        longReadOpening: {
          'drop-cap': {
            tokens: {
              '--drop-cap-float': 'left',
              '--drop-cap-size': '3.1em',
              '--drop-cap-pad-inline-end': 'var(--space-xs)',
            },
          },
          standfirst: {
            tokens: {
              '--long-read-opening-size': 'var(--text-lead)',
              '--long-read-opening-leading': 'var(--text-lead-leading)',
            },
          },
          plain: {
            tokens: {
              '--drop-cap-float': 'none',
            },
          },
        },
        quote: {
          'centred-mark': {
            tokens: {
              '--pull-quote-rule-block-width': 'var(--rule-hairline-width)',
            },
          },
          'column-rule': {
            tokens: {
              '--pull-quote-rule-block-width': '0',
              '--pull-quote-rule-inline-width': 'var(--rule-hairline-width)',
              '--pull-quote-pad-inline': 'var(--space-md)',
              '--pull-quote-mark-display': 'none',
              '--pull-quote-quotes-display': 'inline',
              '--pull-quote-align': 'start',
            },
          },
        },
        directory: {
          'agate-directory': {
            tokens: {
              '--directory-portrait-radius': '0',
              '--directory-entry-pad-block': 'var(--space-3xs)',
            },
          },
          'plate-portraits': {
            tokens: {
              '--directory-portrait-aspect': '4 / 5',
              '--directory-portrait-radius': '0',
              '--directory-rule-width': 'var(--rule-strong-width)',
            },
          },
        },
        sectionBoundary: {
          'rule-and-folio': {
            tokens: {
              '--section-folio-display': 'inline',
            },
          },
          'rule-only': {
            tokens: {
              '--section-folio-display': 'none',
            },
          },
          'folio-in-margin': {
            tokens: {
              '--section-folio-placement': 'margin',
            },
          },
        },
        tableRules: {
          'hairline-rows': {
            tokens: {
              '--table-head-rule-width': 'var(--rule-hairline-width)',
            },
          },
          'ruled-head': {
            tokens: {
              '--table-head-rule-width': 'var(--rule-strong-width)',
            },
          },
          'full-grid': {
            tokens: {
              '--table-head-rule-width': 'var(--rule-hairline-width)',
              '--table-column-rule-width': 'var(--rule-hairline-width)',
            },
          },
        },
      },
    },
    atlas: {
      tokens: {
        '--definition-list-term-font': 'var(--font-mono)',
        '--definition-list-term-transform': 'uppercase',
        '--definition-list-term-tracking': '0.05em',
        '--definition-list-term-width': '7rem',
        '--pull-quote-rule-block-width': '0',
        '--pull-quote-rule-inline-width': 'var(--rule-strong-width)',
        '--pull-quote-pad-inline': 'var(--space-md)',
        '--pull-quote-attribution-font': 'var(--font-mono)',
        '--timeline-stop-size': 'var(--space-xs)',
        '--progress-block-size': 'var(--space-2xs)',
        '--progress-radius': '0',
        '--notice-bar-word-font': 'var(--font-mono)',
        '--table-head-font': 'var(--font-mono)',
        '--table-head-transform': 'uppercase',
        '--table-head-tracking': '0.05em',
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
        '--avatar-frame-width': 'var(--rule-strong-width)',
        '--dropzone-rule-style': 'solid',
        '--legend-font': 'var(--font-mono)',
        '--state-marker-font': 'var(--font-mono)',
        '--standfirst-font': 'var(--font-heading)',
        '--byline-font': 'var(--font-mono)',
      },
      options: {
        headingFace: {
          overpass: {
            fonts: {
              heading: 'overpass',
            },
          },
          'libre-franklin-extrabold': {
            fonts: {
              heading: 'libre-franklin',
            },
          },
          'archivo-condensed': {
            fonts: {
              heading: 'archivo-condensed',
            },
          },
        },
        nameplate: {
          'corner-title-block': {
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-frame-width': 'var(--rule-hairline-width)',
              '--nameplate-corner-mark-width': 'var(--rule-hairline-width)',
              '--nameplate-meta-placement': 'block',
            },
          },
          'sheet-header-scale-line': {
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-frame-width': '0',
              '--nameplate-meta-placement': 'inline',
              '--nameplate-rule-width': 'var(--rule-hairline-width)',
            },
          },
          'departure-board-header': {
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-frame-width': '0',
              '--nameplate-rule-width': 'var(--rule-strong-width)',
              '--nameplate-meta-placement': 'block',
            },
          },
        },
        component: {
          'departure-board': {
            tokens: {
              '--map-grid-size': 'var(--space-xl)',
              '--schedule-data-size': 'var(--text-caption)',
            },
          },
          'line-diagram': {
            tokens: {
              '--map-grid-size': '0',
              '--schedule-data-size': 'var(--text-caption)',
              '--schedule-row-leading': '1.5',
            },
          },
          'gazetteer-list': {
            tokens: {
              '--map-grid-size': '0',
              '--schedule-data-size': 'var(--text-folio)',
              '--schedule-row-leading': 'var(--text-body-leading)',
            },
          },
        },
        longReadOpening: {
          'drop-cap': {
            tokens: {
              '--drop-cap-float': 'left',
              '--drop-cap-size': '3.1em',
              '--drop-cap-pad-inline-end': 'var(--space-xs)',
            },
          },
          standfirst: {
            tokens: {
              '--long-read-opening-size': 'var(--text-lead)',
              '--long-read-opening-leading': 'var(--text-lead-leading)',
            },
          },
          plain: {
            tokens: {
              '--drop-cap-float': 'none',
            },
          },
        },
        quote: {
          'route-line': {
            tokens: {
              '--pull-quote-rule-block-width': '0',
            },
          },
          'boxed-sign': {
            tokens: {
              '--pull-quote-rule-block-width': 'var(--rule-strong-width)',
            },
          },
        },
        directory: {
          gazetteer: {
            tokens: {
              '--directory-entry-pad-block': 'var(--space-3xs)',
            },
          },
          'station-index': {
            tokens: {
              '--directory-portrait-aspect': '4 / 5',
              '--directory-rule-width': 'var(--rule-strong-width)',
              '--directory-entry-pad-block': 'var(--space-xs)',
            },
          },
        },
        sectionBoundary: {
          'rule-and-folio': {
            tokens: {
              '--section-folio-display': 'inline',
            },
          },
          'rule-only': {
            tokens: {
              '--section-folio-display': 'none',
            },
          },
        },
        tableRules: {
          'hairline-rows': {
            tokens: {
              '--table-head-rule-width': 'var(--rule-hairline-width)',
            },
          },
          'ruled-head': {
            tokens: {
              '--table-head-rule-width': 'var(--rule-strong-width)',
            },
          },
          'full-grid': {
            tokens: {
              '--table-column-rule-width': 'var(--rule-hairline-width)',
            },
          },
        },
      },
    },
    'field-guide': {
      tokens: {
        '--definition-list-term-font': 'var(--font-mono)',
        '--definition-list-term-transform': 'uppercase',
        '--definition-list-term-tracking': '0.06em',
        '--definition-list-term-size': 'var(--text-folio)',
        '--pull-quote-rule-rgb': 'var(--rule-hairline-rgb)',
        '--pull-quote-rule-block-width': '0',
        '--pull-quote-rule-inline-width': 'var(--rule-hairline-width)',
        '--pull-quote-pad-inline': 'var(--space-md)',
        '--timeline-tick-length': 'var(--space-md)',
        '--progress-fill': 'rgb(var(--color-accent-secondary-rgb))',
        '--progress-radius': '0',
        '--notice-bar-word-font': 'var(--font-mono)',
        '--table-head-font': 'var(--font-mono)',
        '--table-head-transform': 'uppercase',
        '--table-head-tracking': '0.06em',
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
        '--avatar-radius': '0',
        '--legend-font': 'var(--font-mono)',
        '--standfirst-style': 'italic',
        '--byline-font': 'var(--font-mono)',
      },
      options: {
        headingFace: {
          besley: {
            fonts: {
              heading: 'besley',
            },
          },
          'vollkorn-display': {
            fonts: {
              heading: 'vollkorn',
            },
          },
          spectral: {
            fonts: {
              heading: 'spectral',
            },
          },
        },
        nameplate: {
          'framed-title-page': {
            tokens: {
              '--nameplate-align': 'center',
              '--nameplate-frame-width': 'var(--rule-hairline-width)',
              '--nameplate-meta-placement': 'block',
            },
          },
          'ruled-title-no-frame': {
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-frame-width': '0',
              '--nameplate-rule-top-width': 'var(--rule-hairline-width)',
              '--nameplate-meta-placement': 'block',
            },
          },
          'plate-and-label': {
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-frame-width': '0',
              '--nameplate-meta-placement': 'inline',
              '--plate-frame-width': 'var(--rule-strong-width)',
            },
          },
        },
        component: {
          'specimen-label': {
            tokens: {
              '--session-card-rule-width': 'var(--rule-hairline-width)',
              '--session-card-pad-block': 'var(--space-sm)',
            },
          },
          'field-notes-column': {
            tokens: {
              '--session-card-rule-width': 'var(--rule-hairline-width)',
              '--session-card-pad-block': 'var(--space-xs)',
              '--schedule-row-leading': '1.4',
            },
          },
        },
        marginalia: {
          off: {
            tokens: {
              '--marginalia-display': 'none',
            },
          },
          on: {
            tokens: {
              '--marginalia-display': 'inline',
            },
          },
        },
        longReadOpening: {
          'drop-cap': {
            tokens: {
              '--drop-cap-float': 'left',
              '--drop-cap-size': '3.1em',
              '--drop-cap-pad-inline-end': 'var(--space-xs)',
            },
          },
          standfirst: {
            tokens: {
              '--long-read-opening-size': 'var(--text-lead)',
              '--long-read-opening-leading': 'var(--text-lead-leading)',
            },
          },
          plain: {
            tokens: {
              '--drop-cap-float': 'none',
            },
          },
        },
        quote: {
          'field-note': {
            tokens: {
              '--pull-quote-rule-block-width': '0',
            },
          },
          'pressed-page': {
            tokens: {
              '--pull-quote-rule-block-width': 'var(--rule-hairline-width)',
              '--pull-quote-rule-inline-width': '0',
              '--pull-quote-pad-inline': '0',
              '--pull-quote-mark-display': 'block',
              '--pull-quote-quotes-display': 'none',
              '--pull-quote-align': 'center',
            },
          },
        },
        directory: {
          'specimen-plates': {
            tokens: {
              '--directory-portrait-aspect': '4 / 5',
              '--directory-portrait-radius': '0',
              '--directory-portrait-ground': 'rgb(var(--color-surface-rgb))',
            },
          },
          'field-list': {
            tokens: {
              '--directory-portrait-radius': '0',
            },
          },
        },
        sectionBoundary: {
          'rule-and-folio': {
            tokens: {
              '--section-folio-display': 'inline',
            },
          },
          'rule-only': {
            tokens: {
              '--section-folio-display': 'none',
            },
          },
          'folio-in-margin': {
            tokens: {
              '--section-folio-placement': 'margin',
            },
          },
        },
        tableRules: {
          'hairline-rows': {
            tokens: {
              '--table-head-rule-width': 'var(--rule-hairline-width)',
            },
          },
          'ruled-head': {
            tokens: {
              '--table-head-rule-width': 'var(--rule-strong-width)',
            },
          },
          'full-grid': {
            tokens: {
              '--table-head-rule-width': 'var(--rule-hairline-width)',
              '--table-column-rule-width': 'var(--rule-hairline-width)',
            },
          },
        },
      },
    },
    zine: {
      componentFonts: {
        '--callout-font': 'script-casual',
      },
      tokens: {
        '--session-card-rule-width': 'var(--rule-strong-width)',
        '--folio-rule-width': 'var(--rule-strong-width)',
        '--folio-font': 'var(--font-mono)',
        '--callout-angle': '-2.5deg',
        '--marginalia-display': 'none',
        '--definition-list-rule-width': 'var(--rule-strong-width)',
        '--definition-list-term-font': 'var(--font-mono)',
        '--definition-list-term-transform': 'uppercase',
        '--definition-list-term-tracking': '0.04em',
        '--pull-quote-pad-block': 'var(--space-lg)',
        '--timeline-spine-width': 'var(--rule-strong-width)',
        '--progress-fill': 'rgb(var(--color-text-primary-rgb))',
        '--progress-radius': '0',
        '--notice-bar-ground': 'rgb(var(--color-surface-rgb))',
        '--notice-bar-rule-width': 'var(--rule-strong-width)',
        '--notice-bar-urgent-rule-width': 'calc(var(--rule-strong-width) * 2)',
        '--notice-bar-word-font': 'var(--font-mono)',
        '--table-head-font': 'var(--font-mono)',
        '--table-head-transform': 'uppercase',
        '--table-head-tracking': '0.04em',
        '--hero-art-width': '64%',
        '--hero-title-size': 'clamp(2.8rem, 6vw, 6rem)',
        '--hero-title-tracking': '-.06em',
        '--hero-title-transform': 'uppercase',
        '--hero-press-display': 'block',
        '--avatar-frame-width': 'var(--rule-strong-width)',
        '--avatar-radius': '0',
        '--dropzone-rule-style': 'solid',
        '--dropzone-rule-width': 'var(--rule-strong-width)',
        '--dropzone-drag-rule-width': 'calc(var(--rule-strong-width) * 2)',
        '--repeater-rule-width': 'var(--rule-strong-width)',
        '--count-figure-weight': 'var(--weight-bold)',
        '--legend-font': 'var(--font-mono)',
        '--legend-rule-width': 'var(--rule-strong-width)',
        '--legend-pad-block': 'var(--space-2xs)',
        '--state-marker-font': 'var(--font-mono)',
        '--standfirst-ink': 'rgb(var(--color-text-primary-rgb))',
        '--standfirst-rule-width': 'var(--rule-strong-width)',
        '--standfirst-pad-block-end': 'var(--space-sm)',
        '--byline-font': 'var(--font-mono)',
      },
      options: {
        headingFace: {
          karrik: {
            fonts: {
              heading: 'karrik',
            },
          },
          bagnard: {
            fonts: {
              heading: 'bagnard',
            },
          },
          avara: {
            fonts: {
              heading: 'avara',
            },
          },
        },
        nameplate: {
          'full-sheet': {
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-rule-width': 'var(--rule-nameplate-width)',
              '--nameplate-frame-width': '0',
            },
          },
          'stacked-block': {
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-leading': '0.86',
              '--nameplate-frame-width': '0',
            },
          },
          'boxed-bill': {
            tokens: {
              '--nameplate-align': 'start',
              '--nameplate-frame-width': 'var(--rule-strong-width)',
              '--nameplate-meta-placement': 'block',
            },
          },
        },
        component: {
          'flat-block': {
            tokens: {
              '--session-card-stamp-offset': '0',
              '--folio-rule-top-width': '0',
            },
          },
          'stamped-block': {
            tokens: {
              '--session-card-stamp-offset': '4px',
              '--session-card-stamp-alpha': '0.55',
              '--folio-rule-top-width': '0',
            },
          },
          'struck-folio': {
            tokens: {
              '--session-card-stamp-offset': '0',
              '--folio-rule-top-width': 'var(--rule-strong-width)',
              '--folio-font': 'var(--font-mono)',
            },
          },
        },
        marginalia: {
          off: {
            tokens: {
              '--marginalia-display': 'none',
            },
          },
          on: {
            tokens: {
              '--marginalia-display': 'inline',
            },
          },
        },
        longReadOpening: {
          'drop-cap': {
            tokens: {
              '--drop-cap-float': 'left',
              '--drop-cap-size': '3.1em',
              '--drop-cap-pad-inline-end': 'var(--space-xs)',
            },
          },
          standfirst: {
            tokens: {
              '--long-read-opening-size': 'var(--text-lead)',
              '--long-read-opening-leading': 'var(--text-lead-leading)',
            },
          },
          plain: {
            tokens: {
              '--drop-cap-float': 'none',
            },
          },
        },
        quote: {
          handwritten: {
            tokens: {
              '--pull-quote-rule-block-width': 'var(--rule-strong-width)',
            },
          },
          'toner-block': {
            componentFonts: {
              '--callout-font': 'karrik',
            },
            tokens: {
              '--callout-angle': '0deg',
              '--pull-quote-pad-block': 'var(--space-md)',
            },
          },
          'cut-out': {
            tokens: {
              '--pull-quote-rule-block-width': '0',
              '--pull-quote-rule-inline-width': 'var(--rule-strong-width)',
              '--pull-quote-pad-inline': 'var(--space-md)',
              '--pull-quote-pad-block': 'var(--space-sm)',
            },
          },
        },
        directory: {
          'contact-sheet': {
            tokens: {
              '--directory-portrait-radius': '0',
              '--directory-rule-width': 'var(--rule-strong-width)',
            },
          },
          'cut-outs': {
            tokens: {
              '--directory-portrait-aspect': '4 / 5',
              '--directory-portrait-radius': '0',
              '--directory-portrait-ground': 'rgb(var(--color-surface-rgb))',
            },
          },
        },
        sectionBoundary: {
          'rule-and-folio': {
            tokens: {
              '--section-folio-display': 'inline',
            },
          },
          'rule-only': {
            tokens: {
              '--section-folio-display': 'none',
            },
          },
        },
        tableRules: {
          'hairline-rows': {
            tokens: {
              '--table-head-rule-width': 'var(--rule-hairline-width)',
            },
          },
          'ruled-head': {
            tokens: {
              '--table-head-rule-width': 'var(--rule-strong-width)',
            },
          },
          'full-grid': {
            tokens: {
              '--table-column-rule-width': 'var(--rule-hairline-width)',
            },
          },
        },
      },
    },
  },
});

require('./theme.cjs').registerPresetRemaps(PRESET_REMAPS);

module.exports = { PRESET_REMAPS };
