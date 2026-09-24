// The event statistics endpoint (issue #178) and the overview that prints
// it (issue #179), against the seeded emulator.
//
// This is the one place the real Admin SDK `count()` runs: the unit tests
// drive functions/src/admin/eventStats.cjs over the in-memory fake. So the
// expected figures here come from plain document reads through adminDb(),
// counted in this file, never from an aggregate — an answer that agrees with
// them was counted by Firestore itself.
//
// The overview is then driven in a real browser: the seeded operator signs
// in, opens /admin, lands on the overview, and every figure sentence on the
// page is compared with the endpoint's own answer. Milestones (issue #180)
// are saved and then emptied through the event settings form, and the
// overview is read after each save; config/event is put back afterwards.
// The Sessions page's Most saved panel (issue #182) is read against counts
// written for the purpose.
//
// The spec adds one ticket record per status (the seed writes none) under its
// own ids and deletes them when it is done, so no later spec meets them.
import { test, expect } from '@playwright/test';
import {
  ADMIN_EMAIL, adminDb, adminIdToken, callFunction, ensureUser, idTokenFor, mailFileSize, waitForOtpCode,
} from './helpers.mjs';

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

async function signIn(page, email) {
  const since = mailFileSize();
  await page.goto('/signin');
  await page.locator('#signin-email').fill(email);
  await page.getByRole('button', { name: /email me a code/i }).click();
  await expect(page.locator('#signin-code')).toBeVisible();
  await page.locator('#signin-code').fill(await waitForOtpCode(since, email, 30_000));
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL((url) => url.pathname !== '/signin');
}

const one = (count, singular, pluralWord) => (count === 1 ? singular : pluralWord);

/** The six figure sentences the overview should print for an answer. */
function figureSentences(stats) {
  const r = stats.registrations;
  const t = stats.tickets;
  const s = stats.speakers;
  const sessions = stats.content.cmsSchedule;
  return [
    `${r.total} ${one(r.total, 'account', 'accounts')}: ${r.byStatus.pending} pending, ${r.byStatus.ticketed} ticketed, `
      + `${r.byStatus.approved} approved, ${r.byStatus.revoked} revoked.`,
    `${r.profileComplete} of ${r.total} ${one(r.total, 'profile', 'profiles')} complete.`,
    `${t.total} ${one(t.total, 'ticket', 'tickets')}: ${t.byStatus.valid} valid, ${t.byStatus.refunded} refunded, `
      + `${t.byStatus.cancelled} cancelled, ${t.byStatus.pending_info} waiting for details.`,
    `${s.total} ${one(s.total, 'speaker', 'speakers')}: ${s.byStatus.draft} draft, ${s.byStatus.invited} invited, `
      + `${s.byStatus.accepted} accepted, ${s.byStatus.approved} approved, ${s.byStatus.removed} removed.`,
    `${sessions.published} ${one(sessions.published, 'session', 'sessions')} on the site. `
      + `${sessions.drafts} with unpublished changes.`,
    `${stats.errors.unresolved} unresolved ${one(stats.errors.unresolved, 'error', 'errors')}.`,
  ];
}

/** `YYYY-MM-DD` for today plus `days`, on the calendar of `timeZone`. */
function dateInZone(timeZone, days) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const [year, month, day] = today.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
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
      // The funnel nests, summed by the server from the same counts.
      expect(stats.funnel).toEqual([
        { id: 'accounts', count: users.total },
        { id: 'ticketed-or-approved', count: users.byStatus.ticketed + users.byStatus.approved },
        { id: 'approved', count: users.byStatus.approved },
      ]);
      expect(Date.parse(stats.readAt)).not.toBeNaN();
    }).toPass({ timeout: 20_000 });
  });

  test('/admin opens on the overview, and every figure on it matches the endpoint', async ({ page }) => {
    test.setTimeout(90_000);
    const token = await adminIdToken();
    await signIn(page, ADMIN_EMAIL);
    await expect(async () => {
      await page.goto('/admin');
      await expect(page).toHaveURL(/\/admin\/overview$/);
      await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
      const nav = page.getByRole('navigation', { name: 'Admin sections' });
      await expect(nav.getByRole('link').first()).toHaveText('Overview');
      await expect(nav.getByRole('link', { name: 'Overview', exact: true })).toHaveAttribute('aria-current', 'page');

      const figures = page.locator('section', { has: page.getByRole('heading', { name: 'Event figures' }) });
      await expect(figures.getByRole('listitem')).toHaveCount(6);
      const printed = (await figures.getByRole('listitem').allTextContents())
        .map((text) => text.replace(/\s+/g, ' ').trim());
      const response = await callFunction('getEventStats', {}, token);
      expect(response.status).toBe(200);
      expect(printed).toEqual(figureSentences(response.body));

      // The funnel and the readiness table read the same answer (issue #181).
      const funnel = page.locator('section', { has: page.getByRole('heading', { name: 'Registration funnel' }) });
      const [accounts, later, approved] = response.body.funnel.map((stage) => stage.count);
      if (accounts === 0) {
        await expect(funnel).toContainText('No one has signed up yet.');
      } else {
        await expect(funnel.getByRole('progressbar')).toHaveCount(3);
        await expect(funnel.getByRole('listitem').nth(1)).toHaveText(`Ticketed or approved: ${later} of ${accounts}`);
        await expect(funnel.getByRole('listitem').nth(2)).toHaveText(`Approved: ${approved} of ${accounts}`);
      }
      const table = page.getByRole('table', { name: /by collection/ });
      const { content } = response.body;
      for (const [label, id] of [['Pages', 'cmsPages'], ['Sessions', 'cmsSchedule'], ['Timeline', 'cmsTimeline']]) {
        await expect(table.getByRole('row', { name: new RegExp(`^${label} `) }).getByRole('cell'))
          .toHaveText([label, String(content[id].published), String(content[id].drafts)]);
      }
    }).toPass({ timeout: 45_000 });

    // Refresh reads the figures again and says when.
    await page.getByRole('button', { name: 'Refresh figures' }).click();
    await expect(page.getByRole('status').filter({ hasText: /^Figures read at / })).toBeVisible();
  });

  test('a milestone saved on the Event page appears on the overview, and an empty set renders nothing', async ({ page }) => {
    test.setTimeout(150_000);
    const eventRef = adminDb().doc('config/event');
    const stored = (await eventRef.get()).data();
    const nav = page.getByRole('navigation', { name: 'Admin sections' });
    const milestones = page.locator('section', { has: page.getByRole('heading', { name: 'Milestones', exact: true }) });
    const openEventPage = async () => {
      await nav.getByRole('link', { name: 'Event', exact: true }).click();
      // The form adopts the live config/event before it is edited.
      await expect(page.getByLabel('Event name', { exact: true })).toHaveValue(stored.name);
    };
    const saveEventPage = async () => {
      await page.getByRole('button', { name: 'Save event settings' }).click();
      await expect(page.getByText('Saved. The site picks the change up live.')).toBeVisible();
    };
    try {
      await eventRef.update({ milestones: [], 'registration.goal': null });
      await signIn(page, ADMIN_EMAIL);
      await page.goto('/admin/overview');
      await expect(page.getByRole('heading', { name: 'Event figures' })).toBeVisible();
      // No milestones and no goal: no panel at all.
      await expect(page.getByRole('heading', { name: 'Milestones', exact: true })).toHaveCount(0);

      // Saved through the event settings form, the way an organizer saves them.
      await openEventPage();
      await page.getByRole('button', { name: 'Add milestone' }).click();
      await expect(page.getByLabel('Milestone 1 name', { exact: true })).toBeFocused();
      await page.getByLabel('Milestone 1 name', { exact: true }).fill('E2E programme announced');
      await page.getByLabel('Milestone 1 date', { exact: true }).fill(dateInZone(stored.timezone, 12));
      await page.getByRole('button', { name: 'Add milestone' }).click();
      await page.getByLabel('Milestone 2 name', { exact: true }).fill('E2E proposals close');
      await page.getByLabel('Milestone 2 date', { exact: true }).fill(dateInZone(stored.timezone, -3));
      await page.getByLabel('Registration goal', { exact: true }).fill('500');
      await saveEventPage();
      await expect.poll(async () => (await eventRef.get()).data().milestones?.length, { timeout: 15_000 }).toBe(2);
      expect((await eventRef.get()).data().registration.goal).toBe(500);

      await nav.getByRole('link', { name: 'Overview', exact: true }).click();
      await expect(milestones).toBeVisible();
      const items = milestones.getByRole('listitem');
      await expect(items).toHaveCount(2);
      await expect(items.nth(0)).toContainText('E2E proposals close');
      await expect(items.nth(0)).toContainText('3 days ago');
      await expect(items.nth(1)).toContainText('E2E programme announced');
      await expect(items.nth(1)).toContainText('In 12 days');
      await expect(milestones).toContainText(/\d+ of 500 approved toward the registration goal\./);
      await expect(milestones.getByRole('progressbar')).toHaveAttribute('max', '500');

      // Emptied through the same form: the overview draws nothing.
      await openEventPage();
      await page.getByRole('button', { name: 'Remove milestone 1' }).click();
      await page.getByRole('button', { name: 'Remove milestone 1' }).click();
      await expect(page.getByText('No milestones yet.')).toBeVisible();
      await page.getByLabel('Registration goal', { exact: true }).fill('');
      await saveEventPage();
      await expect.poll(async () => (await eventRef.get()).data().milestones, { timeout: 15_000 }).toEqual([]);
      await nav.getByRole('link', { name: 'Overview', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Event figures' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Milestones', exact: true })).toHaveCount(0);
    } finally {
      await eventRef.set(stored);
    }
  });

  // Session popularity (issue #182), on the admin Sessions page, from the
  // public sessionBookmarks counts the bookmarkSession function keeps. The
  // counts are written here through the Admin SDK so the order is known;
  // whatever the collection held before is put back afterwards.
  test('the Sessions page ranks sessions by saves, and says when none has been saved', async ({ page }) => {
    test.setTimeout(90_000);
    const counts = adminDb().collection('sessionBookmarks');
    const before = (await counts.get()).docs.map((doc) => [doc.id, doc.data()]);
    for (const [id] of before) await counts.doc(id).delete();
    const [first, second] = (await adminDb().collection('cmsSchedule').where('visible', '==', true).get()).docs;
    try {
      await signIn(page, ADMIN_EMAIL);
      await page.goto('/admin/sessions');
      const panel = page.locator('section', { has: page.getByRole('heading', { name: 'Most saved' }) });
      await expect(panel).toContainText('No session has been saved yet.');

      await counts.doc(first.id).set({ count: 3, updatedAt: new Date() });
      await counts.doc(second.id).set({ count: 7, updatedAt: new Date() });
      // The listener delivers the counts; the most saved comes first.
      const table = panel.getByRole('table', { name: 'Sessions by saves, most first.' });
      const rows = table.getByRole('row');
      await expect(rows).toHaveCount(3);
      await expect(rows.nth(1)).toContainText(second.data().title);
      await expect(rows.nth(1).getByRole('cell').last()).toHaveText('7');
      await expect(rows.nth(2)).toContainText(first.data().title);
      await expect(rows.nth(2).getByRole('cell').last()).toHaveText('3');
      await expect(table.getByRole('columnheader', { name: 'Saved' })).toHaveAttribute('aria-sort', 'descending');
      await expect(panel).not.toContainText('No session has been saved yet.');
      await expect(panel).toContainText(/\d+ sessions? on the site ha(s|ve) no saves yet\./);
    } finally {
      await counts.doc(first.id).delete();
      await counts.doc(second.id).delete();
      for (const [id, data] of before) await counts.doc(id).set(data);
    }
  });
});
