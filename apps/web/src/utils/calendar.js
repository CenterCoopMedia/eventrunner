// Calendar export helpers (issue #16, spec §9 "ICS export + calendar
// links"). Direct Google Calendar OAuth sync is REMOVED by design — a
// per-client OAuth consent-screen verification does not scale under
// deploy-per-client (spec §9 "Google Calendar sync" row). This module is
// the replacement: an .ics file the attendee downloads, plus Google/Outlook
// "add to calendar" URL builders that need no OAuth at all.
//
// Event-neutral: everything here reads from `eventConfig`/`session`
// arguments, never a literal event name, city, or date (spec §2.4).
// Timezone resolution reuses lib/eventTime.js's `resolveSessionInstants`,
// so the DST/midnight-rollover handling pinned there (fail-soft on an
// unresolvable wall clock) is not re-implemented here.
import { resolveSessionInstants } from '../lib/eventTime.js';

/**
 * Escape one ICS TEXT value per RFC 5545 §3.3.11: backslash, semicolon, and
 * comma are backslash-escaped; newlines become the literal two-character
 * sequence "\n" (a real CRLF inside a value would corrupt the content
 * line). Order matters — backslash must be escaped first, or the escaping
 * of the other characters would double-escape.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function escapeIcsText(value) {
  if (value == null) return '';
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

const textEncoder = new TextEncoder();

/**
 * Fold one unfolded ICS content line to RFC 5545 §3.1's 75-OCTET limit:
 * continuation lines start with a single space. Counts UTF-8 bytes, not
 * UTF-16 code units or characters — a code-unit count silently undercounts
 * non-ASCII text (e.g. 40 CJK characters is 40 code units, comfortably
 * under 75, but 120 UTF-8 bytes, comfortably over the actual limit), which
 * would emit spec-non-conformant lines a strict calendar client could
 * reject or mis-render. Splits on Unicode code points (`Array.from`, not
 * `.slice()`) so a fold point never lands inside a multi-byte character or
 * a surrogate pair.
 *
 * @param {string} line
 * @returns {string}
 */
export function foldIcsLine(line) {
  if (textEncoder.encode(line).length <= 75) return line;

  const codePoints = Array.from(line);
  const chunks = [];
  let chunk = '';
  let chunkBytes = 0;
  // First line budgets 75 octets; each continuation line's leading space
  // (itself 1 octet) leaves 74 for content.
  let budget = 75;

  for (const char of codePoints) {
    const charBytes = textEncoder.encode(char).length;
    if (chunkBytes + charBytes > budget && chunk.length > 0) {
      chunks.push(chunk);
      chunk = '';
      chunkBytes = 0;
      budget = 74;
    }
    chunk += char;
    chunkBytes += charBytes;
  }
  if (chunk.length > 0) chunks.push(chunk);

  return chunks.join('\r\n ');
}

/** UTC ICS/URL timestamp: "YYYYMMDDTHHMMSSZ". @param {Date} date */
function toIcsUtc(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/**
 * One VEVENT block's lines (unfolded — foldIcsCalendar folds the whole
 * document). Null when the session's start time cannot be resolved to a
 * real instant (fail soft, matches eventTime.js — no VEVENT for a "time to
 * be announced" session rather than a bogus one).
 *
 * @param {object} eventConfig
 * @param {object} session
 * @param {Date} [now]
 * @returns {string[] | null}
 */
function buildIcsEventLines(eventConfig, session, now = new Date()) {
  const { start, end } = resolveSessionInstants(eventConfig, session);
  if (!start) return null;

  const venue = eventConfig?.venue;
  const location = [session?.location, venue?.name, venue?.city].filter(Boolean).join(', ');
  const uid = `${session.id}@${escapeIcsText(eventConfig?.shortName || 'schedule').toLowerCase().replace(/[^a-z0-9-]/g, '-')}.ics`;

  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${toIcsUtc(now)}`,
    `DTSTART:${toIcsUtc(start)}`,
  ];
  // An unresolvable end time is dropped rather than defaulted — a fabricated
  // end would misrepresent a session the CMS never gave a real duration.
  if (end) lines.push(`DTEND:${toIcsUtc(end)}`);
  lines.push(`SUMMARY:${escapeIcsText(session.title)}`);
  if (session.description) lines.push(`DESCRIPTION:${escapeIcsText(session.description)}`);
  if (location) lines.push(`LOCATION:${escapeIcsText(location)}`);
  lines.push('END:VEVENT');
  return lines;
}

/**
 * A complete .ics calendar document for one or more sessions. Sessions
 * whose time cannot be resolved are silently skipped (fail soft); the
 * caller decides whether "nothing exported" merits its own message. CRLF
 * line endings and 75-octet folding per RFC 5545.
 *
 * @param {object} eventConfig
 * @param {object[]} sessions
 * @param {{ now?: Date }} [opts]
 * @returns {string}
 */
export function buildIcsCalendar(eventConfig, sessions, { now = new Date() } = {}) {
  const prodIdName = escapeIcsText(eventConfig?.shortName || eventConfig?.name || 'Event schedule');
  const unfolded = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//Run of Show//${prodIdName}//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...(Array.isArray(sessions) ? sessions : [])
      .flatMap((session) => buildIcsEventLines(eventConfig, session, now) ?? []),
    'END:VCALENDAR',
  ];
  return unfolded.map(foldIcsLine).join('\r\n') + '\r\n';
}

/**
 * Trigger a browser download of an .ics file. No-ops outside a DOM (SSR /
 * test environments without `document`) instead of throwing.
 *
 * @param {string} filename
 * @param {string} icsText
 */
export function downloadIcs(filename, icsText) {
  if (typeof document === 'undefined') return;
  const blob = new Blob([icsText], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * A filesystem-safe .ics filename from free text, e.g. a session title or
 * the event's short name. Falls back to "schedule" when nothing usable
 * remains (spec §2.4 event-neutral — never a hardcoded literal).
 *
 * @param {string} text
 * @returns {string}
 */
export function icsFileName(text) {
  const slug = String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'schedule'}.ics`;
}

/**
 * Google Calendar "add to calendar" deep link — no OAuth, no calendar.events
 * scope, just a prefilled compose URL (spec §9's replacement for direct
 * sync). Null when the session's time cannot be resolved.
 *
 * @param {object} eventConfig
 * @param {object} session
 * @returns {string | null}
 */
export function buildGoogleCalendarUrl(eventConfig, session) {
  const { start, end } = resolveSessionInstants(eventConfig, session);
  if (!start) return null;
  const venue = eventConfig?.venue;
  const location = [session?.location, venue?.name, venue?.city].filter(Boolean).join(', ');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: session.title || '',
    dates: `${toIcsUtc(start)}/${toIcsUtc(end || start)}`,
  });
  if (session.description) params.set('details', session.description);
  if (location) params.set('location', location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Outlook (outlook.live.com) "add to calendar" deep link, same no-OAuth
 * replacement as the Google builder above.
 *
 * @param {object} eventConfig
 * @param {object} session
 * @returns {string | null}
 */
export function buildOutlookCalendarUrl(eventConfig, session) {
  const { start, end } = resolveSessionInstants(eventConfig, session);
  if (!start) return null;
  const venue = eventConfig?.venue;
  const location = [session?.location, venue?.name, venue?.city].filter(Boolean).join(', ');
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: session.title || '',
    startdt: start.toISOString(),
    enddt: (end || start).toISOString(),
  });
  if (session.description) params.set('body', session.description);
  if (location) params.set('location', location);
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
}
