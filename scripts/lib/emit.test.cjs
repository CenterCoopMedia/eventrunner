'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { emitAll, emitScheduleData, internals } = require('./emit.cjs');
const { demoSnapshot, demoEvent } = require('./demo-event.cjs');
const { validatePageDoc } = require('../../functions/src/cms/pages.cjs');
const { validateOrganizationFields } = require('../../functions/src/cms/organizations.cjs');
const {
  speakerDisplayName,
  buildPublicSpeaker,
  validateSpeaker,
  PUBLIC_SPEAKER_FIELDS,
} = require('shared/speaker');

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
  // Published by the seed's own actor: the flag stays. A doc another actor
  // published loses it, which the test below holds.
  const base = demoSnapshot();
  const noisy = {
    ...base,
    content: base.content.map((doc) => ({
      ...doc,
      revision: 7,
      status: 'clean',
      publishedAt: new Date(0),
      publishedBy: 'init-event-script',
      basedOnRevision: 6,
    })),
  };
  const out = emitAll(noisy)['siteContent.js'];
  assert.doesNotMatch(out, /revision|publishedAt|publishedBy|basedOnRevision|seededAt/);
  assert.match(out, /seeded: true/);
});

test('a flagged block another actor published loses its seeded flag in the snapshot', () => {
  // The public site reads `seeded` to show sample-content chips and to keep
  // the home page's When fact live; a deployment from before the CMS cleared
  // the flag on edit holds edited blocks that still carry it, and who
  // published decides (adversarial review, 2026-09-24).
  const base = demoSnapshot();
  const [first, second] = base.content;
  const out = emitAll({
    ...base,
    content: [
      { ...first, seeded: true, publishedBy: 'init-event-script' },
      { ...second, seeded: true, publishedBy: 'admin-uid' },
    ],
  })['siteContent.js'];
  const block = (id) => out.slice(out.indexOf(`${id}: {`), out.indexOf('\n  },', out.indexOf(`${id}: {`)));
  assert.match(block(first.id), /seeded: true/);
  assert.doesNotMatch(block(second.id), /seeded/);
  assert.doesNotMatch(out, /publishedBy/);
});

test('a session carries its recording link into the generated snapshot', () => {
  // The emitter is a DENYLIST (STRIPPED_FIELDS), so a new session field
  // reaches the bundle by default rather than by being listed. That is the
  // right default and it is also invisible: nothing here would fail if
  // `recordingUrl` were added to the strip list by accident, and the only
  // symptom would be a link that renders in the admin preview and vanishes
  // on the built site. So the seam is pinned.
  const base = demoSnapshot();
  const [first, ...rest] = base.sessions;
  const out = emitScheduleData({
    sessions: [{ ...first, recordingUrl: 'https://video.example.org/watch?v=demo' }, ...rest],
    speakers: base.speakers,
  });
  assert.match(out, /recordingUrl: 'https:\/\/video\.example\.org\/watch\?v=demo'/);
});

test('config/bootstrap is never emitted into the bundle', () => {
  const files = emitAll(demoSnapshot());
  const all = Object.values(files).join('\n');
  assert.doesNotMatch(all, /adminEmails/);
  assert.doesNotMatch(all, /staffEmails/);
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

test('every demo page is a valid page doc, and the demo names stay fictional', () => {
  const demo = demoEvent();
  for (const page of demo.pages) {
    const { seeded, ...contract } = page;
    assert.equal(validatePageDoc(contract).ok, true, `${page.id} is not a valid page doc`);
  }
  const names = [
    // Canonical speakers hold firstName/lastName, never a joined `name`
    // string (spec §4.3) — the display name is derived, here as everywhere.
    ...demo.speakers.map((s) => speakerDisplayName(s)),
    ...demo.organizations.map((o) => o.name),
    demo.config.event.name,
    demo.config.event.legal.operatorName,
  ];
  assert.deepEqual(names, [
    'Marisol Reyes',
    'Devon Achebe',
    'Priya Natarajan',
    'Lucia Bennett',
    'Omar Farouk',
    'June Park',
    'Elena Santos',
    'Theo Brooks',
    'Amara Okafor',
    'Samir Das',
    'Nora Chen',
    'Mateo Rivera',
    'Beacon Community Fund',
    'Lighthouse Press Trust',
    'Tidewater Media Collective',
    'Openfield Tools',
    'Civic Thread Studio',
    'Common Ground Coffee',
    'Harborlight Media Summit',
    'Harborlight Cooperative',
  ]);
});

test('every demo organization passes the field checks an admin save applies (issue 192)', () => {
  // The demo is seeded, never saved through the editor, so nothing else
  // would notice a fixture sponsor the organization seam would refuse. Every
  // field is checked, the three profile fields included.
  for (const organization of demoEvent().organizations) {
    const { id, ...fields } = organization;
    const verdict = validateOrganizationFields(fields, fields);
    assert.equal(verdict.ok, true, `${id}: ${JSON.stringify(verdict.errors)}`);
    assert.deepEqual(verdict.fields, fields, `${id} is stored exactly as the seam would store it`);
  }
});

test('demo speakers are canonical documents, and the bundle ships only their projection', () => {
  // The seeder writes demo.speakers into `speakers/{id}`, so they must be
  // valid canonical records (spec §4.3) — and demoSnapshot must run them
  // through the same projection the onSpeakerWritten trigger runs, or the
  // committed bundle would carry fields `speakers_public` never holds.
  const demo = demoEvent();
  for (const speaker of demo.speakers) {
    const { id, seeded, uid, inviteToken, approvedAt, ...editable } = speaker;
    assert.equal(validateSpeaker(editable).ok, true, `${id} is not a valid speaker payload`);
    assert.equal(uid, null, 'a seeded speaker holds no account link');
    assert.equal(inviteToken, null);
  }

  const emitted = demoSnapshot().speakers;
  for (const speaker of emitted) {
    assert.deepEqual(
      Object.keys(speaker).sort(),
      ['id', ...PUBLIC_SPEAKER_FIELDS].sort(),
      'the bundle must carry exactly the public projection',
    );
  }
  const source = emitted.map(({ id, ...rest }) => rest);
  assert.deepEqual(source, demo.speakers.map((s) => buildPublicSpeaker(s)));
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


test('the furnished demo schedule keeps its count and references consistent', () => {
  const demo = demoEvent();
  const sessions = new Map(demo.sessions.map((session) => [session.id, session]));
  const speakers = new Set(demo.speakers.map((speaker) => speaker.id));
  const places = new Set(demo.config.event.venue.places.map((place) => place.id));
  const count = demo.sessions.filter((session) => session.type !== 'break' && !session.parentId).length;
  assert.equal(Number(demo.content.find((doc) => doc.id === 'stats__sessions').value), count);
  for (const session of demo.sessions) {
    const day = demo.config.event.days.find((entry) => entry.id === session.dayId);
    assert.ok(day, session.id);
    assert.ok(session.startTime >= day.startTime && session.endTime <= day.endTime, session.id);
    assert.ok(session.startTime < session.endTime, session.id);
    for (const speakerId of session.speakerIds) assert.ok(speakers.has(speakerId), session.id);
    if (session.placeId) assert.ok(places.has(session.placeId), session.id);
    if (session.parentId) {
      const parent = sessions.get(session.parentId);
      assert.ok(parent, session.id);
      assert.equal(session.dayId, parent.dayId);
      assert.ok(session.startTime >= parent.startTime && session.endTime <= parent.endTime);
    }
  }
  for (const speaker of demo.speakers) {
    assert.ok(demo.sessions.some((session) => session.speakerIds.includes(speaker.id)), speaker.id);
  }
  assert.match(demo.config.event.venue.map.alt, /not the museum floor plan/);
});
