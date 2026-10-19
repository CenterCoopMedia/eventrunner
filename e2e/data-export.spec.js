// Event data export (issue 329), driven through the real Data export page.
//
// A staff account signs in through the real sign-in page, exports the
// sessions spreadsheet, and meets no order export and no package. The
// operator endpoints refuse its own ID token. The seeded operator then signs
// in, downloads the event data package from the same page, and the zip the
// browser saves is read back with the package reader
// (functions/src/admin/eventPackageReader.cjs): the manifest, the
// checksums, the relationships, the records this file seeded, and no raw
// provider record or bootstrap list. Each export's admin_logs row is read
// with the Admin SDK.
//
// One hidden session (live, with its clean draft), one invited speaker, one
// Stripe order with its ticket, and one ticket synced from another source
// are made for this file, in the shapes their writers store, with a stamp in
// every id, and removed at the end; config/bootstrap is restored.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import packageReader from '../functions/src/admin/eventPackageReader.cjs';
import { ADMIN_EMAIL, adminDb, callFunction, ensureUser, idTokenFor, signIn } from './helpers.mjs';

const { verifyEventPackage, readEventPackage } = packageReader;

const STAFF_EMAIL = 'e2e-export-staff@example.test';

/** RFC 4180 reader: BOM, every cell quoted, CRLF records. */
function parseCsv(text) {
  expect(text.startsWith('\uFEFF')).toBe(true);
  const body = text.slice(1);
  const rows = [];
  let row = [];
  let i = 0;
  while (i < body.length) {
    expect(body[i]).toBe('"');
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
    expect(body.slice(i, i + 2)).toBe('\r\n');
    i += 2;
    rows.push(row);
    row = [];
  }
  return rows;
}

test.describe.serial('event data export', () => {
  const stamp = Date.now();
  const sessionId = `e2e-export-session-${stamp}`;
  const speakerId = `e2e-export-speaker-${stamp}`;
  const orderId = `e2e-export-order-${stamp}`;
  const ticketId = `${orderId}_0_0`;
  const syncedTicketId = `e2e-export-synced-${stamp}`;
  const title = `=HYPERLINK("http://example.test","Export ${stamp}")`;
  // speakers/invites.cjs stores the SHA-256 digest of the invite token.
  const inviteHash = crypto.createHash('sha256').update(`invite-${stamp}`).digest('hex');
  let seededBootstrap;

  test.beforeAll(async () => {
    const db = adminDb();
    const config = db.collection('config');
    seededBootstrap = (await config.doc('bootstrap').get()).data();
    await config.doc('bootstrap').set({
      ...seededBootstrap,
      staffEmails: [...(seededBootstrap.staffEmails ?? []), STAFF_EMAIL],
    });
    const at = new Date();
    const dayId = (await config.doc('event').get()).data()?.days?.[0]?.id ?? 'day-1';
    // createSpeaker (speakers/profile.cjs), then sendSpeakerInvite (speakers/invites.cjs).
    await db.collection('speakers').doc(speakerId).set({
      firstName: 'Export', lastName: `Speaker ${stamp}`, slug: `e2e-export-speaker-${stamp}`, email: `speaker-${stamp}@example.test`,
      organization: '', jobTitle: '', bio: 'Reports on budgets.', headshotPath: null, socialHandles: {},
      status: 'invited', uid: null, inviteToken: inviteHash, inviteSends: [at], approvedAt: null,
      createdAt: at, updatedAt: at, updatedBy: ADMIN_EMAIL,
    });
    // A published session (store.publishDocs) with its clean draft. Hidden,
    // so no public page or other spec counts it.
    const fields = { title, description: 'Export check.', dayId, startTime: '09:00', endTime: '10:00', speakerIds: [speakerId] };
    await db.collection('cmsSchedule').doc(sessionId).set({
      ...fields, visible: false, revision: 1, publishedAt: at, publishedBy: 'e2e-staff-uid',
    });
    await db.collection('cmsSchedule_drafts').doc(sessionId).set({
      ...fields, visible: false, status: 'clean', basedOnRevision: 1, updatedAt: at, updatedBy: ADMIN_EMAIL,
    });
    // A paid Stripe order (ticketing/stripeCheckout.cjs, then stripeReconcile.cjs).
    await db.collection('ticket_orders').doc(orderId).set({
      id: orderId, orderId, provider: 'stripe', eventId: 'e2e-event', stripeAccountId: 'acct_1E2eExport', livemode: false,
      attemptId: `att_${stamp}`, source: 'checkout', purchaserUid: null, purchaserEmail: `buyer-${stamp}@example.test`,
      requestFingerprint: inviteHash, catalogRevision: 1, currency: 'usd', currencyExponent: 2,
      lines: [{ ticketTypeId: 'general', ticketClass: 'General', name: 'General', quantity: 1, unitAmount: 2500, lineAmount: 2500 }],
      subtotalAmount: 2500, totalAmount: 2500, taxAmount: 0, discountAmount: 0, feeAmount: 0,
      taxTreatment: 'not_collected', refundPolicy: 'No refunds.',
      seats: [{ externalId: ticketId, ticketTypeId: 'general', ticketClass: 'General', lineIndex: 0, seatIndex: 0, firstName: 'Holder', lastName: '', email: `holder-${stamp}@example.test` }],
      ticketIds: [ticketId], status: 'paid', paymentStatus: 'succeeded', inventoryState: 'sold',
      stripeSessionId: `cs_test_${stamp}`, stripePaymentIntentId: `pi_${stamp}`, checkoutUrl: `https://checkout.example.test/SECRET-${stamp}`,
      expiresAt: at.toISOString(), refundStatus: 'none', refundedAmount: 0, refunds: [], disputes: [],
      reconciliationException: null, reconciliationLease: null, paidAt: at, reconciledAt: at, createdAt: at, updatedAt: at,
    });
    await db.collection('tickets').doc(ticketId).set({
      externalId: ticketId, orderId, provider: 'stripe', eventId: 'e2e-event', source: 'checkout',
      ticketTypeId: 'general', ticketClass: 'General', quantity: 1, email: `holder-${stamp}@example.test`,
      firstName: 'Holder', lastName: null, status: 'valid', claimedByUid: null, claimedAt: null, claimPromptSentAt: null,
      purchasedAt: at.toISOString(), createdAt: at, updatedAt: at,
    });
    // A ticket synced from another source (ticketing/sync.cjs), with its raw record.
    await db.collection('tickets').doc(syncedTicketId).set({
      externalId: syncedTicketId, orderId: `eb-order-${stamp}`, email: `synced-${stamp}@example.test`, firstName: 'Synced',
      lastName: null, ticketClass: 'General', quantity: 1, purchasedAt: at.toISOString(), status: 'valid', provider: 'eventbrite',
      raw: { barcodes: [{ barcode: `SECRET-${stamp}` }] }, claimedByUid: null, claimedAt: null, claimPromptSentAt: null,
      createdAt: at, updatedAt: at,
    });
  });

  test.afterAll(async () => {
    const db = adminDb();
    await Promise.all([
      db.collection('cmsSchedule').doc(sessionId).delete(),
      db.collection('cmsSchedule_drafts').doc(sessionId).delete(),
      db.collection('speakers').doc(speakerId).delete(),
      db.collection('ticket_orders').doc(orderId).delete(),
      db.collection('tickets').doc(ticketId).delete(),
      db.collection('tickets').doc(syncedTicketId).delete(),
    ]);
    if (seededBootstrap) await db.collection('config').doc('bootstrap').set(seededBootstrap);
  });

  test('staff export the sessions spreadsheet; orders and the package stay with the operator', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(page, STAFF_EMAIL);
    await page.goto('/admin/data-export');
    await expect(page.getByRole('heading', { level: 1, name: 'Data export' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export ticket orders' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Event data package' })).toHaveCount(0);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export sessions' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^sessions-\d{4}-\d{2}-\d{2}\.csv$/);
    const text = fs.readFileSync(await download.path(), 'utf8');
    const rows = parseCsv(text);
    const row = rows.find((cells) => cells[0] === sessionId);
    expect(row[1]).toBe(`'${title}`);
    expect(row[rows[0].indexOf('Speakers')]).toBe(`Export Speaker ${stamp}`);
    expect(text).not.toContain('SECRET');
    expect(text).not.toContain(inviteHash);
    await expect(page.getByRole('status').filter({ hasText: 'Exported' })).toContainText('The export is in the admin log.');

    const logs = await adminDb().collection('admin_logs').where('action', '==', 'exportEventData').get();
    expect(logs.docs.map((doc) => doc.data())).toContainEqual(expect.objectContaining({
      email: STAFF_EMAIL, docPath: 'cmsSchedule', details: expect.objectContaining({ dataset: 'sessions' }),
    }));

    // The server refuses the operator exports to the staff account's own token.
    const token = await idTokenFor(await ensureUser(STAFF_EMAIL));
    expect((await callFunction('exportEventData', { dataset: 'orders' }, token)).status).toBe(403);
    expect((await callFunction('downloadEventPackage', { sections: ['orders'], includeStaffNotes: false }, token)).status).toBe(403);
    await context.close();
  });

  test('the operator downloads the event data package, and it reads back whole', async ({ browser }) => {
    const before = (await adminDb().collection('admin_logs').where('action', '==', 'downloadEventPackage').get()).size;
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(page, ADMIN_EMAIL);
    await page.goto('/admin/data-export');
    await expect(page.getByRole('group', { name: 'Parts to include (8 of 8 chosen)' })).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60_000 }),
      page.getByRole('button', { name: 'Download event data package' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^event-data-package-\d{4}-\d{2}-\d{2}\.zip$/);
    const buffer = fs.readFileSync(await download.path());
    const report = verifyEventPackage(buffer);
    expect(report.problems).toEqual([]);
    expect(report.manifest.schemaVersion).toBe(1);

    const { files } = readEventPackage(buffer);
    const read = (path) => JSON.parse(files.get(path).toString('utf8'));
    const session = read('program/sessions.json').find((record) => record.id === sessionId);
    expect(session.speakerIds).toEqual([speakerId]);
    expect(read('speakers/speakers.json').some((record) => record.id === speakerId)).toBe(true);
    const order = read('orders/orders.json').find((record) => record.id === orderId);
    expect(order.ticketIds).toEqual([ticketId]);
    expect(read('orders/admissions.json').find((record) => record.id === ticketId).orderId).toBe(orderId);
    expect(read('orders/admissions.json').find((record) => record.id === syncedTicketId).provider).toBe('eventbrite');
    expect(Object.keys(read('content/config.json'))).not.toContain('bootstrap');
    for (const [path, data] of files) {
      expect(data.toString('utf8'), path).not.toContain('SECRET');
      expect(data.toString('utf8'), path).not.toContain(inviteHash);
    }
    expect(files.get('README.md').toString('utf8')).toContain('## Personal data and retention');

    await expect(page.getByRole('status').filter({ hasText: 'Downloaded' })).toContainText('The download is in the admin log.');
    const logs = await adminDb().collection('admin_logs').where('action', '==', 'downloadEventPackage').get();
    expect(logs.size).toBe(before + 1);
    await context.close();
  });
});
