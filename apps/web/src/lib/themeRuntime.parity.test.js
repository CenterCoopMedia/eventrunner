// Contract test for the theme vocabularies (design brief §3.2, §3.3).
//
// The Branding tab offers the operator a list of modes, font roles, font
// sets, textures, and radii. The server validates a saved document against
// its own lists, and the token generator resolves it against a third set.
// A list that drifts between the three means the editor can offer a value
// the server rejects, or the generator silently drops.
//
// This is the same shape of test the admin block palette uses
// (admin/blockTypes.test.js): import the other side's source directly and
// compare, rather than restating either list here.
import { describe, expect, it } from 'vitest';
import * as sharedTheme from 'shared/theme';
import * as generatorTheme from '../../../../scripts/lib/theme.cjs';
import {
  DEFAULT_MODE_POLICY,
  FONT_SET_IDS,
  MODE_POLICY_IDS,
  RADIUS_IDS,
  THEME_COLOR_KEYS,
  THEME_COLOR_PROPERTIES,
  THEME_FONT_ROLES,
  TEXTURE_IDS,
} from './themeRuntime.js';

const { FONT_SETS, RADIUS_SCALES, CSS_VARIABLE_STEM } =
  generatorTheme.default ?? generatorTheme;

describe('theme vocabulary parity: browser against the shared schema', () => {
  it('offers exactly the mode policies the server accepts', () => {
    expect([...MODE_POLICY_IDS]).toEqual([...sharedTheme.THEME_MODE_POLICIES]);
    expect(DEFAULT_MODE_POLICY).toBe(sharedTheme.DEFAULT_MODE_POLICY);
    expect(MODE_POLICY_IDS).toContain(DEFAULT_MODE_POLICY);
  });

  it('offers exactly the font roles the server accepts', () => {
    expect([...THEME_FONT_ROLES]).toEqual([...sharedTheme.THEME_FONT_ROLES]);
    // The retired role is not offered, but a stored document may still
    // carry it for one release.
    expect(THEME_FONT_ROLES).not.toContain(sharedTheme.LEGACY_FONT_ROLE);
  });

  it('offers exactly the font sets, textures, and radii the server accepts', () => {
    expect([...FONT_SET_IDS].sort()).toEqual([...sharedTheme.THEME_FONT_SET_IDS].sort());
    expect([...TEXTURE_IDS]).toEqual([...sharedTheme.THEME_TEXTURES]);
    expect([...RADIUS_IDS].sort()).toEqual([...sharedTheme.THEME_RADIUS_IDS].sort());
  });

  it('edits exactly the color roles the server accepts', () => {
    expect([...THEME_COLOR_KEYS].sort()).toEqual([...sharedTheme.THEME_COLOR_KEYS].sort());
  });
});

describe('theme vocabulary parity: browser against the token generator', () => {
  it('names the same bundled font sets the generator can emit', () => {
    expect([...FONT_SET_IDS].sort()).toEqual(Object.keys(FONT_SETS).sort());
  });

  it('names the same radius scale the generator can emit', () => {
    expect([...RADIUS_IDS].sort()).toEqual(Object.keys(RADIUS_SCALES).sort());
  });

  it('overrides the same custom properties the generator writes', () => {
    // The generator keys its stems by the seed spelling; the browser keys
    // its properties by the canonical role. Fold the two together and the
    // property names must match exactly, or a runtime override would write
    // a property nothing reads.
    const generated = {};
    for (const [seedKey, stem] of Object.entries(CSS_VARIABLE_STEM)) {
      generated[sharedTheme.canonicalColorKey(seedKey)] = `--${stem}-rgb`;
    }
    expect(generated).toEqual({ ...THEME_COLOR_PROPERTIES });
  });
});
