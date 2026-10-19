'use strict';

/**
 * A synthetic event for the data export tests (issue #329). Every private
 * document also carries fields that must never leave the deployment, each
 * with a value that starts with SECRET or PRIVATE, so a test can search a
 * whole file for those words. Formula-shaped values sit in the fields a
 * spreadsheet shows first.
 *
 * Every relationship resolves: the package tests prove that the reader
 * finds no dangling reference in a whole event.
 */

const ADMIN = 'admin@example.com';
const STAFF = 'staff@example.com';
const BOOTSTRAP_DOC = Object.freeze({ adminEmails: [ADMIN, 'SECRET-operator@example.com'], staffEmails: [STAFF] });

const AT = new Date('2026-03-27T14:00:00.000Z');

/** The words no exported file may contain. */
const FORBIDDEN = Object.freeze(['SECRET', 'PRIVATE']);

function exportSeed() {
  return {
    'config/bootstrap': BOOTSTRAP_DOC,
    'config/providers': { ticketing: { webhookId: 'SECRET-webhook' }, email: { apiKeyRef: 'SECRET-key' } },
    'config/event': {
      name: 'Sample summit',
      timezone: 'America/New_York',
      days: [{ id: 'day-1', label: 'Main day', date: '2026-03-27' }],
    },
    'config/theme': { preset: 'broadsheet', tokens: { light: {} } },
    'config/features': { sessionPitches: true },
    'config/badges': { categories: [{ id: 'role', badges: [{ id: 'writer', label: 'Writer' }] }] },

    'cmsSchedule/session-keynote': {
      title: '=HYPERLINK("http://example.test","Keynote")',
      dayId: 'day-1', startTime: '09:00', endTime: '10:00', type: 'keynote', track: 'A',
      location: 'Hall', speakerIds: ['speaker-ada'], visible: true, revision: 2,
      publishedBy: 'PRIVATE-staff-uid', updatedBy: 'PRIVATE-staff-uid', materialCount: 1,
      description: 'Opening remarks.',
    },
    'cmsSchedule/session-panel': {
      title: 'Data panel', dayId: 'day-1', startTime: '10:15', endTime: '11:00', type: 'panel',
      speakerIds: ['speaker-ada', 'speaker-bo'], parentId: 'session-keynote', visible: true,
    },
    'cmsSchedule_drafts/session-panel': {
      title: 'Data panel (revised)', dayId: 'day-1', startTime: '10:15', endTime: '11:00', type: 'panel',
      speakerIds: ['speaker-ada', 'speaker-bo'], parentId: 'session-keynote', status: 'dirty',
    },
    'cmsSchedule_drafts/session-draft': {
      title: 'Unpublished workshop', dayId: 'day-1', startTime: '13:00', endTime: '14:00', status: 'draft',
    },

    'speakers/speaker-ada': {
      firstName: 'Ada', lastName: 'Quill', slug: 'ada-quill', email: 'ada@example.com',
      organization: '@Ledger', jobTitle: 'Editor', bio: 'Covers budgets.',
      socialHandles: { mastodon: '@ada@example.social' }, status: 'approved',
      uid: 'SECRET-speaker-uid', inviteToken: 'SECRET-invite-token', acceptedEmail: 'SECRET-accepted@example.com',
      inviteSends: { count: 1 }, pendingEdits: { bio: 'PRIVATE-pending-bio' }, approvedAt: AT,
    },
    'speakers/speaker-bo': {
      firstName: 'Bo', lastName: 'Reyes', slug: 'bo-reyes', email: 'bo@example.com',
      organization: 'Gazette', jobTitle: 'Reporter', status: 'approved', inviteToken: null,
    },

    'cmsOrganizations/org-ledger': {
      name: '+SUM(1,2)', tier: 'Sponsor', url: 'https://example.org/', description: 'A sponsor.',
      logoPath: 'branding/ledger.png', order: 1, visible: true, publishedBy: 'PRIVATE-staff-uid',
    },

    'cmsContent/hero__title': { section: 'hero', field: 'title', value: 'Welcome', visible: true },
    'cmsPages/about': { title: 'About', slug: 'about', blocks: [{ type: 'text', body: '<p>About.</p>' }], visible: true },
    'cmsUpdates/update-1': { title: 'Doors open', body: 'Doors open at eight.', visible: true },
    'cmsTimeline/milestone-1': { title: 'Pitch call opens', date: '2026-01-10', visible: true },
    'announcements/announcement-1': { message: 'Lunch is served.', startsAt: AT, endsAt: AT, createdBy: 'PRIVATE-staff-uid' },
    'live_updates/live-1': { message: 'Room change for the panel.', createdAt: AT },
    'media_assets/asset-1': {
      path: 'media/hero.jpg', folder: 'media', filename: 'hero.jpg', contentType: 'image/jpeg', size: 2048,
      alt: 'The hall', title: 'Hall', uploadedBy: 'PRIVATE-uploader@example.com', uploadedByUid: 'PRIVATE-uploader-uid',
      createdAt: AT, updatedAt: AT, updatedBy: 'PRIVATE-uploader@example.com',
    },

    'session_materials/material-file': {
      sessionId: 'session-keynote', type: 'file', filename: 'slides.pdf', url: null,
      storagePath: 'session-materials/session-keynote/slides.pdf', reviewStatus: 'approved',
      submittedBySpeakerId: 'speaker-ada', createdBy: 'PRIVATE-creator-uid', createdAt: AT, updatedAt: AT,
      managedStorageObject: true,
    },
    'session_materials/material-link': {
      sessionId: 'session-panel', type: 'link', filename: 'Dataset', url: 'https://example.org/data',
      storagePath: null, reviewStatus: 'pending', submittedBySpeakerId: null, createdAt: AT, updatedAt: AT,
    },

    'users/uid-ada': {
      displayName: 'Ada Quill', email: 'ada@example.com', organization: '-1+2', jobTitle: 'Editor',
      registrationStatus: 'ticketed', badges: ['writer'], profileVisibility: 'public', speakerId: 'speaker-ada',
      pronouns: 'PRIVATE-pronouns', bio: 'PRIVATE-bio', approvalSource: 'PRIVATE-source', role: 'PRIVATE-role',
      photoPath: 'profile-photos/uid-ada/PRIVATE.jpg', createdAt: AT,
    },
    'users/uid-cy': {
      displayName: 'Cy Park', email: 'cy@example.com', organization: 'Weekly', registrationStatus: 'approved',
      profileVisibility: 'attendees_only', createdAt: AT,
    },

    'ticket_orders/order-1': {
      id: 'order-1', provider: 'stripe', livemode: false, source: 'checkout', status: 'paid', paymentStatus: 'succeeded',
      purchaserUid: 'uid-ada', purchaserEmail: 'ada@example.com', currency: 'usd', currencyExponent: 2,
      subtotalAmount: 5000, totalAmount: 5000, discountAmount: 0, taxAmount: 0, feeAmount: 0,
      refundStatus: 'none', refundedAmount: 0,
      lines: [{ ticketTypeId: 'general', name: 'General', quantity: 2, unitAmount: 2500, lineAmount: 5000, attendees: [] }],
      ticketIds: ['ticket-1', 'ticket-2'], stripeSessionId: 'cs_SECRET', stripePaymentIntentId: 'pi_SECRET',
      checkoutUrl: 'https://checkout.example/SECRET', requestFingerprint: 'SECRET-fingerprint',
      attemptId: 'SECRET-attempt', createdAt: AT, updatedAt: AT,
    },
    'tickets/ticket-1': {
      externalId: 'ticket-1', orderId: 'order-1', provider: 'stripe', ticketTypeId: 'general', ticketClass: 'General',
      firstName: 'Ada', lastName: 'Quill', email: 'ada@example.com', quantity: 1, status: 'valid',
      claimedByUid: 'uid-ada', claimedAt: AT, raw: { token: 'SECRET-raw-token' }, createdAt: AT,
    },
    'tickets/ticket-2': {
      externalId: 'ticket-2', orderId: 'order-1', provider: 'stripe', ticketTypeId: 'general', ticketClass: 'General',
      firstName: '=Cy', lastName: 'Park', email: 'cy@example.com', quantity: 1, status: 'valid',
      claimedByUid: 'uid-cy', checkedInAt: AT, raw: { payload: 'SECRET-raw' }, createdAt: AT,
    },
    'ticket_catalog/current': {
      currency: 'usd', revision: 3, ticketTypes: [{ id: 'general', name: 'General', unitAmount: 2500 }],
      stripePriceSecret: 'SECRET-catalog', updatedBy: 'PRIVATE-staff-uid',
    },

    'session_pitches/pitch-1': {
      title: 'Local data desks', description: 'How small rooms share data.', organization: 'Weekly', format: 'Panel',
      consent: { version: 'session-pitch-review-v1', at: AT }, uid: 'uid-cy', email: 'cy@example.com',
      status: 'accepted', reviewRevision: 2, privateNotes: 'PRIVATE-staff-note', createdAt: AT, reviewedAt: AT,
      reviewedBy: 'PRIVATE-reviewer-uid', convertedSessionId: 'session-panel',
    },

    // Collections a package never reads.
    'admin_logs/log-1': { action: 'PRIVATE-audit', uid: 'PRIVATE-uid' },
    'auth_challenges/challenge-1': { codeHash: 'SECRET-code' },
    'speaker_invites/hash-1': { speakerId: 'speaker-ada', expiresAt: 'SECRET-expiry' },
    'sent_emails/mail-1': { html: 'SECRET-mail-body' },
    'ticket_webhook_deliveries/delivery-1': { body: 'SECRET-webhook-body' },
    'ticket_sync_queue/order-1': { payload: 'SECRET-queue' },
    'ticket_payment_attempts/attempt-1': { idempotencyKey: 'SECRET-idem' },
    'feedback/feedback-1': { message: 'PRIVATE-feedback' },
  };
}

module.exports = { ADMIN, STAFF, BOOTSTRAP_DOC, AT, FORBIDDEN, exportSeed };
