'use strict';

// The reminder planner (issue #518, ADR 0006): fire instants on calendar
// days at a local send time, daylight saving gaps and overlaps, windows,
// catch-up, and quiet hours, in zones east and west of UTC.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_OFFSETS,
  addCalendarDays,
  planReminders,
  resolveLocalInstant,
  windowKeyFor,
} = require('./reminderSchedule.cjs');

const NY = 'America/New_York';
const iso = (date) => (date ? date.toISOString() : null);

function plan(overrides) {
  const result = planReminders({ offsetsDays: [14, 7, 2], sendTime: '10:00', timeZone: NY, ...overrides });
  assert.equal(result.ok, true, result.error);
  return result;
}

function fires(result) {
  return result.windows.map((w) => [w.windowKey, iso(w.fireAt)]);
}

test('offsets fire on calendar days at the local send time, keyed by the anchor date', () => {
  const result = plan({ anchor: { date: '2026-11-20', time: '09:00' }, now: new Date('2026-10-20T12:00:00Z') });
  assert.equal(iso(result.anchor.instant), '2026-11-20T14:00:00.000Z');
  assert.deepEqual(fires(result), [
    ['2026-11-20-14d', '2026-11-06T15:00:00.000Z'],
    ['2026-11-20-7d', '2026-11-13T15:00:00.000Z'],
    ['2026-11-20-2d', '2026-11-18T15:00:00.000Z'],
  ]);
  assert.equal(result.due, null);
  assert.deepEqual(result.next, { offsetDays: 14, windowKey: '2026-11-20-14d', at: new Date('2026-11-06T15:00:00Z') });
  assert.equal(windowKeyFor('2026-11-20', 7), '2026-11-20-7d');
});

test('an offset across the spring change is 7 calendar days, not 168 hours (New York)', () => {
  const result = plan({ anchor: { date: '2026-03-12', time: '10:00' }, offsetsDays: [7], now: 0 });
  // 2026-03-05 10:00 EST, then 2026-03-12 10:00 EDT: 167 hours apart.
  assert.equal(iso(result.windows[0].fireAt), '2026-03-05T15:00:00.000Z');
  assert.equal(iso(result.anchor.instant), '2026-03-12T14:00:00.000Z');
  assert.equal((result.anchor.instant - result.windows[0].fireAt) / 3_600_000, 167);
});

test('an offset across the autumn change is 7 calendar days, not 168 hours (New York)', () => {
  const result = plan({ anchor: { date: '2026-11-05', time: '10:00' }, offsetsDays: [7], now: 0 });
  // 2026-10-29 10:00 EDT, then 2026-11-05 10:00 EST: 169 hours apart.
  assert.equal(iso(result.windows[0].fireAt), '2026-10-29T14:00:00.000Z');
  assert.equal((result.anchor.instant - result.windows[0].fireAt) / 3_600_000, 169);
});

test('a send time inside the spring-forward gap fires at the first minute after it', () => {
  // 2026-03-08 in New York: 02:00 EST jumps to 03:00 EDT.
  assert.equal(iso(resolveLocalInstant('2026-03-08', '02:30', NY)), '2026-03-08T07:00:00.000Z');
  assert.equal(iso(resolveLocalInstant('2026-03-08', '02:00', NY)), '2026-03-08T07:00:00.000Z');
  const result = plan({ anchor: { date: '2026-03-15', time: '12:00' }, offsetsDays: [7], sendTime: '02:30', now: 0 });
  const [window] = result.windows;
  assert.equal(iso(window.fireAt), '2026-03-08T07:00:00.000Z');
  // 03:00 is quiet hours, so the window opens at 08:00 EDT.
  assert.equal(iso(window.opensAt), '2026-03-08T12:00:00.000Z');
});

test('a send time inside the fall-back overlap fires at the earlier instant', () => {
  // 2026-11-01 in New York: 01:00 to 02:00 happens twice.
  assert.equal(iso(resolveLocalInstant('2026-11-01', '01:30', NY)), '2026-11-01T05:30:00.000Z');
  const result = plan({ anchor: { date: '2026-11-08', time: '12:00' }, offsetsDays: [7], sendTime: '01:30', now: 0 });
  assert.equal(iso(result.windows[0].fireAt), '2026-11-01T05:30:00.000Z');
  // 08:00 EST, after the change.
  assert.equal(iso(result.windows[0].opensAt), '2026-11-01T13:00:00.000Z');
});

test('an anchor time inside a gap or an overlap uses the same rule', () => {
  const gap = plan({ anchor: { date: '2026-03-08', time: '02:15' }, offsetsDays: [1], now: 0 });
  assert.equal(iso(gap.anchor.instant), '2026-03-08T07:00:00.000Z');
  const overlap = plan({ anchor: { date: '2026-11-01', time: '01:15' }, offsetsDays: [1], now: 0 });
  assert.equal(iso(overlap.anchor.instant), '2026-11-01T05:15:00.000Z');
});

test('Asia/Kolkata: a half-hour offset with no daylight saving', () => {
  const result = planReminders({
    anchor: { date: '2026-12-01', time: '09:00' },
    offsetsDays: DEFAULT_OFFSETS.attendees,
    sendTime: '09:00',
    timeZone: 'Asia/Kolkata',
    now: new Date('2026-11-24T03:30:00Z'),
  });
  assert.deepEqual(fires(result), [
    ['2026-12-01-7d', '2026-11-24T03:30:00.000Z'],
    ['2026-12-01-1d', '2026-11-30T03:30:00.000Z'],
  ]);
  assert.equal(result.due.windowKey, '2026-12-01-7d');
});

test('Pacific/Auckland: offsets across its spring change, and an anchor whose UTC date is the day before', () => {
  // New Zealand moves from UTC+12 to UTC+13 on 2026-09-27.
  const result = planReminders({
    anchor: '2026-09-30T20:00:00Z', // 2026-10-01 09:00 NZDT
    offsetsDays: [7, 2],
    sendTime: '09:00',
    timeZone: 'Pacific/Auckland',
    now: 0,
  });
  assert.equal(result.anchor.date, '2026-10-01');
  assert.deepEqual(fires(result), [
    ['2026-10-01-7d', '2026-09-23T21:00:00.000Z'],
    ['2026-10-01-2d', '2026-09-28T20:00:00.000Z'],
  ]);
});

test('UTC: fire instants are the plain dates', () => {
  const result = planReminders({
    anchor: new Date('2027-01-10T15:00:00Z'), offsetsDays: [1], sendTime: '12:00', timeZone: 'UTC', now: 0,
  });
  assert.deepEqual(fires(result), [['2027-01-10-1d', '2027-01-09T12:00:00.000Z']]);
  assert.equal(addCalendarDays('2027-03-01', -1), '2027-02-28');
  assert.equal(addCalendarDays('2028-03-01', -1), '2028-02-29');
});

test('window boundaries: a window opens at its fire instant and closes when the next offset fires', () => {
  const anchor = { date: '2026-11-20', time: '09:00' };
  const f7 = new Date('2026-11-13T15:00:00Z');
  const f2 = new Date('2026-11-18T15:00:00Z');
  const anchorAt = new Date('2026-11-20T14:00:00Z');

  assert.equal(plan({ anchor, now: f7.getTime() - 1 }).due.windowKey, '2026-11-20-14d');
  assert.equal(plan({ anchor, now: f7 }).due.windowKey, '2026-11-20-7d');
  assert.equal(plan({ anchor, now: f2.getTime() - 1 }).due.windowKey, '2026-11-20-7d');
  const last = plan({ anchor, now: f2 });
  assert.equal(last.due.windowKey, '2026-11-20-2d');
  assert.equal(last.due.closesAt.getTime(), anchorAt.getTime());
  assert.deepEqual(last.windows.map((w) => w.state), ['closed', 'closed', 'open']);
  assert.equal(last.next, null);

  const ended = plan({ anchor, now: anchorAt });
  assert.equal(ended.due, null);
  assert.equal(ended.next, null);
  assert.deepEqual(ended.windows.map((w) => w.state), ['closed', 'closed', 'closed']);
});

test('catch-up sends a missed offset inside its own window, and drops a window a later offset closed', () => {
  const anchor = { date: '2026-11-20', time: '09:00' };
  // Two days after the 7-day fire time, at noon: the 7-day reminder is still due.
  const catchUp = plan({ anchor, now: new Date('2026-11-15T17:00:00Z') });
  assert.equal(catchUp.due.windowKey, '2026-11-20-7d');
  assert.deepEqual(catchUp.next, { offsetDays: 2, windowKey: '2026-11-20-2d', at: new Date('2026-11-18T15:00:00Z') });
  // After the 2-day fire time, the 14- and 7-day windows are gone.
  const later = plan({ anchor, now: new Date('2026-11-19T15:00:00Z') });
  assert.equal(later.due.windowKey, '2026-11-20-2d');
  assert.deepEqual(later.windows.filter((w) => w.state === 'closed').map((w) => w.offsetDays), [14, 7]);
});

test('quiet hours: nothing is due from 20:00 to 08:00 event-local', () => {
  const anchor = { date: '2026-11-20', time: '09:00' };
  // 2026-11-15 21:00 EST, inside the 7-day window.
  const evening = plan({ anchor, now: new Date('2026-11-16T02:00:00Z') });
  assert.equal(evening.quietNow, true);
  assert.equal(evening.due, null);
  assert.deepEqual(evening.next, { offsetDays: 7, windowKey: '2026-11-20-7d', at: new Date('2026-11-16T13:00:00Z') });
  // 07:59 is quiet, 08:00 is not.
  assert.equal(plan({ anchor, now: new Date('2026-11-16T12:59:00Z') }).due, null);
  assert.equal(plan({ anchor, now: new Date('2026-11-16T13:00:00Z') }).due.windowKey, '2026-11-20-7d');
  // 19:59 is not quiet, 20:00 is.
  assert.equal(plan({ anchor, now: new Date('2026-11-17T00:59:00Z') }).due.windowKey, '2026-11-20-7d');
  assert.equal(plan({ anchor, now: new Date('2026-11-17T01:00:00Z') }).due, null);
});

test('a window that opens in quiet hours waits for 08:00', () => {
  const result = plan({ anchor: { date: '2026-11-20', time: '09:00' }, sendTime: '21:00', offsetsDays: [7, 2], now: 0 });
  const [seven, two] = result.windows;
  assert.equal(iso(seven.fireAt), '2026-11-14T02:00:00.000Z'); // 2026-11-13 21:00 EST
  assert.equal(iso(seven.opensAt), '2026-11-14T13:00:00.000Z'); // 2026-11-14 08:00 EST
  assert.equal(iso(two.opensAt), '2026-11-19T13:00:00.000Z');
  assert.deepEqual(result.next, { offsetDays: 7, windowKey: '2026-11-20-7d', at: seven.opensAt });
  assert.equal(plan({ anchor: { date: '2026-11-20', time: '09:00' }, sendTime: '21:00', offsetsDays: [7, 2], now: seven.fireAt }).due, null);
});

test('a window with no time outside quiet hours before it closes never opens', () => {
  // Anchor 2026-11-20 07:00, one day before at 21:00: the window ends at 07:00, before 08:00.
  const result = plan({ anchor: { date: '2026-11-20', time: '07:00' }, sendTime: '21:00', offsetsDays: [1], now: 0 });
  assert.equal(result.windows[0].state, 'empty');
  assert.equal(result.next, null);
});

test('offsets are deduplicated and sorted, and bad input is refused', () => {
  const result = plan({ anchor: { date: '2026-11-20', time: '09:00' }, offsetsDays: [2, 14, 7, 7], now: 0 });
  assert.deepEqual(result.windows.map((w) => w.offsetDays), [14, 7, 2]);
  const base = { anchor: { date: '2026-11-20', time: '09:00' }, offsetsDays: [7], sendTime: '10:00', timeZone: NY, now: 0 };
  assert.match(planReminders({ ...base, timeZone: 'Mars/Olympus' }).error, /timeZone/);
  assert.match(planReminders({ ...base, sendTime: '9:00' }).error, /sendTime/);
  assert.match(planReminders({ ...base, offsetsDays: [0] }).error, /offsetsDays/);
  assert.match(planReminders({ ...base, offsetsDays: [1.5] }).error, /offsetsDays/);
  assert.match(planReminders({ ...base, offsetsDays: [] }).error, /offsetsDays/);
  assert.match(planReminders({ ...base, now: 'soon' }).error, /now/);
  assert.match(planReminders({ ...base, anchor: { date: '2026-02-30', time: '09:00' } }).error, /anchor/);
  assert.match(planReminders({ ...base, anchor: 'not a date' }).error, /anchor/);
  assert.equal(planReminders().ok, false);
});
