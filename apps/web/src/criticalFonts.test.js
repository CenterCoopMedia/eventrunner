import { describe, expect, it } from 'vitest';
import { criticalFontTags } from '../criticalFonts.js';

describe('snapshot font preload hints', () => {
  it('selects only heading/body/data families and deduplicates their files', () => {
    const css = `:root { --font-heading: 'Reading', serif; --font-body: 'Reading', serif;
      --font-data: 'Labels', sans-serif; --font-mono: 'Numbers', monospace; }
      @font-face { font-family: 'Reading'; src: url('/fonts/reading-400.woff2'); }
      @font-face { font-family: 'Reading'; src: url('/fonts/reading-700.woff2'); }
      @font-face { font-family: 'Labels'; src: url('/fonts/labels.woff2'); }
      @font-face { font-family: 'Numbers'; src: url('/fonts/numbers.woff2'); }
      @font-face { font-family: 'Unused'; src: url('/fonts/unused.woff2'); }`;
    expect(criticalFontTags(css).map((tag) => tag.attrs)).toEqual([
      { rel: 'preload', as: 'font', type: 'font/woff2', crossorigin: '', href: '/fonts/reading-400.woff2' },
      { rel: 'preload', as: 'font', type: 'font/woff2', crossorigin: '', href: '/fonts/reading-700.woff2' },
      { rel: 'preload', as: 'font', type: 'font/woff2', crossorigin: '', href: '/fonts/labels.woff2' },
    ]);
  });

  it('does not fetch a font for a system stack or an unresolved role alias', () => {
    expect(criticalFontTags(':root { --font-body: system-ui, sans-serif; --font-data: var(--font-body); }')).toEqual([]);
  });
});
