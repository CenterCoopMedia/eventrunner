'use strict';

// Measured from the bundled font files and the matching local faces.
// Each row holds the local family, glyph range, weight, and size, ascent,
// descent and optional line gap percentages.
const LATIN = 'U+20-7E,U+A0-AC,U+AE-FF,U+2013-2014,U+2018-2019,U+201C-201D,U+2026';
const BAGNARD = 'U+20-21,U+24,U+26,U+28-29,U+2C-3B,U+3F-5A,U+60-7A,U+A8,U+AB,U+B4,U+B8,U+BB,U+C0-CF,U+D1-D6,U+D9-DD,U+E0-EF,U+F1-F6,U+F9-FD,U+FF,U+152-153,U+2018-2019,U+201C-201D,U+20AC';
const AVARA = 'U+20-7E,U+A1-A3,U+A5-A9,U+AB,U+AE,U+B0-B1,U+B4,U+B6,U+B8,U+BB-CF,U+D1-DD,U+E0-EF,U+F1-FD,U+FF,U+2013-2014,U+2018-2019,U+201C-201D,U+2026';

const FONT_FALLBACKS = {
  'serif-editorial': ['serif', LATIN, 400, 117.1, 88.47, 28.61],
  'sans-humanist': ['sans', LATIN, 400, 92.09, 111.19, 43.43],
  'script-casual': ['script', LATIN, 400, 95.64, 100.38, 31.37],
  'caslon-display': ['serif', LATIN, 400, 92.11, 105.3, 28.88],
  'caslon-text': ['serif', LATIN, 400, 117.08, 82.85, 22.21],
  'baskerville': ['serif', LATIN, 400, 125.93, 77.03, 21.44],
  'spectral': ['serif', LATIN, 600, 106.02, 99.88, 43.67],
  'fraunces': ['serif', LATIN, 400, 114.43, 85.46, 22.28],
  'newsreader': ['serif', LATIN, 400, 104.6, 70.27, 25.33],
  'plex-sans': ['sans', LATIN, 400, 100.17, 102.33, 27.45],
  'plex-mono': ['mono', LATIN, 400, 99.98, 102.52, 27.5],
  'archivo-condensed': ['narrow', LATIN, 400, 94.95, 92.47, 22.12],
  'cabin': ['sans', LATIN, 400, 92.98, 103.79, 26.89],
  'merriweather': ['serif', LATIN, 400, 117.62, 83.66, 23.21],
  'public-sans': ['sans', LATIN, 400, 103.03, 92.2, 21.84],
  'karrik': ['sans', LATIN, 400, 97.17, 92.62, 20.58],
  'bagnard': ['serif', BAGNARD, 400, 117.69, 63.73, 21.24],
  'avara': ['serif', AVARA, 700, 117.1, 71.73, 27.33, 6.83],
  'fragment-mono': ['mono', LATIN, 400, 102.98, 92.25, 24.28],
  'besley': ['serif', LATIN, 400, 123.04, 101.6, 34.54],
  'vollkorn': ['serif', LATIN, 400, 106.67, 89.24, 41.34],
  'overpass': ['sans', LATIN, 400, 98.88, 89.3, 38.73],
  'overpass-mono': ['mono', LATIN, 400, 102.65, 86.02, 37.31],
  'libre-franklin': ['sans', LATIN, 400, 103.05, 93.74, 23.87],
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
  for (const [setId, metrics] of Object.entries(FONT_FALLBACKS)) {
    const [kind, range, weight, size, ascent, descent, gap = 0] = metrics;
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

module.exports = { appendFontFallbacks };
