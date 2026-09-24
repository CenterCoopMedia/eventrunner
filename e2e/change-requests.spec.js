// Change requests (issue #188), on the real surface.
//
// The done line crosses the flag, the footer, the endpoint, the rules, the
// audit trail and the admin page, so only the emulators prove it. A visitor
// signs in through the real sign-in page. With the flag off (the seeded
// default) the footer offers nothing and the endpoint refuses a direct POST.
// With the flag on, the visitor sends a request from the footer by keyboard,
// and a staff account finds it on the admin page, moves it on, and removes
// it; every step leaves its admin_logs row, read back with the Admin SDK.
// The rate limit is driven against the real endpoint with the visitor's own
// token. Turning the flag off again refuses the very next request.
//
// config/bootstrap and config/features are restored when the file is done,
// because later specs sign in as the seeded operator and read the flags.
import { test, expect } from '@playwright/test';
import {
  adminDb, callFunction, ensureUser, idTokenFor, signIn,
} from './helpers.mjs';

const VISITOR_EMAIL = 'e2e-change-visitor@example.test';
const STAFF_EMAIL = 'e2e-change-staff@example.test';

const footerButton = (page) =>
  page.locator('footer').getByRole('button', { name: 'Request a change' });

async function setFlag(on) {
  await adminDb().collection('config').doc('features').set({ changeRequests: on }, { merge: true });
}

test.describe.serial('change requests', () => {
  const stamp = Date.now();
  const message = `The travel page lists the wrong hotel (${stamp}).`;
  let seededBootstrap;
  let seededFeatures;
  let visitorUid;
  let visitorToken;
  let visitor;
  let staff;
  let requestId;

  test.beforeAll(async ({ browser }) => {
    // Two sign-ins through the real page, each waiting on an emailed code.
    test.setTimeout(120_000);
    const config = adminDb().collection('config');
    seededBootstrap = (await config.doc('bootstrap').get()).data();
    seededFeatures = (await config.doc('features').get()).data();
    await config.doc('bootstrap').set({
      ...seededBootstrap,
      staffEmails: [...(seededBootstrap.staffEmails ?? []), STAFF_EMAIL],
    });

    // Sign in first: the sign-in creates the account, and an account made
    // beforehand would get a registration prompt that the code reader could
    // take for the code.
    visitor = await (await browser.newContext()).newPage();
    await signIn(visitor, VISITOR_EMAIL);
    staff = await (await browser.newContext()).newPage();
    await signIn(staff, STAFF_EMAIL);

    visitorUid = await ensureUser(VISITOR_EMAIL);
    visitorToken = await idTokenFor(visitorUid);
    // A retried run starts with a fresh rate-limit window.
    await adminDb().collection('change_request_rate_limits').doc(visitorUid).delete();
  });

  test.afterAll(async () => {
    await visitor?.context().close();
    await staff?.context().close();
    const db = adminDb();
    const config = db.collection('config');
    if (seededBootstrap) await config.doc('bootstrap').set(seededBootstrap);
    if (seededFeatures) await config.doc('features').set(seededFeatures);
    const left = await db.collection('change_requests').where('uid', '==', visitorUid ?? '').get();
    await Promise.all(left.docs.map((doc) => doc.ref.delete()));
    if (visitorUid) await db.collection('change_request_rate_limits').doc(visitorUid).delete();
  });

  test('the flag is off by default, and no form is reachable with it off', async () => {
    const features = (await adminDb().collection('config').doc('features').get()).data();
    expect(features.changeRequests).toBe(false);

    // The public footer offers nothing to a signed-in visitor.
    await visitor.goto('/');
    await expect(visitor.locator('footer')).toBeVisible();
    await expect(footerButton(visitor)).toHaveCount(0);

    // The admin page states the flag and draws no form.
    await staff.goto('/admin/change-requests');
    await expect(staff.getByRole('heading', { level: 1, name: 'Change requests' })).toBeVisible();
    await expect(staff.getByText('Change requests are off. An operator can turn them on under Features.')).toBeVisible();
    await expect(staff.getByRole('button', { name: 'Send request' })).toHaveCount(0);
    await expect(staff.getByLabel('What should change?')).toHaveCount(0);

    // A direct POST is refused by the server, and nothing is written.
    const refused = await callFunction('submitChangeRequest', { message: 'Direct.', submissionKey: `direct${stamp}` }, visitorToken);
    expect(refused.status).toBe(404);
    expect(refused.body.error.code).toBe('not-found');
    expect((await adminDb().collection('change_requests').doc(`direct${stamp}`).get()).exists).toBe(false);
    expect((await adminDb().collection('change_request_rate_limits').doc(visitorUid).get()).exists).toBe(false);
  });

  test('a visitor sends a request from the footer by keyboard, and it writes an audit row', async () => {
    await setFlag(true);
    await visitor.goto('/faq');
    const button = footerButton(visitor);
    await expect(button).toBeVisible();

    await button.focus();
    await visitor.keyboard.press('Enter');
    await expect(visitor.getByRole('dialog', { name: 'Request a change' })).toBeVisible();
    // The heading, and so the dialog's name, becomes "Request sent" after a send.
    const dialog = visitor.getByRole('dialog');
    const field = dialog.getByLabel('What should change?');
    await expect(field).toBeFocused();
    await visitor.keyboard.type(message);
    await visitor.keyboard.press('Tab');
    const pageField = dialog.getByLabel('Page (optional)');
    await expect(pageField).toBeFocused();
    await expect(pageField).toHaveValue('/faq');
    await visitor.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await visitor.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Send request' })).toBeFocused();
    await visitor.keyboard.press('Enter');

    await expect(visitor.getByRole('dialog', { name: 'Request sent' })).toBeVisible();
    await expect(dialog.getByRole('status')).toHaveText('We got your request. The event team will read it.');
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
    await visitor.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(button).toBeFocused();

    // The store holds the token's identity and the text; the audit row holds neither text.
    const stored = await adminDb().collection('change_requests').where('uid', '==', visitorUid).get();
    expect(stored.size).toBe(1);
    requestId = stored.docs[0].id;
    expect(stored.docs[0].data()).toMatchObject({
      message, page: '/faq', status: 'new', uid: visitorUid, email: VISITOR_EMAIL,
    });
    const rows = await adminDb().collection('admin_logs').where('docPath', '==', `change_requests/${requestId}`).get();
    expect(rows.docs.map((doc) => doc.data())).toEqual([
      expect.objectContaining({ action: 'submitChangeRequest', uid: visitorUid, email: VISITOR_EMAIL }),
    ]);
    expect(JSON.stringify(rows.docs.map((doc) => doc.data()))).not.toContain(String(stamp));
  });

  test('staff find it on the admin page, move it on, and remove it outright; each step writes a row', async () => {
    await staff.goto('/admin/change-requests');
    await expect(staff.getByRole('button', { name: 'Send request' })).toBeVisible();
    const row = staff.getByRole('listitem').filter({ hasText: message });
    await expect(row).toBeVisible();
    await expect(row).toContainText('New');
    await expect(row.getByRole('link', { name: VISITOR_EMAIL })).toHaveAttribute('href', `mailto:${VISITOR_EMAIL}`);
    await expect(row).toContainText('/faq');

    await row.getByRole('button', { name: 'Mark in progress' }).click();
    await expect(row.getByRole('button', { name: 'Mark done' })).toBeVisible();
    await expect(row).toContainText('In progress');
    const ref = adminDb().collection('change_requests').doc(requestId);
    await expect.poll(async () => (await ref.get()).data()?.status).toBe('in_progress');
    expect((await ref.get()).data().updatedBy).toBe(STAFF_EMAIL);

    await row.getByRole('button', { name: 'Remove' }).click();
    await expect(row.getByText('The request and its text are deleted. The admin log keeps who sent it and when. This cannot be undone.')).toBeVisible();
    await row.getByRole('button', { name: 'Remove this request' }).click();
    await expect(staff.getByText('Request removed.')).toBeVisible();
    await expect(staff.getByRole('listitem').filter({ hasText: message })).toHaveCount(0);
    await expect(staff.getByRole('heading', { level: 2, name: 'Requests', exact: true })).toBeFocused();
    await expect.poll(async () => (await ref.get()).exists).toBe(false);

    const rows = await adminDb().collection('admin_logs').where('docPath', '==', `change_requests/${requestId}`).get();
    const actions = rows.docs.map((doc) => doc.data());
    expect(actions).toHaveLength(3);
    expect(actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'submitChangeRequest', email: VISITOR_EMAIL }),
      expect.objectContaining({ action: 'updateChangeRequestStatus', email: STAFF_EMAIL }),
      expect.objectContaining({ action: 'deleteChangeRequest', email: STAFF_EMAIL }),
    ]));
    // The removal left no copy of the text anywhere in the log.
    expect(JSON.stringify(actions)).not.toContain(String(stamp));
  });

  test('the public path is rate limited: the sixth request in 15 minutes is refused', async () => {
    // One request in this window already: the footer send above.
    for (let i = 1; i < 5; i += 1) {
      const sent = await callFunction('submitChangeRequest', { message: `Burst ${i}.`, submissionKey: `burst${stamp}${i}` }, visitorToken);
      expect(sent.status, `request ${i + 1}`).toBe(201);
    }
    const limited = await callFunction('submitChangeRequest', { message: 'One too many.', submissionKey: `burst${stamp}6` }, visitorToken);
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('rate-limited');
    expect(limited.body.error.retryAfterSeconds).toBeGreaterThan(0);
    // The wait the reader sees is the server's window, in whole minutes, rounded up.
    const minutes = Math.ceil(limited.body.error.retryAfterSeconds / 60);
    expect(limited.body.error.message).toBe(
      `Too many change requests. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`,
    );
    expect((await adminDb().collection('change_requests').doc(`burst${stamp}6`).get()).exists).toBe(false);
    const logged = await adminDb().collection('admin_logs').where('docPath', '==', `change_requests/burst${stamp}6`).get();
    expect(logged.size).toBe(0);

    // The footer states the refusal in the server's words.
    await visitor.goto('/');
    await footerButton(visitor).click();
    const dialog = visitor.getByRole('dialog', { name: 'Request a change' });
    await dialog.getByLabel('What should change?').fill('Still one too many.');
    await dialog.getByRole('button', { name: 'Send request' }).click();
    await expect(dialog.getByRole('alert')).toHaveText(/^Too many change requests\. Try again in \d+ minutes?\.$/);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
  });

  test('turning the flag off takes the footer control away and refuses the next request at once', async () => {
    await setFlag(false);
    await expect(footerButton(visitor)).toHaveCount(0);
    await adminDb().collection('change_request_rate_limits').doc(visitorUid).delete();
    const refused = await callFunction('submitChangeRequest', { message: 'After the flag.', submissionKey: `after${stamp}` }, visitorToken);
    expect(refused.status).toBe(404);
    expect((await adminDb().collection('change_requests').doc(`after${stamp}`).get()).exists).toBe(false);
  });
});
