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

module.exports = {
  EMAIL_ADDRESS_RE,
  isEmailAddress,
};
