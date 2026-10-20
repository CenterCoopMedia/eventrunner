'use strict';

/**
 * A synthetic event for the data export tests (issue #329).
 *
 * EVERY DOCUMENT HAS THE SHAPE ITS WRITER STORES. The comment above each
 * group names the writer, and exportFixture.test.cjs runs the content
 * fields through the same validators the writers use. A field no code
 * writes does not belong here: a made-up field lets a test pass for the
 * wrong reason.
 *
 * Values that must never leave the deployment are of two kinds. Free text
 * (a private note, a bio, a raw provider payload) starts with SECRET or
 * PRIVATE, so a test can search a whole file for those words. Values with
 * a fixed form (an account id, a token hash, a staff address) keep their
 * real form and are listed in FORBIDDEN_VALUES. Formula-shaped values sit
 * in the fields a spreadsheet shows first.
 *
 * Every relationship resolves except one: an admission synced from an
 * external ticketing source names that source's order, which the package
 * does not hold.
 */

const crypto = require('node:crypto');

const ADMIN = 'admin@example.com';
const STAFF = 'staff@example.com';
const BOOTSTRAP_DOC = Object.freeze({ adminEmails: [ADMIN, 'operator-two@example.com'], staffEmails: [STAFF] });

const AT = new Date('2026-03-27T14:00:00.000Z');

/** Staff account ids, as requireAdmin hands them to the writers. */
const STAFF_UID = 'staff-uid-1';
const OPERATOR_UID = 'operator-uid-1';

const digest = (text) => crypto.createHash('sha256').update(text).digest('hex');

/** A pending invite's token hash (speakers/invites.cjs stores the SHA-256 digest). */
const INVITE_HASH = digest('fixture-invite-token');
/** The checkout request fingerprint (ticketing/stripeCommerce.cjs requestFingerprint). */
const FINGERPRINT = digest('fixture-checkout-request');

/** The words no exported file may contain. */
const FORBIDDEN = Object.freeze(['SECRET', 'PRIVATE']);

/** Values with a fixed form that no exported file may contain. */
const FORBIDDEN_VALUES = Object.freeze([
  STAFF, STAFF_UID, OPERATOR_UID, INVITE_HASH, FINGERPRINT,
  'acct_1FixtureAccount', 'cs_test_fixture', 'pi_fixture', 'ch_fixture', 'att_fixture',
]);

/** The bookkeeping store.publishDocs writes on a live CMS document. */
const published = (revision = 1) => ({ revision, publishedAt: AT, publishedBy: STAFF_UID });

/** The draft store.publishDocs leaves behind: the same content, marked clean. */
const cleanDraft = (fields, visible, revision = 1) => ({
  ...fields, visible, status: 'clean', basedOnRevision: revision, updatedAt: AT, updatedBy: STAFF,
});

/** A draft store.writeDraft saves and nobody has published yet. */
const dirtyDraft = (fields, visible, basedOnRevision) => ({
  ...fields, visible, status: 'dirty', basedOnRevision, updatedAt: AT, updatedBy: STAFF,
});

const KEYNOTE = {
  title: '=HYPERLINK("http://example.test","Keynote")', description: 'Opening remarks.',
  dayId: 'day-1', startTime: '09:00', endTime: '10:00', type: 'keynote', track: 'A',
  location: 'Hall', speakerIds: ['speaker-ada'],
};
const PANEL = {
  title: 'Data panel', description: 'Three desks compare notes.',
  dayId: 'day-1', startTime: '10:15', endTime: '11:00', type: 'panel', track: 'A',
  speakerIds: ['speaker-ada', 'speaker-bo'], parentId: 'session-keynote',
};
// Revised to say the panel needs no slides: the export must carry the mark.
const PANEL_REVISED = { ...PANEL, title: 'Data panel (revised)', materialsNotNeeded: true };
const WORKSHOP = {
  title: 'Unpublished workshop', description: 'Hands-on records requests.',
  dayId: 'day-1', startTime: '13:00', endTime: '14:00', type: 'workshop',
};
/** convertSessionPitch (sessions/pitchQueue.cjs) builds these fields from pitch-1. */
const CONVERTED = {
  title: 'Local data desks', description: '<p>How small rooms share data.</p>',
  dayId: 'day-1', startTime: '14:00', endTime: '15:00', speakerIds: ['pitch-pitch-1'], type: 'Panel',
};
const LEDGER = {
  slug: 'ledger', name: '+SUM(1,2)', tier: 'Sponsor', url: 'https://example.org/', description: 'A sponsor.',
  logoPath: 'cms-images/asset-2/ledger.png', order: 1,
};
const GAZETTE = {
  slug: 'gazette', name: 'Gazette', tier: 'Partner', url: 'https://example.net/', description: 'A partner.', order: 2,
};
const EMBARGO = {
  slug: 'embargoed-sponsor', name: 'Embargoed sponsor', tier: 'Sponsor', url: 'https://example.com/', description: 'Not announced.', order: 3,
};

function exportSeed() {
  return {
    // config: the shapes shared/config validates. pitch_call is what
    // updatePitchCall (sessions/pitches.cjs) writes.
    'config/bootstrap': BOOTSTRAP_DOC,
    'config/providers': { ticketing: { name: 'stripe', livemode: false, stripeAccountId: 'acct_1FixtureAccount' } },
    'config/event': {
      name: 'Sample summit',
      shortName: 'SAMPLE26',
      timezone: 'America/New_York',
      days: [{ id: 'day-1', label: 'Main day', date: '2026-03-27', startTime: '08:00', endTime: '18:00' }],
      tracks: [{ letter: 'A', name: 'Main hall' }],
      sender: { email: 'hello@example.com', name: 'Sample summit', replyTo: null },
    },
    'config/theme': { preset: 'broadsheet', colors: {}, tokens: { light: {} } },
    'config/features': { schedule: true, speakers: true, sessionMaterials: true },
    'config/badges': { categories: [{ id: 'role', label: 'Role', maxPicks: 1, badges: [{ id: 'writer', label: 'Writer' }] }] },
    'config/pitch_call': { enabled: false, closesAt: '2026-02-01T00:00:00.000Z', externalFormUrl: null },

    // cmsSchedule: store.writeDraft and store.publishDocs. A live document
    // holds the content, materialCount (materials/store.cjs), visible,
    // revision, publishedAt and the publisher's account id; every published
    // document keeps its draft.
    'cmsSchedule/session-keynote': { ...KEYNOTE, materialCount: 1, visible: true, ...published(2) },
    'cmsSchedule_drafts/session-keynote': cleanDraft(KEYNOTE, true, 2),
    'cmsSchedule/session-panel': { ...PANEL, materialCount: 1, visible: true, ...published(1) },
    'cmsSchedule_drafts/session-panel': dirtyDraft(PANEL_REVISED, true, 1),
    'cmsSchedule_drafts/session-draft': dirtyDraft(WORKSHOP, true, null),
    // What convertSessionPitch wrote for pitch-1, after a staff member
    // published it. The conversion draft has visible: false, so the live
    // session stays hidden until someone shows it.
    'cmsSchedule/pitch-pitch-1': { ...CONVERTED, visible: false, ...published(1) },
    'cmsSchedule_drafts/pitch-pitch-1': cleanDraft(CONVERTED, false, 1),

    // speakers: createSpeaker (speakers/profile.cjs), the invite and
    // acceptance transactions (speakers/invites.cjs), the self-edit queue
    // (pendingEdits), and convertSessionPitch.
    'speakers/speaker-ada': {
      firstName: 'Ada', lastName: 'Quill', slug: 'ada-quill', email: 'ada@example.com',
      organization: '@Ledger', jobTitle: 'Editor', bio: 'Covers budgets.',
      headshotPath: 'speaker-photos/speaker-ada/asset-3/ada.jpg',
      socialHandles: { mastodon: '@ada@example.social' }, status: 'approved',
      uid: 'uid-ada', inviteToken: null, inviteSends: [AT], acceptedAt: AT, acceptedEmail: 'ada@example.com',
      pendingEdits: { bio: 'PRIVATE-pending-bio' }, approvedAt: AT, createdAt: AT, updatedAt: AT, updatedBy: STAFF,
    },
    'speakers/speaker-bo': {
      firstName: 'Bo', lastName: 'Reyes', slug: 'bo-reyes', email: 'bo@example.com',
      organization: 'Gazette', jobTitle: 'Reporter', bio: '', headshotPath: null, socialHandles: {}, status: 'invited',
      uid: null, inviteToken: INVITE_HASH, inviteSends: [AT], approvedAt: null, createdAt: AT, updatedAt: AT, updatedBy: STAFF,
    },
    'speakers/pitch-pitch-1': {
      firstName: 'Cy', lastName: 'Park', slug: 'pitch-pitch-1', email: 'cy@example.com', organization: 'Weekly',
      bio: '', jobTitle: '', socialHandles: {}, headshotPath: null, status: 'draft', uid: null, inviteToken: null,
      approvedAt: null, createdAt: AT, updatedAt: AT, updatedBy: STAFF,
    },

    // cmsOrganizations: the same two-revision store. Gazette is published
    // and hidden (visible: false). The embargoed sponsor is a draft only:
    // no package file may hold it.
    'cmsOrganizations/org-ledger': { ...LEDGER, visible: true, ...published(1) },
    'cmsOrganizations_drafts/org-ledger': cleanDraft(LEDGER, true, 1),
    'cmsOrganizations/org-gazette': { ...GAZETTE, visible: false, ...published(1) },
    'cmsOrganizations_drafts/org-gazette': cleanDraft(GAZETTE, false, 1),
    'cmsOrganizations_drafts/org-embargo': dirtyDraft(EMBARGO, true, null),

    // The other CMS collections: content blocks keyed <section>__<field>
    // (cms/content.cjs), pages (cms/pages.cjs), updates (cms/updates.cjs)
    // and timeline entries (cms/timeline.cjs), each live after a publish.
    'cmsContent/hero__title': { section: 'hero', field: 'title', blockType: 'text', value: 'Welcome', visible: true, ...published(1) },
    'cmsPages/about': {
      id: 'about', label: 'About', path: '/about', icon: null, order: 3, systemPage: false,
      sections: [{
        id: 'intro', label: 'Introduction', description: null, allowedBlocks: ['richtext'], maxBlocks: 4, reorderable: true,
        defaultBlocks: [{ field: 'intro_body', blockType: 'richtext', description: 'Body' }],
      }],
      visible: true, ...published(1),
    },
    'cmsUpdates/update-1': { title: 'Doors open', body: 'Doors open at eight.', publishAt: null, pinned: false, visible: true, ...published(1) },
    'cmsTimeline/edition-2025': { year: 2025, title: 'Pitch call opens', description: 'The first open call.', visible: true, ...published(1) },

    // saveAnnouncement (admin/announcements.cjs) and saveLiveUpdate (admin/liveUpdates.cjs).
    'announcements/announcement-1': {
      message: 'Lunch is served.', level: 'info', startsAt: AT, endsAt: AT, link: null, createdAt: AT, updatedAt: AT,
    },
    'live_updates/live-1': {
      message: 'Room change for the panel.', pinned: false, category: null, audience: 'everyone', postedAt: AT, updatedAt: AT,
    },

    // storeAsset (media/upload.cjs): the uploader's address and account id.
    'media_assets/asset-1': {
      path: 'cms-images/asset-1/hero.jpg', folder: 'cms-images', filename: 'hero.jpg', contentType: 'image/jpeg', size: 2048,
      alt: 'The hall', title: 'Hall', uploadedBy: STAFF, uploadedByUid: STAFF_UID,
      createdAt: AT, updatedAt: AT, updatedBy: STAFF,
    },

    // createMaterial (materials/store.cjs): a speaker's file upload and a
    // staff member's link.
    'session_materials/material-file': {
      sessionId: 'session-keynote', type: 'file', url: null,
      storagePath: 'session-materials/session-keynote/obj-1', filename: 'slides.pdf', reviewStatus: 'approved',
      submittedBySpeakerId: 'speaker-ada', createdBy: 'uid-ada', createdAt: AT, updatedAt: AT, managedStorageObject: true,
    },
    'session_materials/material-link': {
      sessionId: 'session-panel', type: 'link', url: 'https://example.org/data', storagePath: null, filename: 'Dataset',
      reviewStatus: 'pending', submittedBySpeakerId: null, createdBy: STAFF_UID, createdAt: AT, updatedAt: AT,
    },

    // users: buildNewUserDoc (users/lifecycle.cjs), then the profile flow,
    // entitlement (approvalSource 'ticket'), the invite acceptance
    // (speakerId) and updateAttendee (pastAttendance).
    'users/uid-ada': {
      uid: 'uid-ada', email: 'ada@example.com', displayName: 'Ada Quill', pronouns: 'PRIVATE-pronouns', bio: 'PRIVATE-bio',
      organization: '-1+2', jobTitle: 'Editor', photoPath: 'profile-photos/uid-ada/photo.jpg', socialHandles: {},
      badges: ['writer'], profileVisibility: 'public', profileComplete: true,
      registrationStatus: 'ticketed', approvalSource: 'ticket', speakerId: 'speaker-ada', role: 'attendee',
      createdAt: AT, updatedAt: AT,
    },
    'users/uid-cy': {
      uid: 'uid-cy', email: 'cy@example.com', displayName: 'Cy Park', pronouns: '', bio: '',
      organization: 'Weekly', jobTitle: '', photoPath: null, socialHandles: {}, badges: [],
      profileVisibility: 'attendees_only', profileComplete: false, pastAttendance: ['2025'],
      registrationStatus: 'approved', approvalSource: 'admin', speakerId: null, role: 'attendee',
      createdAt: AT, updatedAt: AT,
    },

    // A Stripe order: created by ticketing/stripeCheckout.cjs, then paid
    // and reconciled by ticketing/stripeReconcile.cjs, which also writes
    // one tickets document per seat under the seat's externalId.
    'ticket_orders/ord_fixture1': {
      id: 'ord_fixture1', orderId: 'ord_fixture1', provider: 'stripe',
      eventId: 'evt-fixture', stripeAccountId: 'acct_1FixtureAccount', livemode: false,
      attemptId: 'att_fixture', source: 'checkout', purchaserUid: 'uid-ada', purchaserEmail: 'ada@example.com',
      requestFingerprint: FINGERPRINT, catalogRevision: 3, currency: 'usd', currencyExponent: 2,
      lines: [{ ticketTypeId: 'general', ticketClass: 'General', name: 'General', quantity: 2, unitAmount: 2500, lineAmount: 5000 }],
      subtotalAmount: 5000, totalAmount: 5000, taxAmount: 0, discountAmount: 0, feeAmount: 0,
      taxTreatment: 'not_collected', refundPolicy: 'Refunds until a week before the event.',
      seats: [
        { externalId: 'ord_fixture1_0_0', ticketTypeId: 'general', ticketClass: 'General', lineIndex: 0, seatIndex: 0, firstName: 'Ada', lastName: 'Quill', email: 'ada@example.com' },
        { externalId: 'ord_fixture1_0_1', ticketTypeId: 'general', ticketClass: 'General', lineIndex: 0, seatIndex: 1, firstName: '=Cy', lastName: 'Park', email: 'cy@example.com' },
      ],
      ticketIds: ['ord_fixture1_0_0', 'ord_fixture1_0_1'],
      status: 'paid', paymentStatus: 'succeeded', inventoryState: 'sold',
      stripeSessionId: 'cs_test_fixture', stripePaymentIntentId: 'pi_fixture', stripeChargeId: 'ch_fixture',
      checkoutUrl: 'https://checkout.example.com/cs_test_fixture', expiresAt: '2026-03-27T14:30:00.000Z',
      refundStatus: 'none', refundedAmount: 0, refunds: [], disputes: [], reconciliationException: null,
      reconciliationLease: null, paidAt: AT, reconciledAt: AT, createdAt: AT, updatedAt: AT,
    },
    'tickets/ord_fixture1_0_0': {
      externalId: 'ord_fixture1_0_0', orderId: 'ord_fixture1', provider: 'stripe', eventId: 'evt-fixture', source: 'checkout',
      ticketTypeId: 'general', ticketClass: 'General', quantity: 1, email: 'ada@example.com', firstName: 'Ada', lastName: 'Quill',
      status: 'valid', claimedByUid: 'uid-ada', claimedAt: AT, claimPromptSentAt: null,
      purchasedAt: '2026-03-27T14:00:00.000Z', createdAt: AT, updatedAt: AT,
    },
    'tickets/ord_fixture1_0_1': {
      externalId: 'ord_fixture1_0_1', orderId: 'ord_fixture1', provider: 'stripe', eventId: 'evt-fixture', source: 'checkout',
      ticketTypeId: 'general', ticketClass: 'General', quantity: 1, email: 'cy@example.com', firstName: '=Cy', lastName: 'Park',
      status: 'valid', claimedByUid: 'uid-cy', claimedAt: AT, claimPromptSentAt: AT,
      purchasedAt: '2026-03-27T14:00:00.000Z', checkedInAt: AT, checkedInByUid: STAFF_UID, createdAt: AT, updatedAt: AT,
    },
    // An admission synced from an external source (ticketing/sync.cjs
    // normalizeTicket and upsertTicket), with the provider's raw record.
    'tickets/eb-ticket-7': {
      externalId: 'eb-ticket-7', orderId: 'eb-order-3', email: 'dee@example.com', firstName: 'Dee', lastName: 'Lowe',
      ticketClass: 'General', quantity: 1, purchasedAt: '2026-03-01T10:00:00.000Z', status: 'valid', provider: 'eventbrite',
      raw: { id: 'eb-ticket-7', barcodes: [{ barcode: 'SECRET-barcode' }] },
      claimedByUid: null, claimedAt: null, claimPromptSentAt: null, createdAt: AT, updatedAt: AT,
    },
    // saveCatalog (ticketing/commerceAdmin.cjs): the validated catalog, its
    // revision, and the operator's account id.
    'ticket_catalog/current': {
      schemaVersion: 1, revision: 3, published: true, salesPaused: false, commercialTermsConfirmed: true,
      currency: 'usd', capacity: 200, maxPerOrder: 10, refundPolicy: 'Refunds until a week before the event.',
      taxTreatment: 'not_collected', salesStartAt: null, salesEndAt: null,
      ticketTypes: [{
        id: 'general', name: 'General', description: '', unitAmount: 2500, capacity: 200, active: true,
        visibility: 'public', minPerOrder: 1, maxPerOrder: 10, salesStartAt: null, salesEndAt: null,
      }],
      updatedAt: AT, updatedBy: OPERATOR_UID,
    },

    // invoiceAdmin (admin/invoices.cjs): saveDraft, then issue, which
    // assigns the number and copies the issuer block, then markPaid. The
    // second was issued and then voided by an operator.
    'invoices/inv_fixture0000000000000001': {
      billTo: { organizationId: 'org-ledger', name: '=Ledger Press', contactName: 'Ada Quill', email: 'billing@example.com', address: '1 Main Street\nExample Town' },
      reference: 'PO-1', dueDate: '2026-04-30', notes: 'Thank you.',
      lines: [{ description: 'Presenting package', quantity: 1, unitAmount: 500000, amount: 500000 }],
      adjustments: [{ kind: 'tax', label: 'Sales tax', amount: 25000 }],
      totals: { subtotal: 500000, discountTotal: 0, taxTotal: 25000, total: 525000 },
      status: 'paid', number: 'INV-0001', sequence: 1, currency: 'usd', issueDate: '2026-03-27',
      issuer: { name: 'Example Events', address: '2 High Street', email: 'events@example.com', taxId: 'TAX-1', paymentInstructions: 'Pay by bank transfer to account 000000.' },
      issuedAt: AT, issuedBy: STAFF_UID,
      payment: { paidOn: '2026-04-02', method: 'bank-transfer', note: 'Ref 42', recordedAt: AT, recordedBy: STAFF_UID },
      // reopen (operator) moved a bounced check here before the transfer came.
      paymentHistory: [{ paidOn: '2026-03-30', method: 'check', note: 'Check 1042', recordedAt: AT, recordedBy: STAFF_UID, reopenedAt: AT, reopenedBy: OPERATOR_UID, reason: 'Check bounced' }],
      // The record send (invoiceAdmin, part 4) keeps of each email of the PDF.
      sends: [{ sendId: 'send-fixture-0001', status: 'sent', to: 'billing@example.com', cc: null, by: STAFF_UID, at: AT, sentAt: AT, providerMessageId: 'pm-fixture-1', note: true, resend: false }],
      revision: 5, createdAt: AT, createdBy: STAFF_UID, updatedAt: AT, updatedBy: STAFF_UID,
      listKey: '2026-03-27T14:00:00.000Z|inv_fixture0000000000000001',
    },
    'invoices/inv_fixture0000000000000002': {
      billTo: { organizationId: null, name: 'Gazette', contactName: '', email: '', address: '' },
      reference: '', dueDate: null, notes: '',
      lines: [{ description: 'Exhibit table', quantity: 2, unitAmount: 15000, amount: 30000 }],
      adjustments: [],
      totals: { subtotal: 30000, discountTotal: 0, taxTotal: 0, total: 30000 },
      status: 'void', number: 'INV-0002', sequence: 2, currency: 'usd', issueDate: '2026-03-27',
      issuer: { name: 'Example Events', address: '2 High Street', email: 'events@example.com', taxId: 'TAX-1', paymentInstructions: 'Pay by bank transfer to account 000000.' },
      issuedAt: AT, issuedBy: STAFF_UID,
      voided: { reason: 'Wrong amount', from: 'issued', at: AT, by: OPERATOR_UID },
      // The Stripe pay link (#519) the void closed, and the card payment
      // that came through it anyway, flagged for the operator.
      payLinks: [{
        linkId: 'pl_fixture00000000000000001', status: 'paid', sessionId: 'cs_test_fixture1', url: 'https://checkout.stripe.com/c/pay/cs_test_fixture1',
        amount: 30000, currency: 'usd', livemode: false, createdAt: AT, createdBy: STAFF_UID,
        expiresAt: new Date('2026-03-28T13:00:00.000Z'), closedAt: AT, closedReason: 'void', stripeClosed: false,
      }],
      paymentReviews: [{
        reviewId: 'rv_fixture00000000000000001', code: 'invoice-void', sessionId: 'cs_test_fixture1', paymentIntentId: 'pi_fixture1',
        amount: 30000, currency: 'usd', at: AT, invoiceStatus: 'void', resolved: false,
      }],
      revision: 3, createdAt: AT, createdBy: STAFF_UID, updatedAt: AT, updatedBy: OPERATOR_UID,
      listKey: '2026-03-27T14:00:00.000Z|inv_fixture0000000000000002',
    },
    // The counter issue moves on, and the settings saveSettings writes. The
    // settings hold the live bank details and never leave the deployment.
    'invoice_counters/current': { lastNumber: 2, lastInvoiceId: 'inv_fixture0000000000000002', updatedAt: AT },
    'invoice_settings/current': {
      prefix: 'INV', currency: '', issuerName: 'Example Events', issuerAddress: '2 High Street', issuerEmail: 'events@example.com',
      taxId: 'TAX-1', paymentInstructions: 'SECRET-bank-details', revision: 1, updatedAt: AT, updatedBy: OPERATOR_UID,
    },

    // The shape submitSessionPitch creates, reviewSessionPitch updates, and
    // convertSessionPitch (sessions/pitchQueue.cjs) completes: the stored
    // `conversion` names the draft session and speaker it created.
    'session_pitches/pitch-1': {
      title: 'Local data desks', description: 'How small rooms share data.', organization: 'Weekly', format: 'Panel',
      consent: { version: 'session-pitch-review-v1', at: AT }, uid: 'uid-cy', email: 'cy@example.com',
      status: 'accepted', reviewRevision: 3, privateNotes: 'PRIVATE-staff-note', createdAt: AT, reviewedAt: AT,
      reviewedBy: STAFF, conversion: { sessionId: 'pitch-pitch-1', speakerId: 'pitch-pitch-1', revision: 3 },
      convertedAt: AT, convertedBy: STAFF,
    },

    // Collections a package never reads, in their writers' shapes.
    'admin_logs/log-1': { action: 'reviewSessionPitch', docPath: 'session_pitches/pitch-1', uid: STAFF_UID, email: STAFF, at: AT, details: { note: 'PRIVATE-audit' } },
    'auth_challenges/challenge-1': { kind: 'otp', email: 'ada@example.com', codeHash: 'SECRET-code-hash', attempts: 0, createdAt: AT },
    [`speaker_invites/${INVITE_HASH}`]: {
      speakerId: 'speaker-bo', email: 'bo@example.com', inviteType: 'speaker', status: 'pending', expiresAt: AT, createdAt: AT, createdBy: STAFF,
    },
    'sent_emails/mail-1': { to: 'ada@example.com', from: 'hello@example.com', subject: 'SECRET-mail-subject', status: 'sent', createdAt: AT },
    'ticket_webhook_deliveries/delivery-1': { provider: 'stripe', body: 'SECRET-webhook-body', receivedAt: AT },
    'ticket_sync_queue/ord_fixture1': { orderId: 'ord_fixture1', payload: 'SECRET-queue', createdAt: AT },
    'ticket_payment_attempts/att_fixture': {
      id: 'att_fixture', orderId: 'ord_fixture1', purchaserUid: 'uid-ada', state: 'succeeded',
      idempotencyKey: 'eventrunner:att_fixture', stripeRequest: { customer_email: 'SECRET-request' }, createdAt: AT, updatedAt: AT,
    },
    'feedback/feedback-1': { message: 'PRIVATE-feedback', category: 'general', createdAt: AT },
  };
}

module.exports = {
  ADMIN, STAFF, STAFF_UID, OPERATOR_UID, BOOTSTRAP_DOC, AT, FORBIDDEN, FORBIDDEN_VALUES, INVITE_HASH, exportSeed,
};
