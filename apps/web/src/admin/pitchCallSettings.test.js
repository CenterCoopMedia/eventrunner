import { describe, expect, it } from 'vitest';
import { sameCallSettings } from './pitchCallSettings.js';

describe('sameCallSettings', () => {
  it('reads one deadline written two ways as the same setting', () => {
    expect(sameCallSettings({ enabled: true, closesAt: '2027-01-31T23:59:59-05:00' }, { enabled: true, closesAt: '2027-02-01T04:59:59.000Z', externalFormUrl: null })).toBe(true);
  });

  it('tells a changed switch, deadline or form address apart', () => {
    const saved = { enabled: true, closesAt: '2027-02-01T04:59:59.000Z', externalFormUrl: null };
    expect(sameCallSettings({ ...saved, enabled: false }, saved)).toBe(false);
    expect(sameCallSettings({ ...saved, closesAt: '2027-02-01T04:59:00.000Z' }, saved)).toBe(false);
    expect(sameCallSettings({ ...saved, closesAt: '' }, saved)).toBe(false);
    expect(sameCallSettings({ ...saved, externalFormUrl: 'https://forms.example.org/a' }, saved)).toBe(false);
    expect(sameCallSettings({ ...saved, externalFormUrl: 'http://forms.example.org/a' }, saved)).toBe(false);
    expect(sameCallSettings({ ...saved, externalFormUrl: '  ' }, saved)).toBe(true);
  });
});
