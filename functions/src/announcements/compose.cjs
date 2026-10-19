'use strict';

/**
 * The announcement email itself (issue #202): the staff draft, the branded
 * render, the delivery channel, and the preview receipt.
 *
 * THE DRAFT is plain text: a subject, a message, and an optional link with
 * a label. Staff never write HTML. The message becomes paragraphs in the
 * shared layout (email/templates/announcement.email.cjs), escaped.
 *
 * THE CHANNEL (issue #490). Announcements go out on their own stream, never
 * the transactional one that carries sign-in codes and receipts:
 *
 *   postmark  `config/providers.email.announcementStream` must name an
 *             active Broadcasts stream on the server, read live from the
 *             Postmark API before any claim or send. Its unsubscribe
 *             handling decides the mode: `Postmark` means Postmark adds the
 *             link and suppresses the address ("provider" mode); `Custom`
 *             means this application adds a signed link and the
 *             List-Unsubscribe headers ("app" mode). `None`, a missing,
 *             archived, or transactional stream, or a failed read refuses.
 *   console   app mode, for local development and the browser tests.
 *   webhook   refused: the relay has no batch or unsubscribe contract yet.
 *
 * THE RECEIPT binds a confirmation to what the preview showed: a SHA-256
 * over the audience, every recipient address, the rendered subject and
 * bodies, the sender, the stream and the unsubscribe mode. It is opaque to
 * the browser and holds no address. A send whose receipt no longer matches
 * is refused before any claim, with a request to preview again.
 */

const crypto = require('node:crypto');
const { render, internals: renderInternals } = require('../email/render.cjs');
const announcementTemplate = require('../email/templates/announcement.email.cjs');
const { safeUrlHref } = require('shared/urlSafety');
const { testUnsubscribeUrl, internals: suppressionInternals } = require('./suppression.cjs');

const { escapeHtml } = renderInternals;

const MAX_SUBJECT_LENGTH = 150;
const MAX_MESSAGE_LENGTH = 10000;
const MAX_LINK_LABEL_LENGTH = 80;
const DRAFT_KEYS = Object.freeze(['subject', 'message', 'linkUrl', 'linkLabel']);
const BODY_SLOT = 'ANNOUNCEMENTBODYSLOT7f3a9c';
const UNSUBSCRIBE_SLOT = 'ANNOUNCEMENTUNSUBSCRIBESLOT7f3a9c';
const PARAGRAPH_STYLE = 'margin:0 0 16px 0;';

/**
 * @param {unknown} input
 * @returns {{ ok: boolean, errors: string[],
 *   value: { subject: string, message: string, link: { url: string, label: string }|null } }}
 */
function validateDraft(input) {
  const errors = [];
  const draft = input && typeof input === 'object' && !Array.isArray(input) ? input : null;
  if (!draft) return { ok: false, errors: ['draft: must be an object'], value: null };
  for (const key of Object.keys(draft)) {
    if (!DRAFT_KEYS.includes(key)) errors.push(`${key}: unknown field`);
  }
  const subject = typeof draft.subject === 'string' ? draft.subject.replace(/\s+/g, ' ').trim() : '';
  if (!subject) errors.push('subject: must contain text');
  else if (subject.length > MAX_SUBJECT_LENGTH) errors.push(`subject: must be ${MAX_SUBJECT_LENGTH} characters or fewer`);

  const message = typeof draft.message === 'string' ? draft.message.replace(/\r\n?/g, '\n').trim() : '';
  if (!message) errors.push('message: must contain text');
  else if (message.length > MAX_MESSAGE_LENGTH) errors.push(`message: must be ${MAX_MESSAGE_LENGTH} characters or fewer`);

  const rawUrl = typeof draft.linkUrl === 'string' ? draft.linkUrl.trim() : '';
  const rawLabel = typeof draft.linkLabel === 'string' ? draft.linkLabel.replace(/\s+/g, ' ').trim() : '';
  let link = null;
  if (rawUrl || rawLabel) {
    const url = safeUrlHref(rawUrl);
    if (!url) errors.push('linkUrl: must be an absolute http or https URL');
    if (!rawLabel) errors.push('linkLabel: must contain text when the email has a link');
    else if (rawLabel.length > MAX_LINK_LABEL_LENGTH) {
      errors.push(`linkLabel: must be ${MAX_LINK_LABEL_LENGTH} characters or fewer`);
    }
    if (url && rawLabel) link = { url, label: rawLabel };
  }
  return { ok: errors.length === 0, errors, value: { subject, message, link } };
}

/** The message as escaped paragraphs; a single line break stays a break. */
function messageHtml(message) {
  return message
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p style="${PARAGRAPH_STYLE}">${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

/**
 * Render the draft once for a whole send. In app mode the bodies keep the
 * unsubscribe placeholder; personalize() puts each recipient's link in.
 *
 * @param {{ config: object, draft: object, mode: 'app'|'provider', now?: () => Date }} args
 */
function renderAnnouncement({ config, draft, mode, now }) {
  const rendered = render({
    template: announcementTemplate,
    tokenValues: {
      announcement_subject: draft.subject,
      announcement_body: BODY_SLOT,
      cta_url: draft.link?.url || '',
      cta_label: draft.link?.label || '',
      unsubscribe_url: mode === 'app' ? UNSUBSCRIBE_SLOT : '',
    },
    config,
    now,
  });
  return {
    subject: rendered.subject,
    html: rendered.html.split(BODY_SLOT).join(messageHtml(draft.message)),
    text: rendered.text.split(BODY_SLOT).join(draft.message).replace(/\n{3,}/g, '\n\n'),
    hasLegalFooterHtml: rendered.hasLegalFooterHtml,
    hasLegalFooterText: rendered.hasLegalFooterText,
  };
}

/** One recipient's bodies, with their unsubscribe link in place. */
function personalize(rendered, unsubscribeUrl) {
  const url = unsubscribeUrl || '';
  return {
    html: rendered.html.split(UNSUBSCRIBE_SLOT).join(escapeHtml(url)),
    text: rendered.text.split(UNSUBSCRIBE_SLOT).join(url),
  };
}

/** The headers a one-click unsubscribe needs (RFC 2369, RFC 8058). */
function unsubscribeHeaders(url) {
  return { 'List-Unsubscribe': `<${url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
}

/** "Name <address>" for display, or the address alone. */
function senderOf(config) {
  const sender = config?.event?.sender || {};
  return {
    from: sender.email ? (sender.name ? `${sender.name} <${sender.email}>` : sender.email) : null,
    replyTo: sender.replyTo || null,
  };
}

const CHANNEL_MESSAGES = Object.freeze({
  'unsupported-provider': 'Announcement email needs the Postmark or console email provider. The webhook relay has no batch send or unsubscribe contract yet.',
  'stream-missing': 'Set config/providers.email.announcementStream to a Postmark broadcast stream before sending announcements.',
  'stream-not-found': 'The announcement stream does not exist on this Postmark server.',
  'stream-transactional': 'The announcement stream is a transactional stream. Use a Broadcasts stream so announcements stay apart from sign-in codes and receipts.',
  'stream-archived': 'The announcement stream is archived. Use an active Broadcasts stream.',
  'stream-unsubscribe': 'The announcement stream has no unsubscribe handling. Set it to Postmark or Custom in Postmark.',
  'stream-unavailable': 'Postmark did not answer the stream check. Try again later.',
  'site-url-missing': 'The site has no public URL, so the email cannot carry an unsubscribe link.',
});

function refused(code) {
  return { ok: false, code, message: CHANNEL_MESSAGES[code] };
}

/**
 * Decide how announcements leave this deployment, before any claim or send.
 *
 * @param {{ provider: object, config: object }} args
 * @returns {Promise<{ ok: true, provider: string, stream: string, mode: 'app'|'provider' } |
 *   { ok: false, code: string, message: string }>}
 */
async function resolveChannel({ provider, config }) {
  const configured = config?.providers?.email?.announcementStream;
  const stream = typeof configured === 'string' && configured.trim() ? configured.trim() : null;
  const needsSite = () => !suppressionInternals.siteUrlOf(config);

  if (provider?.name === 'console') {
    if (needsSite()) return refused('site-url-missing');
    return { ok: true, provider: 'console', stream: stream || 'announcements', mode: 'app' };
  }
  if (provider?.name !== 'postmark' || typeof provider.sendBatch !== 'function') {
    return refused('unsupported-provider');
  }
  if (!stream) return refused('stream-missing');
  const transactional = config?.providers?.email?.messageStream || 'outbound';
  if (stream === transactional) return refused('stream-transactional');
  let info;
  try {
    info = await provider.getMessageStream(stream);
  } catch {
    return refused('stream-unavailable');
  }
  if (!info?.found) return refused(info?.status === 404 || info?.status === 422 ? 'stream-not-found' : 'stream-unavailable');
  if (info.archived) return refused('stream-archived');
  if (info.type !== 'Broadcasts') return refused('stream-transactional');
  if (info.unsubscribeHandling === 'Postmark') return { ok: true, provider: 'postmark', stream, mode: 'provider' };
  if (info.unsubscribeHandling === 'Custom') {
    if (needsSite()) return refused('site-url-missing');
    return { ok: true, provider: 'postmark', stream, mode: 'app' };
  }
  return refused('stream-unsubscribe');
}

/** What the composer says about the unsubscribe link, by mode. */
function unsubscribeNote(mode) {
  return mode === 'provider'
    ? 'Postmark adds an unsubscribe link at the end of each message. This preview does not show it.'
    : 'Each recipient gets their own unsubscribe link at the end of the message. The link in this preview and in a test send changes nothing.';
}

/** The opaque digest a confirmation must match. */
function receiptFor({ audience, recipients, rendered, sender, channel }) {
  const canonical = JSON.stringify({
    v: 1,
    audience,
    recipients: recipients.map((r) => r.email),
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    from: sender.from,
    replyTo: sender.replyTo,
    stream: channel.stream,
    mode: channel.mode,
  });
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** The preview bodies: the inert test link in place of a live one. */
function previewBodies({ rendered, config }) {
  return personalize(rendered, testUnsubscribeUrl(config));
}

module.exports = {
  validateDraft,
  renderAnnouncement,
  personalize,
  unsubscribeHeaders,
  senderOf,
  resolveChannel,
  unsubscribeNote,
  receiptFor,
  previewBodies,
  internals: {
    messageHtml,
    CHANNEL_MESSAGES,
    BODY_SLOT,
    UNSUBSCRIBE_SLOT,
    MAX_SUBJECT_LENGTH,
    MAX_MESSAGE_LENGTH,
    MAX_LINK_LABEL_LENGTH,
  },
};
