'use strict';

// Primitives shared by public readers and config validation. Keep this
// module independent of the document validators and their writer-only data.
const { safeUrlHref } = require('../urlSafety.cjs');

const MAX_SOCIAL_LABEL_LENGTH = 40;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Canonical absolute HTTPS href, or '' for an unsafe/non-HTTPS value. */
function httpsUrlHref(value) {
  const href = safeUrlHref(value);
  return href.startsWith('https://') ? href : '';
}

function isHttpsUrl(value) {
  return httpsUrlHref(value) !== '';
}

/** A YYYY-MM-DD string naming a real calendar date, without normalization. */
function isValidCalendarDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const normalized = new Date(Date.UTC(year, month - 1, day));
  return normalized.getUTCFullYear() === year && normalized.getUTCMonth() === month - 1 && normalized.getUTCDate() === day;
}

module.exports = { MAX_SOCIAL_LABEL_LENGTH, httpsUrlHref, isHttpsUrl, isValidCalendarDate };
