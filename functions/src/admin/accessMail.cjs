'use strict';

// Access is committed before email preparation. Reuse the central send-once
// claim and email log; there is no background retry or separate mail queue.
const { resolveAdminTier, staffExpiryOf } = require('../core/auth.cjs');
const { checkDemoWrites } = require('../core/demoWrites.cjs');
const { render } = require('../email/render.cjs');
const { loadTemplate } = require('../email/templates.cjs');
const { transactionalStream } = require('../email/stream.cjs');

const TEMPLATE_ID = 'admin.access_granted';
const SEND_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

async function activeAccount({ db, email, now = Date.now }) {
  const snap = await db.collection('config').doc('bootstrap').get();
  const bootstrap = snap.exists ? snap.data() : null;
  const tier = resolveAdminTier(bootstrap, email, now());
  const expiry = tier === 'staff' ? staffExpiryOf(bootstrap, email) : null;
  return { tier, expiresAtMs: expiry?.expiresAtMs ?? null };
}

/** Configured event address, never an inferred host or one-time invitation. */
function adminUrl(config) {
  const raw = config?.tierA?.publicUrl;
  const url = new URL(raw);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Invalid event address');
  }
  return `${raw.trim().replace(/\/+$/, '')}/admin`;
}

/** accepted means the provider accepted it, never that it was delivered. */
async function sendAccessInstructions({ db, getConfig, sendEmail, email, onceKey, now = Date.now, env = process.env, log = console }) {
  let message;
  let send = sendEmail;
  let reason = 'demo-policy';
  try {
    const policy = await checkDemoWrites({ db });
    if (!policy.ok) return { status: 'failed', reason: policy.code };
    reason = 'event-config';
    const config = await getConfig();
    const channel = transactionalStream(config);
    if (!channel.ok) return { status: 'failed', reason: 'transactional-stream' };
    reason = 'email-template';
    const { template, override } = await loadTemplate({ db, id: TEMPLATE_ID });
    // Read live access after preparation, immediately before the send. Ended,
    // malformed and removed grants must never be described as active.
    reason = 'access-check';
    const account = await activeAccount({ db, email, now });
    if (!account.tier) return { status: 'failed', reason: 'inactive-access' };
    reason = 'event-address';
    const url = adminUrl(config);
    reason = 'email-render';
    const rendered = render({
      template, override, config, now: () => new Date(now()),
      tokenValues: {
        access_email: email, access_role: account.tier, admin_url: url,
        access_ends: account.expiresAtMs === null ? '' : new Date(account.expiresAtMs).toISOString(),
      },
    });
    if (rendered.usedFallback) log.warn('Admin access instructions used shipped wording', { reason: 'invalid-template-override' });
    message = {
      ...rendered, subject: rendered.subject.replace(/[\r\n]+/g, ' ').trim(),
      to: email, tag: TEMPLATE_ID, source: 'admin-access', onceKey,
      ...(channel.stream ? { messageStream: channel.stream } : {}),
    };
    if (!send) {
      reason = 'email-provider';
      const { createEmailCore } = require('../email/send.cjs');
      const { getEmailProvider } = require('../email/providers/index.cjs');
      send = createEmailCore({ db, provider: getEmailProvider({ env }), getConfig }).send;
    }
  } catch {
    // Raw exceptions may contain provider credentials or recipient content.
    log.warn('Admin access instructions preparation failed', { reason });
    return { status: 'failed', reason };
  }
  try {
    const result = await send(message);
    // send().skipped means the claim exists, including an interrupted send.
    // It cannot tell us whether the provider ever accepted the earlier call.
    if (result?.skipped || result?.ambiguous) return { status: 'uncertain' };
    if (result?.status === 'sent') {
      return { status: 'accepted', providerMessageId: result.providerMessageId ?? null };
    }
    return { status: 'failed', reason: 'provider-refused' };
  } catch {
    // An unexpected exception at this boundary may follow provider contact.
    log.warn('Admin access instructions acceptance is uncertain', { reason: 'email-send' });
    return { status: 'uncertain' };
  }
}

module.exports = { activeAccount, sendAccessInstructions, SEND_ID_RE };
