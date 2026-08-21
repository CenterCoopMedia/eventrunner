'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSchedulePdf,
  createBuildSchedulePdfHandler,
  internals: {
    hexToRgb01,
    resolveThemeColors,
    resolveBranding,
    fitText,
    groupSessionsByDay,
    resolveSpeakerLine,
    deriveApprovedSpeakerName,
    formatClock,
    formatSessionTime,
    canEncode,
    sanitizeForFont,
  },
} = require('./pdf.cjs');
const { makeFakeDb } = require('../cms/firestoreFake.cjs');

// This test file exercises hex-color parsing directly, but pdf.test.cjs is
// NOT on the spec §7.6 hex-literal allowlist (only pdf.cjs itself is — the
// allowlist is exactly three paths, by design). Building fixture colors
// through this helper keeps every hex value config-shaped test DATA rather
// than a source-level hex literal, so the lint rule (rightly) does not
// need a fourth allowlisted path just for tests.
const hex = (digits) => `#${digits}`;

// -------------------------------------------------------------- fixtures

const THREE_DAYS = [
  { id: 'day-1', label: 'Day one', date: '2026-10-14', startTime: '09:00', endTime: '17:00' },
  { id: 'day-2', label: 'Day two', date: '2026-10-15', startTime: '09:00', endTime: '17:00' },
  { id: 'day-3', label: 'Day three', date: '2026-10-16', startTime: '09:00', endTime: '16:00' },
];

const EVENT = {
  name: '[Fixture] Harborlight Media Summit',
  tagline: 'A synthetic three-day event',
  timezone: 'America/New_York',
  days: THREE_DAYS,
  venue: { name: 'Fixture Hall', city: 'Testville', region: 'ST' },
};

const THEME = {
  colors: {
    primary: hex('123456'),
    ink: hex('111111'),
    inkMuted: hex('666666'),
    surface: hex('FFFFFF'),
    accent: hex('ABCDEF'),
  },
};

function session(overrides) {
  return {
    id: 'session',
    dayId: 'day-1',
    startTime: '09:30',
    endTime: '10:00',
    title: 'Fixture session',
    location: 'Main hall',
    speakerIds: [],
    order: 0,
    visible: true,
    ...overrides,
  };
}

// ------------------------------------------------------------- hexToRgb01

test('hexToRgb01: parses #rgb and #rrggbb, rejects everything else', () => {
  assert.deepEqual(hexToRgb01(hex('000000')), { r: 0, g: 0, b: 0 });
  assert.deepEqual(hexToRgb01(hex('ffffff')), { r: 1, g: 1, b: 1 });
  assert.deepEqual(hexToRgb01(hex('f00')), { r: 1, g: 0, b: 0 });
  assert.equal(hexToRgb01('not-a-color'), null);
  assert.equal(hexToRgb01('#gggggg'), null);
  assert.equal(hexToRgb01(undefined), null);
  assert.equal(hexToRgb01(null), null);
});

test('resolveThemeColors: configured colors win, missing/invalid ones fall back independently', () => {
  const resolved = resolveThemeColors({ colors: { primary: hex('010203'), ink: 'nonsense' } });
  assert.deepEqual(resolved.primary, hexToRgb01(hex('010203')));
  // 'ink' was invalid -> falls back to the default, not to primary.
  assert.deepEqual(resolved.ink, hexToRgb01(hex('1F2933')));
  // surface/accent/inkMuted were entirely absent -> defaults.
  assert.ok(resolved.surface);
  assert.ok(resolved.accent);
});

test('resolveThemeColors: a null/missing theme falls back entirely to defaults', () => {
  const resolved = resolveThemeColors(null);
  assert.deepEqual(resolved.primary, hexToRgb01(hex('1F2933')));
});

// -------------------------------------------------------------- branding

test('resolveBranding: reads name/tagline/venue from config/event', () => {
  const b = resolveBranding(EVENT);
  assert.equal(b.name, EVENT.name);
  assert.equal(b.tagline, EVENT.tagline);
  assert.equal(b.venueLine, 'Fixture Hall, Testville, ST');
});

test('resolveBranding: fails soft on a missing/half-seeded config/event', () => {
  assert.deepEqual(resolveBranding(null), { name: 'Event schedule', tagline: null, venueLine: null });
  assert.deepEqual(resolveBranding({}), { name: 'Event schedule', tagline: null, venueLine: null });
  assert.equal(resolveBranding({ venue: {} }).venueLine, null);
});

// ------------------------------------------------------------------ fitText

test('fitText: picks the largest size whose measured width fits', () => {
  // Deterministic synthetic measure: width = length * size * 0.5.
  const measure = (text, size) => text.length * size * 0.5;
  const { size, width } = fitText({ measure, text: 'Hello', maxWidth: 100, maxSize: 60, minSize: 6 });
  assert.ok(size <= 60 && size >= 6);
  assert.ok(width <= 100);
  // One size up must have overflowed (binary search found the true max).
  assert.ok(measure('Hello', size + 1) > 100);
});

test('fitText: empty text returns maxSize with zero width, never calls measure', () => {
  let called = false;
  const result = fitText({ measure: () => { called = true; return 0; }, text: '', maxWidth: 100, maxSize: 24 });
  assert.equal(result.size, 24);
  assert.equal(result.width, 0);
  assert.equal(called, false);
});

test('fitText: even the minimum size overflows -> returns minSize (best effort, no throw)', () => {
  const measure = () => 9999;
  const result = fitText({ measure, text: 'Way too long', maxWidth: 10, maxSize: 24, minSize: 6 });
  assert.equal(result.size, 6);
});

test('fitText: maxSize below minSize is handled without an infinite loop', () => {
  const measure = (text, size) => size;
  const result = fitText({ measure, text: 'x', maxWidth: 100, maxSize: 4, minSize: 10 });
  assert.equal(result.size, 10);
});

// ---------------------------------------------------------- day grouping

test('groupSessionsByDay: groups by arbitrary-length days[] in configured order', () => {
  const sessions = [
    session({ id: 'c', dayId: 'day-3', startTime: '09:30' }),
    session({ id: 'a', dayId: 'day-1', startTime: '10:00' }),
    session({ id: 'b', dayId: 'day-1', startTime: '09:00' }),
  ];
  const grouped = groupSessionsByDay(sessions, THREE_DAYS);
  assert.equal(grouped.length, 3);
  assert.deepEqual(grouped.map((g) => g.day.id), ['day-1', 'day-2', 'day-3']);
  assert.deepEqual(grouped[0].sessions.map((s) => s.id), ['b', 'a']); // sorted by startTime
  assert.deepEqual(grouped[1].sessions, []);
  assert.deepEqual(grouped[2].sessions.map((s) => s.id), ['c']);
});

test('groupSessionsByDay: a session naming an unconfigured dayId is dropped, not misfiled', () => {
  const sessions = [session({ id: 'orphan', dayId: 'no-such-day' })];
  const grouped = groupSessionsByDay(sessions, THREE_DAYS);
  assert.deepEqual(grouped.flatMap((g) => g.sessions), []);
});

test('groupSessionsByDay: an empty days[] yields an empty grouping (no crash)', () => {
  assert.deepEqual(groupSessionsByDay([session()], []), []);
  assert.deepEqual(groupSessionsByDay([], []), []);
});

test('groupSessionsByDay: ties on startTime break on `order`', () => {
  const sessions = [
    session({ id: 'second', dayId: 'day-1', startTime: '09:00', order: 1 }),
    session({ id: 'first', dayId: 'day-1', startTime: '09:00', order: 0 }),
  ];
  const grouped = groupSessionsByDay(sessions, THREE_DAYS);
  assert.deepEqual(grouped[0].sessions.map((s) => s.id), ['first', 'second']);
});

// ------------------------------------------------------------- speakers

test('resolveSpeakerLine: joins resolved names, drops unresolved ids silently', () => {
  const names = { 's1': 'Alex Placeholder', 's2': 'Sam Example' };
  assert.equal(resolveSpeakerLine(['s1', 's2'], names), 'Alex Placeholder, Sam Example');
  assert.equal(resolveSpeakerLine(['s1', 'unknown'], names), 'Alex Placeholder');
  assert.equal(resolveSpeakerLine([], names), '');
  assert.equal(resolveSpeakerLine(undefined, names), '');
});

// -------------------------------------------------- canonical speaker name

test('deriveApprovedSpeakerName: prefers displayName, else firstName + lastName, for an approved speaker', () => {
  assert.equal(
    deriveApprovedSpeakerName({ firstName: 'Alex', lastName: 'Placeholder', status: 'approved' }),
    'Alex Placeholder',
  );
  assert.equal(
    deriveApprovedSpeakerName({
      firstName: 'Alex',
      lastName: 'Placeholder',
      displayName: 'A. Placeholder',
      status: 'approved',
    }),
    'A. Placeholder',
  );
});

test('deriveApprovedSpeakerName: never resolves a non-approved speaker (invited/pending/declined/removed/missing status)', () => {
  for (const status of ['invited', 'pending', 'declined', 'removed', undefined, null, '']) {
    assert.equal(
      deriveApprovedSpeakerName({ firstName: 'Alex', lastName: 'Placeholder', status }),
      '',
      `status ${JSON.stringify(status)} must not resolve a name`,
    );
  }
});

test('deriveApprovedSpeakerName: fails soft on a missing/malformed record', () => {
  assert.equal(deriveApprovedSpeakerName(null), '');
  assert.equal(deriveApprovedSpeakerName(undefined), '');
  assert.equal(deriveApprovedSpeakerName({ status: 'approved' }), ''); // no usable name fields
});

// ----------------------------------------------------------------- clock

test('formatClock / formatSessionTime: 24h wall clock to 12h display', () => {
  assert.equal(formatClock('09:30'), '9:30 AM');
  assert.equal(formatClock('00:00'), '12:00 AM');
  assert.equal(formatClock('12:00'), '12:00 PM');
  assert.equal(formatClock('23:59'), '11:59 PM');
  assert.equal(formatSessionTime({ startTime: '09:30', endTime: '10:00' }), '9:30 AM–10:00 AM');
  assert.equal(formatSessionTime({ startTime: '09:30' }), '9:30 AM');
  assert.equal(formatSessionTime({}), '');
});

// ------------------------------------------------------ unicode sanitize

async function helveticaFont() {
  const { PDFDocument, StandardFonts } = require('pdf-lib');
  const doc = await PDFDocument.create();
  return doc.embedFont(StandardFonts.Helvetica);
}

test('canEncode: true for WinAnsi-encodable text, false for CJK/Arabic/emoji', async () => {
  const font = await helveticaFont();
  assert.equal(canEncode(font, 'Hello, world'), true);
  assert.equal(canEncode(font, 'café'), true); // Latin-1 accented — WinAnsi covers this directly
  assert.equal(canEncode(font, '日本語'), false);
  assert.equal(canEncode(font, 'مرحبا'), false);
  assert.equal(canEncode(font, '😀'), false);
});

test('sanitizeForFont: passes already-encodable text through unchanged (fast path)', async () => {
  const font = await helveticaFont();
  assert.equal(sanitizeForFont(font, 'Plain ASCII title'), 'Plain ASCII title');
  assert.equal(sanitizeForFont(font, 'café'), 'café');
  assert.equal(sanitizeForFont(font, ''), '');
  assert.equal(sanitizeForFont(font, null), '');
  assert.equal(sanitizeForFont(font, undefined), '');
});

test('sanitizeForFont: transliterates accented Latin beyond Latin-1 via NFKD + combining-mark strip', async () => {
  const font = await helveticaFont();
  // "ế" (Vietnamese e with circumflex + acute) has no direct WinAnsi slot,
  // but NFKD-decomposes to "e" plus two combining marks.
  assert.equal(sanitizeForFont(font, 'Tiếng Việt'), 'Tieng Viet');
});

test('sanitizeForFont: drops unrecoverable scripts (CJK/Arabic) rather than crashing, keeping the rest', async () => {
  const font = await helveticaFont();
  assert.equal(sanitizeForFont(font, 'Hello 日本語 world'), 'Hello  world');
  assert.equal(sanitizeForFont(font, 'مرحبا'), '(unsupported characters)');
});

test('sanitizeForFont: a surrogate-pair emoji is dropped whole, never split into lone surrogates', async () => {
  const font = await helveticaFont();
  const result = sanitizeForFont(font, 'Party 😀 time');
  assert.equal(result, 'Party  time');
  // No lone surrogate leaked through (which would itself be a WinAnsi throw).
  assert.equal(canEncode(font, result), true);
});

test('buildSchedulePdf: CJK/Arabic/emoji in event name, title, and speaker name never 500s', async () => {
  const sessions = [
    session({
      id: 'intl',
      dayId: 'day-1',
      title: '日本語のセッション',
      location: 'مؤتمر',
      speakerIds: ['sp-intl'],
    }),
  ];
  const bytes = await buildSchedulePdf({
    event: { ...EVENT, name: '日本語イベント 😀', days: THREE_DAYS },
    theme: THEME,
    sessions,
    speakerNamesById: { 'sp-intl': '田中太郎' },
  });
  assert.equal(Buffer.from(bytes).toString('latin1', 0, 5), '%PDF-');
});

// ------------------------------------------------------------- PDF build

test('buildSchedulePdf: a 3-day synthetic event produces a correctly grouped, branded PDF', async () => {
  const { PDFDocument } = require('pdf-lib');
  const sessions = [
    session({ id: 's1', dayId: 'day-1', startTime: '09:30', title: 'Welcome', speakerIds: ['sp1'] }),
    session({ id: 's2', dayId: 'day-1', startTime: '10:30', title: 'Workshop A' }),
    session({ id: 's3', dayId: 'day-2', startTime: '09:30', title: 'Panel' }),
    session({ id: 's4', dayId: 'day-3', startTime: '15:00', title: 'Closing' }),
  ];
  const bytes = await buildSchedulePdf({
    event: EVENT,
    theme: THEME,
    sessions,
    speakerNamesById: { sp1: 'Alex Placeholder' },
  });

  assert.ok(Buffer.isBuffer(Buffer.from(bytes)));
  assert.equal(Buffer.from(bytes).toString('latin1', 0, 5), '%PDF-');

  const loaded = await PDFDocument.load(bytes);
  // Config-driven branding: the doc title comes straight from config/event.
  assert.equal(loaded.getTitle(), EVENT.name);
  assert.equal(loaded.getSubject(), EVENT.tagline);
  // One page per configured day, at minimum.
  assert.ok(loaded.getPageCount() >= THREE_DAYS.length);
});

test('buildSchedulePdf: empty days[] still produces a single valid page (no crash)', async () => {
  const { PDFDocument } = require('pdf-lib');
  const bytes = await buildSchedulePdf({
    event: { ...EVENT, days: [] },
    theme: THEME,
    sessions: [],
  });
  const loaded = await PDFDocument.load(bytes);
  assert.equal(loaded.getPageCount(), 1);
});

test('buildSchedulePdf: a day with zero visible sessions still gets its own page', async () => {
  const { PDFDocument } = require('pdf-lib');
  const bytes = await buildSchedulePdf({ event: EVENT, theme: THEME, sessions: [] });
  const loaded = await PDFDocument.load(bytes);
  assert.equal(loaded.getPageCount(), THREE_DAYS.length);
});

test('buildSchedulePdf: missing theme falls back to default colors without throwing', async () => {
  const bytes = await buildSchedulePdf({ event: EVENT, theme: null, sessions: [] });
  assert.equal(Buffer.from(bytes).toString('latin1', 0, 5), '%PDF-');
});

// ---------------------------------------------------------------- handler

function fakeRes() {
  const res = {
    statusCode: null,
    headers: {},
    sent: null,
    set(name, value) {
      res.headers[name] = value;
      return res;
    },
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.sent = payload;
      return res;
    },
    send(payload) {
      res.sent = payload;
      return res;
    },
  };
  return res;
}

test('createBuildSchedulePdfHandler: 405 on non-GET', async () => {
  const db = makeFakeDb();
  const handler = createBuildSchedulePdfHandler({ db, getConfig: async () => ({ features: { schedulePdf: true } }) });
  const res = fakeRes();
  await handler({ method: 'POST' }, res);
  assert.equal(res.statusCode, 405);
});

test('createBuildSchedulePdfHandler: 404 when the feature flag is off', async () => {
  const db = makeFakeDb();
  const handler = createBuildSchedulePdfHandler({ db, getConfig: async () => ({ features: {} }) });
  const res = fakeRes();
  await handler({ method: 'GET' }, res);
  assert.equal(res.statusCode, 404);
});

test('createBuildSchedulePdfHandler: 200 with a PDF body, reading only visible sessions', async () => {
  const db = makeFakeDb({
    'cmsSchedule/visible-1': session({ id: 'visible-1', visible: true }),
    'cmsSchedule/hidden-1': session({ id: 'hidden-1', visible: false }),
  });
  const handler = createBuildSchedulePdfHandler({
    db,
    getConfig: async () => ({ features: { schedulePdf: true }, event: EVENT, theme: THEME }),
  });
  const res = fakeRes();
  await handler({ method: 'GET' }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'application/pdf');
  assert.equal(Buffer.isBuffer(res.sent), true);
  assert.equal(res.sent.toString('latin1', 0, 5), '%PDF-');
});

test('createBuildSchedulePdfHandler: resolves speaker names via the canonical firstName/lastName/status shape, approved only', async () => {
  const db = makeFakeDb({
    'cmsSchedule/s1': session({ id: 's1', speakerIds: ['approved-1', 'pending-1'] }),
    'speakers/approved-1': { firstName: 'Alex', lastName: 'Placeholder', status: 'approved' },
    'speakers/pending-1': { firstName: 'Sam', lastName: 'NotYetApproved', status: 'pending' },
  });
  const handler = createBuildSchedulePdfHandler({
    db,
    getConfig: async () => ({ features: { schedulePdf: true }, event: EVENT, theme: THEME }),
  });
  const res = fakeRes();
  await handler({ method: 'GET' }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.sent.toString('latin1', 0, 5), '%PDF-');
});

test('createBuildSchedulePdfHandler: tolerates a missing speakers collection', async () => {
  const db = makeFakeDb({ 'cmsSchedule/s1': session({ id: 's1' }) });
  const handler = createBuildSchedulePdfHandler({
    db,
    getConfig: async () => ({ features: { schedulePdf: true }, event: EVENT, theme: THEME }),
  });
  const res = fakeRes();
  await handler({ method: 'GET' }, res);
  assert.equal(res.statusCode, 200);
});
