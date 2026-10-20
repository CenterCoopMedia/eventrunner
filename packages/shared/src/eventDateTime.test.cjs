'use strict';

// The event-clock conversion the web admin and the functions share
// (issues #476, #518). The web suite (apps/web/src/lib/eventDateTime.test.js)
// checks the same rules through the admin's re-export; these run under
// `npm test`, so a change here fails the functions tier too.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isKnownTimeZone,
  readWall,
  resolveEventDateTime,
  splitEventDateTime,
  wallParts,
  zoneOffsetMinutes,
} = require('./eventDateTime.cjs');

const NY = 'America/New_York';
const iso = (result) => result.instant.toISOString();

test('a winter and a summer date in New York each use their own offset', () => {
  const winter = resolveEventDateTime('2027-01-15', '23:59', NY);
  assert.equal(winter.status, 'ok');
  assert.equal(iso(winter), '2027-01-16T04:59:00.000Z');
  assert.equal(winter.offset, -300);
  const summer = resolveEventDateTime('2027-07-01', '09:00', NY);
  assert.equal(iso(summer), '2027-07-01T13:00:00.000Z');
  assert.equal(summer.offset, -240);
});

test('the spring-forward gap is reported, not shifted', () => {
  assert.deepEqual(resolveEventDateTime('2027-03-14', '02:30', NY), { status: 'gap', offsetBefore: -300, offsetAfter: -240 });
  assert.equal(iso(resolveEventDateTime('2027-03-14', '01:59', NY)), '2027-03-14T06:59:00.000Z');
  assert.equal(iso(resolveEventDateTime('2027-03-14', '03:00', NY)), '2027-03-14T07:00:00.000Z');
});

test('the fall-back overlap gives both instants, earlier first', () => {
  const result = resolveEventDateTime('2027-11-07', '01:30', NY);
  assert.equal(result.status, 'overlap');
  assert.deepEqual(result.candidates.map((c) => [c.instant.toISOString(), c.offset]), [
    ['2027-11-07T05:30:00.000Z', -240],
    ['2027-11-07T06:30:00.000Z', -300],
  ]);
});

test('zones off the hour and south of the equator', () => {
  const kolkata = resolveEventDateTime('2027-01-15', '23:59', 'Asia/Kolkata');
  assert.equal(iso(kolkata), '2027-01-15T18:29:00.000Z');
  assert.equal(kolkata.offset, 330);
  // Auckland is on daylight time (UTC+13) in January and standard (UTC+12) in July.
  assert.equal(resolveEventDateTime('2027-01-15', '09:00', 'Pacific/Auckland').offset, 780);
  assert.equal(resolveEventDateTime('2027-07-15', '09:00', 'Pacific/Auckland').offset, 720);
  assert.equal(iso(resolveEventDateTime('2027-07-15', '09:00', 'UTC')), '2027-07-15T09:00:00.000Z');
});

test('malformed dates, times and zones are invalid', () => {
  assert.deepEqual(resolveEventDateTime('2027-02-30', '09:00', NY), { status: 'invalid' });
  assert.deepEqual(resolveEventDateTime('2027-02-01', '24:00', NY), { status: 'invalid' });
  assert.deepEqual(resolveEventDateTime('2027-02-01', '09:00', 'Mars/Olympus'), { status: 'invalid' });
  assert.equal(isKnownTimeZone('Mars/Olympus'), false);
  assert.equal(isKnownTimeZone(NY), true);
  assert.equal(readWall('2027-02-29', '00:00'), null);
});

test('splitEventDateTime shows a stored instant on the event clock', () => {
  assert.deepEqual(splitEventDateTime('2027-02-01T04:59:59.000Z', NY), { date: '2027-01-31', time: '23:59:59' });
  assert.deepEqual(splitEventDateTime('2027-07-01T13:00:00.000Z', NY), { date: '2027-07-01', time: '09:00' });
  assert.equal(splitEventDateTime('', NY), null);
  assert.equal(splitEventDateTime('not a date', NY), null);
  assert.equal(splitEventDateTime('2027-07-01T13:00:00.000Z', 'Mars/Olympus'), null);
});

test('zoneOffsetMinutes and wallParts read the zone at one instant', () => {
  assert.equal(zoneOffsetMinutes(new Date('2027-03-14T06:59:00Z'), NY), -300);
  assert.equal(zoneOffsetMinutes(new Date('2027-03-14T07:00:00Z'), NY), -240);
  const p = wallParts(new Date('2027-01-01T05:00:00Z'), NY);
  assert.deepEqual([p.year, p.month, p.day, p.hour, p.minute], ['2027', '01', '01', '00', '00']);
});
