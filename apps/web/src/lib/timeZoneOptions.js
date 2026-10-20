// The time zones staff choose from in Event settings (issue #475). The
// stored value stays the IANA name (config/event.timezone); this file turns
// each name into words a person recognises: the city, the region, the zone's
// usual name, and its UTC offset at one moment.
//
// The list comes from the browser (Intl.supportedValuesOf). An engine that
// cannot list zones gets FALLBACK_TIME_ZONES. Offsets come from the shared
// event clock (shared/eventDateTime through lib/eventDateTime.js), so a zone
// with daylight saving time reads its summer offset in summer and its winter
// offset in winter. Nothing here knows any event's zone.

import { partsIn } from 'shared/eventDateTime';
import {
  formatCalendarDate,
  formatUtcOffset,
  isKnownTimeZone,
  resolveEventDateTime,
  zoneOffsetMinutes,
} from './eventDateTime.js';

/**
 * The zones offered when Intl cannot list its own: one or more per inhabited
 * offset, and the zones most events use. Every name is canonical IANA.
 */
export const FALLBACK_TIME_ZONES = Object.freeze([
  'UTC',
  'Pacific/Honolulu',
  'America/Anchorage',
  'America/Los_Angeles',
  'America/Vancouver',
  'America/Tijuana',
  'America/Phoenix',
  'America/Denver',
  'America/Edmonton',
  'America/Chicago',
  'America/Mexico_City',
  'America/Winnipeg',
  'America/New_York',
  'America/Toronto',
  'America/Detroit',
  'America/Bogota',
  'America/Lima',
  'America/Halifax',
  'America/Puerto_Rico',
  'America/Caracas',
  'America/Santiago',
  'America/St_Johns',
  'America/Sao_Paulo',
  'America/Argentina/Buenos_Aires',
  'Atlantic/Azores',
  'Atlantic/Reykjavik',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Lisbon',
  'Africa/Lagos',
  'Africa/Casablanca',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Amsterdam',
  'Europe/Brussels',
  'Europe/Stockholm',
  'Europe/Warsaw',
  'Africa/Johannesburg',
  'Africa/Cairo',
  'Europe/Athens',
  'Europe/Helsinki',
  'Europe/Kyiv',
  'Asia/Jerusalem',
  'Europe/Istanbul',
  'Africa/Nairobi',
  'Asia/Riyadh',
  'Europe/Moscow',
  'Asia/Tehran',
  'Asia/Dubai',
  'Asia/Kabul',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Kathmandu',
  'Asia/Dhaka',
  'Asia/Yangon',
  'Asia/Bangkok',
  'Asia/Jakarta',
  'Asia/Singapore',
  'Asia/Manila',
  'Asia/Hong_Kong',
  'Asia/Shanghai',
  'Australia/Perth',
  'Asia/Seoul',
  'Asia/Tokyo',
  'Australia/Darwin',
  'Australia/Adelaide',
  'Australia/Brisbane',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Pacific/Guam',
  'Pacific/Noumea',
  'Pacific/Auckland',
  'Pacific/Fiji',
  'Pacific/Chatham',
  'Pacific/Tongatapu',
  'Pacific/Kiritimati',
]);

/**
 * Old names some engines still list, and the names IANA uses now. A person
 * looking for Kolkata or Kyiv should find it under that name. The new name
 * replaces the old one only when this engine knows it.
 */
const RENAMED_ZONES = Object.freeze({
  'Africa/Asmera': 'Africa/Asmara',
  'America/Godthab': 'America/Nuuk',
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Asia/Thimbu': 'Asia/Thimphu',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
  'Europe/Kiev': 'Europe/Kyiv',
  'Pacific/Enderbury': 'Pacific/Kanton',
  'Pacific/Ponape': 'Pacific/Pohnpei',
  'Pacific/Truk': 'Pacific/Chuuk',
});

const currentName = (zone) => (RENAMED_ZONES[zone] && isKnownTimeZone(RENAMED_ZONES[zone]) ? RENAMED_ZONES[zone] : zone);

/**
 * Every zone the picker offers, UTC first. `stored` is the event's current
 * zone: when the browser's list leaves it out (an alias such as US/Eastern),
 * it is kept so the field still shows what is saved. An unknown name is not
 * offered.
 *
 * @param {{ supportedValuesOf?: (key: string) => string[] }} [intl]
 * @param {string} [stored]
 * @returns {string[]}
 */
export function supportedTimeZones(intl = globalThis.Intl, stored = '') {
  let listed = [];
  try {
    if (typeof intl?.supportedValuesOf === 'function') listed = intl.supportedValuesOf('timeZone') ?? [];
  } catch {
    listed = [];
  }
  const zones = listed.length > 0 ? listed.map(currentName) : FALLBACK_TIME_ZONES;
  const keep = stored && !zones.includes(stored) && isKnownTimeZone(stored) ? [stored] : [];
  return [...new Set(['UTC', ...keep, ...zones])];
}

function zoneName(instant, timeZone, style) {
  try {
    return partsIn(timeZone, instant, { timeZoneName: style }).timeZoneName ?? '';
  } catch {
    return '';
  }
}

const words = (segment) => segment.replace(/_/g, ' ');

/** Lowercase, no accents, and every minus sign read as a hyphen. */
function fold(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[−–]/g, '-')
    .toLowerCase();
}

/**
 * One zone in words at one moment.
 *
 * `display` is what the field shows once the zone is chosen:
 * "New York (Eastern Time, UTC−04:00)".
 *
 * @param {string} timeZone IANA name
 * @param {Date} [instant] the moment whose offset is shown; now by default
 */
export function describeZoneOption(timeZone, instant = new Date()) {
  const segments = timeZone.split('/');
  const city = words(segments[segments.length - 1]);
  const region = segments.slice(0, -1).map(words).join(', ');
  const offset = zoneOffsetMinutes(instant, timeZone);
  const offsetLabel = formatUtcOffset(offset);
  const generic = zoneName(instant, timeZone, 'longGeneric');
  const name = generic && generic !== timeZone && !/^GMT[+-]/.test(generic) ? generic : '';
  const abbreviation = zoneName(instant, timeZone, 'short');
  const display = `${city} (${name ? `${name}, ` : ''}${offsetLabel})`;
  return {
    value: timeZone,
    city,
    region,
    name,
    offset,
    offsetLabel,
    display,
    cityKey: fold(city),
    searchText: fold([city, region, timeZone, words(timeZone), name, abbreviation, offsetLabel].join(' ')),
  };
}

let cache = { hour: null, stored: null, options: [] };

/**
 * Every zone in words, sorted west to east and then by city. The offsets
 * are the ones in force at `instant`. Cached for the hour, because an
 * offset changes at most at a clock change and building the list touches
 * every zone the browser knows.
 *
 * @param {Date} [instant]
 * @param {string} [stored] the event's current zone, kept even when unlisted
 */
export function timeZoneOptions(instant = new Date(), stored = '') {
  const hour = Math.floor(instant.getTime() / 3_600_000);
  if (cache.hour === hour && cache.stored === stored) return cache.options;
  const options = supportedTimeZones(globalThis.Intl, stored)
    .map((zone) => describeZoneOption(zone, instant))
    .sort((a, b) => a.offset - b.offset || a.city.localeCompare(b.city));
  cache = { hour, stored, options };
  return options;
}

/**
 * The zones that match what was typed. Every typed word must appear
 * somewhere in the zone's words; zones whose city starts with the text come
 * first. Nothing typed returns the whole list.
 *
 * @param {ReturnType<typeof describeZoneOption>[]} options
 * @param {string} query
 */
export function filterTimeZoneOptions(options, query) {
  const folded = fold(query).trim();
  if (!folded) return options;
  const tokens = folded.split(/\s+/);
  const matches = options.filter((option) => tokens.every((token) => option.searchText.includes(token)));
  const first = matches.filter((option) => option.cityKey.startsWith(folded));
  return [...first, ...matches.filter((option) => !option.cityKey.startsWith(folded))];
}

/**
 * The offset on each event day, in words. One offset is one sentence; a
 * clock change during the event names each offset and the day it starts.
 * Each day is read at its start time, or at noon when the start is blank or
 * falls in a skipped or repeated hour.
 *
 * @param {string} timeZone
 * @param {{ date?: string, startTime?: string }[]} days
 * @returns {string} '' when there is nothing to say
 */
export function describeEventDayOffsets(timeZone, days) {
  if (!isKnownTimeZone(timeZone)) return '';
  const runs = [];
  for (const day of days ?? []) {
    let resolved = resolveEventDateTime(day?.date, day?.startTime, timeZone);
    if (resolved.status !== 'ok') resolved = resolveEventDateTime(day?.date, '12:00', timeZone);
    if (resolved.status !== 'ok') continue;
    const last = runs[runs.length - 1];
    if (!last || last.offset !== resolved.offset) runs.push({ offset: resolved.offset, date: day.date });
  }
  if (runs.length === 0) return '';
  if (runs.length === 1) return `Event days use ${formatUtcOffset(runs[0].offset)}.`;
  const parts = runs.map((run, index) => (index === 0
    ? `${formatUtcOffset(run.offset)} on ${formatCalendarDate(run.date)}`
    : `${formatUtcOffset(run.offset)} from ${formatCalendarDate(run.date)}`));
  return `The offset changes during the event: ${parts.join(', then ')}.`;
}
