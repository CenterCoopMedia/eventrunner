// The event statistics endpoint (issue #178) against the seeded emulator.
//
// This is the one place the real Admin SDK `count()` runs: the unit tests
// drive functions/src/admin/eventStats.cjs over the in-memory fake. So the
// expected figures here come from plain document reads through adminDb(),
// counted in this file, never from an aggregate — an answer that agrees with
// them was counted by Firestore itself.
//
// The spec adds one ticket record per status (the seed writes none) under its
// own ids and deletes them when it is done, so no later spec meets them.
import { test, expect } from '@playwright/test';
import { adminDb, adminIdToken, callFunction, ensureUser, idTokenFor } from './helpers.mjs';

const STRANGER_EMAIL = 'e2e-stats-stranger@example.test';
const TICKET_STATUSES = ['valid', 'refunded', 'cancelled', 'pending_info'];
const REGISTRATION_STATUSES = ['pending', 'ticketed', 'approved', 'revoked'];
const SPEAKER_STATUSES = ['draft', 'invited', 'accepted', 'approved', 'removed'];
const PUBLISHABLE_COLLECTIONS = ['cmsContent', 'cmsSchedule', 'cmsOrganizations', 'cmsTimeline', 'cmsUpdates', 'cmsPages'];

/** Every document in a collection, read whole, and the ones `predicate` keeps. */
async function countDocs(collection, predicate = () => true) {
  const snap = await adminDb().collection(collection).get();
  return snap.docs.filter((doc) => predicate(doc.data())).length;
}

/** `{ total, byStatus }` for a collection, counted from its documents. */
async function byStatus(collection, field, statuses) {
  const snap = await adminDb().collection(collection).get();
  const rows = snap.docs.map((doc) => doc.data());
  return {
    total: rows.length,
    byStatus: Object.fromEntries(statuses.map((status) => [status, rows.filter((row) => row[field] === status).length])),
  };
}

test.describe.serial('the event statistics endpoint', () => {
  const ticketIds = TICKET_STATUSES.flatMap((status, index) =>
    Array.from({ length: index + 1 }, (_, n) => `e2e-stats-${status}-${n}`));

  test.beforeAll(async () => {
    // 1 valid, 2 refunded, 3 cancelled, 4 waiting for details.
    for (const id of ticketIds) {
      const status = TICKET_STATUSES.find((candidate) => id.startsWith(`e2e-stats-${candidate}-`));
      await adminDb().collection('tickets').doc(id).set({ status, email: `${id}@example.test` });
    }
  });

  test.afterAll(async () => {
    for (const id of ticketIds) await adminDb().collection('tickets').doc(id).delete();
  });

  test('refuses an anonymous caller and a signed-in non-admin', async () => {
    const anonymous = await callFunction('getEventStats', {});
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.registrations).toBeUndefined();

    const stranger = await idTokenFor(await ensureUser(STRANGER_EMAIL));
    const refused = await callFunction('getEventStats', {}, stranger);
    expect(refused.status).toBe(403);
    expect(refused.body.error.message).toBe('Admin access required.');
    expect(refused.body.registrations).toBeUndefined();
  });

  test('returns the counts for the seeded demo event, counted by Firestore', async () => {
    const token = await adminIdToken();
    // Retried as a whole: an auth trigger from an account made moments ago
    // (the stranger above) can still be writing its users document, and the
    // figures and the reads must be taken of the same state.
    await expect(async () => {
      const response = await callFunction('getEventStats', {}, token);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const stats = response.body;

      const users = await byStatus('users', 'registrationStatus', REGISTRATION_STATUSES);
      expect(stats.registrations).toEqual({
        ...users,
        profileComplete: await countDocs('users', (data) => data.profileComplete === true),
      });
      expect(stats.tickets).toEqual(await byStatus('tickets', 'status', TICKET_STATUSES));
      // At least the records this spec added: 1, 2, 3 and 4, one count per status.
      TICKET_STATUSES.forEach((status, index) => {
        expect(stats.tickets.byStatus[status], status).toBeGreaterThanOrEqual(index + 1);
      });
      expect(stats.speakers).toEqual(await byStatus('speakers', 'status', SPEAKER_STATUSES));
      // The demo seed's sessions, pages, and blocks are on the site.
      expect(stats.content.cmsSchedule.published).toBeGreaterThan(0);
      for (const name of PUBLISHABLE_COLLECTIONS) {
        expect(stats.content[name], name).toEqual({
          published: await countDocs(name, (data) => data.visible === true),
          drafts: await countDocs(`${name}_drafts`, (data) => data.status === 'dirty'),
        });
      }
      expect(stats.errors).toEqual({
        unresolved: await countDocs('system_errors', (data) => data.resolved === false),
      });
      expect(Date.parse(stats.readAt)).not.toBeNaN();
    }).toPass({ timeout: 20_000 });
  });
});
