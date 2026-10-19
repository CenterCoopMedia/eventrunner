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
 * 1. WEBHOOK AUTHENTICATION (#356). Eventbrite's webhook delivery carries
 *    no payload signature, and its webhook API takes no signing secret:
 *    `registerWebhook` can send only `endpoint_url`, `actions`, and
 *    `event_id`. An HMAC check would refuse every real delivery. This
 *    adapter uses the fallback the ADR's §3.1 uses for Postmark: a shared
 *    secret in the registered URL. `TICKETING_WEBHOOK_SECRET` is a random
 *    value the operator generates (at least MIN_WEBHOOK_SECRET_LENGTH
 *    characters). The length is checked where the secret is used, not at
 *    construction, because every ticketing function builds this provider:
 *    a short or missing secret refuses every delivery and stops
 *    `registerWebhook`, and nothing else. `registerWebhook` registers
 *    `<callbackUrl>?token=<secret>`, and `verifyWebhook` compares the
 *    delivery's `token` query parameter with SHA-256 digests and
 *    `timingSafeEqual`, so a length mismatch never short-circuits the
 *    comparison. A missing or wrong secret is refused before the body is
 *    read. An authenticated delivery the adapter cannot act on (bad JSON,
 *    an unknown `api_url` shape or host) is acknowledged and ignored, so
 *    Eventbrite does not retry it. The secret proves only that the caller
 *    knows the URL, so the body is never trusted for ticket data: it
 *    yields an order id from an `api_url` on Eventbrite's own API host,
 *    and `sync.cjs` re-fetches that order from API_BASE with this
 *    deployment's token. Nothing ever fetches the delivered URL itself.
 *    Delivery bodies echo `config.endpoint_url`, secret included, so a
 *    captured body must be sanitized before it is kept anywhere. #79 must
 *    confirm that Eventbrite keeps the query string when it delivers.
 * 2. DELIVERY ID. Eventbrite's webhook payload carries no per-delivery
 *    identifier. The dedup key `ticket_webhook_deliveries/{deliveryId}`
 *    (§3.3 step 2) needs one, so this adapter derives it as
 *    `sha256(rawBody)` — a byte-identical retry of the same notification
 *    collapses (the intended dedup behavior), while a distinct
 *    notification about the same order (different bytes) gets its own id
 *    and is processed, collapsing onto the same `orderId` queue row per
 *    §3.3's "not a collision" note.
 * 3. RESOURCE URL SHAPE. `api_url` references the changed resource, and
 *    the resource kind varies by action. Eventbrite's documentation shows
 *    `/v3/orders/{orderId}/` for `order.*` and
 *    `/v3/events/{eventId}/attendees/{attendeeId}/` for `attendee.*`; the
 *    first synthetic fixtures assumed `/v3/events/{eventId}/orders/{orderId}/`
 *    for every action. `ticket_sync_queue` is keyed by `orderId` (§3.3
 *    step 2), so all three are accepted (API_PATH_SHAPES). The order form
 *    with no event id defers the event check to the sync re-fetch. The
 *    attendee form is mapped to its order by reading the attendee from
 *    API_BASE. Any other shape is acknowledged and ignored. This is the
 *    single most load-bearing synthetic-fixture assumption; #79 must
 *    confirm which shapes real deliveries carry.
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
const { resolveRegistrationAction } = require('shared/registration');

const API_BASE = 'https://www.eventbriteapi.com/v3';

/** The only host an `api_url` may name (judgment call 1, above). */
const API_HOST = new URL(API_BASE).hostname;

/** Query parameter in the registered webhook URL that carries the shared secret (judgment call 1). */
const URL_SECRET_PARAM = 'token';

/**
 * The URL secret is the only authentication on the webhook, so it must
 * resist guessing. 32 characters is `openssl rand -hex 16`; the runbook
 * asks for `openssl rand -hex 32`.
 */
const MIN_WEBHOOK_SECRET_LENGTH = 32;

/** Upper bound on webhook-list pages read by registerWebhook. */
const MAX_WEBHOOK_PAGES = 50;

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
 * Every action registered with Eventbrite (#357). Derived from the map
 * above so an action the adapter handles can never be left out of the
 * registration again — the operator script used to send its own shorter
 * list, and refunds never arrived.
 */
const WEBHOOK_ACTIONS = Object.freeze(Object.keys(ACTION_TO_EVENT_TYPE));

/** @param {unknown} actions Eventbrite's `actions` field: a comma list or an array. @returns {string[]} */
function actionList(actions) {
  if (Array.isArray(actions)) return actions.map((a) => String(a).trim()).filter(Boolean);
  if (typeof actions === 'string') return actions.split(',').map((a) => a.trim()).filter(Boolean);
  return [];
}

/**
 * The `api_url` path shapes this adapter accepts (judgment call 3). The
 * repository's fixtures assumed the first; Eventbrite's own webhook
 * documentation shows the second for `order.*` and the third for
 * `attendee.*`. All three are accepted until #79 confirms what a real
 * delivery carries. Eventbrite ids are typically numeric, but the segment
 * match is intentionally not restricted to digits — a synthetic or sandbox
 * id shaped like `evt-1` must parse the same way a real numeric id does.
 */
const API_PATH_SHAPES = Object.freeze([
  { re: /^\/v3\/events\/([^/]+)\/orders\/([^/]+)\/?$/, of: (m) => ({ kind: 'order', eventId: m[1], orderId: m[2] }) },
  { re: /^\/v3\/orders\/([^/]+)\/?$/, of: (m) => ({ kind: 'order', eventId: null, orderId: m[1] }) },
  { re: /^\/v3\/events\/([^/]+)\/attendees\/([^/]+)\/?$/, of: (m) => ({ kind: 'attendee', eventId: m[1], attendeeId: m[2] }) },
]);

/**
 * The resource a delivered `api_url` names, or null. Only an https URL on
 * Eventbrite's own API host, with no port or credentials, is accepted
 * (#356). The URL is never fetched; the ids are, against API_BASE.
 * @param {unknown} apiUrl
 * @returns {{ kind: 'order', eventId: string|null, orderId: string } |
 *           { kind: 'attendee', eventId: string, attendeeId: string } | null}
 */
function parseApiUrl(apiUrl) {
  if (typeof apiUrl !== 'string') return null;
  let url;
  try {
    url = new URL(apiUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== API_HOST || url.port !== '' ||
      url.username !== '' || url.password !== '') {
    return null;
  }
  for (const shape of API_PATH_SHAPES) {
    const match = shape.re.exec(url.pathname);
    if (match) return shape.of(match);
  }
  return null;
}

/**
 * The URL registered with Eventbrite: the callback with the shared secret
 * in its query (judgment call 1). Throws unless the callback is https.
 * @param {string} callbackUrl @param {string} secret
 */
function endpointUrlFor(callbackUrl, secret) {
  let url;
  try {
    url = new URL(callbackUrl);
  } catch {
    url = null;
  }
  if (!url || url.protocol !== 'https:') {
    throw new Error('registerWebhook requires an https callbackUrl');
  }
  url.searchParams.set(URL_SECRET_PARAM, secret);
  return url.toString();
}

/** The URL secret a stored endpoint carries, or ''. @param {unknown} value */
function tokenOf(value) {
  try {
    return new URL(String(value)).searchParams.get(URL_SECRET_PARAM) || '';
  } catch {
    return '';
  }
}

/** `origin + pathname` of a URL, or '' when it does not parse. @param {unknown} value */
function baseOf(value) {
  try {
    const url = new URL(String(value));
    return `${url.origin}${url.pathname}`;
  } catch {
    return '';
  }
}

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

/** @param {Buffer} rawBody @returns {string} a content-derived delivery id (judgment call 2) */
function deliveryIdFor(rawBody) {
  return crypto.createHash('sha256').update(rawBody).digest('hex');
}

/**
 * The self-service claim page (issue #33): `/ticket/claim`, reserved in
 * `shared/routing` alongside `/speaker/accept`. Same helper as
 * `providers/manual.cjs`'s claimUrl — kept as a small duplicate rather than
 * a shared import, since the two providers otherwise share no code and a
 * one-line URL join is not worth a new module.
 * @param {object|null} config @returns {string|null}
 */
function claimUrl(config) {
  const site = typeof config?.tierA?.publicUrl === 'string' ? config.tierA.publicUrl.replace(/\/+$/, '') : '';
  return site ? `${site}/ticket/claim` : null;
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
  // Checked where it is used, not here. Every ticketing function builds
  // this provider (claim, verify, sync, status), and a short or missing
  // webhook secret must cost webhooks only: verifyWebhook refuses every
  // delivery and registerWebhook throws.
  const webhookSecret = typeof env.TICKETING_WEBHOOK_SECRET === 'string' ? env.TICKETING_WEBHOOK_SECRET : '';
  const webhookSecretUsable = webhookSecret.length >= MIN_WEBHOOK_SECRET_LENGTH;

  /**
   * The registered URL carries the secret, and an Eventbrite error may
   * echo that URL. Every API error message passes through here before it
   * is thrown, so the secret never reaches a log or the operator terminal.
   * @param {string} text
   */
  function redact(text) {
    let out = String(text);
    for (const form of new Set([webhookSecret, encodeURIComponent(webhookSecret)])) {
      if (form) out = out.split(form).join('[redacted]');
    }
    return out;
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
      throw new Error(redact(`eventbrite API ${method} ${path} failed: ${detail}`));
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
    webhookEventTypes: WEBHOOK_ACTIONS,

    /**
     * Authenticates by the URL secret (judgment call 1). Headers carry
     * nothing Eventbrite signs, so they are not read.
     *
     * @param {Buffer} rawBody @param {Record<string,string>} _headers
     * @param {{ query?: Record<string, unknown> }} [context] the delivery URL's parsed query
     * @returns {Promise<object>} WebhookVerification
     */
    async verifyWebhook(rawBody, _headers, context = {}) {
      const provided = context?.query?.[URL_SECRET_PARAM];
      if (!webhookSecretUsable || typeof provided !== 'string' || provided.length === 0 ||
          !safeEqual(provided, webhookSecret)) {
        return { valid: false, deliveryId: '', eventType: 'unknown', resourceId: null, reason: 'invalid_secret' };
      }

      // Authenticated from here on. A delivery the adapter cannot act on
      // is acknowledged with no order (the handler answers 200 +
      // not_actionable), never refused: a 401 would make Eventbrite retry
      // it for days.
      const deliveryId = deliveryIdFor(rawBody);
      const ignored = (eventType = 'unknown') => ({ valid: true, deliveryId, eventType, resourceId: null });

      let body;
      try {
        body = JSON.parse(Buffer.from(rawBody).toString('utf8'));
      } catch {
        return ignored();
      }

      const action = typeof body?.config?.action === 'string' ? body.config.action : null;
      if (!action) return ignored();
      const eventType = ACTION_TO_EVENT_TYPE[action] || 'unknown';
      const resource = parseApiUrl(body?.api_url);
      if (!resource) return ignored(eventType);

      // Wrong-event: this deployment's configured event id does not match
      // the delivery's — 200 + ignored, per §3.3 step 1, so Eventbrite
      // stops retrying a misconfigured webhook (e.g. one still pointed at
      // a prior event's callback URL). The /v3/orders/{id}/ form names no
      // event; sync.cjs drops a re-fetched order for another event.
      if (externalEventId && resource.eventId !== null && resource.eventId !== externalEventId) {
        return { valid: false, deliveryId, eventType, resourceId: resource.orderId ?? null, reason: 'wrong_event' };
      }

      let orderId = resource.orderId;
      if (resource.kind === 'attendee') {
        // The queue is keyed by order. The attendee resource names its
        // order; read it from API_BASE, never from the delivered URL. A
        // throw here is a 500, which Eventbrite retries.
        const attendee = await apiCall(
          `/events/${encodeURIComponent(resource.eventId)}/attendees/${encodeURIComponent(resource.attendeeId)}/`,
        );
        orderId = attendee?.order_id != null ? String(attendee.order_id) : null;
        if (!orderId) return ignored(eventType);
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
     * item 5). Idempotent: an existing subscription at the same endpoint
     * (origin and path), carrying this secret, every handled action, and
     * this event, is reused rather than duplicated (judgment call 6 covers
     * organization discovery). Every page of the webhook list is read.
     *
     * The subscription always carries every action in WEBHOOK_ACTIONS
     * (#357). `events` is accepted for the provider interface but cannot
     * narrow the list: an action the adapter handles and Eventbrite never
     * sends is a silent gap. Every other subscription at the same endpoint
     * is returned in `staleWebhookIds`, whether or not one was reused, so
     * the operator can delete it.
     *
     * @param {{ callbackUrl: string, events?: string[] }} opts
     * @returns {Promise<{ webhookId: string, staleWebhookIds: string[] }>}
     */
    async registerWebhook({ callbackUrl }) {
      if (!webhookSecretUsable) {
        // Never echo the value: this message reaches the operator terminal.
        throw new Error(
          `eventbrite registerWebhook requires TICKETING_WEBHOOK_SECRET of at least ${MIN_WEBHOOK_SECRET_LENGTH} characters`,
        );
      }
      if (typeof callbackUrl !== 'string' || !callbackUrl.trim()) {
        throw new Error('registerWebhook requires a callbackUrl');
      }
      // Judgment call 1: Eventbrite stores and calls this URL, secret included.
      const endpointUrl = endpointUrlFor(callbackUrl.trim(), webhookSecret);
      const orgs = await apiCall('/users/me/organizations/');
      const orgId = orgs?.organizations?.[0]?.id;
      if (!orgId) {
        throw new Error('eventbrite registerWebhook: no organization found for TICKETING_API_TOKEN');
      }

      // Every page of the list, following the same continuation-token
      // pagination as listTickets. The page cap stops a looping token.
      const webhooksPath = `/organizations/${encodeURIComponent(orgId)}/webhooks/`;
      const existing = [];
      let continuation = null;
      for (let page = 0; page < MAX_WEBHOOK_PAGES; page += 1) {
        const listed = await apiCall(continuation
          ? `${webhooksPath}?${new URLSearchParams({ continuation }).toString()}`
          : webhooksPath);
        if (Array.isArray(listed?.webhooks)) existing.push(...listed.webhooks);
        const next = listed?.pagination?.has_more_items === true ? listed.pagination.continuation : null;
        if (typeof next !== 'string' || !next || next === continuation) break;
        continuation = next;
      }

      // Same endpoint = same origin and path, whatever its query, so a URL
      // Eventbrite normalized still matches. One that carries this secret
      // (compared in constant time), every action, and this event is kept;
      // every other one at the endpoint is stale (#356, #357).
      const sameEndpoint = existing
        .filter((w) => w?.id != null && baseOf(w.endpoint_url) === baseOf(endpointUrl));
      const complete = (w) => {
        const have = actionList(w.actions);
        const token = tokenOf(w.endpoint_url);
        return token !== '' && safeEqual(token, webhookSecret) &&
          WEBHOOK_ACTIONS.every((a) => have.includes(a)) &&
          (!externalEventId || w.event_id == null || String(w.event_id) === externalEventId);
      };
      const already = sameEndpoint.find(complete);
      const staleWebhookIds = sameEndpoint.filter((w) => w !== already).map((w) => String(w.id));
      if (already) {
        return { webhookId: String(already.id), staleWebhookIds };
      }

      const created = await apiCall(`/organizations/${encodeURIComponent(orgId)}/webhooks/`, {
        method: 'POST',
        body: {
          endpoint_url: endpointUrl,
          actions: WEBHOOK_ACTIONS.join(','),
          ...(externalEventId ? { event_id: externalEventId } : {}),
        },
      });
      if (created?.id == null) {
        throw new Error('eventbrite registerWebhook: create response carried no webhook id');
      }
      return { webhookId: String(created.id), staleWebhookIds };
    },

    /**
     * Registration messaging (§3.5 eventbrite row). `ctaUrl` for the
     * no-ticket case is the client's configured checkout URL
     * (`config/event.registration.externalUrl`); for the unclaimed-ticket
     * case it is the self-service claim page (issue #33), same as `manual`.
     *
     * @param {object} ctx RegistrationPromptContext (§3.5)
     */
    async getRegistrationPrompt(ctx = {}) {
      const suppressed = {
        send: false, templateId: null, ctaLabel: null, ctaUrl: null, action: null, bodyNote: null,
      };
      if (ctx?.isSpeaker === true || ctx?.hasClaimedTicket === true) return suppressed;

      if (ctx?.trigger === 'ticket_unclaimed') {
        const config = typeof getConfig === 'function' ? await getConfig() : null;
        return {
          send: true,
          templateId: 'ticket.claim_prompt',
          ctaLabel: 'Claim your ticket',
          ctaUrl: claimUrl(config),
          action: 'claim',
          bodyNote: null,
        };
      }

      const config = typeof getConfig === 'function' ? await getConfig() : null;
      // THE SAME READER THE PAGE USES (shared/registration, M7 issue 8).
      // This used to be a `typeof === 'string'` check of its own, which
      // meant a legacy config/event written before the https rule existed
      // was refused by the page and still put in front of a reader here —
      // in an email, where nobody can see the address before they click.
      //
      // The LABEL is this provider's own and stays that way: the client's
      // `actionLabel` is the wording for their own registration form, and
      // this row sends a reader to an Eventbrite checkout instead.
      const action = resolveRegistrationAction(config?.event);
      return {
        send: true,
        templateId: 'ticket.get_ticket',
        ctaLabel: 'Get your ticket',
        ctaUrl: action?.url ?? null,
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
    API_HOST,
    URL_SECRET_PARAM,
    MIN_WEBHOOK_SECRET_LENGTH,
    ACTION_TO_EVENT_TYPE,
    WEBHOOK_ACTIONS,
    actionList,
    API_PATH_SHAPES,
    parseApiUrl,
    endpointUrlFor,
    safeEqual,
    deliveryIdFor,
    claimUrl,
  },
};
