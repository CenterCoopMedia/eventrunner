import { describe, expect, it } from 'vitest';
import { isReadOnlyDemo } from './readOnlyDemo.js';

describe('isReadOnlyDemo', () => {
  it('disables accounts for either the static build or the deployed historical flag', () => {
    expect(isReadOnlyDemo({}, true)).toBe(true);
    expect(isReadOnlyDemo({ historicalDemo: true }, false)).toBe(true);
    expect(isReadOnlyDemo({ historicalDemo: true }, true)).toBe(true);
  });

  it('keeps ordinary and older client configurations enabled', () => {
    for (const config of [undefined, null, {}, { historicalDemo: false }, { historicalDemo: 'true' }]) {
      expect(isReadOnlyDemo(config, false)).toBe(false);
    }
    expect(isReadOnlyDemo({ shortName: 'NC Local', archivedAt: '2026-03-28' }, false)).toBe(false);
  });
});
