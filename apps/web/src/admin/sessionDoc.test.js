import { describe, expect, it } from 'vitest';
import {
  mergeSessionRevisions,
  publishSetForSession,
  sessionFields,
  sessionIdFromTitle,
} from './sessionDoc.js';

describe('session document helpers', () => {
  it('merges revisions and keeps children directly below their parent', () => {
    const live = [
      { id: 'later', dayId: 'day-1', startTime: '10:00', title: 'Later' },
      { id: 'parent', dayId: 'day-1', startTime: '09:00', title: 'Parent' },
      { id: 'child', dayId: 'day-1', startTime: '11:00', title: 'Child', parentId: 'parent' },
    ];
    const drafts = [
      { id: 'parent', dayId: 'day-1', startTime: '09:00', title: 'Parent changed', status: 'dirty' },
    ];
    const groups = mergeSessionRevisions(live, drafts, [{ id: 'day-1', label: 'Day one' }]);
    expect(groups[0].rows.map((row) => row.id)).toEqual(['parent', 'child', 'later']);
    expect(groups[0].rows[0].state.id).toBe('dirty');
  });

  it('includes a draft-only parent when publishing its child', () => {
    const groups = mergeSessionRevisions(
      [],
      [
        { id: 'parent', dayId: 'day-1', title: 'Parent' },
        { id: 'child', dayId: 'day-1', title: 'Child', parentId: 'parent' },
      ],
    );
    const rows = groups.flatMap((group) => group.rows);
    expect(publishSetForSession(rows[1], rows)).toEqual(['parent', 'child']);
  });

  it('normalizes ids and sends structural clears as null', () => {
    expect(sessionIdFromTitle('Café: Opening Session')).toBe('cafe-opening-session');
    expect(sessionFields({
      title: ' Session ', description: '', dayId: 'day-1', startTime: '09:00', endTime: '10:00',
      track: '', placeId: '', location: '', parentId: '', visible: true,
    })).toEqual({
      title: 'Session', description: '', dayId: 'day-1', startTime: '09:00', endTime: '10:00',
      track: null, placeId: null, location: null, parentId: null,
    });
  });
});
