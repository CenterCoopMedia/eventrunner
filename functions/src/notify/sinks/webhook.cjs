'use strict';

/**
 * Operator-notification webhook sink (spec §3.2): signed JSON POST with the
 * same auth shape as the email webhook adapter — Bearer secret plus
 * `X-Signature: sha256=<hmac-sha256>` over the exact raw body, keyed by
 * OPERATOR_WEBHOOK_SECRET. No retries here, and no throw escapes deliver():
 * the notifier core treats every failure as a swallowed
 * `{ delivered: false }`.
 */

const crypto = require('node:crypto');

/** @param {string} secret @param {string|Buffer} rawBody @returns {string} hex */
function signBody(secret, rawBody) {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

/**
 * @param {{ env?: Record<string, string|undefined>,
 *           fetchImpl?: typeof fetch }} deps
 */
function createWebhookSink({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const url = env.OPERATOR_WEBHOOK_URL;
  const secret = env.OPERATOR_WEBHOOK_SECRET;
  if (!url) throw new Error('webhook operator sink requires OPERATOR_WEBHOOK_URL');
  if (!secret) throw new Error('webhook operator sink requires OPERATOR_WEBHOOK_SECRET');

  /**
   * @param {object} payload OperatorEvent plus { deployment, projectId, timestamp }
   * @returns {Promise<{ delivered: boolean, sink: 'webhook', error?: string }>}
   */
  async function deliver(payload) {
    const rawBody = JSON.stringify(payload);
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${secret}`,
          'X-Signature': `sha256=${signBody(secret, rawBody)}`,
        },
        body: rawBody,
      });
    } catch (err) {
      return { delivered: false, sink: 'webhook', error: String(err?.message || err) };
    }

    if (response.status >= 200 && response.status <= 299) {
      return { delivered: true, sink: 'webhook' };
    }

    let error = `operator webhook responded ${response.status}`;
    try {
      const text = await response.text();
      if (text) error = `${error}: ${text.slice(0, 500)}`;
    } catch {
      // Body unreadable; keep the status-only error.
    }
    return { delivered: false, sink: 'webhook', error };
  }

  return { name: 'webhook', deliver };
}

module.exports = { createWebhookSink, internals: { signBody } };
