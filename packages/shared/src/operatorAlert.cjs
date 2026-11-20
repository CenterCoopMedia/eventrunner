'use strict';

const { eventRunnerEmail } = require('./operatorAlertLayout.cjs');
const { MAX_SCREENSHOTS } = require('./screenshotPolicy.mjs');

const SUBMISSIONS = Object.freeze({
  feedback: 'New feedback',
  'change-request': 'New change request',
  'problem-report': 'New problem report',
});
const SITE_ID = /^[a-z0-9][a-z0-9-]{0,127}$/i;
const RECORD_ID = /^[a-z0-9_-]{8,128}$/i;
const PAGE_PATH = /^\/[a-z0-9/_.-]{0,159}$/i;

/** Use fixed alert text and only structured context from the saved record. */
function buildSubmissionAlert({ kind, site, id, link, page, screenshotCount = 0, allowLoopback = false }) {
  if (!Object.hasOwn(SUBMISSIONS, kind) ||
      typeof site !== 'string' || !SITE_ID.test(site) ||
      typeof id !== 'string' || !RECORD_ID.test(id) ||
      !Number.isInteger(screenshotCount) || screenshotCount < 0 || screenshotCount > MAX_SCREENSHOTS) return null;
  let url;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  const loopback = allowLoopback && url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((!loopback && url.protocol !== 'https:') || url.username || url.password) return null;
  return {
    kind,
    title: SUBMISSIONS[kind],
    summary: 'A new submission is ready for review.',
    fields: {
      site,
      record: id,
      ...(typeof page === 'string' && PAGE_PATH.test(page) && !page.startsWith('//') ? { page } : {}),
      ...(screenshotCount ? { screenshots: screenshotCount } : {}),
    },
    url: url.href,
    dedupeKey: `${kind}:${site}:${id}`,
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderOperatorMail(payload) {
  const kind = String(payload.kind || 'info').toUpperCase();
  const subject = `[${payload.deployment || 'deployment'}] ${kind}: ${payload.title || ''}`.trim();
  const fields = payload.fields && typeof payload.fields === 'object' ? payload.fields : {};
  const lines = [payload.summary || ''];
  for (const [key, value] of Object.entries(fields)) lines.push(`${key}: ${value}`);
  if (payload.url) lines.push(`url: ${payload.url}`);
  if (payload.errorId) lines.push(`errorId: ${payload.errorId}`);
  if (payload.timestamp) lines.push(`timestamp: ${payload.timestamp}`);

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
  return { subject, text: lines.filter((line) => line.length > 0).join('\n'), html };
}

module.exports = { buildSubmissionAlert, renderOperatorMail, escapeHtml };
