// Calendar export tests (issue #16). Fixture config/sessions only — no
// Firebase, no network (spec §8.1 credential-free CI).
import { describe, expect, it } from 'vitest';
import {
  buildGoogleCalendarUrl,
  buildIcsCalendar,
  buildOutlookCalendarUrl,
  escapeIcsText,
  foldIcsLine,
  icsFileName,
} from './calendar.js';

// Non-UTC zone on purpose, same as Schedule.test.jsx — America/Chicago is
// UTC−5 (CDT) on the fixture dates.
const fixtureConfig = {
  name: '[Fixture] Lakeshore Docs Camp',
  shortName: '[Fixture] LDC',
  timezone: 'America/Chicago',
  venue: { name: '[Fixture] Lakeshore Hall', city: 'Fixtureville' },
  days: [{ id: 'fx-day-1', label: 'Day one', date: '2026-10-15' }],
};

const fixtureSession = {
  id: 'fx-early',
  dayId: 'fx-day-1',
  startTime: '09:05',
  endTime: '09:45',
  title: '[Fixture] Morning kickoff',
  description: '[Fixture] What the day covers.',
  location: 'Main hall',
};

describe('escapeIcsText', () => {
  it('escapes backslash, semicolon, comma, and newlines per RFC 5545', () => {
    expect(escapeIcsText('a\\b;c,d\ne\r\nf')).toBe('a\\\\b\\;c\\,d\\ne\\nf');
  });

  it('is null/undefined-safe', () => {
    expect(escapeIcsText(null)).toBe('');
    expect(escapeIcsText(undefined)).toBe('');
  });
});

describe('foldIcsLine', () => {
  const byteLength = (s) => new TextEncoder().encode(s).length;

  it('leaves short lines untouched', () => {
    expect(foldIcsLine('SUMMARY:short')).toBe('SUMMARY:short');
  });

  it('folds a long ASCII line at 75 octets with a leading-space continuation', () => {
    const long = 'DESCRIPTION:' + 'x'.repeat(100);
    const folded = foldIcsLine(long);
    const parts = folded.split('\r\n');
    expect(parts[0].length).toBe(75);
    expect(parts[1].startsWith(' ')).toBe(true);
    // Rejoining (stripping the fold) must reproduce the original text.
    expect(parts.map((p, i) => (i === 0 ? p : p.slice(1))).join('')).toBe(long);
  });

  it('folds by UTF-8 OCTETS, not UTF-16 code units — 40 CJK characters is well under', () => {
    // 40 CJK characters: 40 UTF-16 code units (well under a naive 75-unit
    // limit) but 3 bytes each in UTF-8 = 120 octets (over the real limit).
    // A code-unit-based fold would wrongly leave this on one line.
    const long = 'SUMMARY:' + '会'.repeat(40);
    const folded = foldIcsLine(long);
    const lines = folded.split('\r\n');
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(byteLength(line)).toBeLessThanOrEqual(75);
    }
    // Rejoining reproduces the original text exactly — no character lost or
    // duplicated at a fold boundary.
    expect(lines.map((l, i) => (i === 0 ? l : l.slice(1))).join('')).toBe(long);
  });

  it('never splits a multi-byte character across a fold boundary', () => {
    const long = 'DESCRIPTION:' + '日本語のテスト文字列です。'.repeat(6);
    const folded = foldIcsLine(long);
    for (const line of folded.split('\r\n')) {
      // A line ending mid-character would produce a replacement-character
      // or truncated sequence when round-tripped through the encoder; a
      // clean re-encode/re-decode round trip proves every fold landed on a
      // whole-character boundary.
      const bytes = new TextEncoder().encode(line.startsWith(' ') ? line.slice(1) : line);
      expect(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).toBe(
        line.startsWith(' ') ? line.slice(1) : line,
      );
    }
  });

  it('keeps every folded line at or under 75 octets even for a run of 4-byte characters (emoji)', () => {
    const long = 'SUMMARY:' + '🎤'.repeat(30);
    const folded = foldIcsLine(long);
    for (const line of folded.split('\r\n')) {
      expect(byteLength(line)).toBeLessThanOrEqual(75);
    }
  });
});

describe('buildIcsCalendar', () => {
  it('produces a VCALENDAR with the session on the event wall clock in UTC', () => {
    const ics = buildIcsCalendar(fixtureConfig, [fixtureSession], {
      now: new Date('2026-09-01T00:00:00Z'),
    });
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('END:VCALENDAR');
    expect(ics).toContain('BEGIN:VEVENT');
    // 09:05 America/Chicago (CDT, UTC−5) on 2026-10-15 = 14:05 UTC.
    expect(ics).toContain('DTSTART:20261015T140500Z');
    expect(ics).toContain('DTEND:20261015T144500Z');
    expect(ics).toContain('SUMMARY:');
    expect(ics).toMatch(/\r\n/);
  });

  it('escapes session text inside the VEVENT', () => {
    const ics = buildIcsCalendar(
      fixtureConfig,
      [{ ...fixtureSession, title: 'Comma, semicolon; and\nnewline' }],
      { now: new Date('2026-09-01T00:00:00Z') },
    );
    expect(ics).toContain('SUMMARY:Comma\\, semicolon\\; and\\nnewline');
  });

  it('skips a session whose time cannot be resolved (fail soft), keeps the rest', () => {
    const unresolvable = { ...fixtureSession, id: 'fx-tba', dayId: 'no-such-day' };
    const ics = buildIcsCalendar(fixtureConfig, [unresolvable, fixtureSession], {
      now: new Date('2026-09-01T00:00:00Z'),
    });
    expect((ics.match(/BEGIN:VEVENT/g) || []).length).toBe(1);
  });

  it('produces a valid (still parseable) empty calendar for no sessions', () => {
    const ics = buildIcsCalendar(fixtureConfig, [], { now: new Date('2026-09-01T00:00:00Z') });
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('END:VCALENDAR');
    expect(ics).not.toContain('BEGIN:VEVENT');
  });

  it('gives each session a stable, distinct UID', () => {
    const other = { ...fixtureSession, id: 'fx-other', title: 'Another session' };
    const ics = buildIcsCalendar(fixtureConfig, [fixtureSession, other], {
      now: new Date('2026-09-01T00:00:00Z'),
    });
    const uids = [...ics.matchAll(/UID:([^\r\n]+)/g)].map((m) => m[1]);
    expect(new Set(uids).size).toBe(2);
  });
});

describe('icsFileName', () => {
  it('slugifies free text into a filesystem-safe .ics name', () => {
    expect(icsFileName('[Fixture] Morning Kickoff!')).toBe('fixture-morning-kickoff.ics');
  });

  it('falls back to "schedule.ics" for empty/unusable input', () => {
    expect(icsFileName('')).toBe('schedule.ics');
    expect(icsFileName('!!!')).toBe('schedule.ics');
  });
});

describe('buildGoogleCalendarUrl', () => {
  it('builds a no-OAuth "add to calendar" URL with the session on the wall clock in UTC', () => {
    const url = buildGoogleCalendarUrl(fixtureConfig, fixtureSession);
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(parsed.searchParams.get('action')).toBe('TEMPLATE');
    expect(parsed.searchParams.get('dates')).toBe('20261015T140500Z/20261015T144500Z');
    expect(parsed.searchParams.get('text')).toBe(fixtureSession.title);
    expect(parsed.searchParams.get('location')).toContain('Main hall');
  });

  it('returns null when the session time cannot be resolved', () => {
    expect(buildGoogleCalendarUrl(fixtureConfig, { ...fixtureSession, dayId: 'nope' })).toBeNull();
  });
});

describe('buildOutlookCalendarUrl', () => {
  it('builds a no-OAuth "add to calendar" deep link', () => {
    const url = buildOutlookCalendarUrl(fixtureConfig, fixtureSession);
    const parsed = new URL(url);
    expect(parsed.origin).toBe('https://outlook.live.com');
    expect(parsed.searchParams.get('rru')).toBe('addevent');
    expect(parsed.searchParams.get('subject')).toBe(fixtureSession.title);
    expect(parsed.searchParams.get('startdt')).toBe('2026-10-15T14:05:00.000Z');
  });

  it('returns null when the session time cannot be resolved', () => {
    expect(buildOutlookCalendarUrl(fixtureConfig, { ...fixtureSession, dayId: 'nope' })).toBeNull();
  });
});
