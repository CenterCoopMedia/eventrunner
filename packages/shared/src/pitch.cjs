'use strict';

const { httpsUrlHref } = require('./config/schema.cjs');

const RFC3339_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|([+-])(\d{2}):(\d{2}))$/;

function isValidCalendarDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

/** Return a canonical RFC3339 instant, or null. */
function readClosesAt(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(RFC3339_RE);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, , oh, om] = match;
  const parts = [y, mo, d, h, mi, s, oh ?? '0', om ?? '0'].map(Number);
  const [year, month, day, hour, minute, second, offsetHour, offsetMinute] = parts;
  if (!isValidCalendarDate(year, month, day)
      || hour > 23 || minute > 59 || second > 59
      || offsetHour > 23 || offsetMinute > 59) return null;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? new Date(millis).toISOString() : null;
}

const MAX_FORM_URL_LENGTH = 2048;

/**
 * The canonical https address of an external pitch form (for example, an
 * Airtable form), or null. Null means the site's own form takes pitches.
 * The same reader gates the operator's write and the public link, so the
 * page never links to a value the server would refuse.
 */
function readPitchFormUrl(value) {
  const href = httpsUrlHref(value);
  return href && href.length <= MAX_FORM_URL_LENGTH ? href : null;
}

/**
 * Pitch emails (issue #324). A receipt goes to a person who pitches through
 * this site's form. An acceptance or a decline goes only when staff send it
 * from the review queue. Operators can edit the subject and the wording of
 * each one. The wording is plain text: a blank line starts a new paragraph,
 * and {{token}} placeholders are filled when the email is sent.
 */
const PITCH_NOTICE_TEMPLATE_IDS = Object.freeze(['pitch.receipt', 'pitch.accepted', 'pitch.declined']);
const DECISION_TEMPLATE_IDS = Object.freeze({ accepted: 'pitch.accepted', rejected: 'pitch.declined' });
// automatic: the server sends the receipt after it stores a pitch from this
// site's form. manual: staff send each receipt from the review queue.
const RECEIPT_MODES = Object.freeze(['automatic', 'manual']);
const MAX_NOTICE_SUBJECT_LENGTH = 200;
const MAX_NOTICE_WORDING_LENGTH = 5000;
const MAX_SUBMITTER_FEEDBACK_LENGTH = 2000;

const PITCH_NOTICE_DEFAULTS = Object.freeze({
  'pitch.receipt': Object.freeze({
    subject: 'We received your session pitch for {{event_name}}',
    wording: [
      'Hello,',
      'Thank you for your session pitch for {{event_name}}. We received “{{pitch_title}}”.',
      'The organizers review each pitch. They will contact you at this address.',
    ].join('\n\n'),
  }),
  'pitch.accepted': Object.freeze({
    subject: 'Your session pitch for {{event_name}} is accepted',
    wording: [
      'Hello,',
      'The organizers accepted your session pitch “{{pitch_title}}” for {{event_name}}.',
      'They will contact you at this address about the next steps.',
    ].join('\n\n'),
  }),
  'pitch.declined': Object.freeze({
    subject: 'About your session pitch for {{event_name}}',
    wording: [
      'Hello,',
      'Thank you for your session pitch “{{pitch_title}}” for {{event_name}}.',
      'The organizers reviewed it. They cannot include it in the program.',
    ].join('\n\n'),
  }),
});

/**
 * The effective pitch email settings from the private
 * `session_pitch_settings/notices` document. A missing or malformed document
 * reads as automatic receipts and the shipped wording. A stored value that
 * is not usable text falls back to the shipped value for that field.
 */
function readPitchNoticeSettings(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const receiptMode = RECEIPT_MODES.includes(source.receiptMode) ? source.receiptMode : 'automatic';
  const stored = source.templates && typeof source.templates === 'object' ? source.templates : {};
  const templates = {};
  for (const id of PITCH_NOTICE_TEMPLATE_IDS) {
    const entry = stored[id] && typeof stored[id] === 'object' ? stored[id] : {};
    const usable = (value, max) => typeof value === 'string' && value.trim() && value.length <= max;
    const subject = usable(entry.subject, MAX_NOTICE_SUBJECT_LENGTH) ? entry.subject : null;
    const wording = usable(entry.wording, MAX_NOTICE_WORDING_LENGTH) ? entry.wording : null;
    templates[id] = {
      subject: subject ?? PITCH_NOTICE_DEFAULTS[id].subject,
      wording: wording ?? PITCH_NOTICE_DEFAULTS[id].wording,
      custom: Boolean(subject || wording),
    };
  }
  return { receiptMode, templates };
}

module.exports = {
  readClosesAt,
  readPitchFormUrl,
  MAX_FORM_URL_LENGTH,
  PITCH_NOTICE_TEMPLATE_IDS,
  DECISION_TEMPLATE_IDS,
  RECEIPT_MODES,
  MAX_NOTICE_SUBJECT_LENGTH,
  MAX_NOTICE_WORDING_LENGTH,
  MAX_SUBMITTER_FEEDBACK_LENGTH,
  PITCH_NOTICE_DEFAULTS,
  readPitchNoticeSettings,
};
