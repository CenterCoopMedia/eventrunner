'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const kit = require('./kit.cjs');
const {
  DEFAULT_COLORS,
  isNonEmptyString,
  hexToRgb01,
  resolveThemeColors,
  resolveBranding,
  fitText,
  canEncode,
  sanitizeForFont,
} = kit;

// Test files are not on the spec §7.6 hex-literal allowlist, so fixture
// colors are built as data (see schedule/pdf.test.cjs).
const hex = (digits) => `#${digits}`;

async function standardFonts() {
  const { PDFDocument, StandardFonts } = require('pdf-lib');
  const doc = await PDFDocument.create();
  return {
    body: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
}

// ------------------------------------------------------------- surface

test('kit: exports the shared helpers and nothing schedule-specific', () => {
  assert.deepEqual(Object.keys(kit).sort(), [
    'DEFAULT_COLORS',
    'canEncode',
    'fitText',
    'hexToRgb01',
    'isNonEmptyString',
    'resolveBranding',
    'resolveThemeColors',
    'sanitizeForFont',
  ]);
});

test('kit: the schedule PDF uses these same functions, not copies', () => {
  const { internals } = require('../schedule/pdf.cjs');
  for (const name of [
    'DEFAULT_COLORS',
    'hexToRgb01',
    'resolveThemeColors',
    'resolveBranding',
    'fitText',
    'canEncode',
    'sanitizeForFont',
  ]) {
    assert.equal(internals[name], kit[name], name);
  }
});

// -------------------------------------------------------------- colors

test('DEFAULT_COLORS: frozen, and every value parses as a hex color', () => {
  assert.equal(Object.isFrozen(DEFAULT_COLORS), true);
  assert.deepEqual(Object.keys(DEFAULT_COLORS), ['primary', 'ink', 'inkMuted', 'surface', 'accent']);
  for (const [key, value] of Object.entries(DEFAULT_COLORS)) {
    assert.notEqual(hexToRgb01(value), null, key);
  }
});

test('hexToRgb01: parses #rgb and #rrggbb in either case', () => {
  assert.deepEqual(hexToRgb01(hex('000')), { r: 0, g: 0, b: 0 });
  assert.deepEqual(hexToRgb01(hex('FFFFFF')), { r: 1, g: 1, b: 1 });
  assert.deepEqual(hexToRgb01(hex('f00')), hexToRgb01(hex('ff0000')));
  assert.deepEqual(hexToRgb01(hex('336699')), { r: 0x33 / 255, g: 0x66 / 255, b: 0x99 / 255 });
});

test('hexToRgb01: returns null for anything that is not #rgb or #rrggbb', () => {
  for (const bad of [hex('12345'), hex('1234'), hex('12345678'), hex('ggg'), '336699', '', null, 7, {}]) {
    assert.equal(hexToRgb01(bad), null, String(bad));
  }
});

test('resolveThemeColors: with no theme, every key is the fallback', () => {
  const expected = Object.fromEntries(
    Object.entries(DEFAULT_COLORS).map(([key, value]) => [key, hexToRgb01(value)]),
  );
  assert.deepEqual(resolveThemeColors(null), expected);
  assert.deepEqual(resolveThemeColors(undefined), expected);
  assert.deepEqual(resolveThemeColors({}), expected);
  assert.deepEqual(resolveThemeColors('not an object'), expected);
});

test('resolveThemeColors: each key falls back on its own', () => {
  const resolved = resolveThemeColors({
    colors: { primary: hex('102030'), ink: 'blue', brandAccent: hex('abc') },
  });
  assert.deepEqual(resolved.primary, hexToRgb01(hex('102030')));
  assert.deepEqual(resolved.ink, hexToRgb01(DEFAULT_COLORS.ink));
  assert.deepEqual(resolved.inkMuted, hexToRgb01(DEFAULT_COLORS.inkMuted));
  assert.deepEqual(resolved.accent, hexToRgb01(hex('abc')));
});

// ------------------------------------------------------------ branding

test('resolveBranding: trims configured text and joins the venue parts', () => {
  assert.deepEqual(
    resolveBranding({
      name: '  Fixture Summit ',
      tagline: ' Two days ',
      venue: { name: 'Fixture Hall', city: '', region: 'ST' },
    }),
    { name: 'Fixture Summit', tagline: 'Two days', venueLine: 'Fixture Hall, ST' },
  );
});

test('resolveBranding: a missing or blank event gives the placeholder name', () => {
  const empty = { name: 'Event schedule', tagline: null, venueLine: null };
  assert.deepEqual(resolveBranding(null), empty);
  assert.deepEqual(resolveBranding({ name: '   ', venue: 'Fixture Hall' }), empty);
  assert.deepEqual(resolveBranding({ venue: { name: ' ' } }), empty);
});

// ------------------------------------------------------------- fitText

test('fitText: picks the largest size that fits', () => {
  const measure = (text, size) => text.length * size;
  assert.deepEqual(fitText({ measure, text: 'abcde', maxWidth: 50, maxSize: 12, minSize: 6 }), {
    size: 10,
    width: 50,
  });
  assert.deepEqual(fitText({ measure, text: 'ab', maxWidth: 50, maxSize: 12 }), {
    size: 12,
    width: 24,
  });
});

test('fitText: keeps the floor when nothing fits, and skips empty text', () => {
  const measure = (text, size) => text.length * size;
  assert.deepEqual(fitText({ measure, text: 'abcdefghij', maxWidth: 10, maxSize: 12, minSize: 6 }), {
    size: 6,
    width: 60,
  });
  assert.deepEqual(fitText({ measure, text: '  ', maxWidth: 10, maxSize: 12 }), {
    size: 12,
    width: 0,
  });
  assert.deepEqual(fitText({ measure, text: 'abc', maxWidth: 10, maxSize: 4, minSize: 6 }), {
    size: 6,
    width: 18,
  });
});

test('fitText: the size it picks fits a real font', async () => {
  const { bold } = await standardFonts();
  const text = 'A long title that must shrink to fit the column';
  const fit = fitText({
    measure: (t, size) => bold.widthOfTextAtSize(t, size),
    text,
    maxWidth: 250,
    maxSize: 12,
    minSize: 6,
  });
  assert.ok(fit.size < 12);
  assert.ok(bold.widthOfTextAtSize(text, fit.size) <= 250);
  assert.ok(bold.widthOfTextAtSize(text, fit.size + 1) > 250);
});

// ---------------------------------------------------------- font safety

test('isNonEmptyString: true only for a string with a non-space character', () => {
  assert.equal(isNonEmptyString('a'), true);
  assert.equal(isNonEmptyString(' a '), true);
  for (const value of ['', '   ', null, undefined, 1, ['a']]) {
    assert.equal(isNonEmptyString(value), false, String(value));
  }
});

test('canEncode: true for WinAnsi text, false for other scripts', async () => {
  const { body } = await standardFonts();
  assert.equal(canEncode(body, 'Invoice total: 1,250.00'), true);
  assert.equal(canEncode(body, 'Café'), true);
  assert.equal(canEncode(body, 'Tiếng'), false);
  assert.equal(canEncode(body, '日本語'), false);
  assert.equal(canEncode(body, '😀'), false);
});

test('sanitizeForFont: keeps, transliterates, drops, or replaces', async () => {
  const { body, bold } = await standardFonts();
  assert.equal(sanitizeForFont(body, 'Plain text'), 'Plain text');
  assert.equal(sanitizeForFont(body, 'Tiếng Việt'), 'Tieng Viet');
  assert.equal(sanitizeForFont(bold, 'Acme 日本 Media 😀'), 'Acme  Media ');
  assert.equal(sanitizeForFont(body, '日本語'), '(unsupported characters)');
  assert.equal(sanitizeForFont(body, ''), '');
  assert.equal(sanitizeForFont(body, null), '');
  assert.equal(sanitizeForFont(body, 42), '');
});
