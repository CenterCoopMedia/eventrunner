'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { makeFakeDb } = require('../cms/firestoreFake.cjs');
const {
  createDownloadEventPackageHandler,
  buildEventPackage,
  zipPackage,
  internals: { SECTION_IDS, SECTIONS, FORMAT, SCHEMA_VERSION, readPackageRequest, EXCLUDED },
} = require('./eventPackage.cjs');
const { readEventPackage, verifyEventPackage } = require('./eventPackageReader.cjs');
const { isSecretKey, scrub } = require('./exportRecords.cjs');
const { ADMIN, STAFF, BOOTSTRAP_DOC, FORBIDDEN, exportSeed } = require('./exportFixture.cjs');

const QUIET = { warn() {}, error() {}, info() {} };
const T0 = new Date('2026-10-01T12:00:00.000Z');
const FOLDER = 'event-data-package-2026-10-01';

const auth = {
  async verifyIdToken(token) {
    const table = {
      admin: { uid: 'admin-1', email: ADMIN, email_verified: true },
      staff: { uid: 'staff-1', email: STAFF, email_verified: true },
    };
    if (!table[token]) throw new Error('invalid token');
    return table[token];
  },
};

function makeRes() {
  const res = {
    statusCode: null, body: null, headers: {},
    set(n, v) { res.headers[n] = v; return res; },
    status(c) { res.statusCode = c; return res; },
    json(p) { res.body = p; return res; },
    send(p) { res.body = p; return res; },
  };
  return res;
}

const ALL = { sections: [...SECTION_IDS], includeStaffNotes: false };

function config() {
  const seed = exportSeed();
  return { bootstrap: BOOTSTRAP_DOC, event: seed['config/event'], badges: seed['config/badges'], features: {} };
}

function setup(overrides = {}) {
  const db = makeFakeDb(exportSeed());
  const handler = createDownloadEventPackageHandler({ db, auth, getConfig: async () => config(), now: () => T0, log: QUIET, ...overrides });
  return { db, handler };
}

async function run(handler, token, body) {
  const res = makeRes();
  await handler({ method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body }, res);
  return res;
}

async function packageFor(body = ALL) {
  const { handler } = setup();
  const res = await run(handler, 'admin', body);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res;
}

const json = (files, path) => JSON.parse(files.get(path).toString('utf8'));

test('readPackageRequest: sections must be chosen, known, and the staff-note choice explicit', () => {
  assert.deepEqual(readPackageRequest({ sections: [], includeStaffNotes: false }).errors, ['sections: choose at least one part of the package.']);
  assert.match(readPackageRequest({ sections: ['secrets'], includeStaffNotes: false }).errors[0], /^sections\[0\]: must be one of/);
  assert.deepEqual(readPackageRequest({ sections: ['program'] }).errors, ['includeStaffNotes: must be true or false.']);
  assert.match(readPackageRequest({ ...ALL, bucket: 'x' }).errors[0], /^bucket: is not accepted/);
  // Repeats drop, and the order follows the package, not the request.
  assert.deepEqual(readPackageRequest({ sections: ['pitches', 'program', 'pitches'], includeStaffNotes: true }), {
    ok: true, sections: ['program', 'pitches'], includeStaffNotes: true,
  });
});

test('the package is operator tier: staff and visitors are refused, and nothing is recorded', async () => {
  const { db, handler } = setup();
  assert.equal((await run(handler, 'staff', ALL)).statusCode, 403);
  assert.equal((await run(handler, null, ALL)).statusCode, 401);
  const get = makeRes();
  await handler({ method: 'GET', headers: { authorization: 'Bearer admin' } }, get);
  assert.equal(get.statusCode, 405);
  assert.equal((await db.collection('admin_logs').where('action', '==', 'downloadEventPackage').get()).size, 0);
});

test('an operator gets a private zip with a versioned manifest and a README for every file', async () => {
  const res = await packageFor();
  assert.equal(res.headers['Content-Type'], 'application/zip');
  assert.equal(res.headers['Content-Disposition'], `attachment; filename="${FOLDER}.zip"`);
  assert.equal(res.headers['Cache-Control'], 'private, max-age=0, no-store');
  const { folder, files } = readEventPackage(res.body);
  assert.equal(folder, FOLDER);

  const manifest = json(files, 'manifest.json');
  assert.equal(manifest.format, FORMAT);
  assert.equal(manifest.schemaVersion, SCHEMA_VERSION);
  assert.equal(manifest.exportedAt, T0.toISOString());
  assert.deepEqual(manifest.sections, SECTION_IDS);
  assert.deepEqual(manifest.excluded, EXCLUDED);
  const expected = SECTIONS.flatMap((section) => section.files.map((file) => file.path));
  assert.deepEqual(manifest.files.map((file) => file.path), expected);
  assert.deepEqual([...files.keys()].sort(), ['README.md', 'manifest.json', ...expected].sort());

  const readme = files.get('README.md').toString('utf8');
  for (const path of expected) assert.ok(readme.includes(`\`${path}\``), `the README describes ${path}`);
  assert.match(readme, /## Personal data and retention/);
  assert.match(readme, /config\/bootstrap/);
  assert.match(readme, /Staff notes on pitches: not included/);
});

test('the reader verifies the package: checksums, counts, and every relationship resolves', async () => {
  const res = await packageFor();
  const report = verifyEventPackage(res.body);
  assert.deepEqual(report.problems, []);
  assert.equal(report.ok, true);
  assert.equal(report.counts['program/sessions.json'], 2);
  assert.equal(report.counts['attendees/attendees.json'], 2);
  assert.equal(report.counts['orders/admissions.json'], 2);
  assert.ok(report.relationships.length >= 10);
  for (const rel of report.relationships) {
    assert.equal(rel.unresolved, 0, `${rel.from} ${rel.field} → ${rel.to}: ${rel.sample}`);
  }
  const checked = Object.fromEntries(report.relationships.map((rel) => [`${rel.from}#${rel.field}`, rel.checked]));
  assert.equal(checked['program/sessions.json#speakerIds[]'], 3);
  assert.equal(checked['orders/admissions.json#orderId'], 2);
  assert.equal(checked['pitches/pitches.json#convertedSessionId'], 1);
  assert.equal(checked['materials/materials.json#sessionId'], 2);
});

test('the reader reports damage: a changed file and a dangling reference', async () => {
  const seed = exportSeed();
  seed['cmsSchedule/session-keynote'].speakerIds = ['speaker-ada', 'speaker-gone'];
  const db = makeFakeDb(seed);
  const built = await buildEventPackage({ db, config: config(), sections: ['program', 'speakers'], includeStaffNotes: false, at: T0 });
  const zip = await zipPackage({ name: built.name, files: built.files, at: T0 });
  const report = verifyEventPackage(zip);
  assert.equal(report.ok, true, 'a dangling reference is reported, not damage');
  const speakers = report.relationships.find((rel) => rel.field === 'speakerIds[]');
  assert.deepEqual({ unresolved: speakers.unresolved, sample: speakers.sample }, { unresolved: 1, sample: ['speaker-gone'] });

  const tampered = built.files.map((file) => (file.path === 'speakers/speakers.json'
    ? { ...file, buffer: Buffer.from('[]') } : file));
  const bad = verifyEventPackage(await zipPackage({ name: built.name, files: tampered, at: T0 }));
  assert.equal(bad.ok, false);
  assert.ok(bad.problems.includes('speakers/speakers.json: the checksum does not match the manifest.'));
  assert.equal(verifyEventPackage(Buffer.from('not a zip')).ok, false);
});

test('no file holds a secret, a credential, a private note, a staff address or an excluded collection', async () => {
  const res = await packageFor();
  const { files } = readEventPackage(res.body);
  for (const [path, data] of files) {
    const text = data.toString('utf8');
    for (const word of FORBIDDEN) assert.ok(!text.includes(word), `${path} must not contain ${word}`);
    assert.ok(!text.includes(STAFF), `${path} names no staff address`);
  }
  const config = json(files, 'content/config.json');
  assert.deepEqual(Object.keys(config).sort(), ['badges', 'event', 'features', 'pitch_call', 'theme']);
  assert.equal(config.pitch_call, null);
  // A theme's design tokens are not credentials.
  assert.deepEqual(config.theme.tokens, { light: {} });
  const catalog = json(files, 'orders/catalog.json');
  assert.equal(catalog[0].revision, 3);
  assert.equal(Object.hasOwn(catalog[0], 'stripePriceSecret'), false);
});

test('records: published sessions only in JSON, the draft in the CSV with its state', async () => {
  const { files } = readEventPackage((await packageFor()).body);
  const sessions = json(files, 'program/sessions.json');
  assert.deepEqual(sessions.map((s) => s.id), ['session-keynote', 'session-panel']);
  assert.equal(sessions[1].title, 'Data panel');
  assert.equal(Object.hasOwn(sessions[0], 'publishedBy'), false);
  const csv = files.get('program/sessions.csv').toString('utf8');
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv, /"session-draft","Unpublished workshop","Draft"/);
  assert.match(csv, /"'=HYPERLINK\(""http:\/\/example.test"",""Keynote""\)"/);
});

test('records: attendees, orders, admissions and pitches keep their joins and their review state', async () => {
  const { files } = readEventPackage((await packageFor()).body);
  const [ada] = json(files, 'attendees/attendees.json');
  assert.deepEqual(ada, {
    id: 'uid-ada', displayName: 'Ada Quill', email: 'ada@example.com', organization: '-1+2', jobTitle: 'Editor',
    registrationStatus: 'ticketed', badges: ['writer'], customBadges: [], pastAttendance: [], socialHandles: {},
    profileVisibility: 'public', speakerId: 'speaker-ada', createdAt: '2026-03-27T14:00:00.000Z',
  });
  assert.match(files.get('attendees/attendees.csv').toString('utf8'), /"'-1\+2"/);
  const [order] = json(files, 'orders/orders.json');
  assert.equal(order.totalAmount, 5000);
  assert.deepEqual(order.ticketIds, ['ticket-1', 'ticket-2']);
  assert.equal(Object.hasOwn(order, 'checkoutUrl'), false);
  const tickets = json(files, 'orders/admissions.json');
  assert.ok(tickets.every((ticket) => !Object.hasOwn(ticket, 'raw')));
  const [pitch] = json(files, 'pitches/pitches.json');
  assert.equal(pitch.status, 'accepted');
  assert.equal(pitch.reviewRevision, 2);
  assert.equal(pitch.convertedSessionId, 'session-panel');
  assert.equal(Object.hasOwn(pitch, 'staffNotes'), false);
  const [file, link] = json(files, 'materials/materials.json');
  assert.equal(file.storagePath, 'session-materials/session-keynote/slides.pdf');
  assert.equal(link.url, 'https://example.org/data');
});

test('staff notes go only when the operator includes them, and the README says so', async () => {
  const { handler } = setup();
  const res = await run(handler, 'admin', { sections: ['pitches'], includeStaffNotes: true });
  const { files } = readEventPackage(res.body);
  assert.deepEqual([...files.keys()].sort(), ['README.md', 'manifest.json', 'pitches/pitches.json']);
  assert.equal(json(files, 'pitches/pitches.json')[0].staffNotes, 'PRIVATE-staff-note');
  assert.match(files.get('README.md').toString('utf8'), /Staff notes on pitches: included/);
});

test('every package writes an admin_logs row before it is sent; no row, no package', async () => {
  const { db, handler } = setup();
  const res = await run(handler, 'admin', { sections: ['program'], includeStaffNotes: false });
  const logs = await db.collection('admin_logs').where('action', '==', 'downloadEventPackage').get();
  assert.equal(logs.size, 1);
  assert.deepEqual(logs.docs[0].data(), {
    action: 'downloadEventPackage', docPath: 'event-package', uid: 'admin-1', email: ADMIN, at: T0,
    details: {
      sections: ['program'], includeStaffNotes: false,
      files: [{ path: 'program/sessions.json', records: 2 }, { path: 'program/sessions.csv', records: 3 }],
      bytes: res.body.length,
    },
  });

  const failing = setup();
  const original = failing.db.collection.bind(failing.db);
  failing.db.collection = (name) => (name === 'admin_logs'
    ? { ...original(name), doc: () => ({ async set() { throw new Error('write failed'); } }) }
    : original(name));
  const refused = await run(failing.handler, 'admin', ALL);
  assert.equal(refused.statusCode, 500);
  assert.match(refused.body.error.message, /could not be recorded, so it was not sent/);
});

test('a package past its document or byte cap answers 413 and names the script', async () => {
  for (const overrides of [{ maxDocs: 5 }, { maxBytes: 100 }]) {
    const { db, handler } = setup(overrides);
    const res = await run(handler, 'admin', ALL);
    assert.equal(res.statusCode, 413);
    assert.match(res.body.error.message, /scripts\/export-event-package\.cjs/);
    assert.equal((await db.collection('admin_logs').where('action', '==', 'downloadEventPackage').get()).size, 0);
  }
});

test('scrub removes credential keys at any depth and keeps design tokens', () => {
  for (const key of ['inviteToken', 'tokenHash', 'apiKey', 'webhookSecret', 'password', 'raw', 'privateKey', 'signature']) {
    assert.equal(isSecretKey(key), true, key);
  }
  for (const key of ['tokens', 'title', 'rawText', 'keynote']) assert.equal(isSecretKey(key), false, key);
  assert.deepEqual(scrub({ a: { b: [{ accessToken: 'x', keep: 1 }] }, at: new Date(0) }), {
    a: { b: [{ keep: 1 }] }, at: '1970-01-01T00:00:00.000Z',
  });
});
