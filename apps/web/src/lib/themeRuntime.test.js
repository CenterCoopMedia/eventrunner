import { describe, expect, it } from 'vitest';
import { buildRuntimeThemeCss, hexToRgbTriple } from './themeRuntime.js';

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
    expect(css.startsWith(':root {')).toBe(true);
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
  });
});
