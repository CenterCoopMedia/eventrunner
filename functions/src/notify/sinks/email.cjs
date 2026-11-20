'use strict';

/**
 * Operator-notification email sink (spec §3.2): renders an operator
 * notification in the Event Runner frame, with the same plain-text body as
 * before, and sends it through the injected email core to `config/providers.notifier.operatorEmail`. The fallback sink when
 * no webhook is configured — the only sink a client-operated deployment
 * would ever need. deliver() never throws; the notifier core swallows
 * failures either way.
 */

const { renderOperatorMail, escapeHtml } = require('shared/operatorAlert');

/**
 * @param {{ sendEmail: (message: object) => Promise<object> }} deps
 *   sendEmail is the email core's send() (spec §3.1) — it owns retry,
 *   from-resolution, and the sent_emails audit row.
 */
function createEmailSink({ sendEmail }) {
  /**
   * @param {object} payload OperatorEvent plus { deployment, projectId, timestamp }
   * @param {{ operatorEmail?: string }} [options]
   * @returns {Promise<{ delivered: boolean, sink: 'email', error?: string }>}
   */
  async function deliver(payload, { operatorEmail } = {}) {
    if (!operatorEmail) {
      return { delivered: false, sink: 'email', error: 'no operatorEmail configured' };
    }
    const { subject, text, html } = renderOperatorMail(payload);
    let result;
    try {
      result = await sendEmail({
        to: operatorEmail,
        subject,
        text,
        html,
        source: 'operator-notify',
        tag: 'operator.notify',
      });
    } catch (err) {
      return { delivered: false, sink: 'email', error: String(err?.message || err) };
    }
    const delivered = result?.status === 'sent';
    const outcome = { delivered, sink: 'email' };
    if (!delivered) outcome.error = result?.error || 'email send failed';
    return outcome;
  }

  return { name: 'email', deliver };
}

module.exports = { createEmailSink, internals: { renderOperatorMail, escapeHtml } };
