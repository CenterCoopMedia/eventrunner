'use strict';

/**
 * The transactional message stream (issue #330; first written for the
 * invoice email, issue #208 part 4).
 *
 * Transactional mail goes on `config/providers.email.messageStream`, or on
 * the provider's default stream (Postmark's `outbound`) when that is unset.
 * It never goes on the announcement stream: when the transactional stream
 * names the same stream as `announcementStream`, this refuses, and the
 * caller sends nothing. Mail on the announcement stream would take that
 * stream's unsubscribe handling and its reputation.
 *
 * @param {object} config the loaded event config
 * @returns {{ ok: true, stream: string|null } | { ok: false }} `stream` null
 *   means the provider's default
 */
function transactionalStream(config) {
  const email = config?.providers?.email ?? {};
  const stream = typeof email.messageStream === 'string' && email.messageStream.trim() ? email.messageStream.trim() : null;
  const announcement = typeof email.announcementStream === 'string' ? email.announcementStream.trim() : '';
  if (announcement && (stream ?? 'outbound') === announcement) return { ok: false };
  return { ok: true, stream };
}

module.exports = { transactionalStream };
