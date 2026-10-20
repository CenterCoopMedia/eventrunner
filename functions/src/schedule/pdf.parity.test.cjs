'use strict';

// Parity check for the schedule PDF (issue #209, PR 2 of 5).
//
// The PDF helpers moved from pdf.cjs into ../pdf/kit.cjs so the invoice PDF
// can share them. That move must not change one byte of a schedule PDF. This
// test renders fixed fixtures with a fixed clock and compares the result with
// pdf.parity.snapshot.cjs, which was generated from pdf.cjs BEFORE the move.
//
// Two things are compared for each fixture:
//   - every page's decoded content stream (the drawn text, fonts, sizes,
//     positions and colors), so a failure shows which draw call changed
//   - the SHA-256 of the whole file, so a change outside the page content
//     (metadata, fonts, object order) also fails
//
// To regenerate the snapshot after an intended layout change, run:
//   UPDATE_PDF_PARITY=1 node --test functions/src/schedule/pdf.parity.test.cjs
// and say in the pull request why the output changed.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { buildSchedulePdf } = require('./pdf.cjs');

const SNAPSHOT_PATH = path.join(__dirname, 'pdf.parity.snapshot.cjs');
// pdf-lib stamps the creation and modification dates from the clock.
const FIXED_NOW = Date.UTC(2026, 0, 2, 3, 4, 5);

// Theme colors are test data, not hex literals (see pdf.test.cjs).
const hex = (digits) => `#${digits}`;

const DAYS = [
  { id: 'day-1', label: 'Day one', date: '2026-10-14' },
  { id: 'day-2', label: '', date: '2026-10-15' },
  { id: 'day-3', date: '' },
];

function session(id, overrides) {
  return {
    id,
    dayId: 'day-1',
    startTime: '09:30',
    endTime: '10:00',
    title: `Session ${id}`,
    location: 'Main hall',
    speakerIds: [],
    order: 0,
    visible: true,
    ...overrides,
  };
}

// Day one overflows onto a continuation page; day two has no sessions;
// day three uses the id as its label. Titles cover fitText (a long title)
// and sanitizeForFont (Latin-1, accented Latin past Latin-1, CJK only).
const SESSIONS = [
  session('s-long', {
    startTime: '08:00',
    endTime: '08:45',
    title:
      'A very long fixture session title that cannot fit the title column at twelve points and must shrink',
    speakerIds: ['sp-1', 'sp-2', 'sp-missing'],
  }),
  session('s-latin', { startTime: '09:00', title: 'Café opening remarks', location: 'Salle Été' }),
  session('s-viet', { startTime: '09:00', order: 1, title: 'Tiếng Việt panel', location: '' }),
  session('s-cjk', { startTime: '13:00', endTime: '', title: '日本語', speakerIds: ['sp-3'] }),
  session('s-untitled', { startTime: '14:00', endTime: '15:30', title: '   ', location: '  ' }),
  ...Array.from({ length: 24 }, (_, i) =>
    session(`s-fill-${String(i).padStart(2, '0')}`, {
      startTime: `${String(10 + Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`,
      endTime: '',
      speakerIds: i % 3 === 0 ? ['sp-1'] : [],
    }),
  ),
  session('s-day3', { dayId: 'day-3', startTime: '11:00', endTime: '12:00', title: 'Closing' }),
  session('s-orphan', { dayId: 'day-9', title: 'Orphan session' }),
];

const SPEAKERS = { 'sp-1': 'Alex Rivera', 'sp-2': 'Sam Lê', 'sp-3': '李雷' };

const FIXTURES = {
  'public, full theme': {
    event: {
      name: '[Fixture] Harborlight Media Summit',
      tagline: 'A synthetic three-day event',
      days: DAYS,
      venue: { name: 'Fixture Hall', city: 'Testville', region: 'ST' },
    },
    theme: {
      colors: {
        primary: hex('123456'),
        ink: hex('111111'),
        inkMuted: hex('666666'),
        surface: hex('FFFFFF'),
        accent: hex('ABCDEF'),
      },
    },
    sessions: SESSIONS,
    speakerNamesById: SPEAKERS,
  },
  'public, alias and invalid theme colors, sparse event': {
    event: { name: '  ', venue: { name: '', city: 'Testville' }, days: DAYS.slice(1) },
    theme: { colors: { brandPrimary: hex('abc'), ink: 'not-a-color', accent: hex('12345') } },
    sessions: SESSIONS,
  },
  'personal copy': {
    event: { name: 'Fixture Summit', days: DAYS },
    theme: null,
    sessions: SESSIONS,
    speakerNamesById: SPEAKERS,
    ownerName: 'Alex Rivera',
    onlySessionIds: ['s-long', 's-cjk', 's-day3'],
  },
  'no days, no event': {
    event: null,
    theme: undefined,
    sessions: [],
  },
};

/** Decoded content stream of every page, in page order. */
async function pageContents(bytes) {
  const { PDFDocument, PDFArray, PDFRawStream, decodePDFRawStream } = require('pdf-lib');
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return doc.getPages().map((page) => {
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray() : [contents];
    return streams
      .map((ref) => doc.context.lookup(ref))
      .map((stream) =>
        stream instanceof PDFRawStream
          ? Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1')
          : Buffer.from(stream.getContents()).toString('latin1'),
      )
      .join('\n');
  });
}

async function render(t, args) {
  t.mock.timers.enable({ apis: ['Date'], now: FIXED_NOW });
  try {
    const bytes = await buildSchedulePdf(args);
    return {
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      pages: await pageContents(bytes),
    };
  } finally {
    t.mock.timers.reset();
  }
}

test('pdf parity: a fixed clock gives the same bytes twice', async (t) => {
  const first = await render(t, FIXTURES['public, full theme']);
  const second = await render(t, FIXTURES['public, full theme']);
  assert.equal(first.sha256, second.sha256);
});

if (process.env.UPDATE_PDF_PARITY === '1') {
  test('pdf parity: write the snapshot', async (t) => {
    const out = {};
    for (const [name, args] of Object.entries(FIXTURES)) out[name] = await render(t, args);
    const body =
      "'use strict';\n\n" +
      '// Generated by pdf.parity.test.cjs with UPDATE_PDF_PARITY=1. Do not edit by hand.\n' +
      `module.exports = ${JSON.stringify(out, null, 2)};\n`;
    fs.writeFileSync(SNAPSHOT_PATH, body);
  });
} else {
  const snapshot = require(SNAPSHOT_PATH);

  test('pdf parity: the snapshot covers every fixture', () => {
    assert.deepEqual(Object.keys(snapshot).sort(), Object.keys(FIXTURES).sort());
  });

  for (const [name, args] of Object.entries(FIXTURES)) {
    test(`pdf parity: ${name} draws the same text and colors`, async (t) => {
      const actual = await render(t, args);
      assert.equal(actual.pages.length, snapshot[name].pages.length, 'page count');
      actual.pages.forEach((content, i) => {
        assert.equal(content, snapshot[name].pages[i], `page ${i + 1} content stream`);
      });
    });

    test(`pdf parity: ${name} gives the same bytes`, async (t) => {
      const actual = await render(t, args);
      assert.equal(actual.sha256, snapshot[name].sha256);
    });
  }
}
