import { describe, expect, it } from 'vitest';
import {
  FALLBACK_TIME_ZONES,
  describeEventDayOffsets,
  describeZoneOption,
  filterTimeZoneOptions,
  supportedTimeZones,
  timeZoneOptions,
} from './timeZoneOptions.js';

const JULY = new Date('2027-07-01T12:00:00Z');
const JANUARY = new Date('2027-01-15T12:00:00Z');

describe('supportedTimeZones', () => {
  it('reads the browser’s IANA list and puts UTC first', () => {
    const zones = supportedTimeZones();
    expect(zones[0]).toBe('UTC');
    expect(zones).toContain('America/New_York');
    expect(zones).toContain('Asia/Kolkata');
    expect(new Set(zones).size).toBe(zones.length);
  });

  it('falls back to a fixed list when Intl cannot list zones', () => {
    const zones = supportedTimeZones({});
    expect(zones[0]).toBe('UTC');
    expect(zones).toEqual(['UTC', ...FALLBACK_TIME_ZONES.filter((zone) => zone !== 'UTC')]);
    expect(zones).toContain('Europe/London');
  });

  it('falls back when the list call throws or comes back empty', () => {
    expect(supportedTimeZones({ supportedValuesOf: () => { throw new Error('no'); } })).toContain('America/Chicago');
    expect(supportedTimeZones({ supportedValuesOf: () => [] })).toContain('America/Chicago');
  });

  it('offers a renamed zone under its current name', () => {
    const zones = supportedTimeZones({ supportedValuesOf: () => ['Asia/Calcutta', 'Europe/Kiev'] });
    expect(zones).toEqual(['UTC', 'Asia/Kolkata', 'Europe/Kyiv']);
  });

  it('keeps a stored zone that the list leaves out, so an alias still shows as chosen', () => {
    expect(supportedTimeZones({ supportedValuesOf: () => ['Europe/Paris'] }, 'US/Eastern'))
      .toEqual(['UTC', 'US/Eastern', 'Europe/Paris']);
    expect(supportedTimeZones({ supportedValuesOf: () => ['Europe/Paris'] }, 'Mars/Olympus'))
      .toEqual(['UTC', 'Europe/Paris']);
  });
});

describe('describeZoneOption', () => {
  it('names the city, the region, the zone’s usual name, and the offset at the given moment', () => {
    const summer = describeZoneOption('America/New_York', JULY);
    expect(summer).toMatchObject({
      value: 'America/New_York',
      city: 'New York',
      region: 'America',
      name: 'Eastern Time',
      offset: -240,
      offsetLabel: 'UTC−04:00',
    });
    expect(summer.display).toBe('New York (Eastern Time, UTC−04:00)');
  });

  it('uses the winter offset in winter: the offset follows daylight saving time', () => {
    expect(describeZoneOption('America/New_York', JANUARY).offsetLabel).toBe('UTC−05:00');
  });

  it('reads underscores and nested regions as words', () => {
    const option = describeZoneOption('America/Argentina/Buenos_Aires', JULY);
    expect(option.city).toBe('Buenos Aires');
    expect(option.region).toBe('America, Argentina');
  });

  it('handles UTC and a zone off the hour', () => {
    expect(describeZoneOption('UTC', JULY)).toMatchObject({ city: 'UTC', region: '', offsetLabel: 'UTC+00:00' });
    expect(describeZoneOption('Asia/Kolkata', JULY).offsetLabel).toBe('UTC+05:30');
  });
});

describe('filterTimeZoneOptions', () => {
  const options = timeZoneOptions(JULY);

  it('lists every zone, sorted west to east, when nothing is typed', () => {
    expect(filterTimeZoneOptions(options, '')).toHaveLength(options.length);
    const offsets = options.map((option) => option.offset);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
  });

  it('finds a zone by city, with the city match first', () => {
    const found = filterTimeZoneOptions(options, 'new york');
    expect(found[0].value).toBe('America/New_York');
  });

  it('finds a zone by its usual name, its IANA name, and its offset', () => {
    expect(filterTimeZoneOptions(options, 'eastern time').map((option) => option.value)).toContain('America/New_York');
    expect(filterTimeZoneOptions(options, 'america/chicago').map((option) => option.value)).toEqual(['America/Chicago']);
    expect(filterTimeZoneOptions(options, 'utc+05:30').map((option) => option.value)).toContain('Asia/Kolkata');
    // A typed hyphen matches the minus sign the label prints.
    expect(filterTimeZoneOptions(options, 'UTC-04:00').map((option) => option.value)).toContain('America/New_York');
  });

  it('ignores accents and case, and needs every typed word to match', () => {
    expect(filterTimeZoneOptions(options, 'SÃO PAULO').map((option) => option.value)).toContain('America/Sao_Paulo');
    expect(filterTimeZoneOptions(options, 'america london')).toEqual([]);
  });
});

describe('describeEventDayOffsets', () => {
  const NY = 'America/New_York';

  it('states one offset when every event day shares it', () => {
    expect(describeEventDayOffsets(NY, [
      { date: '2027-06-10', startTime: '09:00' },
      { date: '2027-06-11', startTime: '09:00' },
    ])).toBe('Event days use UTC−04:00.');
  });

  it('names the change when the clocks move during the event', () => {
    expect(describeEventDayOffsets(NY, [
      { date: '2027-11-06', startTime: '09:00' },
      { date: '2027-11-07', startTime: '09:00' },
      { date: '2027-11-08', startTime: '09:00' },
    ])).toBe('The offset changes during the event: UTC−04:00 on November 6, 2027, then UTC−05:00 from November 7, 2027.');
  });

  it('says nothing without a known zone or a dated day', () => {
    expect(describeEventDayOffsets('Mars/Olympus', [{ date: '2027-06-10', startTime: '09:00' }])).toBe('');
    expect(describeEventDayOffsets(NY, [{ date: '', startTime: '' }])).toBe('');
  });
});
