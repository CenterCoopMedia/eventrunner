'use strict';

/**
 * Operator-notification email sink (spec §3.2): renders an operator
 * notification in the Event Runner frame, with the same plain-text body as
 * before, and sends it through the injected email core to `config/providers.notifier.operatorEmail`. The fallback sink when
 * no webhook is configured — the only sink a client-operated deployment
 * would ever need. deliver() never throws; the notifier core swallows
 * failures either way.
 */

const { eventRunnerEmail } = require('../../email/templates/eventRunnerLayout.cjs');

/** Minimal HTML entity escape for the inline template. @param {unknown} value */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {object} payload OperatorEvent plus { deployment, projectId, timestamp }
 * @returns {{ subject: string, text: string, html: string }}
 */
function renderOperatorMail(payload) {
  const kind = String(payload.kind || 'info').toUpperCase();
  const subject = `[${payload.deployment || 'deployment'}] ${kind}: ${payload.title || ''}`.trim();

  const lines = [payload.summary || ''];
  const fields = payload.fields && typeof payload.fields === 'object' ? payload.fields : {};
  for (const [key, value] of Object.entries(fields)) {
    lines.push(`${key}: ${value}`);
  }
  if (payload.url) lines.push(`url: ${payload.url}`);
  if (payload.errorId) lines.push(`errorId: ${payload.errorId}`);
  if (payload.timestamp) lines.push(`timestamp: ${payload.timestamp}`);
  const text = lines.filter((line) => line.length > 0).join('\n');

  const rows = Object.entries(fields).map(([key, value]) => [escapeHtml(key), escapeHtml(value)]);
  if (payload.url) rows.push(['url', `<a href="${escapeHtml(payload.url)}" style="color:inherit;">${escapeHtml(payload.url)}</a>`]);
  if (payload.errorId) rows.push(['errorId', escapeHtml(payload.errorId)]);
  if (payload.timestamp) rows.push(['timestamp', escapeHtml(payload.timestamp)]);
  const html = eventRunnerEmail({
    context: escapeHtml(payload.deployment || 'deployment'),
    title: escapeHtml(`${kind}: ${payload.title || ''}`),
    paragraphs: payload.summary ? [escapeHtml(payload.summary).replace(/\n/g, '<br>')] : [],
    rows,
    link: payload.url ? { href: escapeHtml(payload.url), text: 'Open the details' } : null,
    footer: 'Event Runner operator alert',
  });

  return { subject, text, html };
}

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
