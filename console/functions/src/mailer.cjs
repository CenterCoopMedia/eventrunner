'use strict';

/**
 * The console's mail. Every function that sends mail takes a `mailer`
 * with this interface, so tests pass a fake and make no network call:
 *
 *   mailer.sendInvite({ to, organizationName, inviterEmail, role, link, expiresInDays })
 *   mailer.sendStatusChange({ to, organizationName, eventName, status, link, note })
 *     to a client Owner, when the status of a request changes (ADR 0007 §3)
 *   mailer.sendOperatorNotice({ to, organizationName, eventName, link, kind, problem })
 *     to a CCM operator. `kind` is 'request' (the default), 'paid',
 *     'build-failed' or 'payment-problem', which carries a `problem` code
 *   mailer.sendAgreementCopy({ to, organizationName, eventName, title, version, body, sha256, typedName, acceptedAt, link })
 *     to the person who accepted the agreement
 *
 * Each returns Promise<void> and rejects when the provider refuses the
 * message. `link` may be '' when the console address is not set; the
 * message then has no link.
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
 * What the client reads for each status (ADR 0007 §3 and §5). The first
 * line is the status as the status page says it.
 */
const STATUS_WORDS = Object.freeze({
  draft: { subject: 'You can change your request', line: 'An Owner went back to change the answers. No payment was taken. To continue, an Owner accepts the agreement again and pays the event fee.' },
  awaiting_payment: { subject: 'Pay the event fee to continue', line: 'An Owner accepted the agreement. The next step is the event fee. We start building your site once your payment is confirmed.' },
  paid: { subject: 'We received your payment', line: 'We received your event fee. We are building your site, and we will email you when it is ready.' },
  submitted: { subject: 'We received your request', line: 'We are reviewing your request. We will email you when it changes.' },
  changes_requested: { subject: 'Your request needs changes', line: 'We need some changes to your request. Open it to see the note and make the changes.' },
  approved: { subject: 'We approved your request', line: 'We approved your request. We are building your site.' },
  building: { subject: 'We are building your site', line: 'We are building your site.' },
  ready: { subject: 'Your site is ready', line: 'Your site is ready.' },
  launched: { subject: 'Your site is open to the public', line: 'Your site is open to the public.' },
  withdrawn: { subject: 'Your request was withdrawn', line: 'An Owner withdrew your request. We will not build this site.' },
  declined: { subject: 'We cannot build this site', line: 'We cannot build this site. Read the note for the reason.' },
});

/** Text and HTML from paragraphs, with an optional link paragraph. */
function compose(subject, paragraphs, link, linkText) {
  const textParts = [...paragraphs];
  if (link) textParts.push(`${linkText}:\n${link}`);
  const htmlParts = paragraphs.map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`);
  if (link) htmlParts.push(`<p><a href="${escapeHtml(link)}">${escapeHtml(linkText)}</a></p>`);
  return { subject, text: `${textParts.join('\n\n')}\n`, html: htmlParts.join('\n') };
}

/** @returns {{ subject: string, text: string, html: string }} */
function statusChangeMessage({ organizationName, eventName, status, link, note }) {
  const words = STATUS_WORDS[status];
  if (!words) throw new TypeError(`statusChangeMessage: unknown status ${status}`);
  const paragraphs = [`${organizationName}: ${eventName}`, words.line];
  if (note) paragraphs.push(`Note from the hosting team:\n${note}`);
  return compose(`${words.subject}: ${eventName}`, paragraphs, link, 'Open your request');
}

/** @returns {{ subject: string, text: string, html: string }} */
function operatorNoticeMessage({ organizationName, eventName, link, kind = 'request', problem = '' }) {
  const who = `${eventName} from ${organizationName}`;
  const words = {
    request: [`New request: ${who}`, [`${organizationName} sent a request for a site for ${eventName}.`, 'Review the answers in the console.']],
    paid: [`Paid: ${who}`, [`${organizationName} paid the event fee for ${eventName}. The request is approved.`]],
    'build-failed': [`Build did not start: ${who}`, ['The payment stands and the request stays approved, but the build did not start. Read the function logs, then start the build.']],
    'payment-problem': [`Payment needs attention: ${who}`, [`A paid session did not approve this request. Reason: ${problem}.`, 'Compare it with the payment in Stripe, and refund it if it should not stand.']],
  }[kind];
  return compose(words[0], words[1], link, 'Open the request');
}

/** The signer's copy: the record's details, then the full text. @returns {{ subject: string, text: string, html: string }} */
function agreementCopyMessage({ organizationName, eventName, title, version, body, sha256, typedName, acceptedAt, link }) {
  return compose(
    `Your copy of the agreement: ${eventName}`,
    [
      `${typedName} accepted this agreement for ${organizationName}, for ${eventName}, at ${acceptedAt}.`,
      `Version ${version}. SHA-256 of the text: ${sha256}`,
      title,
      ...body.split(/\n\s*\n/),
    ],
    link,
    'Open your request',
  );
}

/**
 * @param {{ token: string, from: string, fetch: typeof globalThis.fetch }} deps
 */
function createPostmarkMailer({ token, from, fetch }) {
  if (typeof token !== 'string' || !token) throw new TypeError('createPostmarkMailer: token is required');
  if (typeof from !== 'string' || !from) throw new TypeError('createPostmarkMailer: from is required');

  async function send(to, message, tag, what) {
    const response = await fetch(POSTMARK_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': token,
      },
      body: JSON.stringify({
        From: from,
        To: to,
        Subject: message.subject,
        TextBody: message.text,
        HtmlBody: message.html,
        MessageStream: 'outbound',
        Tag: tag,
      }),
    });
    if (!response.ok) {
      let code = '';
      try {
        code = ` (code ${(await response.json()).ErrorCode})`;
      } catch {
        code = '';
      }
      throw new Error(`Postmark refused the ${what} email: HTTP ${response.status}${code}`);
    }
  }

  return {
    sendInvite: (invite) => send(invite.to, inviteMessage(invite), 'console-invite', 'invite'),
    sendStatusChange: (change) => send(change.to, statusChangeMessage(change), 'console-status', 'status'),
    sendOperatorNotice: (notice) => send(notice.to, operatorNoticeMessage(notice), 'console-operator', 'operator notice'),
    sendAgreementCopy: (copy) => send(copy.to, agreementCopyMessage(copy), 'console-agreement', 'agreement copy'),
  };
}

module.exports = {
  agreementCopyMessage,
  createPostmarkMailer,
  inviteMessage,
  operatorNoticeMessage,
  statusChangeMessage,
  ROLE_WORDS,
  STATUS_WORDS,
};
