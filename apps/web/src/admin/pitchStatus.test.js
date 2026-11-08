import { describe, expect, it } from 'vitest';
import { PITCH_STATUS_OPTIONS, pitchRow } from './pitchStatus.js';

describe('pitch rows', () => {
  it('reads a decline stored as rejected, with its email record, as declined', () => {
    const sent = { state: 'sent', attempt: 1 };
    expect(pitchRow({ id: 'p1', status: 'rejected', notices: { rejected: sent } }))
      .toEqual({ id: 'p1', status: 'declined', notices: { declined: sent } });
    expect(pitchRow({ id: 'p2', status: 'new' })).toEqual({ id: 'p2', status: 'new' });
  });

  it('offers each stored status once, with words', () => {
    expect(PITCH_STATUS_OPTIONS.map((o) => o.value)).toEqual(['new', 'in_review', 'accepted', 'declined']);
    expect(PITCH_STATUS_OPTIONS.every((o) => o.label)).toBe(true);
  });
});
