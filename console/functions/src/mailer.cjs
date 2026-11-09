'use strict';

/**
 * The console's mail. Every function that sends mail takes a `mailer`
 * with this interface, so tests pass a fake and make no network call:
 *
 *   mailer.sendInvite({ to, organizationName, inviterEmail, role, link, expiresInDays })
 *   mailer.sendStatusChange({ to, organizationName, eventName, status, link, note })
 *     to a client Owner, when the status of a request changes (ADR 0007 §3)
 *     `status` can also be 'build-failed', when a build stops
 *   mailer.sendOperatorNotice({ to, organizationName, eventName, link, kind, problem })
 *     to a CCM operator. `kind` is 'started', 'build-failed' or
 *     'build-run-failed', which carries the `problem` text
 *   mailer.sendAgreementCopy({ to, organizationName, eventName, title, version, body, sha256, typedName, legalName, signerTitle, acceptedAt, link })
 *     to the person who accepted the agreement, with a PDF of the text attached
 *
 * Each returns Promise<void> and rejects when the provider refuses the
 * message. `link` may be '' when the console address is not set; the
 * message then has no link.
 *
 * The real mailer is Postmark. Its server token is the console project's
 * own secret, CONSOLE_POSTMARK_TOKEN, never a client project's.
 */

const { hostName } = require('./hostName.cjs');
const { agreementPdf, formatAcceptedAt } = require('./agreementPdf.cjs');
const { button, detailsTable, fineprint, heading, kicker, note, paragraph, wrapConsoleEmail } = require('./emailLayout.cjs');

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
  const html = wrapConsoleEmail([
    heading(escapeHtml(subject)),
    paragraph(escapeHtml(lines[0])),
    button(escapeHtml(link), 'Accept the invite'),
    fineprint(`${escapeHtml(lines[3])}<br>${escapeHtml(lines[4])}`),
  ].join('\n'), { preheader: escapeHtml(lines[0]) });
  return { subject, text, html };
}

/**
 * What the client reads for each status (ADR 0007 §3 and §5). The first
 * line is the status as the status page says it.
 */
const STATUS_WORDS = Object.freeze({
  approved: { subject: 'We started building your site', line: 'An Owner accepted the agreement, and we started building your site. We will email you when it is ready, or if it needs anything from you.' },
  ready: { subject: 'Your site is ready', line: 'Your site is ready.' },
  launched: { subject: 'Your site is open to the public', line: 'Your site is open to the public.' },
  withdrawn: { subject: 'Your request was withdrawn', line: 'An Owner withdrew your request. We will not build this site.' },
  declined: { subject: 'We cannot build this site', line: 'We cannot build this site. Read the note for the reason.' },
  'build-failed': { subject: 'Your site did not finish building', line: 'Your site did not finish building. Open your request to see what to do next.' },
});

const breaks = (text) => escapeHtml(text).replace(/\n/g, '<br>');

/**
 * Text and branded HTML from paragraphs, with an optional link. A paragraph
 * may be `{ note }`, a note from the host: "Note from ...:" and the note in
 * the text, a quoted panel in the HTML. `context` is a small line above
 * the heading and, unless `contextInText` is false, the first text
 * paragraph. The heading is `title`.
 */
function compose(subject, paragraphs, link, linkText, { title = subject, context = '', contextInText = true } = {}) {
  const noteLabel = () => `Note from ${hostName()}`;
  const textParts = [...(context && contextInText ? [context] : []), ...paragraphs.map((p) => (typeof p === 'string' ? p : `${noteLabel()}:\n${p.note}`))];
  if (link) textParts.push(`${linkText}:\n${link}`);
  const first = paragraphs.find((p) => typeof p === 'string') || '';
  // A line that only repeats the heading ("Your site is ready.") is left out of the HTML.
  const body = paragraphs.filter((p, i) => !(i === 0 && p === `${title}.`));
  const html = wrapConsoleEmail([
    context ? kicker(escapeHtml(context)) : '',
    heading(escapeHtml(title)),
    ...body.map((p, i) => (typeof p === 'string'
      ? paragraph(breaks(p), i === body.length - 1 && !link)
      : note(escapeHtml(noteLabel()), breaks(p.note)))),
    link ? button(escapeHtml(link), escapeHtml(linkText)) : '',
  ].filter(Boolean).join('\n'), { preheader: escapeHtml(first) });
  return { subject, text: `${textParts.join('\n\n')}\n`, html };
}

/** @returns {{ subject: string, text: string, html: string }} */
function statusChangeMessage({ organizationName, eventName, status, link, note, adminLink }) {
  const words = STATUS_WORDS[status];
  if (!words) throw new TypeError(`statusChangeMessage: unknown status ${status}`);
  const paragraphs = [words.line];
  if (note) paragraphs.push({ note });
  const shape = { title: words.subject, context: `${organizationName}: ${eventName}` };
  if (adminLink) {
    paragraphs.push('Sign in to your admin panel with this email address. The setup checklist there shows what is left before you open the site to the public.');
    return compose(`${words.subject}: ${eventName}`, paragraphs, adminLink, 'Open your admin panel', shape);
  }
  return compose(`${words.subject}: ${eventName}`, paragraphs, link, 'Open your request', shape);
}

/** @returns {{ subject: string, text: string, html: string }} */
function operatorNoticeMessage({ organizationName, eventName, link, kind = 'started', problem = '' }) {
  const who = `${eventName} from ${organizationName}`;
  const words = {
    started: [`Build started: ${who}`, [`${organizationName} accepted the agreement for ${eventName}. The build is starting.`]],
    'build-failed': [`Build did not start: ${who}`, ['The agreement stands and the request stays approved, but the build did not start. Read the function logs and fix the cause, then select Retry the build on the request.']],
    'build-run-failed': [`Build failed: ${who}`, [
      `The build stopped. ${problem}`,
      'Open the request to read the build record and fix the cause, then select Retry the build. The steps that finished are not done twice.',
    ]],
  }[kind];
  return compose(words[0], words[1], link, 'Open the request', { title: words[0].slice(0, words[0].length - who.length - 2), context: who, contextInText: false });
}

/**
 * The signer's note: what they accepted, when, and which version. The full
 * text and its SHA-256 are in the attached PDF (agreementPdf.cjs).
 * @returns {{ subject: string, text: string, html: string }}
 */
function agreementCopyMessage({ eventName, title, version, typedName, legalName, signerTitle, acceptedAt, link }) {
  const when = formatAcceptedAt(acceptedAt);
  const intro = `You accepted the agreement on behalf of ${legalName} for ${eventName}.`;
  const attached = 'Your copy of the agreement is attached as a PDF. Keep it for your records.';
  const rows = [
    ['Agreement', title],
    ['Version', String(version)],
    ['Accepted by', `${typedName}, ${signerTitle}`],
    ['Date', when],
  ];
  const text = [
    'Agreement accepted',
    intro,
    rows.map(([label, value]) => `${label}: ${value}`).join('\n'),
    attached,
    ...(link ? [`Open your request:\n${link}`] : []),
  ].join('\n\n');
  const html = wrapConsoleEmail([
    '<h1 style="margin:0 0 12px 0;font-size:22px;line-height:1.3;">Agreement accepted</h1>',
    `<p style="margin:0 0 24px 0;">${escapeHtml(intro)}</p>`,
    detailsTable(rows.map(([label, value]) => [escapeHtml(label), escapeHtml(value)])),
    `<p style="margin:0 0 24px 0;">${escapeHtml(attached)}</p>`,
    link ? button(escapeHtml(link), 'Open your request') : '',
  ].filter(Boolean).join('\n'), { preheader: escapeHtml(`Version ${version}, accepted ${when}. Your copy is attached.`) });
  return { subject: `Your copy of the agreement: ${eventName}`, text: `${text}\n`, html };
}

/** The PDF file the signer's note carries, as a Postmark attachment. */
async function agreementAttachment(copy) {
  const pdf = await agreementPdf(copy);
  return {
    Name: `Event Runner agreement, version ${copy.version}.pdf`,
    Content: Buffer.from(pdf).toString('base64'),
    ContentType: 'application/pdf',
  };
}

/**
 * @param {{ token: string, from: string, fetch: typeof globalThis.fetch }} deps
 */
function createPostmarkMailer({ token, from, fetch }) {
  if (typeof token !== 'string' || !token) throw new TypeError('createPostmarkMailer: token is required');
  if (typeof from !== 'string' || !from) throw new TypeError('createPostmarkMailer: from is required');

  async function send(to, message, tag, what, attachments = []) {
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
        ...(attachments.length ? { Attachments: attachments } : {}),
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
    sendAgreementCopy: async (copy) => send(copy.to, agreementCopyMessage(copy), 'console-agreement', 'agreement copy', [await agreementAttachment(copy)]),
  };
}

module.exports = {
  agreementCopyMessage,
  createPostmarkMailer,
  inviteMessage,
  operatorNoticeMessage,
  statusChangeMessage,
  STATUS_WORDS,
};
