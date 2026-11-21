'use strict';

// Measured from the bundled font files and the matching local faces.
// Each family lists its local counterpart and glyph range, followed by one
// tuple per measured face: weight, size, ascent, descent and optional line gap.
const LATIN = 'U+20-7E,U+A0-AC,U+AE-FF,U+2013-2014,U+2018-2019,U+201C-201D,U+2026';
const BAGNARD = 'U+20-21,U+24,U+26,U+28-29,U+2C-3B,U+3F-5A,U+60-7A,U+A8,U+AB,U+B4,U+B8,U+BB,U+C0-CF,U+D1-D6,U+D9-DD,U+E0-EF,U+F1-F6,U+F9-FD,U+FF,U+152-153,U+2018-2019,U+201C-201D,U+20AC';
const AVARA = 'U+20-7E,U+A1-A3,U+A5-A9,U+AB,U+AE,U+B0-B1,U+B4,U+B6,U+B8,U+BB-CF,U+D1-DD,U+E0-EF,U+F1-FD,U+FF,U+2013-2014,U+2018-2019,U+201C-201D,U+2026';

const FONT_FALLBACKS = {
  'serif-editorial': ['serif', LATIN, [400, 117.1, 88.47, 28.61], [700, 114.41, 90.55, 29.28]],
  'sans-humanist': ['sans', LATIN, [400, 92.09, 111.19, 43.43], [700, 90.61, 113.01, 44.14]],
  'script-casual': ['script', LATIN, [400, 95.64, 100.38, 31.37]],
  'caslon-display': ['serif', LATIN, [400, 92.11, 105.3, 28.88]],
  'caslon-text': ['serif', LATIN, [400, 117.08, 82.85, 22.21], [700, 120.6, 80.43, 21.56]],
  'baskerville': ['serif', LATIN, [400, 125.93, 77.03, 21.44], [700, 122.63, 79.1, 22.02]],
  'spectral': ['serif', LATIN, [600, 106.02, 99.88, 43.67]],
  'fraunces': ['serif', LATIN, [400, 114.43, 85.46, 22.28], [700, 116.31, 84.09, 21.92]],
  'newsreader': ['serif', LATIN, [400, 104.6, 70.27, 25.33], [700, 106.63, 68.93, 24.85]],
  'plex-sans': ['sans', LATIN, [400, 100.17, 102.33, 27.45], [700, 97.8, 104.81, 28.12]],
  'plex-mono': ['mono', LATIN, [400, 99.98, 102.52, 27.5], [600, 99.98, 102.52, 27.5]],
  'archivo-condensed': ['narrow', LATIN, [400, 94.95, 92.47, 22.12], [700, 94.98, 92.44, 22.11]],
  'cabin': ['sans', LATIN, [400, 92.98, 103.79, 26.89], [700, 88.61, 108.9, 28.21]],
  'merriweather': ['serif', LATIN, [400, 117.62, 83.66, 23.21], [700, 114.85, 85.67, 23.77]],
  'public-sans': ['sans', LATIN, [400, 103.03, 92.2, 21.84], [700, 98.35, 96.59, 22.88]],
  'karrik': ['sans', LATIN, [400, 97.17, 92.62, 20.58]],
  'bagnard': ['serif', BAGNARD, [400, 117.69, 63.73, 21.24]],
  'avara': ['serif', AVARA, [700, 117.1, 71.73, 27.33, 6.83]],
  'fragment-mono': ['mono', LATIN, [400, 102.98, 92.25, 24.28]],
  'besley': ['serif', LATIN, [400, 123.04, 101.6, 34.54], [700, 126.14, 99.1, 33.69]],
  'vollkorn': ['serif', LATIN, [400, 106.67, 89.24, 41.34], [700, 109.05, 87.3, 40.44]],
  'overpass': ['sans', LATIN, [400, 98.88, 89.3, 38.73], [700, 96.5, 91.51, 39.69]],
  'overpass-mono': ['mono', LATIN, [400, 102.65, 86.02, 37.31], [700, 102.65, 86.02, 37.31]],
  'libre-franklin': ['sans', LATIN, [400, 103.05, 93.74, 23.87], [700, 98.95, 97.63, 24.86]],
};

const LOCAL_FACES = {
  serif: ['Times New Roman', 'Liberation Serif'],
  sans: ['Arial', 'Liberation Sans'],
  mono: ['Courier New', 'Liberation Mono'],
  narrow: ['Arial Narrow', 'Liberation Sans Narrow'],
  script: ['Z003 Medium Italic'],
};

function appendFontFallbacks(lines) {
  lines.push('', '/* Local fallbacks for the Latin glyphs covered by the bundled faces. */');
  for (const [setId, [kind, range, ...faces]] of Object.entries(FONT_FALLBACKS)) {
    for (const [weight, size, ascent, descent, gap = 0] of faces) {
      const suffix = weight >= 600 ? ' Bold' : '';
      const sources = LOCAL_FACES[kind].map((name) => `local('${name}${suffix}')`).join(', ');
      lines.push(
        '@font-face {',
        `  font-family: '${setId} fallback';`,
        `  font-weight: ${weight};`,
        `  src: ${sources};`,
        `  size-adjust: ${size}%;`,
        `  ascent-override: ${ascent}%;`,
        `  descent-override: ${descent}%;`,
        `  line-gap-override: ${gap}%;`,
        `  unicode-range: ${range};`,
        '}',
      );
    }
  }
}

module.exports = { appendFontFallbacks };
