'use strict';

/**
 * OperatorNotifier core (spec §3.2). Replaces every direct alert/telegram
 * call site: product code never learns which sink is configured.
 *
 * Core responsibilities live here, not in sinks:
 *   - sink selection from EVENT_OPERATOR_NOTIFIER ('webhook'|'email'|'none')
 *   - title prefixed with config/event.shortName
 *   - 5-minute in-memory dedupe window keyed by dedupeKey (per container,
 *     matching the existing errorAlertRateLimit Map semantics)
 *   - never throws — alerting is not the operation the caller was performing
 */

const { createWebhookSink } = require('./sinks/webhook.cjs');
const { createEmailSink } = require('./sinks/email.cjs');

const DEDUPE_WINDOW_MS = 5 * 60 * 1000;
const SINK_NAMES = new Set(['webhook', 'email', 'none']);

/** dedupeKey -> last-attempt ms; per container, pruned on every check. */
const dedupeSeen = new Map();

/**
 * True when the key was attempted within the window; records this attempt
 * otherwise. Stale entries are pruned so the Map cannot grow unbounded.
 * @param {string} key @param {number} nowMs
 */
function isDuplicate(key, nowMs) {
  for (const [seenKey, seenAt] of dedupeSeen) {
    if (nowMs - seenAt >= DEDUPE_WINDOW_MS) dedupeSeen.delete(seenKey);
  }
  if (dedupeSeen.has(key)) return true;
  dedupeSeen.set(key, nowMs);
  return false;
}

/** Test hook: drop the per-container dedupe state. */
function resetDedupeForTest() {
  dedupeSeen.clear();
}

/**
 * @param {{
 *   env?: Record<string, string|undefined>,
 *   getConfig: () => Promise<object>,
 *   sendEmail?: (message: object) => Promise<object>,
 *   fetchImpl?: typeof fetch,
 *   now?: () => number,
 *   log?: Pick<Console, 'warn'>,
 * }} deps
 * @returns {{ name: 'webhook'|'email'|'none',
 *   notify: (event: object) => Promise<{ delivered: boolean, sink: string, error?: string }> }}
 */
function createOperatorNotifier({
  env = process.env,
  getConfig,
  sendEmail,
  fetchImpl,
  now = Date.now,
  log = console,
}) {
  // The notifier is the operator's error channel: a typo'd sink value that
  // silently became 'none' would be invisible exactly when it matters.
  const raw = typeof env.EVENT_OPERATOR_NOTIFIER === 'string' ? env.EVENT_OPERATOR_NOTIFIER.trim() : '';
  const name = SINK_NAMES.has(raw) ? raw : 'none';
  if (raw && !SINK_NAMES.has(raw)) {
    log.warn(`EVENT_OPERATOR_NOTIFIER "${raw}" is not one of webhook|email|none; operator alerts are disabled`);
  }

  /**
   * @param {object} event OperatorEvent (spec §3.2): { kind, title, summary,
   *   fields?, url?, dedupeKey?, errorId? }
   * @returns {Promise<{ delivered: boolean, sink: string, error?: string }>}
   */
  async function notify(event) {
    // 'none' (or unset/unknown) short-circuits without loading config.
    if (name === 'none') return { delivered: false, sink: 'none' };

    try {
      const nowMs = now();
      if (event?.dedupeKey && isDuplicate(event.dedupeKey, nowMs)) {
        return { delivered: false, sink: name, error: 'suppressed-duplicate' };
      }

      const config = await getConfig();
      const shortName = config?.event?.shortName;
      const title = shortName ? `[${shortName}] ${event.title}` : event.title;

      const payload = {
        ...event,
        title,
        deployment: env.EVENT_SLUG || null,
        projectId: env.EVENT_FIREBASE_PROJECT_ID || null,
        timestamp: new Date(nowMs).toISOString(),
      };

      if (name === 'webhook') {
        const sink = createWebhookSink({ env, fetchImpl });
        return await sink.deliver(payload);
      }
      const sink = createEmailSink({ sendEmail });
      const operatorEmail = config?.providers?.notifier?.operatorEmail;
      return await sink.deliver(payload, { operatorEmail });
    } catch (err) {
      // A notifier failure is logged and swallowed (spec §3.2).
      log.warn('operator notify failed', err);
      return { delivered: false, sink: name, error: String(err?.message || err) };
    }
  }

  return { name, notify };
}

module.exports = {
  createOperatorNotifier,
  internals: { resetDedupeForTest, DEDUPE_WINDOW_MS, isDuplicate },
};
