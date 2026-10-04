import { describe, expect, it } from 'vitest';
import { speakerCompletion } from './speakerCompletion.js';

const speaker = {
  firstName: 'Rae',
  lastName: 'Okonkwo',
  bio: 'A speaker biography.',
  headshotPath: 'speaker-photos/rae/photo.png',
};

describe('speaker completion requirements', () => {
  it('names each missing profile field once and has no materials task without a session', () => {
    const result = speakerCompletion({
      speaker: { ...speaker, bio: '', headshotPath: null },
      sessions: [],
      materialsBySession: {},
    });

    expect(result.total).toBe(2);
    expect(result.completed).toBe(0);
    expect(result.outstanding.map((item) => item.id)).toEqual(['bio', 'headshot']);
    expect(result.total - result.completed).toBe(result.outstanding.length);
  });

  it('counts submitted profile edits and pending or approved materials as complete', () => {
    const result = speakerCompletion({
      speaker: {
        ...speaker,
        bio: '',
        headshotPath: null,
        pendingEdits: { bio: 'Awaiting review.', headshotPath: 'speaker-photos/rae/new.png' },
      },
      sessions: [{ id: 's1', title: 'One' }, { id: 's2', title: 'Two' }],
      materialsBySession: {
        s1: [{ reviewStatus: 'pending' }],
        s2: [{ reviewStatus: 'approved' }],
      },
    });

    expect(result).toMatchObject({ completed: 4, total: 4, outstanding: [] });
  });

  it('keeps rejected-only sessions outstanding and deduplicates repeated session rows', () => {
    const result = speakerCompletion({
      speaker,
      sessions: [
        { id: 's/2', title: 'Second session' },
        { id: 's/2', title: 'Second session' },
        { id: 's3', title: 'Third session' },
      ],
      materialsBySession: {
        's/2': [{ reviewStatus: 'rejected' }],
        s3: [{ reviewStatus: 'pending' }],
      },
    });

    expect(result.total).toBe(4);
    expect(result.completed).toBe(3);
    expect(result.outstanding).toEqual([{
      id: 'materials:s/2',
      label: 'Send materials for Second session',
      to: '/speaker/dashboard?session=s%2F2&tab=materials#speaker-sessions-heading',
      complete: false,
    }]);
    expect(result.total - result.completed).toBe(result.outstanding.length);
  });
});
