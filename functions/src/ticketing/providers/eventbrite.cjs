'use strict';

/**
 * The `eventbrite` ticketing provider (spec §3.3, §3.5; issue #30).
 *
 * "Provider #1 behind the seam, carrying the hard-won operational lessons":
 * webhook delivery is a thin notification ("something changed on order
 * N") and the authoritative read is always a follow-up call to the
 * Eventbrite REST API (v3), which is eventually consistent immediately
 * after `order.placed` — the exact reason `fetchOrder().complete` exists
 * and why `sync.cjs` retries instead of trusting the webhook body.
 *
 * ============================================================================
 * JUDGMENT CALLS — Eventbrite's public API/webhook documentation does not
 * fully specify several of the shapes this adapter depends on. Each is
 * marked here AND in `__fixtures__/README.md`, tracked for operator
 * verification against a real sandbox under issue #79. Nothing below is
 * guessed silently; every gap has an explicit, defensible choice:
 *
 * 1. WEBHOOK SIGNING. Eventbrite's classic webhook delivery is not
 *    documented as carrying a payload signature (unlike, say, Stripe) —
 *    the ADR's own §3.1 makes the same observation about Postmark's
 *    delivery webhooks and resolves it with a shared secret rather than
 *    an HMAC. This adapter was specified to implement "HMAC over payload
 *    with the webhook secret, constant-time compare", so that is what is
 *    built: an `X-Eventbrite-Signature` header carrying
 *    hex(HMAC-SHA256(TICKETING_WEBHOOK_SECRET, rawBody)), checked the same
 *    way `email/providers/postmark.cjs` and `ticketingFake.cjs` compare
 *    secrets (SHA-256 digest + `timingSafeEqual`, so a length mismatch
 *    never short-circuits the comparison). If a real sandbox run (#79)
 *    shows Eventbrite delivers no such header, the fallback is the same
 *    shared-secret-in-URL trick §3.1 uses for Postmark.
 * 2. DELIVERY ID. Eventbrite's webhook payload carries no per-delivery
 *    identifier. The dedup key `ticket_webhook_deliveries/{deliveryId}`
 *    (§3.3 step 2) needs one, so this adapter derives it as
 *    `sha256(rawBody)` — a byte-identical retry of the same notification
 *    collapses (the intended dedup behavior), while a distinct
 *    notification about the same order (different bytes) gets its own id
 *    and is processed, collapsing onto the same `orderId` queue row per
 *    §3.3's "not a collision" note.
 * 3. RESOURCE URL SHAPE. `api_url` is documented to reference the changed
 *    resource, but real Eventbrite deliveries reportedly vary the
 *    resource kind by action (order resource for `order.*`, attendee
 *    resource for `attendee.*`, which does not itself carry an order id
 *    in its path). Since `ticket_sync_queue` is keyed by `orderId` (§3.3
 *    step 2) and every actionable webhook must resolve one, this adapter
 *    expects `api_url` to always resolve the ORDER resource path
 *    `/v3/events/{eventId}/orders/{orderId}/`, for every actionable
 *    action including `attendee.updated`. This is the single most
 *    load-bearing synthetic-fixture assumption; #79 must confirm it.
 * 4. `order.refunded` FOLDING. The ADR's `WebhookVerification.eventType`
 *    enum is `'order.placed' | 'order.updated' | 'attendee.updated' |
 *    'unknown'` — there is no `order.refunded` slot, though Eventbrite
 *    documents that action. It is folded into `'order.updated'`: a
 *    refund is a change to the order, the re-fetch picks up the refunded
 *    ticket status from `fetchOrder()`, and the entitlement recompute
 *    (§3.4) reacts to the resulting ticket status change regardless of
 *    which literal webhook action carried the news.
 * 5. "COMPLETE" SIGNAL. Eventbrite does not document a boolean flag
 *    meaning "this order's attendee data has finished propagating". This
 *    adapter treats the ORDER RESPONSE ITSELF as the signal: `attendees`
 *    present as an array (even empty, e.g. a fully-refunded order) means
 *    the expansion resolved; `attendees` absent/undefined means the
 *    expansion has not hydrated yet. Getting this wrong costs at most a
 *    few extra 2-minute retries (safe direction) or an eventual
 *    exhausted-row operator alert (visible direction) — never a silent
 *    drop, which is the one failure mode §3.3 was written to remove.
 * 6. WEBHOOK REGISTRATION SCOPE. Eventbrite webhooks are created under an
 *    ORGANIZATION, not an event, and creation needs an organization id
 *    that the deploy-time env (spec §2.1) does not carry. `registerWebhook`
 *    discovers it via `GET /v3/users/me/organizations/` and uses the
 *    first organization returned — correct for the single-org-per-token
 *    case every deployment here is expected to be, but unverified against
 *    a real multi-org account (#79).
 * ============================================================================
 */

const crypto = require('node:crypto');

const API_BASE = 'https://www.eventbriteapi.com/v3';

/** Header carrying the HMAC signature (judgment call 1, above). */
const SIGNATURE_HEADER = 'x-eventbrite-signature';

/** Eventbrite webhook `config.action` values this adapter knows how to fold. */
const ACTION_TO_EVENT_TYPE = Object.freeze({
  'order.placed': 'order.placed',
  'order.updated': 'order.updated',
  // Judgment call 4: no dedicated slot in the ADR's eventType enum — a
  // refund is a change to the order, so it folds into order.updated.
  'order.refunded': 'order.updated',
  'attendee.updated': 'attendee.updated',
});

/**
 * Matches the order resource inside `api_url` (judgment call 3). Eventbrite
 * ids are typically numeric, but the segment match is intentionally not
 * restricted to digits — a synthetic or sandbox id shaped like `evt-1` must
 * parse the same way a real numeric id does.
 */
const ORDER_API_URL_RE = /\/events\/([^/]+)\/orders\/([^/?]+)\/?(?:\?.*)?$/;

/**
 * Constant-time string equality via SHA-256 digests, so a length mismatch
 * never short-circuits `timingSafeEqual`'s precondition. Same shape as
 * `email/providers/postmark.cjs` and `ticketingFake.cjs`.
 * @param {string} a @param {string} b
 */
function safeEqual(a, b) {
  const da = crypto.createHash('sha256').update(String(a), 'utf8').digest();
  const db = crypto.createHash('sha256').update(String(b), 'utf8').digest();
  return crypto.timingSafeEqual(da, db);
}

/** Case-insensitive header lookup. @param {Record<string,string>} headers @param {string} name */
function header(headers, name) {
  if (!headers) return undefined;
  if (name in headers) return headers[name];
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key];
  }
  return undefined;
}

/** @param {string} secret @param {Buffer} rawBody @returns {string} hex HMAC-SHA256 */
function signBody(secret, rawBody) {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

/** @param {Buffer} rawBody @returns {string} a content-derived delivery id (judgment call 2) */
function deliveryIdFor(rawBody) {
  return crypto.createHash('sha256').update(rawBody).digest('hex');
}

/**
 * @param {{ env?: Record<string, string|undefined>, fetchImpl?: typeof fetch,
 *           getConfig?: () => Promise<object> }} [deps]
 * @returns {object} TicketingProvider (spec §3.3)
 */
function createEventbriteProvider({ env = process.env, fetchImpl = globalThis.fetch, getConfig = null } = {}) {
  const apiToken = env.TICKETING_API_TOKEN;
  if (!apiToken) {
    throw new Error('ticketing provider "eventbrite" requires TICKETING_API_TOKEN');
  }
  const webhookSecret = env.TICKETING_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error('ticketing provider "eventbrite" requires TICKETING_WEBHOOK_SECRET');
  }
  const externalEventId = typeof env.EVENT_TICKETING_EVENT_ID === 'string' &&
    env.EVENT_TICKETING_EVENT_ID.trim().length > 0
    ? env.EVENT_TICKETING_EVENT_ID.trim()
    : null;

  /**
   * GET/POST the Eventbrite v3 API. Throws a descriptive Error on any
   * non-2xx (mirrors postmark.cjs: a throw is what drains the sync queue's
   * retry path in sync.cjs — never silently swallowed). Returns null only
   * for a 404, which callers treat as "no such resource" rather than a
   * transient failure.
   *
   * @param {string} path leading slash, appended to API_BASE
   * @param {{ method?: string, body?: object }} [opts]
   */
  async function apiCall(path, { method = 'GET', body } = {}) {
    const response = await fetchImpl(`${API_BASE}${path}`, {
      method,
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Accept': 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (response.status === 404) return null;
    let parsed = null;
    try {
      parsed = await response.json();
    } catch {
      // A non-JSON body on a non-2xx (proxy error page etc) — handled below.
    }
    if (response.status < 200 || response.status > 299) {
      const detail = parsed?.error_description || parsed?.error || `eventbrite responded ${response.status}`;
      throw new Error(`eventbrite API ${method} ${path} failed: ${detail}`);
    }
    return parsed;
  }

  /**
   * One Eventbrite attendee object → TicketRecord (§3.3). Returns null for
   * an attendee with no usable id — sync.cjs's normalizeTicket would drop
   * it anyway, but skipping here avoids fabricating a partial record.
   * @param {object} attendee @param {string} orderId @param {string} purchasedAt
   */
  function ticketRecordFromAttendee(attendee, orderId, purchasedAt) {
    const externalId = attendee?.id != null ? String(attendee.id) : null;
    if (!externalId) return null;
    const profile = attendee?.profile || {};
    // Judgment call: Eventbrite's Attendee resource documents a boolean
    // `refunded` field alongside `status` ('Attending' | 'Not Attending' |
    // ...). `refunded` wins when present; otherwise status carries it.
    // Anything unrecognized is left as-is — sync.cjs's normalizeTicket
    // coerces an unrecognized status string to 'pending_info', which is
    // the correct "we don't know yet" bucket (§3.3) rather than a guess
    // made twice in two files.
    let status;
    if (attendee?.refunded === true) status = 'refunded';
    else if (attendee?.status === 'Attending') status = 'valid';
    else if (attendee?.status === 'Not Attending' || attendee?.status === 'Deleted') status = 'cancelled';
    else status = attendee?.status;
    return {
      externalId,
      orderId: attendee?.order_id != null ? String(attendee.order_id) : orderId,
      email: typeof profile.email === 'string' ? profile.email : null,
      firstName: typeof profile.first_name === 'string' ? profile.first_name : null,
      lastName: typeof profile.last_name === 'string' ? profile.last_name : null,
      ticketClass: typeof attendee?.ticket_class_name === 'string' ? attendee.ticket_class_name : null,
      // Eventbrite's Attendee resource is one row per ticket, not per
      // order — quantity is always 1 at this level (§3.3 TicketRecord).
      quantity: 1,
      purchasedAt,
      status,
      raw: attendee || null,
    };
  }

  /**
   * Fetch one order and expand it into TicketRecord[]. Shared by
   * `fetchOrder` and `listTickets`'s order-expansion path.
   * @param {object} order raw Eventbrite Order resource
   */
  function ticketsFromOrder(order) {
    const orderId = order?.id != null ? String(order.id) : '';
    const purchasedAt = typeof order?.created === 'string' ? order.created : null;
    const attendees = Array.isArray(order?.attendees) ? order.attendees : [];
    return attendees
      .map((a) => ticketRecordFromAttendee(a, orderId, purchasedAt))
      .filter((t) => t !== null);
  }

  return {
    name: 'eventbrite',
    externalEventId,

    /**
     * @param {Buffer} rawBody @param {Record<string,string>} headers
     * @returns {Promise<object>} WebhookVerification
     */
    async verifyWebhook(rawBody, headers) {
      const provided = header(headers, SIGNATURE_HEADER);
      if (typeof provided !== 'string' || provided.trim().length === 0 ||
          !safeEqual(provided.trim(), signBody(webhookSecret, rawBody))) {
        return { valid: false, deliveryId: '', eventType: 'unknown', resourceId: null, reason: 'invalid_signature' };
      }

      let body;
      try {
        body = JSON.parse(Buffer.from(rawBody).toString('utf8'));
      } catch {
        return { valid: false, deliveryId: '', eventType: 'unknown', resourceId: null, reason: 'malformed' };
      }

      const action = typeof body?.config?.action === 'string' ? body.config.action : null;
      const apiUrl = typeof body?.api_url === 'string' ? body.api_url : '';
      const match = ORDER_API_URL_RE.exec(apiUrl);
      if (!action || !match) {
        return { valid: false, deliveryId: '', eventType: 'unknown', resourceId: null, reason: 'malformed' };
      }

      const [, eventIdFromUrl, orderId] = match;
      const deliveryId = deliveryIdFor(rawBody);
      const eventType = ACTION_TO_EVENT_TYPE[action] || 'unknown';

      // Wrong-event: this deployment's configured event id does not match
      // the delivery's — 200 + ignored, per §3.3 step 1, so Eventbrite
      // stops retrying a misconfigured webhook (e.g. one still pointed at
      // a prior event's callback URL).
      if (externalEventId && eventIdFromUrl !== externalEventId) {
        return { valid: false, deliveryId, eventType, resourceId: orderId, reason: 'wrong_event' };
      }

      return { valid: true, deliveryId, eventType, resourceId: orderId };
    },

    /** @param {string} orderId */
    async fetchOrder(orderId) {
      const id = typeof orderId === 'string' ? orderId.trim() : '';
      if (!id) return { orderId: id, externalEventId, tickets: [], complete: true };

      const order = await apiCall(`/orders/${encodeURIComponent(id)}/?expand=attendees`);
      if (!order) {
        // No such order (404). Nothing to retry toward — an empty,
        // complete result lets the drain delete the queue row rather than
        // spending the attempt budget on a permanently-missing order.
        return { orderId: id, externalEventId, tickets: [], complete: true };
      }

      // Judgment call 5: `attendees` present as an array (even []) means
      // the expansion resolved; absent means Eventbrite has not hydrated
      // it yet — the eventual-consistency signal §3.3 describes.
      const complete = Array.isArray(order.attendees);
      return {
        orderId: id,
        externalEventId: order.event_id != null ? String(order.event_id) : externalEventId,
        tickets: complete ? ticketsFromOrder(order) : [],
        complete,
      };
    },

    /**
     * Paginated bulk sync (§3.3): walks `/events/{id}/orders/?expand=attendees`
     * with Eventbrite's continuation-token pagination, flattening every
     * order's attendees into TicketRecord[] the same way fetchOrder does.
     * `since` maps to Eventbrite's documented `changed_since` order filter.
     *
     * @param {{ since?: string, pageToken?: string }} [opts]
     */
    async listTickets(opts = {}) {
      if (!externalEventId) return { tickets: [], nextPageToken: null };
      const params = new URLSearchParams({ expand: 'attendees' });
      if (typeof opts?.since === 'string' && opts.since.trim()) params.set('changed_since', opts.since.trim());
      if (typeof opts?.pageToken === 'string' && opts.pageToken.trim()) {
        params.set('continuation', opts.pageToken.trim());
      }
      const page = await apiCall(`/events/${encodeURIComponent(externalEventId)}/orders/?${params.toString()}`);
      const orders = Array.isArray(page?.orders) ? page.orders : [];
      const tickets = orders.flatMap((order) => ticketsFromOrder(order));
      const hasMore = page?.pagination?.has_more_items === true;
      const nextPageToken = hasMore && typeof page?.pagination?.continuation === 'string'
        ? page.pagination.continuation
        : null;
      return { tickets, nextPageToken };
    },

    /**
     * Self-service order claim (§3.3): an order number IS the Eventbrite
     * order id, so this is `fetchOrder` plus two safety checks a webhook
     * or admin sync does not need — the claimed email must match the
     * order's buyer, and the order must belong to this deployment's event
     * ("rejects any order.event_id other than the hardcoded one", §3.3).
     *
     * @param {string} orderNumber @param {string} email
     * @returns {Promise<object[]|null>}
     */
    async lookupByOrderNumber(orderNumber, email) {
      const id = typeof orderNumber === 'string' ? orderNumber.trim() : '';
      if (!id) return null;
      const order = await apiCall(`/orders/${encodeURIComponent(id)}/?expand=attendees`);
      if (!order) return null;
      if (externalEventId && order.event_id != null && String(order.event_id) !== externalEventId) return null;
      const claimedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
      const orderEmail = typeof order.email === 'string' ? order.email.trim().toLowerCase() : '';
      if (!claimedEmail || claimedEmail !== orderEmail) return null;
      if (!Array.isArray(order.attendees)) return null;
      return ticketsFromOrder(order);
    },

    /**
     * Create (or find) the org-level webhook subscription (§3.3, §5.6
     * item 5). Idempotent: an existing subscription with the same
     * `endpoint_url` is reused rather than duplicated (judgment call 6
     * covers organization discovery).
     *
     * @param {{ callbackUrl: string, events: string[] }} opts
     * @returns {Promise<{ webhookId: string }>}
     */
    async registerWebhook({ callbackUrl, events }) {
      if (typeof callbackUrl !== 'string' || !callbackUrl.trim()) {
        throw new Error('registerWebhook requires a callbackUrl');
      }
      const orgs = await apiCall('/users/me/organizations/');
      const orgId = orgs?.organizations?.[0]?.id;
      if (!orgId) {
        throw new Error('eventbrite registerWebhook: no organization found for TICKETING_API_TOKEN');
      }

      const existing = await apiCall(`/organizations/${encodeURIComponent(orgId)}/webhooks/`);
      const already = (Array.isArray(existing?.webhooks) ? existing.webhooks : [])
        .find((w) => w?.endpoint_url === callbackUrl);
      if (already?.id != null) {
        return { webhookId: String(already.id) };
      }

      const created = await apiCall(`/organizations/${encodeURIComponent(orgId)}/webhooks/`, {
        method: 'POST',
        body: {
          endpoint_url: callbackUrl,
          actions: Array.isArray(events) && events.length > 0
            ? events.join(',')
            : Object.keys(ACTION_TO_EVENT_TYPE).join(','),
          ...(externalEventId ? { event_id: externalEventId } : {}),
        },
      });
      if (created?.id == null) {
        throw new Error('eventbrite registerWebhook: create response carried no webhook id');
      }
      return { webhookId: String(created.id) };
    },

    /**
     * Registration messaging (§3.5 eventbrite row). `ctaUrl` for the
     * no-ticket case is the client's configured checkout URL
     * (`config/event.registration.externalUrl`); for the unclaimed-ticket
     * case it is left null, same as `manual` — the self-service claim page
     * (issue #33) does not exist yet, and the template renders no CTA
     * button when `ctaUrl` is null (§6.2).
     *
     * @param {object} ctx RegistrationPromptContext (§3.5)
     */
    async getRegistrationPrompt(ctx = {}) {
      const suppressed = {
        send: false, templateId: null, ctaLabel: null, ctaUrl: null, action: null, bodyNote: null,
      };
      if (ctx?.isSpeaker === true || ctx?.hasClaimedTicket === true) return suppressed;

      if (ctx?.trigger === 'ticket_unclaimed') {
        return {
          send: true,
          templateId: 'ticket.claim_prompt',
          ctaLabel: 'Claim your ticket',
          ctaUrl: null,
          action: 'claim',
          bodyNote: null,
        };
      }

      const config = typeof getConfig === 'function' ? await getConfig() : null;
      const externalUrl = typeof config?.event?.registration?.externalUrl === 'string'
        ? config.event.registration.externalUrl.trim()
        : null;
      return {
        send: true,
        templateId: 'ticket.get_ticket',
        ctaLabel: 'Get your ticket',
        ctaUrl: externalUrl || null,
        action: 'purchase',
        bodyNote: null,
      };
    },
  };
}

module.exports = {
  createEventbriteProvider,
  internals: {
    API_BASE,
    SIGNATURE_HEADER,
    ACTION_TO_EVENT_TYPE,
    ORDER_API_URL_RE,
    safeEqual,
    signBody,
    deliveryIdFor,
    header,
  },
};
