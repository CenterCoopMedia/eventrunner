'use strict';

/**
 * Console adapter (spec §3.1): writes the rendered message to console.log
 * and reports success. Default under the emulator; the factory REFUSES to
 * load in production unless explicitly selected, so a misconfigured
 * deployment cannot silently swallow client mail.
 *
 * No verifyDeliveryWebhook — with this adapter active the delivery-ingest
 * endpoint refuses every request (spec §3.1).
 */

const crypto = require('node:crypto');
const fs = require('node:fs');

/**
 * @param {{ env?: Record<string, string|undefined>,
 *           log?: Pick<Console, 'log'>,
 *           appendFileSync?: typeof fs.appendFileSync }} deps
 * @returns {{ name: 'console', send: (message: object) => Promise<object> }}
 */
function createConsoleProvider({
  env = process.env,
  log = console,
  appendFileSync = fs.appendFileSync,
} = {}) {
  if (env.FUNCTIONS_EMULATOR !== 'true' && (env.EVENT_EMAIL_PROVIDER || '').trim() !== 'console') {
    throw new Error(
      'console email provider refuses to load outside the emulator unless ' +
      'EVENT_EMAIL_PROVIDER=console is set explicitly'
    );
  }

  // Test-observability sink (e2e only, opt-in). The e2e suite needs to read
  // the OTP codes and invite tokens that exist nowhere else server-side (one
  // is a scrypt hash, the other a SHA-256 digest), and scraping them back out
  // of the emulator's stdout proved unreliable: under `emulators:exec`
  // firebase-tools re-prints every captured line with a "> " prefix that is
  // ANSI-colorized whenever it thinks the terminal supports color (it does in
  // GitHub Actions), which interleaves escape sequences into the middle of the
  // pretty-printed JSON blob below and makes it unparseable. Writing one
  // self-delimiting JSON line per message straight to a file removes that
  // whole channel from the test path. Strictly gated on E2E_MAIL_FILE, which
  // only scripts/dev/run-e2e.sh ever sets, so normal dev and production
  // behavior is byte-for-byte unchanged.
  const mailFile = typeof env.E2E_MAIL_FILE === 'string' ? env.E2E_MAIL_FILE.trim() : '';

  /** @param {object} message EmailMessage @returns {Promise<object>} EmailSendResult */
  async function send(message) {
    const captured = {
      to: message.to,
      from: message.from,
      replyTo: message.replyTo,
      subject: message.subject,
      tag: message.tag,
      text: message.text,
      html: message.html,
    };
    log.log('[email:console]', JSON.stringify(captured, null, 2));
    if (mailFile) {
      // Synchronous + append-only + one line per message: no buffering to be
      // lost if the emulator is killed mid-run, and a reader polling by byte
      // offset can never observe a torn record (a single write() of a line
      // under the pipe-buffer size is atomic for O_APPEND).
      appendFileSync(mailFile, `${JSON.stringify(captured)}\n`);
    }
    return {
      providerMessageId: `console-${crypto.randomUUID()}`,
      status: 'sent',
      providerStatus: 200,
    };
  }

  return { name: 'console', send };
}

module.exports = { createConsoleProvider };
