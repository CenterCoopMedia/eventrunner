'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  prepareAnnouncement,
  createSaveAnnouncementHandler,
  createDeleteAnnouncementHandler,
} = require('./announcements.cjs');

function fakeDb(seed = {}) {
  const docs = new Map(Object.entries(seed));
  let autoId = 0;
  return {
    docs,
    collection(name) {
      return {
        doc(id) {
          const key = `${name}/${id ?? `auto${(autoId += 1)}`}`;
          return {
            async get() {
              if (key === 'config/bootstrap') {
                return { exists: true, data: () => ({ adminEmails: ['admin@example.org'] }) };
              }
              const data = docs.get(key);
              return { exists: data !== undefined, data: () => data };
            },
            async set(data) { docs.set(key, data); },
            async delete() { docs.delete(key); },
          };
        },
      };
    },
  };
}

const auth = {
  async verifyIdToken(token) {
    if (token === 'admin-token') {
      return { uid: 'admin1', email: 'admin@example.org', email_verified: true };
    }
    throw new Error('bad token');
  },
};
const req = (body) => ({ method: 'POST', headers: { authorization: 'Bearer admin-token' }, body });
const res = () => ({
  statusCode: null,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
  set() { return this; },
});
const input = (overrides = {}) => ({
  message: 'The entrance has moved.',
  level: 'info',
  startsAt: '2026-10-02T13:00:00.000Z',
  endsAt: '2026-10-02T15:00:00.000Z',
  link: null,
  ...overrides,
});
const deps = (db = fakeDb()) => ({
  db,
  auth,
  getConfig: async () => ({}),
  now: () => Date.parse('2026-10-02T12:00:00.000Z'),
  log: { warn() {}, error() {} },
});

test('prepareAnnouncement sanitizes text, canonicalizes links, and accepts an active window', () => {
  const verdict = prepareAnnouncement(input({
    message: '<b>The entrance has moved.</b>',
    level: 'urgent',
    link: { url: ' HTTPS://example.org/details ', label: '<i>Read details</i>' },
  }));
  assert.equal(verdict.ok, true);
  assert.equal(verdict.value.message, 'The entrance has moved.');
  assert.deepEqual(verdict.value.link, {
    url: 'https://example.org/details',
    label: 'Read details',
  });
  assert.ok(verdict.value.startsAt instanceof Date);
});

test('prepareAnnouncement rejects unsafe links, unknown levels, and reversed windows', () => {
  const verdict = prepareAnnouncement(input({
    level: 'warning',
    startsAt: '2026-10-02T15:00:00.000Z',
    endsAt: '2026-10-02T13:00:00.000Z',
    link: { url: 'javascript:alert(1)', label: 'Open' },
  }));
  assert.equal(verdict.ok, false);
  assert.ok(verdict.errors.some((error) => error.startsWith('level:')));
  assert.ok(verdict.errors.some((error) => error.startsWith('endsAt:')));
  assert.ok(verdict.errors.some((error) => error.startsWith('link.url:')));
});

test('saveAnnouncement writes only sanitized public content and records the actor in admin_logs', async () => {
  const db = fakeDb();
  const response = res();
  await createSaveAnnouncementHandler(deps(db))(req({
    id: 'entry-change',
    announcement: input({ message: '<script>Move to the east entrance.</script>' }),
  }), response);
  assert.equal(response.statusCode, 200);
  const stored = db.docs.get('announcements/entry-change');
  assert.equal(stored.message, 'Move to the east entrance.');
  assert.equal('updatedBy' in stored, false);
  const logKey = [...db.docs.keys()].find((key) => key.startsWith('admin_logs/'));
  assert.equal(db.docs.get(logKey).email, 'admin@example.org');
});

test('deleteAnnouncement removes an existing row and logs the action', async () => {
  const db = fakeDb({ 'announcements/a1': input() });
  const response = res();
  await createDeleteAnnouncementHandler(deps(db))(req({ id: 'a1' }), response);
  assert.equal(response.statusCode, 200);
  assert.equal(db.docs.has('announcements/a1'), false);
  assert.ok([...db.docs.keys()].some((key) => key.startsWith('admin_logs/')));
});

test('announcement handlers require an existing row for delete and a valid record for save', async () => {
  const d = deps();
  const missing = res();
  await createDeleteAnnouncementHandler(d)(req({ id: 'missing' }), missing);
  assert.equal(missing.statusCode, 404);

  const invalid = res();
  await createSaveAnnouncementHandler(d)(req({ announcement: input({ message: '<>' }) }), invalid);
  assert.equal(invalid.statusCode, 400);
});
