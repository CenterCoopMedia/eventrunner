/* global process */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  describeEventDateTime, describeTimeZone, formatShift, formatUtcOffset, isKnownTimeZone,
  resolveEventDateTime, splitEventDateTime, toStoredInstant, zoneOffsetMinutes,
} from './eventDateTime.js';

const NY = 'America/New_York';
const iso = (result) => toStoredInstant(result.instant);

describe('resolveEventDateTime', () => {
  it('turns 11:59 PM Eastern on January 15 into the UTC instant staff used to type by hand', () => {
    const result = resolveEventDateTime('2027-01-15', '23:59', NY);
    expect(result.status).toBe('ok');
    expect(iso(result)).toBe('2027-01-16T04:59:00.000Z');
    expect(result.offset).toBe(-300);
  });

  it('keeps seconds when the time carries them', () => {
    expect(iso(resolveEventDateTime('2027-01-31', '23:59:59', NY))).toBe('2027-02-01T04:59:59.000Z');
  });

  it('uses the summer offset for a summer date, not the offset in force today', () => {
    const result = resolveEventDateTime('2027-07-01', '09:00', NY);
    expect(iso(result)).toBe('2027-07-01T13:00:00.000Z');
    expect(result.offset).toBe(-240);
  });

  it('reports the spring-forward gap in New York instead of shifting the time', () => {
    expect(resolveEventDateTime('2027-03-14', '02:30', NY)).toEqual({ status: 'gap', offsetBefore: -300, offsetAfter: -240 });
    expect(resolveEventDateTime('2027-03-14', '02:00', NY).status).toBe('gap');
    expect(iso(resolveEventDateTime('2027-03-14', '01:59', NY))).toBe('2027-03-14T06:59:00.000Z');
    expect(iso(resolveEventDateTime('2027-03-14', '03:00', NY))).toBe('2027-03-14T07:00:00.000Z');
  });

  it('offers both instants for the repeated fall-back hour in New York, earlier first', () => {
    const result = resolveEventDateTime('2027-11-07', '01:30', NY);
    expect(result.status).toBe('overlap');
    expect(result.candidates.map((candidate) => [toStoredInstant(candidate.instant), candidate.offset])).toEqual([
      ['2027-11-07T05:30:00.000Z', -240],
      ['2027-11-07T06:30:00.000Z', -300],
    ]);
    expect(resolveEventDateTime('2027-11-07', '02:00', NY).status).toBe('ok');
  });

  it('handles a European zone on its own transition dates', () => {
    expect(resolveEventDateTime('2027-03-28', '01:30', 'Europe/London').status).toBe('gap');
    const overlap = resolveEventDateTime('2027-10-31', '01:30', 'Europe/London');
    expect(overlap.candidates.map((candidate) => candidate.offset)).toEqual([60, 0]);
    expect(iso(resolveEventDateTime('2027-06-01', '12:00', 'Europe/London'))).toBe('2027-06-01T11:00:00.000Z');
  });

  it('handles a zone 30 minutes off the hour with no daylight saving', () => {
    const result = resolveEventDateTime('2027-01-15', '23:59', 'Asia/Kolkata');
    expect(iso(result)).toBe('2027-01-15T18:29:00.000Z');
    expect(result.offset).toBe(330);
  });

  it('handles a zone whose clock change is 30 minutes', () => {
    // Lord Howe Island moves from UTC+10:30 to UTC+11:00 at 2:00 AM on the
    // first Sunday in October.
    expect(resolveEventDateTime('2027-10-03', '02:15', 'Australia/Lord_Howe')).toEqual({ status: 'gap', offsetBefore: 630, offsetAfter: 660 });
    expect(resolveEventDateTime('2027-04-04', '01:45', 'Australia/Lord_Howe').status).toBe('overlap');
  });

  it('refuses malformed dates, impossible dates, malformed times and unknown zones', () => {
    for (const [date, time, zone] of [
      ['2027-02-30', '12:00', NY], ['2027-13-01', '12:00', NY], ['27-01-01', '12:00', NY],
      ['2027-01-01', '24:00', NY], ['2027-01-01', '9:00', NY], ['2027-01-01', '', NY],
      ['2027-01-01', '12:00', 'Not/AZone'], ['2027-01-01', '12:00', ''],
    ]) expect(resolveEventDateTime(date, time, zone)).toEqual({ status: 'invalid' });
  });
});

describe('splitEventDateTime', () => {
  it('reads a stored instant back on the event’s clock', () => {
    expect(splitEventDateTime('2027-02-01T04:59:59.000Z', NY)).toEqual({ date: '2027-01-31', time: '23:59:59' });
    expect(splitEventDateTime('2027-01-16T04:59:00.000Z', NY)).toEqual({ date: '2027-01-15', time: '23:59' });
    expect(splitEventDateTime('2027-01-31T23:59:59-05:00', NY)).toEqual({ date: '2027-01-31', time: '23:59:59' });
    expect(splitEventDateTime('2027-01-15T18:29:00.000Z', 'Asia/Kolkata')).toEqual({ date: '2027-01-15', time: '23:59' });
  });

  it('round-trips both instants of a repeated hour', () => {
    expect(splitEventDateTime('2027-11-07T05:30:00.000Z', NY)).toEqual({ date: '2027-11-07', time: '01:30' });
    expect(splitEventDateTime('2027-11-07T06:30:00.000Z', NY)).toEqual({ date: '2027-11-07', time: '01:30' });
  });

  it('reads blank and unreadable values as no value', () => {
    for (const value of [null, undefined, '', '  ', 'soon', 42]) expect(splitEventDateTime(value, NY)).toBeNull();
    expect(splitEventDateTime('2027-01-01T00:00:00Z', 'Not/AZone')).toBeNull();
  });
});

describe('words', () => {
  it('names the zone and the offset for the selected date', () => {
    expect(describeEventDateTime(new Date('2027-02-01T04:59:59.000Z'), NY))
      .toBe('Sunday, January 31, 2027 at 11:59:59 PM Eastern Standard Time (UTC−05:00)');
    expect(describeEventDateTime(new Date('2027-07-01T13:00:00.000Z'), NY))
      .toBe('Thursday, July 1, 2027 at 9:00 AM Eastern Daylight Time (UTC−04:00)');
    expect(describeEventDateTime(new Date('2027-01-15T18:29:00.000Z'), 'Asia/Kolkata'))
      .toBe('Friday, January 15, 2027 at 11:59 PM India Standard Time (UTC+05:30)');
  });

  it('formats offsets, shifts and zone names', () => {
    expect(formatUtcOffset(-300)).toBe('UTC−05:00');
    expect(formatUtcOffset(330)).toBe('UTC+05:30');
    expect(formatUtcOffset(0)).toBe('UTC+00:00');
    expect(formatShift(60)).toBe('one hour');
    expect(formatShift(-30)).toBe('30 minutes');
    expect(describeTimeZone(NY)).toBe('Eastern Time (America/New_York)');
    expect(zoneOffsetMinutes(new Date('2027-07-01T00:00:00Z'), 'UTC')).toBe(0);
    expect(isKnownTimeZone('Not/AZone')).toBe(false);
  });
});

describe('the browser’s own zone', () => {
  // Staff may sit anywhere. Nothing here may read the machine's zone: only
  // the event's zone decides the instant and the words.
  let saved;
  beforeEach(() => { saved = process.env.TZ; process.env.TZ = 'Pacific/Auckland'; });
  afterEach(() => { if (saved === undefined) delete process.env.TZ; else process.env.TZ = saved; });

  it('gives the same instants and words when the machine is far from the event', () => {
    // Prove the zone change took effect, so the test is not empty.
    expect(new Date('2027-01-15T12:00:00Z').getTimezoneOffset()).toBe(-780);
    expect(iso(resolveEventDateTime('2027-01-15', '23:59', NY))).toBe('2027-01-16T04:59:00.000Z');
    expect(resolveEventDateTime('2027-03-14', '02:30', NY).status).toBe('gap');
    expect(resolveEventDateTime('2027-11-07', '01:30', NY).status).toBe('overlap');
    expect(splitEventDateTime('2027-02-01T04:59:59.000Z', NY)).toEqual({ date: '2027-01-31', time: '23:59:59' });
    expect(describeEventDateTime(new Date('2027-02-01T04:59:59.000Z'), NY))
      .toBe('Sunday, January 31, 2027 at 11:59:59 PM Eastern Standard Time (UTC−05:00)');
  });
});
