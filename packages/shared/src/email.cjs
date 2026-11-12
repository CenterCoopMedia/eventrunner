'use strict';

/**
 * The email address check every form and validator shares: one `@`, no
 * whitespace, and a dot inside the domain with text on both sides. It is a
 * shape check, not a deliverability check.
 *
 * The pattern never backtracks. The domain takes one character, then every
 * character up to its first dot, then the rest. The earlier spelling,
 * /^[^\s@]+@[^\s@]+\.[^\s@]+$/, accepts the same strings, but on a value
 * that fails it tries every dot in the domain against every later position.
 * A 50,000-character value took about two seconds, and the OTP endpoint
 * takes that value from anyone.
 */
const EMAIL_ADDRESS_RE = /^[^\s@]+@[^\s@][^\s@.]*\.[^\s@]+$/;

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isEmailAddress(value) {
  return typeof value === 'string' && EMAIL_ADDRESS_RE.test(value);
}

/**
 * Characters that make an address more than one plain mailbox: a list
 * separator, a display-name bracket or quote, a comment, a route, an
 * escape, or whitespace (a line break would start a new header).
 */
const NOT_BARE_RE = /[\s,;:<>"()[\]\\]/;

/**
 * One plain address and nothing else, for a value that goes into a mail
 * header as typed (the invoice email copy address, #208 part 4). The
 * shared form check and the email core's boundary both use this, so a
 * preview never accepts what the send refuses.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isBareEmailAddress(value) {
  return isEmailAddress(value) && !NOT_BARE_RE.test(value);
}

/** The mailing-address requirement for announcement and reminder email. */
function hasMailingAddress(value) {
  if (typeof value !== 'string' || /\[Replace/i.test(value)) return false;
  const hasText = (text) => text.replace(/&nbsp;|&#160;|&#xA0;/gi, ' ').trim().length > 0;
  let cursor = 0;
  while (cursor < value.length) {
    const opening = value.indexOf('<', cursor);
    if (opening === -1) return hasText(value.slice(cursor));
    const closing = value.indexOf('>', opening + 1);
    // An unmatched opening bracket is text, as in the existing footer check.
    if (closing === -1) return hasText(value.slice(cursor));
    if (hasText(value.slice(cursor, opening))) return true;
    cursor = closing + 1;
  }
  return false;
}

module.exports = {
  EMAIL_ADDRESS_RE,
  isEmailAddress,
  isBareEmailAddress,
  hasMailingAddress,
};
