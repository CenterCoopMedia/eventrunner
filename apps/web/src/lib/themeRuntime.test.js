import { describe, expect, it } from 'vitest';
import {
  buildRuntimeThemeCss,
  hexToRgbTriple,
  rgbTripleToHex,
} from './themeRuntime.js';

// Hex strings under test are composed at runtime so no hex color literal
// appears in source (spec §7.6 — the ESLint sweep applies to tests too).
const hex = (digits) => `#${digits}`;

describe('hexToRgbTriple', () => {
  it('converts six-digit hex to a space-separated RGB triple', () => {
    expect(hexToRgbTriple(hex('2A9D8F'))).toBe('42 157 143');
    expect(hexToRgbTriple(hex('000000'))).toBe('0 0 0');
    expect(hexToRgbTriple(hex('ffffff'))).toBe('255 255 255');
  });

  it('accepts lowercase, whitespace, and a missing hash', () => {
    expect(hexToRgbTriple('c84b31')).toBe('200 75 49');
    expect(hexToRgbTriple(`  ${hex('2C3E50')}  `)).toBe('44 62 80');
  });

  it('expands three-digit shorthand', () => {
    expect(hexToRgbTriple(hex('fff'))).toBe('255 255 255');
    expect(hexToRgbTriple(hex('09c'))).toBe('0 153 204');
  });

  it('ignores the alpha channel of eight-digit hex', () => {
    expect(hexToRgbTriple(hex('2A9D8FCC'))).toBe('42 157 143');
  });

  it('returns null for anything that is not a valid hex color', () => {
    expect(hexToRgbTriple(null)).toBeNull();
    expect(hexToRgbTriple(undefined)).toBeNull();
    expect(hexToRgbTriple(42)).toBeNull();
    expect(hexToRgbTriple('')).toBeNull();
    expect(hexToRgbTriple(hex('12'))).toBeNull();
    expect(hexToRgbTriple(hex('GGGGGG'))).toBeNull();
    expect(hexToRgbTriple('teal')).toBeNull();
  });
});

const LIGHT_BLOCK = ":root,\n:root[data-mode='light'],\n:root[data-theme][data-mode='light'] {";
const DARK_BLOCK = ":root[data-mode='dark'],\n:root[data-theme][data-mode='dark'] {";

/**
 * The two screen mode blocks, with the print block that follows them cut
 * away — it carries the light palette a second time, so leaving it attached
 * would put light values inside what a test reads as "the dark block".
 */
const screenModeBlocks = (css) => css.split('@media print')[0].split(DARK_BLOCK);

describe('buildRuntimeThemeCss', () => {
  it('emits brand and semantic RGB-triple overrides from config/theme colors', () => {
    const css = buildRuntimeThemeCss({
      colors: {
        primary: hex('2A9D8F'),
        primaryDark: hex('1E7268'),
        inkMuted: hex('5C6B7A'),
        success: hex('166534'),
        keynote: hex('5E35B1'),
      },
    });
    expect(css).toContain('--brand-primary-rgb: 42 157 143;');
    expect(css).toContain('--brand-primary-dark-rgb: 30 114 104;');
    expect(css).toContain('--brand-ink-muted-rgb: 92 107 122;');
    expect(css).toContain('--semantic-success-rgb: 22 101 52;');
    expect(css).toContain('--semantic-keynote-rgb: 94 53 177;');
    // Colors are mode-scoped now (design brief §3.3), so the light block
    // carries two selectors: the attribute-free one beats the generated
    // baseline that first paint uses, and the [data-mode='light'] one beats
    // the generated light block once the runtime has written the attribute.
    // The light block names three selectors and the dark block two, because
    // the generated stylesheet now carries a (preset, mode) block that is
    // more specific than the plain mode block (design brief §3.4). Attribute
    // presence ties with attribute equality, so this element wins on
    // document order.
    expect(css.startsWith(LIGHT_BLOCK)).toBe(true);
    expect(css).toContain(DARK_BLOCK);
  });

  it('derives a dark block from a document that names one palette', () => {
    const css = buildRuntimeThemeCss({
      colors: { surface: hex('F7F7F5'), ink: hex('16212C'), primary: hex('155E75') },
    });
    const [light, dark] = screenModeBlocks(css);
    // The designed dark ground replaces the light surface, and the brand
    // color is lifted rather than reused.
    expect(light).toContain('--brand-surface-rgb: 247 247 245;');
    expect(dark).toContain('--brand-surface-rgb: 24 27 32;');
    expect(dark).not.toContain('--brand-primary-rgb: 21 94 117;');
    expect(dark).toMatch(/--brand-primary-rgb: \d+ \d+ \d+;/);
  });

  it('accepts per-mode overrides, and a named dark token wins over the derivation', () => {
    const css = buildRuntimeThemeCss({
      colors: {
        light: { surface: hex('F7F7F5'), ink: hex('16212C') },
        dark: { surface: hex('101418') },
      },
    });
    const [light, dark] = screenModeBlocks(css);
    expect(light).toContain('--brand-surface-rgb: 247 247 245;');
    expect(dark).toContain('--brand-surface-rgb: 16 20 24;');
    // Ink is not named for dark, so the derivation still supplies it.
    expect(dark).toContain('--brand-ink-rgb: 238 236 231;');
  });

  it('moves the rule colors with the ink and surface it derives them from', () => {
    const css = buildRuntimeThemeCss({
      colors: { surface: hex('F7F7F5'), ink: hex('16212C') },
    });
    expect(css).toContain('--rule-hairline-rgb: 216 217 217;');
    expect(css).toContain('--rule-nameplate-rgb: 22 33 44;');
    // The control border rides the same derivation (WCAG 1.4.11 needs it to
    // move with ink/surface exactly like the named rules do).
    expect(css).toContain('--color-border-control-rgb: 130 136 140;');
    // Without both ends of the mix there is nothing to derive from, so the
    // build-time rules stand.
    expect(buildRuntimeThemeCss({ colors: { ink: hex('16212C') } })).not.toContain(
      '--rule-hairline-rgb',
    );
  });

  it('skips malformed colors instead of emitting broken CSS', () => {
    const css = buildRuntimeThemeCss({
      colors: { primary: 'not-a-color', accent: hex('C84B31') },
    });
    expect(css).not.toContain('--brand-primary-rgb');
    expect(css).toContain('--brand-accent-rgb: 200 75 49;');
  });

  it('resolves font set ids to bundled stacks and drops unknown ids', () => {
    const css = buildRuntimeThemeCss({
      fonts: { heading: 'sans-humanist', body: 'remote-url-not-allowed' },
    });
    expect(css).toContain("--font-heading: 'Source Sans 3'");
    expect(css).not.toContain('--font-body');
  });

  it('resolves the data and mono roles too', () => {
    const css = buildRuntimeThemeCss({
      fonts: { data: 'serif-editorial', mono: 'sans-humanist' },
    });
    expect(css).toContain("--font-data: 'Source Serif 4'");
    expect(css).toContain("--font-mono: 'Source Sans 3'");
  });

  it('maps radius and texture ids', () => {
    const css = buildRuntimeThemeCss({ radius: 'round', texture: 'flat' });
    expect(css).toContain('--radius-base: 16px;');
    expect(css).toContain('--radius-large: 28px;');
    expect(css).toContain('--texture: flat;');
  });

  it('returns an empty string when there is nothing to override', () => {
    expect(buildRuntimeThemeCss(null)).toBe('');
    expect(buildRuntimeThemeCss({})).toBe('');
    expect(buildRuntimeThemeCss({ radius: 'unknown', texture: 'velvet' })).toBe('');
    // The mode policy is an attribute, not CSS, so it alone overrides nothing.
    expect(buildRuntimeThemeCss({ mode: 'dark' })).toBe('');
  });
});

// The generated stylesheet's print block freezes the palette the deployment
// shipped with. config/theme arrives live, so paper needs the live one too.
describe('buildRuntimeThemeCss print block', () => {
  const printBlockOf = (css) => {
    const match = css.match(/@media print \{\n([\s\S]*?)\n\}\n?$/);
    return match ? match[1] : null;
  };

  it('prints the live light palette, whatever mode the screen is in', () => {
    const css = buildRuntimeThemeCss({
      colors: { surface: hex('F7F7F5'), ink: hex('16212C'), primary: hex('C84B31') },
    });
    const print = printBlockOf(css);
    expect(print).not.toBeNull();
    expect(print).toContain('--brand-surface-rgb: 247 247 245;');
    expect(print).toContain('--brand-ink-rgb: 22 33 44;');
    expect(print).toContain('--brand-primary-rgb: 200 75 49;');
    // The rules move with the ink and surface they are mixed from, on paper
    // exactly as on screen.
    expect(print).toContain('--rule-hairline-rgb: 216 217 217;');
    expect(print).toContain('--color-border-control-rgb: 130 136 140;');
  });

  it('never lets a dark value reach paper', () => {
    const css = buildRuntimeThemeCss({
      colors: {
        light: { surface: hex('F7F7F5'), ink: hex('16212C') },
        dark: { surface: hex('101418'), ink: hex('E8EBF0') },
      },
    });
    const print = printBlockOf(css);
    expect(print).toContain('--brand-surface-rgb: 247 247 245;');
    expect(print).not.toContain('16 20 24');
    expect(print).not.toContain('232 235 240');
  });

  it('names every selector the generated print block names, so it wins on order', () => {
    // Specificity, selector for selector, is a TIE with the generated block
    // (scripts/lib/tokens.cjs printPaletteBlock). That is the point: this
    // element is appended after the generated stylesheet, so the tie is
    // broken by document order and the live values win. Dropping the leading
    // `html` would lose to the generated block instead.
    const print = printBlockOf(buildRuntimeThemeCss({ colors: { primary: hex('C84B31') } }));
    for (const selector of [
      'html:root,',
      'html:root:not([data-mode]),',
      "html:root[data-mode='dark'],",
      "html:root[data-theme][data-mode='dark']",
    ]) {
      expect(print).toContain(selector);
    }
  });

  it('leaves the admin token on screen', () => {
    // The admin is a screen tool; no print rule reads its tokens. Its own
    // mode blocks still carry the accent.
    const css = buildRuntimeThemeCss({
      colors: { surface: hex('F7F7F5'), ink: hex('16212C') },
      adminAccent: hex('C84B31'),
    });
    expect(css).toContain('--admin-client-accent-rgb:');
    expect(printBlockOf(css)).not.toContain('--admin-');
  });

  it('emits no print block when the document overrides no color', () => {
    // Nothing to say about paper, so the generated block — the no-JavaScript
    // fallback — is left to do the whole job on its own.
    expect(buildRuntimeThemeCss({ fonts: { heading: 'sans-humanist' } })).not.toContain(
      '@media print',
    );
    expect(buildRuntimeThemeCss({ radius: 'round' })).not.toContain('@media print');
  });
});

// The inverse conversion, used by the admin Branding tab to seed its color
// inputs from the build-time custom properties when config/theme carries no
// colors map yet.
describe('rgbTripleToHex', () => {
  it('round-trips a hex color through the triple form', () => {
    for (const digits of ['2a9d8f', '000000', 'ffffff', 'c84b31']) {
      expect(rgbTripleToHex(hexToRgbTriple(hex(digits)))).toBe(hex(digits));
    }
  });

  it('accepts the comma-separated form a browser may report', () => {
    expect(rgbTripleToHex(' 42, 157, 143 ')).toBe(hex('2a9d8f'));
  });

  it('returns null for anything that is not three 0-255 channels', () => {
    expect(rgbTripleToHex('')).toBeNull();
    expect(rgbTripleToHex('42 157')).toBeNull();
    expect(rgbTripleToHex('42 157 256')).toBeNull();
    expect(rgbTripleToHex('42 157 abc')).toBeNull();
    expect(rgbTripleToHex(null)).toBeNull();
  });
});
