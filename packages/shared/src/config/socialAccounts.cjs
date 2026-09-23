'use strict';

const { safeUrlHref } = require('../urlSafety.cjs');
const { MAX_SOCIAL_LABEL_LENGTH } = require('./schema.cjs');

/**
 * The event's social accounts as the site footer and the mail footer list
 * them (#231): one list, read one way, so the two cannot disagree.
 *
 * validateEventConfig refuses a malformed account at save, but a
 * config/event written before that rule, or by a script that skipped it, is
 * still read at render time. So every entry is met as it is and normalized:
 *
 *   • not an object, no service name, or a link shared/urlSafety refuses →
 *     dropped, rather than a link with no name or a link that is not a link;
 *   • the service name and the handle are trimmed and cut to
 *     MAX_SOCIAL_LABEL_LENGTH, the cap the schema refuses a longer one with;
 *   • the link is the canonical href urlSafety returns;
 *   • one service and link listed twice is listed once.
 *
 * @param {unknown} social config/event.social
 * @returns {Array<{ platform: string, handle: string, url: string }>}
 */
function listSocialAccounts(social) {
  const handles = Array.isArray(social?.handles) ? social.handles : [];
  const seen = new Set();
  const accounts = [];
  for (const entry of handles) {
    if (!entry || typeof entry !== 'object') continue;
    if (typeof entry.platform !== 'string' || typeof entry.url !== 'string') continue;
    const url = safeUrlHref(entry.url);
    if (!url) continue;
    const platform = entry.platform.trim().slice(0, MAX_SOCIAL_LABEL_LENGTH);
    if (!platform) continue;
    const handle =
      typeof entry.handle === 'string' ? entry.handle.trim().slice(0, MAX_SOCIAL_LABEL_LENGTH) : '';
    const key = `${platform}\u0000${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    accounts.push({ platform, handle, url });
  }
  return accounts;
}

module.exports = { listSocialAccounts };
