'use strict';

/**
 * Console adapter (spec §3.1): writes the rendered message to console.log
 * and reports success. Default under the emulator; the factory REFUSES to
 * load in production unless explicitly selected, so a misconfigured
 * deployment cannot silently swallow client mail.
 *
 * No verifyDeliveryWebhook — with this adapter active the delivery-ingest
 * endpoint refuses every request (spec §3.1).
 */

const crypto = require('node:crypto');

/**
 * @param {{ env?: Record<string, string|undefined>,
 *           log?: Pick<Console, 'log'> }} deps
 * @returns {{ name: 'console', send: (message: object) => Promise<object> }}
 */
function createConsoleProvider({ env = process.env, log = console } = {}) {
  if (env.FUNCTIONS_EMULATOR !== 'true' && env.EVENT_EMAIL_PROVIDER !== 'console') {
    throw new Error(
      'console email provider refuses to load outside the emulator unless ' +
      'EVENT_EMAIL_PROVIDER=console is set explicitly'
    );
  }

  /** @param {object} message EmailMessage @returns {Promise<object>} EmailSendResult */
  async function send(message) {
    log.log('[email:console]', JSON.stringify({
      to: message.to,
      from: message.from,
      replyTo: message.replyTo,
      subject: message.subject,
      tag: message.tag,
      text: message.text,
      html: message.html,
    }, null, 2));
    return {
      providerMessageId: `console-${crypto.randomUUID()}`,
      status: 'sent',
      providerStatus: 200,
    };
  }

  return { name: 'console', send };
}

module.exports = { createConsoleProvider };
