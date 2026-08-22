'use strict';

/**
 * The `none` ticketing provider (spec §3.3).
 *
 * "`none` is `manual` with an empty ticket set; every deployment therefore
 * has a working registration path." Until the manual/CSV adapter lands
 * (issue #31) this is a standalone built-in rather than a configuration of
 * that adapter — the shape is identical either way, because an empty CSV
 * import produces exactly these answers:
 *
 *   • no webhook to verify        → { valid: false, reason: 'no webhook' }
 *   • no orders to fetch          → an empty, COMPLETE order
 *   • no tickets to list          → an empty, terminal page
 *   • no order numbers to look up → null
 *   • no registerWebhook          → the capability gate (§3.3) reports
 *     `webhookSupported: false` instead of an unregistered-webhook warning
 *
 * `fetchOrder` returning `complete: true` matters: `complete === false` is
 * the retry signal (§3.3 step 3), and a provider that has no data to wait
 * for must never park an order in the queue for six attempts and then page
 * an operator about it.
 *
 * Registration messaging (§3.5): `none` returns `send: false` — there is
 * nothing for an unticketed user to buy or claim, and the only path to
 * access is an admin approval (§3.4).
 */

/**
 * @param {{ env?: Record<string, string|undefined> }} [deps]
 * @returns {object} TicketingProvider (spec §3.3)
 */
function createNoneProvider({ env = process.env } = {}) {
  const externalEventId = typeof env.EVENT_TICKETING_EVENT_ID === 'string' &&
    env.EVENT_TICKETING_EVENT_ID.trim().length > 0
    ? env.EVENT_TICKETING_EVENT_ID.trim()
    : null;

  return {
    name: 'none',
    externalEventId,

    /** @returns {Promise<object>} WebhookVerification */
    async verifyWebhook() {
      // deliveryId is part of the WebhookVerification shape even on the
      // refusal path; an empty string is honest — there is no delivery.
      return { valid: false, deliveryId: '', eventType: 'unknown', resourceId: null, reason: 'no webhook' };
    },

    /** @param {string} orderId */
    async fetchOrder(orderId) {
      return { orderId, externalEventId, tickets: [], complete: true };
    },

    async listTickets() {
      return { tickets: [], nextPageToken: null };
    },

    async lookupByOrderNumber() {
      return null;
    },

    // No registerWebhook: capability, not enablement, is the gate (§3.3).

    /** @param {object} ctx RegistrationPromptContext (§3.5) */
    async getRegistrationPrompt() {
      return {
        send: false,
        templateId: null,
        ctaLabel: null,
        ctaUrl: null,
        action: null,
        bodyNote: null,
      };
    },
  };
}

module.exports = { createNoneProvider };
