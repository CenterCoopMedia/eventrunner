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

  it('never renders a day id as its heading: date, then position, before the id', () => {
    // #248: "Day one" came from a real label, but day-2 and day-3 fell back
    // to their raw document ids the moment a day carried no label. A
    // heading must read the day's date, and only reach for its position
    // ("Day 2", 1-indexed, digits) when even the date cannot be resolved.
    const days = [
      { id: 'day-1', label: 'Day one', date: '2026-10-14' },
      { id: 'day-2', date: '2026-10-15' },
      { id: 'day-3' },
    ];
    const drafts = [
      { id: 's1', dayId: 'day-1', title: 'One' },
      { id: 's2', dayId: 'day-2', title: 'Two' },
      { id: 's3', dayId: 'day-3', title: 'Three' },
    ];
    const groups = mergeSessionRevisions([], drafts, days, 'America/New_York');
    expect(groups.map((group) => group.label)).toEqual([
      'Day one',
      'Thursday, October 15',
      'Day 3',
    ]);
  });

  it('never renders an unconfigured day id as its heading either', () => {
    // #248 review follow-up: a session can carry a dayId that is not, or is
    // no longer, in config/event.days at all — the exact case an
    // init-event-then-seed-demo-event run leaves behind when the answers
    // file configures only day-1 and the demo seed's sessions still land on
    // day-2 and day-3 (seed-demo-event.cjs skips an existing config/event
    // doc), and the case an operator makes by deleting a day sessions still
    // point at. That is a different problem from "the day has no label" —
    // there is no day record here to read a label or a date from — so it
    // gets its own plain heading rather than reusing the day-with-no-label
    // fallback, and never the raw dayId.
    const live = [
      { id: 's1', dayId: 'day-1', title: 'One' },
      { id: 's2', dayId: 'day-2', title: 'Two' },
      { id: 's3', dayId: 'day-3', title: 'Three' },
    ];
    const days = [{ id: 'day-1', label: 'Day one', date: '2027-05-13' }];
    const groups = mergeSessionRevisions(live, [], days, 'America/New_York');
    expect(groups.map((group) => group.label)).toEqual([
      'Day one',
      'Not on a configured day',
      'Not on a configured day',
    ]);
    expect(groups.map((group) => group.dayId)).toEqual(['day-1', 'day-2', 'day-3']);
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
      track: '', placeId: '', location: '', parentId: '', recordingUrl: '', visible: true,
    })).toEqual({
      title: 'Session', description: '', dayId: 'day-1', startTime: '09:00', endTime: '10:00',
      track: null, placeId: null, location: null, parentId: null, recordingUrl: null,
    });
  });

  it('trims a recording link and sends it as it was typed', () => {
    expect(sessionFields({
      title: 'Session', description: '', dayId: 'day-1', startTime: '09:00', endTime: '10:00',
      recordingUrl: '  https://video.example.org/watch?v=abc  ',
    }).recordingUrl).toBe('https://video.example.org/watch?v=abc');
  });
});
