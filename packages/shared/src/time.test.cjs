'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isSessionPast, isDayPast, parseSessionDatetime, nowInZone } = require('./time.cjs');

const CONFIG = {
  timezone: 'America/Chicago',
  days: [
    { id: 'day-1', date: '2027-06-10', startTime: '09:00', endTime: '17:00' },
    { id: 'day-2', date: '2027-06-11', startTime: '09:00', endTime: '16:00' },
  ],
};

// Local 2027-06-10T12:00 in America/Chicago (CDT, UTC-5).
const MID_DAY_1 = new Date('2027-06-10T17:00:00Z');

test('isSessionPast: genuine past and future both ways', () => {
  assert.equal(isSessionPast(CONFIG, { dayId: 'day-1', endTime: '10:00 AM' }, MID_DAY_1), true);
  assert.equal(isSessionPast(CONFIG, { dayId: 'day-1', endTime: '3:00 PM' }, MID_DAY_1), false);
});

test('isSessionPast: full ISO endTime passes through and compares', () => {
  assert.equal(isSessionPast(CONFIG, { dayId: 'day-1', endTime: '2027-06-10T10:00' }, MID_DAY_1), true);
  assert.equal(isSessionPast(CONFIG, { dayId: 'day-1', endTime: '2027-06-10T15:00' }, MID_DAY_1), false);
});

test('isSessionPast requires a configured day even for ISO endTime', () => {
  // An unconfigured dayId is a data problem, not a release signal — the
  // embargo must stay closed even when the ISO endTime needs no day lookup.
  assert.equal(isSessionPast(CONFIG, { dayId: 'missing', endTime: '2027-06-10T10:00' }, MID_DAY_1), false);
  assert.equal(isSessionPast(CONFIG, { endTime: '2027-06-10T10:00' }, MID_DAY_1), false);
});

test('isSessionPast fails closed on malformed or out-of-range ISO endTime', () => {
  for (const endTime of [
    '2027-06-10T09:00garbage', // trailing garbage (regex must be end-anchored)
    '2027-06-10T25:00',        // hour out of range
    '2027-06-10T09:99',        // minute out of range
    '2027-13-10T09:00',        // month out of range
    '2027-06-32T09:00',        // day out of range
    '2027-06-10T09:00:99',     // second out of range
  ]) {
    assert.equal(isSessionPast(CONFIG, { dayId: 'day-1', endTime }, MID_DAY_1), false, endTime);
  }
});

test('isSessionPast compares at minute precision (no seconds-skew in the final minute)', () => {
  // Local 2027-06-10T17:00:33 in America/Chicago.
  const inFinalMinute = new Date('2027-06-10T22:00:33Z');
  const session = { dayId: 'day-1', endTime: '2027-06-10T17:00' };
  // Truncated, 17:00:33 equals 17:00 — not yet past during the final minute.
  assert.equal(isSessionPast(CONFIG, session, inFinalMinute), false);
  // A session ending 17:00 is past starting 17:01.
  assert.equal(isSessionPast(CONFIG, session, new Date('2027-06-10T22:01:00Z')), true);
});

test('isSessionPast fails closed on date-only endTime', () => {
  // "2027-06-09" sorts before every same-day datetime; accepting it would
  // release an embargo for the whole day. Must be rejected.
  assert.equal(isSessionPast(CONFIG, { dayId: 'day-1', endTime: '2027-06-09' }, MID_DAY_1), false);
});

test('isSessionPast fails closed on unknown dayId', () => {
  assert.equal(isSessionPast(CONFIG, { dayId: 'day-9', endTime: '10:00 AM' }, MID_DAY_1), false);
});

test('isSessionPast fails closed on malformed clock strings', () => {
  for (const endTime of [
    '10 o clock', '25:00 PM', '', null, undefined, '10:00',
    '12:99 AM', // minutes out of range
    '0:30 AM',  // 12-hour clock has no hour 0
    '13:00 PM', // hour out of range
  ]) {
    assert.equal(isSessionPast(CONFIG, { dayId: 'day-1', endTime }, MID_DAY_1), false, String(endTime));
  }
});

test('isDayPast: minute-precision boundary — past strictly after endTime', () => {
  // day-1 ends 17:00 local. Local 17:00:33 truncates to 17:00 — not past.
  assert.equal(isDayPast(CONFIG, 'day-1', new Date('2027-06-10T22:00:33Z')), false);
  // From 17:01 the day is past.
  assert.equal(isDayPast(CONFIG, 'day-1', new Date('2027-06-10T22:01:00Z')), true);
  // Mid-day is not past; unknown dayId fails closed.
  assert.equal(isDayPast(CONFIG, 'day-1', MID_DAY_1), false);
  assert.equal(isDayPast(CONFIG, 'day-9', new Date('2027-07-01T00:00:00Z')), false);
});

test('isSessionPast fails closed on missing config / timezone / session', () => {
  assert.equal(isSessionPast(null, { dayId: 'day-1', endTime: '10:00 AM' }, MID_DAY_1), false);
  assert.equal(isSessionPast({ days: CONFIG.days }, { dayId: 'day-1', endTime: '10:00 AM' }, MID_DAY_1), false);
  assert.equal(isSessionPast(CONFIG, null, MID_DAY_1), false);
});

test('parseSessionDatetime resolves clock times against the configured day', () => {
  assert.equal(parseSessionDatetime(CONFIG, 'day-1', '3:15 PM'), '2027-06-10T15:15:00');
  assert.equal(parseSessionDatetime(CONFIG, 'day-2', '12:00 AM'), '2027-06-11T00:00:00');
  assert.equal(parseSessionDatetime(CONFIG, 'day-2', '12:30 PM'), '2027-06-11T12:30:00');
  assert.equal(parseSessionDatetime(CONFIG, 'missing-day', '3:15 PM'), null);
  // Out-of-range clock values fail closed here too, not just in isSessionPast.
  assert.equal(parseSessionDatetime(CONFIG, 'day-1', '12:99 AM'), null);
  assert.equal(parseSessionDatetime(CONFIG, 'day-1', '13:00 PM'), null);
});

test('nowInZone produces a full naive ISO string in the requested zone', () => {
  const s = nowInZone('UTC', new Date('2027-06-10T17:04:05Z'));
  assert.equal(s, '2027-06-10T17:04:05');
  const chicago = nowInZone('America/Chicago', new Date('2027-06-10T17:04:05Z'));
  assert.equal(chicago, '2027-06-10T12:04:05');
});
