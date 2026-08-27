// The admin's state vocabulary (design brief §5.2, admin story part 2).
//
// The point of this module is that there is exactly ONE spelling of each
// state in the whole admin, so these cases guard the words themselves as
// much as the mapping.
import { describe, expect, it } from 'vitest';
import { RECORD_STATE_IDS, RECORD_STATE_WORDS, deadMatter, recordStateOf, state } from './recordState.js';

describe('the three words', () => {
  it('are exactly these, and nothing else spells them', () => {
    expect(RECORD_STATE_WORDS).toEqual({
      draft: 'Draft',
      live: 'Live',
      dirty: 'Live with unpublished changes',
    });
    expect(RECORD_STATE_IDS).toEqual(['draft', 'live', 'dirty']);
  });

  it('reads the two-revision model into them', () => {
    expect(recordStateOf({ live: null, draft: { status: 'dirty' } }).label).toBe('Draft');
    expect(recordStateOf({ live: {}, draft: { status: 'dirty' } }).label).toBe(
      'Live with unpublished changes',
    );
    expect(recordStateOf({ live: {}, draft: { status: 'clean' } }).label).toBe('Live');
    expect(recordStateOf({ live: {}, draft: null }).label).toBe('Live');
  });

  it('names a state directly for a flow that has no draft revision', () => {
    expect(state('live')).toEqual({ id: 'live', label: 'Live' });
  });

  it('keeps every word on dead matter rather than hiding the record', () => {
    // Archived, revoked, disabled, and superseded rows drop to the
    // standing-matter ink and keep their word: nothing is hidden to make the
    // room look tidy.
    expect(deadMatter('Removed')).toEqual({ id: 'dead', label: 'Removed' });
  });
});
