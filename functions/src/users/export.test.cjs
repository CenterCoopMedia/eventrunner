'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { makeFakeDb: makeBareFakeDb } = require('../cms/firestoreFake.cjs');
const {
  createExportAttendeesHandler,
  internals: { escapeCell, EXPORT_COLUMNS },
} = require('./export.cjs');

// requireAdmin reads config/bootstrap LIVE from the db it is handed and
// fails closed on an absent document, so every fake carries it.
const ADMIN = 'admin@example.com';
const STAFF = 'staff@example.com';
const BOOTSTRAP_DOC = { adminEmails: [ADMIN], staffEmails: [STAFF] };
const makeFakeDb = (seed = {}) => makeBareFakeDb({ 'config/bootstrap': BOOTSTRAP_DOC, ...seed });

const QUIET = { warn() {}, error() {}, info() {} };
const T0 = new Date('2026-09-23T22:30:00.000Z');

const HEADER = [
  'Name', 'Email', 'Organization', 'Role', 'Registration status', 'Badges',
  'Past attendance', 'Social handles', 'Profile visibility',
];

const BADGES_CONFIG = {
  categories: [
    {
      id: 'role',
      maxPicks: 3,
      badges: [
        { id: 'writer', label: 'Writer' },
        { id: 'editor', label: 'Editor' },
      ],
    },
  ],
};

function makeRes() {
  const res = {
    statusCode: null, body: null, headers: {},
    set(n, v) { res.headers[n] = v; return res; },
    status(c) { res.statusCode = c; return res; },
    json(p) { res.body = p; return res; },
  };
  return res;
}

const auth = {
  async verifyIdToken(token) {
    const table = {
      admin: { uid: 'admin-1', email: ADMIN, email_verified: true },
      staff: { uid: 'staff-1', email: STAFF, email_verified: true },
      ada: { uid: 'uid-ada', email: 'ada@example.com', email_verified: true },
      'admin-unverified': { uid: 'admin-1', email: ADMIN, email_verified: false },
    };
    if (!table[token]) throw new Error('invalid token');
    return table[token];
  },
};

function configWith(features = {}) {
  return async () => ({ bootstrap: BOOTSTRAP_DOC, badges: BADGES_CONFIG, features });
}

const FILTER = { status: 'all', searched: false };

const req = (token, body = { uids: ['uid-ada'], filter: FILTER }, method = 'POST') => ({
  method,
  headers: token ? { authorization: `Bearer ${token}` } : {},
  body,
});

/**
 * Every field an account document can carry, private ones included, with
 * a value no exported column should ever contain.
 */
function fullAccount(overrides = {}) {
  return {
    uid: 'uid-ada',
    email: 'ada@example.com',
    displayName: 'Ada Quill',
    pronouns: 'PRIVATE-pronouns',
    bio: 'PRIVATE-bio',
    organization: 'The Weekly Ledger',
    jobTitle: 'Data editor',
    photoPath: 'profile-photos/uid-ada/PRIVATE-photo.jpg',
    socialHandles: { mastodon: '@ada@example.social', bluesky: '@ada.example.com' },
    badges: ['writer', 'not-configured'],
    customBadges: ['Night owl'],
    profileVisibility: 'attendees_only',
    profileComplete: true,
    registrationStatus: 'approved',
    approvalSource: 'PRIVATE-approval-source',
    speakerId: 'PRIVATE-speaker-id',
    role: 'PRIVATE-role',
    pastAttendance: ['2024', '2025'],
    createdAt: new Date('2020-01-02T03:04:05.000Z'),
    updatedAt: new Date('2021-01-02T03:04:05.000Z'),
    lastSeenAt: new Date('2022-01-02T03:04:05.000Z'),
    ...overrides,
  };
}

/**
 * RFC 4180 reader for the file the endpoint returns: quoted fields, doubled
 * quotes, commas and line breaks inside a quote, CRLF records. The test
 * reads the real file with it rather than trusting the builder.
 */
function parseCsv(text) {
  assert.ok(text.startsWith('\uFEFF'), 'the file starts with a byte-order mark');
  const body = text.slice(1);
  assert.ok(body.endsWith('\r\n'), 'the file ends with a CRLF');
  const rows = [];
  let row = [];
  let i = 0;
  while (i < body.length) {
    assert.equal(body[i], '"', `every cell is quoted (offset ${i})`);
    i += 1;
    let cell = '';
    for (;;) {
      if (body[i] === '"' && body[i + 1] === '"') { cell += '"'; i += 2; continue; }
      if (body[i] === '"') { i += 1; break; }
      cell += body[i];
      i += 1;
    }
    row.push(cell);
    if (body[i] === ',') { i += 1; continue; }
    assert.equal(body.slice(i, i + 2), '\r\n', 'records end with CRLF');
    i += 2;
    rows.push(row);
    row = [];
  }
  return rows;
}

function adminLogs(db) {
  return db.ids('admin_logs').map((id) => db.read('admin_logs', id));
}

async function run(db, request, { getConfig = configWith(), now = () => T0 } = {}) {
  const res = makeRes();
  await createExportAttendeesHandler({ db, auth, getConfig, now, log: QUIET })(request, res);
  return res;
}

// ---------------------------------------------------------------------------
// The file: exactly the approved field set.
// ---------------------------------------------------------------------------

test('the columns are the nine approved fields, in order', () => {
  assert.deepEqual(EXPORT_COLUMNS.map((column) => column.header), HEADER);
});

test('the real file carries exactly the approved fields: the header and every row, nothing else', async () => {
  const db = makeFakeDb({
    'users/uid-ada': fullAccount(),
    'users/uid-bo': fullAccount({
      uid: 'uid-bo',
      email: 'bo@example.com',
      displayName: 'Bo Reyes',
      organization: '',
      jobTitle: '',
      badges: [],
      customBadges: [],
      socialHandles: {},
      pastAttendance: [],
      registrationStatus: 'pending',
      profileVisibility: 'private',
    }),
  });

  const res = await run(db, req('admin', { uids: ['uid-ada', 'uid-bo'], filter: FILTER }));

  assert.equal(res.statusCode, 200);
  const rows = parseCsv(res.body.csv);
  assert.deepEqual(rows, [
    HEADER,
    [
      'Ada Quill',
      'ada@example.com',
      'The Weekly Ledger',
      'Data editor',
      'approved',
      // The unconfigured id is dropped; custom badges are off by default.
      'Writer',
      '2024; 2025',
      // Sorted by label.
      'bluesky: @ada.example.com; mastodon: @ada@example.social',
      'attendees_only',
    ],
    ['Bo Reyes', 'bo@example.com', '', '', 'pending', '', '', '', 'private'],
  ]);

  // Not one private value reaches the file, in any cell.
  for (const secret of [
    'PRIVATE', 'uid-ada', 'uid-bo', 'profile-photos', '2020', '2021', '2022', 'not-configured',
  ]) {
    assert.ok(!res.body.csv.includes(secret), `the file leaks ${secret}`);
  }
});

test('custom badges are exported only while the custom badges feature is on', async () => {
  const seed = { 'users/uid-ada': fullAccount() };

  const off = await run(makeFakeDb(seed), req('admin'));
  assert.equal(parseCsv(off.body.csv)[1][5], 'Writer');

  const on = await run(makeFakeDb(seed), req('admin'), { getConfig: configWith({ customBadges: true }) });
  assert.equal(parseCsv(on.body.csv)[1][5], 'Writer; Night owl');
});

test('social handles are sorted by label and non-string handles are dropped', async () => {
  const db = makeFakeDb({
    'users/uid-ada': fullAccount({
      socialHandles: { web: 'example.com/ada', bluesky: '@ada', mastodon: { url: 'x' }, linkedin: 7 },
    }),
  });
  const res = await run(db, req('admin'));
  assert.equal(parseCsv(res.body.csv)[1][7], 'bluesky: @ada; web: example.com/ada');
});

// ---------------------------------------------------------------------------
// Formula escaping.
// ---------------------------------------------------------------------------

test('each leading formula character gains an apostrophe', () => {
  for (const [value, expected] of [
    ['=HYPERLINK("http://example.com")', `"'=HYPERLINK(""http://example.com"")"`],
    ['+1 555 0100', `"'+1 555 0100"`],
    ['-2+3', `"'-2+3"`],
    ['@SUM(A1:A2)', `"'@SUM(A1:A2)"`],
    ['\t=1+1', `"'\t=1+1"`],
    ['\rcmd', `"'\rcmd"`],
    ['\ttext', `"'\ttext"`],
  ]) {
    assert.equal(escapeCell(value), expected, JSON.stringify(value));
  }
});

test('a formula character after leading whitespace is escaped too', () => {
  for (const [value, expected] of [
    [' =1+1', `"' =1+1"`],
    ['   +1', `"'   +1"`],
    ['\n-1', `"'\n-1"`],
    ['\u00a0@x', `"'\u00a0@x"`],
  ]) {
    assert.equal(escapeCell(value), expected, JSON.stringify(value));
  }
});

test('an inner formula character is not escaped', () => {
  assert.equal(escapeCell('a=b'), '"a=b"');
  assert.equal(escapeCell('Rae-Okonkwo'), '"Rae-Okonkwo"');
  assert.equal(escapeCell('rae@example.com'), '"rae@example.com"');
  assert.equal(escapeCell(''), '""');
});

test('quotes are doubled, and commas and line breaks stay inside the cell', () => {
  assert.equal(escapeCell('The "Weekly", Ledger'), '"The ""Weekly"", Ledger"');
  assert.equal(escapeCell('line one\r\nline two'), '"line one\r\nline two"');
});

test('every exported field is escaped in the real file, and a list cell is escaped once', async () => {
  const db = makeFakeDb({
    'users/uid-ada': fullAccount({
      displayName: '=cmd|"/C calc"!A0',
      email: '@evil@example.com',
      organization: '+Org, "quoted"',
      jobTitle: '-Editor',
      registrationStatus: '\tapproved',
      pastAttendance: ['=2024', '=2025'],
      socialHandles: { '=label': '=handle' },
      profileVisibility: '\rpublic',
    }),
  });

  const res = await run(db, req('admin'));
  assert.equal(res.statusCode, 200);
  const [, row] = parseCsv(res.body.csv);
  assert.deepEqual(row, [
    `'=cmd|"/C calc"!A0`,
    `'@evil@example.com`,
    `'+Org, "quoted"`,
    `'-Editor`,
    `'\tapproved`,
    'Writer',
    // Checked once, on the joined cell: the second entry is inside it.
    `'=2024; =2025`,
    `'=label: =handle`,
    `'\rpublic`,
  ]);
});

// ---------------------------------------------------------------------------
// The gate and the request.
// ---------------------------------------------------------------------------

test('refuses a wrong method, a stranger, an attendee, and an unverified admin', async () => {
  const db = makeFakeDb({ 'users/uid-ada': fullAccount() });

  assert.equal((await run(db, req('admin', undefined, 'GET'))).statusCode, 405);
  assert.equal((await run(db, req(null))).statusCode, 401);
  assert.equal((await run(db, req('ada'))).statusCode, 403);
  assert.equal((await run(db, req('admin-unverified'))).statusCode, 403);
  assert.deepEqual(adminLogs(db), []);
});

test('a staff admin may export: attendees are staff work', async () => {
  const db = makeFakeDb({ 'users/uid-ada': fullAccount() });
  const res = await run(db, req('staff'));
  assert.equal(res.statusCode, 200);
  assert.equal(adminLogs(db)[0].email, STAFF);
});

test('refuses an empty, oversized, or malformed uid list, a bad filter, and any other key', async () => {
  const db = makeFakeDb({ 'users/uid-ada': fullAccount() });
  const tooMany = Array.from({ length: 10001 }, (_, i) => `uid-${i}`);

  for (const [body, fragment] of [
    [{ uids: [], filter: FILTER }, 'uids: must list at least one attendee.'],
    [{ filter: FILTER }, 'uids: must list at least one attendee.'],
    [{ uids: tooMany, filter: FILTER }, 'uids: at most 10,000 attendees per export. Narrow the filter.'],
    [{ uids: ['uid-ada', 7], filter: FILTER }, 'uids[1]: must be an account id.'],
    [{ uids: ['users/uid-ada'], filter: FILTER }, 'uids[0]: must be an account id.'],
    [{ uids: ['uid-ada'] }, 'filter: must be an object'],
    [{ uids: ['uid-ada'], filter: { status: 'everyone', searched: false } }, 'filter.status: must be one of all, pending, ticketed, approved, revoked.'],
    [{ uids: ['uid-ada'], filter: { status: 'all', searched: 'yes' } }, 'filter.searched: must be true or false.'],
    [{ uids: ['uid-ada'], filter: { status: 'all', searched: true, query: 'ada' } }, 'filter.query: is not accepted.'],
    [{ uids: ['uid-ada'], filter: FILTER, query: 'Ada Quill' }, 'query: is not accepted.'],
    [['uid-ada'], 'body: must be a JSON object'],
  ]) {
    const res = await run(db, req('admin', body));
    assert.equal(res.statusCode, 400, JSON.stringify(body).slice(0, 80));
    assert.ok(res.body.error.message.includes(fragment), `${res.body.error.message} names ${fragment}`);
    assert.equal(res.body.csv, undefined);
  }
  assert.deepEqual(adminLogs(db), []);
});

test('exactly 10,000 uids is accepted', async () => {
  const db = makeFakeDb({ 'users/uid-ada': fullAccount() });
  const uids = ['uid-ada', ...Array.from({ length: 9999 }, (_, i) => `uid-missing-${i}`)];
  const res = await run(db, req('admin', { uids, filter: FILTER }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.rowCount, 1);
  assert.equal(res.body.skipped, 9999);
});

// ---------------------------------------------------------------------------
// The response and the audit row.
// ---------------------------------------------------------------------------

test('a 200 keeps request order, drops duplicates, skips absent accounts, and is never cached', async () => {
  const db = makeFakeDb({
    'users/uid-ada': fullAccount(),
    'users/uid-bo': fullAccount({ uid: 'uid-bo', displayName: 'Bo Reyes', email: 'bo@example.com' }),
  });

  const res = await run(db, req('admin', {
    uids: ['uid-bo', 'uid-gone', 'uid-ada', 'uid-bo'],
    filter: FILTER,
  }));

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(res.body.filename, 'attendees-2026-09-23.csv');
  assert.equal(res.body.rowCount, 2);
  assert.equal(res.body.skipped, 1);
  const rows = parseCsv(res.body.csv);
  assert.deepEqual(rows.slice(1).map((row) => row[0]), ['Bo Reyes', 'Ada Quill']);
});

test('the filename carries the UTC date of the export', async () => {
  const db = makeFakeDb({ 'users/uid-ada': fullAccount() });
  // 23:30 in UTC-05:00 is already the next day in UTC.
  const res = await run(db, req('admin'), { now: () => new Date('2026-09-24T04:30:00.000Z') });
  assert.equal(res.body.filename, 'attendees-2026-09-24.csv');
});

test('writes exactly one audit row with the actor, the row count, and the filter, and never the search text', async () => {
  const db = makeFakeDb({ 'users/uid-ada': fullAccount() });

  const res = await run(db, req('admin', { uids: ['uid-ada'], filter: { status: 'approved', searched: true } }));

  assert.equal(res.statusCode, 200);
  const logs = adminLogs(db);
  assert.equal(logs.length, 1);
  assert.deepEqual(logs[0], {
    action: 'exportAttendees',
    docPath: 'users',
    uid: 'admin-1',
    email: ADMIN,
    at: T0,
    details: { rowCount: 1, filter: { status: 'approved', searched: true } },
  });
  assert.ok(!JSON.stringify(logs[0]).includes('Ada'), 'no attendee name in the audit row');
});

test('a failed audit write refuses the file: 500 and no csv', async () => {
  const db = makeFakeDb({ 'users/uid-ada': fullAccount() });
  const collection = db.collection.bind(db);
  db.collection = (name) => {
    if (name !== 'admin_logs') return collection(name);
    return {
      doc: () => ({
        async set() { throw new Error('admin_logs unavailable'); },
      }),
    };
  };

  const res = await run(db, req('admin'));

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.csv, undefined);
  assert.equal(res.body.filename, undefined);
  assert.match(res.body.error.message, /could not be recorded/);
});

test('logs counts only, never a cell value', async () => {
  const db = makeFakeDb({ 'users/uid-ada': fullAccount() });
  const lines = [];
  const log = { info: (...args) => lines.push(args.join(' ')), error: (...args) => lines.push(args.join(' ')) };
  const res = makeRes();
  await createExportAttendeesHandler({ db, auth, getConfig: configWith(), now: () => T0, log })(req('admin'), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(lines, ['exportAttendees: 1 rows, 0 skipped']);
});
