'use strict';

/**
 * The console's mail. Every function that sends mail takes a `mailer`
 * with this interface, so tests pass a fake and make no network call:
 *
 *   mailer.sendInvite({ to, organizationName, inviterEmail, role, link, expiresInDays })
 *     -> Promise<void>, rejects when the provider refuses the message
 *
 * The real mailer is Postmark. Its server token is the console project's
 * own secret, CONSOLE_POSTMARK_TOKEN, never a client project's.
 */

const POSTMARK_URL = 'https://api.postmarkapp.com/email';
const ROLE_WORDS = Object.freeze({ owner: 'Owner', editor: 'Editor' });

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** @returns {{ subject: string, text: string, html: string }} */
function inviteMessage({ organizationName, inviterEmail, role, link, expiresInDays }) {
  const roleWord = ROLE_WORDS[role] || 'Editor';
  const subject = `Join ${organizationName} on Event Runner`;
  const lines = [
    `${inviterEmail} invited you to join ${organizationName} as an ${roleWord}.`,
    'Open this link to accept the invite:',
    link,
    `The link works once and expires in ${expiresInDays} days.`,
    'If you did not expect this email, you can ignore it.',
  ];
  const text = `${lines[0]}\n\n${lines[1]}\n${lines[2]}\n\n${lines[3]}\n${lines[4]}\n`;
  const html = [
    `<p>${escapeHtml(lines[0])}</p>`,
    `<p><a href="${escapeHtml(link)}">Accept the invite</a></p>`,
    `<p>${escapeHtml(lines[3])}<br>${escapeHtml(lines[4])}</p>`,
  ].join('\n');
  return { subject, text, html };
}

/**
 * @param {{ token: string, from: string, fetch: typeof globalThis.fetch }} deps
 */
function createPostmarkMailer({ token, from, fetch }) {
  if (typeof token !== 'string' || !token) throw new TypeError('createPostmarkMailer: token is required');
  if (typeof from !== 'string' || !from) throw new TypeError('createPostmarkMailer: from is required');
  return {
    async sendInvite(invite) {
      const message = inviteMessage(invite);
      const response = await fetch(POSTMARK_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Postmark-Server-Token': token,
        },
        body: JSON.stringify({
          From: from,
          To: invite.to,
          Subject: message.subject,
          TextBody: message.text,
          HtmlBody: message.html,
          MessageStream: 'outbound',
          Tag: 'console-invite',
        }),
      });
      if (!response.ok) {
        let code = '';
        try {
          code = ` (code ${(await response.json()).ErrorCode})`;
        } catch {
          code = '';
        }
        throw new Error(`Postmark refused the invite email: HTTP ${response.status}${code}`);
      }
    },
  };
}

module.exports = { createPostmarkMailer, inviteMessage, ROLE_WORDS };
