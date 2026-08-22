'use strict';

/**
 * The `manual`/CSV ticketing provider (spec §3.3, §3.5; issue #31).
 *
 * There is no external ticketing platform behind this adapter. Its ticket
 * data lives entirely in `tickets/{externalId}` (§4.2, `provider: 'manual'`
 * rows) — an admin uploads a CSV through `ticketingImportCsv`
 * (../csvImport.cjs), which upserts rows into that collection through the
 * SAME `upsertTickets` helper sync.cjs uses for every other provider. This
 * adapter therefore has no store of its own to maintain; it reads the one
 * collection the rest of the system already reads and writes.
 *
 * Unlike `eventbrite`, `manual` needs a Firestore handle to answer
 * `listTickets`/`lookupByOrderNumber`/`fetchOrder` — so, breaking with the
 * `{ env, fetchImpl }` shape those two use, this factory also takes `db`
 * (and `getConfig`, for §3.5). Nothing here imports firebase-admin directly
 * (core/firestore.cjs's job); the registry (providers/index.cjs) is what
 * threads `db`/`getConfig` from the caller into the factory.
 *
 *   • verifyWebhook   → `{ valid: false, reason: 'no webhook' }` (§3.3):
 *     there is no webhook to verify, ever — capability-gated provisioning
 *     (`registerWebhook` absent) skips registration entirely.
 *   • listTickets     → `tickets/{externalId}` where `provider == 'manual'`,
 *     paginated by document id. A full sync (`ticketingSync`) walking this
 *     provider is therefore a no-op confirmation, never a duplicate import.
 *   • lookupByOrderNumber → exact match on `orderId` among manual tickets
 *     (§3.3: "returns lookupByOrderNumber as an exact match on imported
 *     rows").
 *   • fetchOrder      → the manual tickets for one orderId. `complete` is
 *     always `true`: a CSV row is either imported or it is not, and there
 *     is no eventually-consistent read to wait out. §3.3's retry queue
 *     exists for a different problem — an order a webhook announced before
 *     the provider's own API could serve it — which cannot happen here,
 *     because there is no webhook and no provider API.
 *   • getRegistrationPrompt → §3.5's `manual` row, implemented in full: an
 *     unticketed new signup is pointed at the client's own registration
 *     form when `config/event.registration.externalUrl` is set, or told an
 *     organizer will confirm them when it is not; an unclaimed ticket gets
 *     the claim prompt, same shape as every other provider. The claim
 *     page's URL is left null here — no such page exists yet (issue #33
 *     builds the self-service claim UI `ticketingVerifyOrder` backs); the
 *     template renders no CTA button when `ctaUrl` is null (§6.2), which is
 *     the correct degraded state until that page ships.
 */

const TICKETS = 'tickets';
const PROVIDER_NAME = 'manual';

/** Ticket rows one `listTickets()` page returns. Bounds a full sync's read cost. */
const LIST_PAGE_SIZE = 200;

/** @param {FirebaseFirestore.QueryDocumentSnapshot} doc @returns {object} TicketRecord (§3.3) */
function ticketRecordFromDoc(doc) {
  const data = doc.data() || {};
  return {
    externalId: doc.id,
    orderId: typeof data.orderId === 'string' ? data.orderId : null,
    email: typeof data.email === 'string' ? data.email : null,
    firstName: typeof data.firstName === 'string' ? data.firstName : null,
    lastName: typeof data.lastName === 'string' ? data.lastName : null,
    ticketClass: typeof data.ticketClass === 'string' ? data.ticketClass : null,
    quantity: Number.isInteger(data.quantity) && data.quantity > 0 ? data.quantity : 1,
    purchasedAt: typeof data.purchasedAt === 'string' ? data.purchasedAt : null,
    status: typeof data.status === 'string' ? data.status : 'pending_info',
    raw: data.raw && typeof data.raw === 'object' ? data.raw : null,
  };
}

/**
 * @param {{ env?: Record<string, string|undefined>, db?: object,
 *           getConfig?: () => Promise<object> }} [deps]
 * @returns {object} TicketingProvider (spec §3.3)
 */
function createManualProvider({ env = process.env, db = null, getConfig = null } = {}) {
  const externalEventId = typeof env.EVENT_TICKETING_EVENT_ID === 'string' &&
    env.EVENT_TICKETING_EVENT_ID.trim().length > 0
    ? env.EVENT_TICKETING_EVENT_ID.trim()
    : null;

  /** @returns {FirebaseFirestore.CollectionReference} */
  function ticketsCollection() {
    if (!db) {
      // A configuration bug, not a runtime one — every deployable path
      // (buildTicketingDeps) supplies db. Failing loudly here beats a
      // TypeError three calls deep.
      throw new Error('ticketing provider "manual" was constructed without a db handle');
    }
    return db.collection(TICKETS);
  }

  return {
    name: PROVIDER_NAME,
    externalEventId,

    /** @returns {Promise<object>} WebhookVerification */
    async verifyWebhook() {
      // deliveryId is part of the shape even on the refusal path; an empty
      // string is honest — there is no delivery, ever (§3.3).
      return { valid: false, deliveryId: '', eventType: 'unknown', resourceId: null, reason: 'no webhook' };
    },

    /** @param {string} orderId */
    async fetchOrder(orderId) {
      const id = typeof orderId === 'string' ? orderId.trim() : '';
      if (!id) return { orderId: id, externalEventId, tickets: [], complete: true };
      const snap = await ticketsCollection()
        .where('provider', '==', PROVIDER_NAME)
        .where('orderId', '==', id)
        .get();
      return {
        orderId: id,
        externalEventId,
        tickets: snap.docs.map(ticketRecordFromDoc),
        // Always complete: a CSV import either wrote the row or it did not.
        // There is no placeholder-attendee state to retry (see module doc).
        complete: true,
      };
    },

    /**
     * Paginated by `createdAt` — a real field on every `tickets/{externalId}`
     * row (§4.2), and one both the real SDK and the in-memory test fake
     * (cms/firestoreFake.cjs) can order and `startAfter()` on. The page
     * token is the last row's `createdAt` as an ISO string; an unparsable
     * or absent token is treated as "start from the first page" rather than
     * thrown on, since a caller round-tripping a stale/garbled token should
     * degrade to a fresh sync, not fail one.
     *
     * @param {{ since?: string, pageToken?: string }} [opts]
     */
    async listTickets(opts = {}) {
      let query = ticketsCollection()
        .where('provider', '==', PROVIDER_NAME)
        .orderBy('createdAt')
        .limit(LIST_PAGE_SIZE);
      const pageToken = typeof opts?.pageToken === 'string' ? opts.pageToken.trim() : '';
      const cursor = pageToken ? new Date(pageToken) : null;
      if (cursor && !Number.isNaN(cursor.getTime())) query = query.startAfter(cursor);
      const snap = await query.get();
      const tickets = snap.docs.map(ticketRecordFromDoc);
      let nextPageToken = null;
      if (snap.docs.length === LIST_PAGE_SIZE) {
        const last = snap.docs[snap.docs.length - 1].data() || {};
        const createdAt = last.createdAt instanceof Date
          ? last.createdAt
          : (typeof last.createdAt?.toDate === 'function' ? last.createdAt.toDate() : null);
        nextPageToken = createdAt ? createdAt.toISOString() : null;
      }
      return { tickets, nextPageToken };
    },

    /** @param {string} orderNumber @returns {Promise<object[]|null>} */
    async lookupByOrderNumber(orderNumber) {
      const id = typeof orderNumber === 'string' ? orderNumber.trim() : '';
      if (!id) return null;
      const snap = await ticketsCollection()
        .where('provider', '==', PROVIDER_NAME)
        .where('orderId', '==', id)
        .get();
      if (snap.empty) return null;
      return snap.docs.map(ticketRecordFromDoc);
    },

    // No registerWebhook: capability, not enablement, is the gate (§3.3) —
    // manual never has a webhook to register, and §8.2 never binds
    // TICKETING_WEBHOOK_SECRET for it.

    /** @param {object} ctx RegistrationPromptContext (§3.5) @returns {Promise<object>} */
    async getRegistrationPrompt(ctx = {}) {
      const suppressed = {
        send: false, templateId: null, ctaLabel: null, ctaUrl: null, action: null, bodyNote: null,
      };
      // Universal skip, every provider (§3.5): a speaker or an already-
      // claimed-ticket user is never told to go get one.
      if (ctx?.isSpeaker === true || ctx?.hasClaimedTicket === true) return suppressed;

      if (ctx?.trigger === 'ticket_unclaimed') {
        return {
          send: true,
          templateId: 'ticket.claim_prompt',
          ctaLabel: 'Claim your ticket',
          // No claim page exists yet (issue #33). The template omits the
          // CTA button entirely when ctaUrl is null (§6.2) — the correct
          // degraded rendering until that page ships.
          ctaUrl: null,
          action: 'claim',
          bodyNote: null,
        };
      }

      // trigger === 'account_created' (or unset, treated the same as the
      // common case §3.5's table describes).
      const config = typeof getConfig === 'function' ? await getConfig() : null;
      const externalUrl = typeof config?.event?.registration?.externalUrl === 'string'
        ? config.event.registration.externalUrl.trim()
        : '';

      if (externalUrl) {
        // "some clients register through their own form" (§3.5) — the same
        // shape eventbrite's no-ticket row uses, pointed at the client's
        // own external registration URL instead of a ticket checkout.
        return {
          send: true,
          templateId: 'ticket.get_ticket',
          ctaLabel: 'Register for the event',
          ctaUrl: externalUrl,
          action: 'purchase',
          bodyNote: null,
        };
      }

      return {
        send: true,
        templateId: 'ticket.get_ticket',
        ctaLabel: 'Contact the organizers',
        ctaUrl: null,
        action: 'await_approval',
        bodyNote: 'An organizer will confirm your registration.',
      };
    },
  };
}

module.exports = { createManualProvider, internals: { TICKETS, PROVIDER_NAME, LIST_PAGE_SIZE, ticketRecordFromDoc } };
