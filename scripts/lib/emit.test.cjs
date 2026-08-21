'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { emitAll, internals } = require('./emit.cjs');
const { demoSnapshot, demoEvent } = require('./demo-event.cjs');
const { validatePageDoc } = require('../../functions/src/cms/pages.cjs');

const GENERATED_DIR = path.resolve(__dirname, '..', '..', 'apps', 'web', 'src', 'generated');

test('the committed snapshot is exactly what the demo fixture generates', () => {
  // This is the §8.6 hygiene gate in unit-test form: it catches a stale
  // snapshot AND a snapshot overwritten with anything other than demo
  // data, with no credentials and no emulator.
  const files = emitAll(demoSnapshot());
  for (const [name, contents] of Object.entries(files)) {
    const committed = fs.readFileSync(path.join(GENERATED_DIR, name), 'utf8');
    assert.equal(
      contents,
      committed,
      `apps/web/src/generated/${name} is stale — regenerate with: node scripts/generate-content.cjs --demo`,
    );
  }
});

test('generation is deterministic across runs', () => {
  assert.deepEqual(emitAll(demoSnapshot()), emitAll(demoSnapshot()));
});

test('generation does not depend on the order docs come back from Firestore', () => {
  const base = demoSnapshot();
  const shuffled = {
    ...base,
    pages: [...base.pages].reverse(),
    content: [...base.content].reverse(),
    sessions: [...base.sessions].reverse(),
    organizations: [...base.organizations].reverse(),
    speakers: [...base.speakers].reverse(),
  };
  assert.deepEqual(emitAll(shuffled), emitAll(base));
});

test('publish bookkeeping is stripped, and seeded is kept', () => {
  const base = demoSnapshot();
  const noisy = {
    ...base,
    content: base.content.map((doc) => ({
      ...doc,
      revision: 7,
      status: 'clean',
      publishedAt: new Date(0),
      publishedBy: 'someone',
      basedOnRevision: 6,
    })),
  };
  const out = emitAll(noisy)['siteContent.js'];
  assert.doesNotMatch(out, /revision|publishedAt|publishedBy|basedOnRevision|seededAt/);
  assert.match(out, /seeded: true/);
});

test('config/bootstrap is never emitted into the bundle', () => {
  const files = emitAll(demoSnapshot());
  const all = Object.values(files).join('\n');
  assert.doesNotMatch(all, /adminEmails/);
  assert.doesNotMatch(all, /demo-admin@example\.org/);
});

test('theme.css carries the palette as RGB triples, and the fonts it names ship in the repo', () => {
  const css = emitAll(demoSnapshot())['theme.css'];
  assert.match(css, /--brand-primary-rgb: \d+ \d+ \d+;/);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{6}/, 'hex belongs in config/theme, triples in the stylesheet');
  for (const file of css.matchAll(/url\('\/fonts\/([^']+)'\)/g)) {
    const fontPath = path.resolve(__dirname, '..', '..', 'apps', 'web', 'public', 'fonts', file[1]);
    assert.ok(fs.existsSync(fontPath), `${file[1]} is referenced but not in the repo`);
  }
});

test('the demo fixture is a three-day event with content on every day', () => {
  const demo = demoEvent();
  assert.equal(demo.config.event.days.length, 3);
  const dayIds = new Set(demo.sessions.map((s) => s.dayId));
  for (const day of demo.config.event.days) {
    assert.ok(dayIds.has(day.id), `no demo session on ${day.id}`);
  }
  assert.ok(demo.speakers.length >= 3);
  assert.ok(demo.organizations.length >= 3);
});

test('every demo page is a valid page doc, and every demo name is fictional', () => {
  const demo = demoEvent();
  for (const page of demo.pages) {
    const { seeded, ...contract } = page;
    assert.equal(validatePageDoc(contract).ok, true, `${page.id} is not a valid page doc`);
  }
  const names = [
    ...demo.speakers.map((s) => s.name),
    ...demo.organizations.map((o) => o.name),
    demo.config.event.name,
    demo.config.event.legal.operatorName,
  ];
  for (const name of names) {
    assert.match(name, /^\[Demo\]/, `${name} does not read as demo content`);
  }
});

test('line terminators from real-world copy do not break the generated module', () => {
  // A Windows-authored paste reaches Firestore with CRLF. Left raw inside
  // a single-quoted literal it is a syntax error — a build break produced
  // by an editor's newline convention.
  const base = demoSnapshot();
  const noisy = {
    ...base,
    content: [
      { ...base.content[0], id: 'crlf__block', value: 'line one\r\nline two\rline three u2028' },
    ],
  };
  const out = emitAll(noisy)['siteContent.js'];
  assert.doesNotMatch(out, /\r/, 'no raw CR may reach the emitted literal');
  const literal = /value: ('.*')/.exec(out)[1];
  assert.equal(eval(`(${literal})`), 'line one\r\nline two\rline three u2028');
});

test('jsValue escapes quotes and backslashes rather than emitting broken JS', () => {
  const literal = internals.jsValue({ value: "it's a \\ backslash" });
  assert.equal(literal.includes("\\'"), true);
  // Evaluating the emitted literal is the assertion: it must parse back
  // to the value it was built from.
  assert.deepEqual(eval(`(${literal})`), { value: "it's a \\ backslash" });
});
