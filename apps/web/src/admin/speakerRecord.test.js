import { describe, expect, it } from 'vitest';
import { pendingFieldsOf, speakerRecordState, speakerStatusOptions } from './speakerRecord.js';

const OPTIONS = [{ value: 'draft' }, { value: 'approved' }, { value: 'removed' }];
const values = (options) => options.map((option) => option.value);

describe('speaker status choices', () => {
  it('offers a removed speaker only Draft and Removed', () => {
    expect(values(speakerStatusOptions(OPTIONS, 'removed'))).toEqual(['draft', 'removed']);
  });

  it('keeps Draft for an unpublished linked speaker, as the server stores Draft as accepted', () => {
    expect(values(speakerStatusOptions(OPTIONS, 'accepted'))).toEqual(['draft', 'approved', 'removed']);
  });

  it('offers a draft, an unstored status and a new speaker every choice', () => {
    expect(values(speakerStatusOptions(OPTIONS, 'draft'))).toEqual(['draft', 'approved', 'removed']);
    expect(values(speakerStatusOptions(OPTIONS, null))).toEqual(['draft', 'approved', 'removed']);
    expect(values(speakerStatusOptions(OPTIONS, undefined))).toEqual(['draft', 'approved', 'removed']);
  });
});

describe('speaker record words', () => {
  it('reads pending edits and the three record states', () => {
    expect(pendingFieldsOf({ pendingEdits: { bio: 'x' } })).toEqual(['bio']);
    expect(pendingFieldsOf({})).toEqual([]);
    expect(speakerRecordState(null)).toBeNull();
    expect(speakerRecordState({ status: 'approved', pendingEdits: { bio: 'x' } }))
      .toEqual(speakerRecordState({ status: 'approved', pendingEdits: { headshotPath: 'y' } }));
    expect(speakerRecordState({ status: 'approved' })).not.toEqual(speakerRecordState({ status: 'draft' }));
  });
});
