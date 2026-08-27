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
  DEFAULT_PRESET_ID,
  FONT_SET_IDS,
  FONT_SET_STACKS,
  MODE_POLICY_IDS,
  MOTIF_SET_IDS,
  PRESET_IDS,
  recommendedConfiguration,
  RADIUS_IDS,
  THEME_COLOR_KEYS,
  THEME_COLOR_PROPERTIES,
  THEME_FONT_ROLES,
  TEXTURE_IDS,
} from './themeRuntime.js';
import motifs from '../../../../design/tokens/motifs.json';

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

  it('offers exactly the presets and motif sets the server accepts', () => {
    // A picker that offered a seventh preset would let an operator save a
    // value updateTheme rejects; one that offered fewer would hide a look
    // the system can render.
    expect([...PRESET_IDS]).toEqual([...sharedTheme.THEME_PRESET_IDS]);
    expect(PRESET_IDS).toContain(DEFAULT_PRESET_ID);
    expect(DEFAULT_PRESET_ID).toBe(sharedTheme.DEFAULT_PRESET_ID);
    expect([...MOTIF_SET_IDS]).toEqual([...sharedTheme.THEME_MOTIF_SET_IDS]);
  });

  it('offers all six styles with no second tier, and leads with the default', () => {
    // Owner calibration, 2026-08-27: every style is first-class. The picker
    // shows one flat list in catalog order, and the style a fresh deployment
    // starts on is the one it leads with.
    expect(PRESET_IDS).toHaveLength(6);
    expect(PRESET_IDS[0]).toBe(DEFAULT_PRESET_ID);
    for (const id of PRESET_IDS) {
      expect(sharedTheme.getPreset(id)).not.toHaveProperty('tier');
    }
  });

  it('builds the same recommended configuration the server would', () => {
    // Picking a style hands the operator a working document, not a blank
    // one: the style id plus a pick in every option group it declares.
    for (const id of PRESET_IDS) {
      const configuration = recommendedConfiguration(id);
      expect(configuration).toEqual(sharedTheme.recommendedConfiguration(id));
      expect(configuration.preset).toBe(id);
      expect(Object.keys(configuration.optionPicks).sort()).toEqual(
        Object.keys(sharedTheme.getPreset(id).options).sort(),
      );
    }
  });
});

describe('theme vocabulary parity: browser against the token generator', () => {
  it('names the same bundled font sets the generator can emit', () => {
    expect([...FONT_SET_IDS].sort()).toEqual(Object.keys(FONT_SETS).sort());
  });

  it('names the same radius scale the generator can emit', () => {
    expect([...RADIUS_IDS].sort()).toEqual(Object.keys(RADIUS_SCALES).sort());
  });

  it('resolves every bundled set to a stack on both sides', () => {
    // The browser holds stacks only; the generator holds the family, the
    // stack, and the files. The stacks must agree exactly, or a runtime
    // override would swap a role onto a family the stylesheet never
    // declared an @font-face for.
    for (const setId of FONT_SET_IDS) {
      expect(FONT_SETS[setId].stack, setId).toBe(FONT_SET_STACKS[setId]);
    }
  });

  it('mirrors the motif sets declared in the token JSON', () => {
    // design/tokens/motifs.json is the source of truth for the sets; the
    // browser list is what the editor's motif control offers.
    expect([...MOTIF_SET_IDS].sort()).toEqual(Object.keys(motifs.sets).sort());
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
