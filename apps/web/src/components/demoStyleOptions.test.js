import { describe, expect, it } from 'vitest';
import { PRESET_IDS } from '../lib/themeRuntime.js';
import {
  DEMO_STYLE_OPTIONS,
  adjacentDemoStyleId,
  getDemoStyleOption,
  isDemoStyleId,
} from './demoStyleOptions.js';

describe('demoStyleOptions', () => {
  it('covers every shipped preset in picker order', () => {
    expect(DEMO_STYLE_OPTIONS.map(({ id }) => id)).toEqual(PRESET_IDS);
    expect(DEMO_STYLE_OPTIONS).toHaveLength(6);
    expect(
      DEMO_STYLE_OPTIONS.every(({ label, summary }) => label && summary),
    ).toBe(true);
  });

  it('validates and reads style ids', () => {
    expect(isDemoStyleId('atlas')).toBe(true);
    expect(isDemoStyleId('unknown')).toBe(false);
    expect(getDemoStyleOption('field-guide').label).toBe('Field Guide');
    expect(getDemoStyleOption('unknown')).toEqual(DEMO_STYLE_OPTIONS[0]);
  });

  it('moves in either direction and wraps at both ends', () => {
    const first = DEMO_STYLE_OPTIONS[0].id;
    const last = DEMO_STYLE_OPTIONS.at(-1).id;
    expect(adjacentDemoStyleId(first, -1)).toBe(last);
    expect(adjacentDemoStyleId(last, 1)).toBe(first);
  });
});
