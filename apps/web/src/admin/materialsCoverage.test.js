// Materials coverage (issue #189): the rule the panel states, on rows
// shaped the way useAdminSessions gives them.
import { describe, expect, it } from 'vitest';
import { liveSessions, materialsCoverage } from './materialsCoverage.js';
import { mergeSessionRevisions, UNKNOWN_DAY_LABEL } from './sessionDoc.js';

const DAYS = [
  { id: 'day-1', label: 'Day one' },
  { id: 'day-2', label: 'Day two' },
];

function rows(live, drafts = []) {
  return mergeSessionRevisions(live, drafts, DAYS, 'UTC').flatMap((group) => group.rows);
}

function session(id, speakerIds, extra = {}) {
  return { id, title: `Title ${id}`, dayId: 'day-1', startTime: '09:00', speakerIds, ...extra };
}

const SPEAKERS = [
  { id: 'ada', displayName: 'Ada Quill', status: 'confirmed' },
  { id: 'bo', displayName: 'Bo Chen', status: 'confirmed' },
  { id: 'cy', displayName: 'Cy Reyes', status: 'confirmed' },
  { id: 'gone', displayName: 'Gone Speaker', status: 'removed' },
];

function coverage(live, materials, { drafts = [], speakers = SPEAKERS } = {}) {
  return materialsCoverage({ sessions: liveSessions(rows(live, drafts), DAYS, 'UTC'), speakers, materials });
}

const names = (list) => list.map((entry) => entry.id);

describe('materialsCoverage', () => {
  it('counts a pending or an approved material, and not a rejected one', () => {
    const result = coverage(
      [session('s1', ['ada']), session('s2', ['bo']), session('s3', ['cy'])],
      [
        { sessionId: 's1', reviewStatus: 'pending' },
        { sessionId: 's2', reviewStatus: 'approved' },
        { sessionId: 's3', reviewStatus: 'rejected' },
      ],
    );
    expect(result.consideredCount).toBe(3);
    expect(result.coveredCount).toBe(2);
    expect(names(result.uncoveredSessions)).toEqual(['s3']);
    expect(names(result.uncoveredSpeakers)).toEqual(['cy']);
  });

  it('leaves out a session with no speakers, and a draft-only session', () => {
    const result = coverage(
      [session('s1', ['ada']), session('empty', []), { id: 'nolist', title: 'No list', dayId: 'day-1' }],
      [],
      { drafts: [session('draft-only', ['bo'], { status: 'dirty' })] },
    );
    expect(result.consideredCount).toBe(1);
    expect(names(result.uncoveredSessions)).toEqual(['s1']);
    expect(names(result.uncoveredSpeakers)).toEqual(['ada']);
  });

  it('reads the live speakers: a draft that adds a speaker does not change coverage', () => {
    const live = [session('s1', ['ada'])];
    const before = coverage(live, []);
    const after = coverage(live, [], { drafts: [session('s1', ['ada', 'bo'], { title: 'Draft title', status: 'dirty' })] });
    expect(after).toEqual(before);
    expect(after.uncoveredSessions[0]).toMatchObject({ title: 'Title s1', speakers: [{ id: 'ada', name: 'Ada Quill', known: true }] });
  });

  it('does not count a removed speaker, and leaves out a session whose only speaker is removed', () => {
    const result = coverage([session('s1', ['ada', 'gone']), session('s2', ['gone'])], []);
    expect(result.consideredCount).toBe(1);
    expect(result.uncoveredSessions[0].speakers.map((speaker) => speaker.name)).toEqual(['Ada Quill']);
    expect(names(result.uncoveredSpeakers)).toEqual(['ada']);
  });

  it('names a speaker under an uncovered session but not in the speaker list when another session of theirs is covered', () => {
    const result = coverage(
      [session('s1', ['ada']), session('s2', ['ada', 'bo'])],
      [{ sessionId: 's1', reviewStatus: 'approved' }],
    );
    expect(names(result.uncoveredSessions)).toEqual(['s2']);
    expect(result.uncoveredSessions[0].speakers.map((speaker) => speaker.name)).toEqual(['Ada Quill', 'Bo Chen']);
    expect(names(result.uncoveredSpeakers)).toEqual(['bo']);
  });

  it('does not list a speaker who is on no session', () => {
    const result = coverage([session('s1', ['ada'])], []);
    expect(names(result.uncoveredSpeakers)).toEqual(['ada']);
    expect(names(result.uncoveredSpeakers)).not.toContain('cy');
  });

  it('counts an unknown speaker id and shows it as the id', () => {
    const result = coverage([session('s1', ['ghost-id'])], []);
    expect(result.consideredCount).toBe(1);
    expect(result.uncoveredSpeakers).toEqual([
      { id: 'ghost-id', name: 'ghost-id', known: false, sessions: [{ id: 's1', title: 'Title s1' }] },
    ]);
  });

  it('answers zero when no session has a speaker', () => {
    expect(coverage([session('s1', [])], [])).toEqual({
      consideredCount: 0,
      coveredCount: 0,
      uncoveredSessions: [],
      uncoveredSpeakers: [],
    });
  });

  it('keeps schedule order, and each session carries its live day label', () => {
    const result = coverage(
      [
        session('late', ['ada'], { dayId: 'day-2', startTime: '09:00' }),
        session('early', ['bo'], { dayId: 'day-1', startTime: '11:00' }),
        session('first', ['cy'], { dayId: 'day-1', startTime: '08:00' }),
        session('lost', ['ada'], { dayId: 'day-9' }),
        session('floating', ['bo'], { dayId: '' }),
      ],
      [],
    );
    expect(names(result.uncoveredSessions)).toEqual(['first', 'early', 'late', 'lost', 'floating']);
    expect(result.uncoveredSessions.map((entry) => entry.dayLabel)).toEqual([
      'Day one', 'Day one', 'Day two', UNKNOWN_DAY_LABEL, 'Unscheduled',
    ]);
    // Speakers are listed by name.
    expect(result.uncoveredSpeakers.map((entry) => entry.name)).toEqual(['Ada Quill', 'Bo Chen', 'Cy Reyes']);
    expect(result.uncoveredSpeakers[0].sessions.map((entry) => entry.id)).toEqual(['late', 'lost']);
  });
});
