import { describe, expect, it } from 'vitest';
import { configuredThemeColor } from './themeColors.js';

const hex = (digits) => `#${digits}`;

describe('configuredThemeColor', () => {
  it('accepts the seeded color spelling', () => {
    expect(configuredThemeColor({ brandPrimary: hex('123456') }, 'primary')).toBe(hex('123456'));
    expect(configuredThemeColor({ brandInk: hex('234567') }, 'ink')).toBe(hex('234567'));
    expect(configuredThemeColor({ brandSurface: hex('f4f5f6') }, 'surface')).toBe(hex('f4f5f6'));
  });

  it('gives the canonical spelling precedence', () => {
    expect(
      configuredThemeColor(
        { brandPrimary: hex('123456'), primary: hex('abcdef') },
        'primary',
      ),
    ).toBe(hex('abcdef'));
  });

  it('ignores unknown and empty values', () => {
    expect(configuredThemeColor({ unknownRole: hex('123456') }, 'primary')).toBe('');
    expect(configuredThemeColor({ brandPrimary: '' }, 'primary')).toBe('');
  });
});
