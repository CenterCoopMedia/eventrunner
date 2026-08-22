'use strict';

/**
 * The registration prompt a brand-new account gets, decided entirely by the
 * configured ticketing provider (spec §3.5, §9 "New-signup registration
 * email"; issue #33).
 *
 * This module — not `users/lifecycle.cjs` — owns the send. §9's porting-map
 * row is explicit: the unconditional "buy on Eventbrite" mail
 * (`notifyNewUserSignup` → `sendGetTicketEmail`) is rewritten so that
 * `TicketingProvider.getRegistrationPrompt()` owns the CTA label, URL,
 * action, and the decision to suppress the message, and "the caller
 * (`users/lifecycle.cjs`) contains no ticketing knowledge at all" (§3.5).
 * Literally: `users/lifecycle.cjs` has no `require('../ticketing/...')` and
 * this file has no `require('../users/lifecycle.cjs')` beyond reading the
 * `users/{uid}` document shape it already owns (§4.1) — the two modules
 * share a collection, not an import edge.
 *
 * **Wiring: a second `users/{uid}` trigger, not a call from
 * `onUserCreated`.** Two ways to reach "run this after the account document
 * is seeded" were on the table:
 *
 *   1. `users/lifecycle.cjs`'s `onUserCreated` calls into this module
 *      directly after `create()` succeeds.
 *   2. This module registers its OWN `onDocumentCreated('users/{uid}', …)`
 *      Firestore trigger — the same shape `ticketing/entitlement.cjs` uses
 *      for `onTicketWritten` and `users/projection.cjs` uses for
 *      `syncUserPublic`, both cross-module triggers on a collection they do
 *      not own.
 *
 *   (2) is what §3.5 is actually asking for: "contains no ticketing
 *   knowledge AT ALL" is a statement about `lifecycle.cjs`'s import graph,
 *   and a direct call from `createOnUserCreated` would put a
 *   `require('../ticketing/...')` right there, however thin. A second
 *   trigger keeps the account-seeding write and the registration-mail send
 *   as two independent Cloud Functions that both react to the same
 *   document, matching the crash-recovery model the rest of the ticketing
 *   module already relies on: `onDocumentCreated` is at-least-once, this
 *   handler is naturally idempotent (`onceKey` on the send, and a repeat
 *   delivery just re-reads the same `users/{uid}` and re-decides the same
 *   answer), and a mail failure here can never roll back or block the
 *   account document `onUserCreated` already committed.
 *
 * **Scope: `trigger: 'account_created'` only.** §3.5's table has a second
 * column, "Ticket exists, unclaimed" (`trigger: 'ticket_unclaimed'`,
 * template `ticket.claim_prompt`) — every provider already implements that
 * branch of `getRegistrationPrompt` (manual.cjs, eventbrite.cjs), but
 * nothing yet calls it with that trigger value. It fires from a DIFFERENT
 * event than "an account was just created" — a ticket getting imported or
 * synced for an address that already has an account, sometime after
 * sign-up — and neither adapter's `ctaUrl` for that branch is wired to a
 * real page yet either (both return `ctaUrl: null` pending the claim
 * surface this issue also builds; see providers/manual.cjs). Building that
 * second trigger is future work; this module's job per the issue is the
 * new-account prompt, and `sendRegistrationPrompt` below is written so a
 * future caller CAN pass `trigger: 'ticket_unclaimed'` with an
 * `onceKey`-worthy `ticketExternalId` — the function does not hardcode
 * `account_created`.
 */

const TICKETS = require('./index.cjs').internals.TICKETS;
const USERS = 'users';

/** First word of a display name, or ''. Never guessed from the email local part (matches users/lifecycle.cjs). */
function firstNameOf(displayName) {
  const trimmed = typeof displayName === 'string' ? displayName.trim() : '';
  if (!trimmed) return '';
  return trimmed.split(/\s+/)[0];
}

/** ISO date → a short human string, event-local semantics not attempted here (matches render.cjs's other date formatting: pass-through). */
function formatClosesAt(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

/**
 * Whether `uid` has ever claimed a ticket — the second universal skip every
 * provider's `getRegistrationPrompt` applies (§3.5). A `limit(1)` existence
 * probe, the same shape `entitlement.cjs`'s `recomputeEntitlement` uses for
 * `hasValidTicket`/`hasUndecidedTicket` — this is a coarser question ("ever
 * claimed anything", any status) so a refunded or cancelled claim still
 * counts: the account has already been through registration once, whatever
 * its ticket's current standing.
 *
 * @param {{ db: object, uid: string }} args
 */
async function hasClaimedTicket({ db, uid }) {
  const snap = await db.collection(TICKETS).where('claimedByUid', '==', uid).limit(1).get();
  return snap.empty === false;
}

/**
 * Build the RegistrationPromptContext (§3.5) for one account.
 *
 * @param {{ uid: string, userDoc: object, hasClaimedTicket: boolean,
 *           trigger: 'account_created'|'ticket_unclaimed'|'admin_resend' }} args
 * @returns {object} RegistrationPromptContext
 */
function buildContext({ uid, userDoc, hasClaimedTicket: claimed, trigger }) {
  const speakerId = userDoc?.speakerId;
  return {
    user: {
      uid,
      email: typeof userDoc?.email === 'string' ? userDoc.email : null,
      displayName: typeof userDoc?.displayName === 'string' && userDoc.displayName ? userDoc.displayName : null,
    },
    registrationStatus: typeof userDoc?.registrationStatus === 'string' ? userDoc.registrationStatus : 'pending',
    isSpeaker: typeof speakerId === 'string' && speakerId.length > 0,
    hasClaimedTicket: claimed === true,
    trigger,
  };
}

/**
 * The one entry point: decide whether to send, and send it (spec §3.5).
 *
 * @param {{ db: object, provider: object, sendEmail: Function,
 *           getConfig: () => Promise<object>, uid: string,
 *           trigger?: 'account_created'|'ticket_unclaimed'|'admin_resend',
 *           ticketExternalId?: string|null, now?: () => Date, log?: object }} deps
 * @returns {Promise<{ sent: boolean, reason: string, templateId?: string|null }>}
 */
async function sendRegistrationPrompt({
  db, provider, sendEmail, getConfig, uid, trigger = 'account_created',
  ticketExternalId = null, now = () => new Date(), log = console,
}) {
  if (typeof uid !== 'string' || uid.length === 0) {
    return { sent: false, reason: 'no-uid' };
  }

  const userSnap = await db.collection(USERS).doc(uid).get();
  if (!userSnap.exists) {
    // A retried trigger delivery after the account was since deleted, or a
    // delivery that raced ahead of the document write — the create() this
    // trigger reacts to has already committed by the time Firestore invokes
    // it, so this is the "deleted before we got to it" case, not a race.
    return { sent: false, reason: 'no-user' };
  }
  const userDoc = userSnap.data() || {};

  if (!userDoc.email) {
    // No address to send to (e.g. a Google account whose provider omitted
    // one — rare, but not impossible). Nothing this module can do.
    return { sent: false, reason: 'no-email' };
  }

  const claimed = await hasClaimedTicket({ db, uid });
  const context = buildContext({ uid, userDoc, hasClaimedTicket: claimed, trigger });

  const prompt = await provider.getRegistrationPrompt(context);
  if (!prompt?.send || !prompt.templateId) {
    return { sent: false, reason: 'suppressed' };
  }

  const { render } = require('../email/render.cjs');
  const { getDefaultTemplate, loadTemplate } = require('../email/templates.cjs');

  const config = await getConfig();
  const template = getDefaultTemplate(prompt.templateId);
  if (!template) {
    // A provider returning a templateId this deployment does not ship is a
    // provider bug, not a runtime condition to paper over.
    log.error(`registration prompt: unknown templateId "${prompt.templateId}" from provider "${provider.name}"`);
    return { sent: false, reason: 'unknown-template' };
  }
  const { override } = await loadTemplate({ db, id: prompt.templateId, now });

  const tokenValues = {
    first_name: firstNameOf(userDoc.displayName),
    cta_label: prompt.ctaLabel || '',
    cta_url: prompt.ctaUrl || '',
    provider_note: prompt.bodyNote || '',
  };
  if (prompt.templateId === 'ticket.get_ticket') {
    tokenValues.registration_closes = formatClosesAt(config?.event?.registration?.closesAt);
  }
  if (prompt.templateId === 'ticket.claim_prompt') {
    // Not carried on RegistrationPrompt (§3.5) — a ticket's class is a fact
    // about the TICKET, and this caller (account_created) never resolves
    // one. A future ticket_unclaimed caller would pass it in; there is none
    // yet (see module doc).
    tokenValues.ticket_class = '';
  }

  const rendered = render({ template, override, tokenValues, config, now });

  // onceKey shapes are the ADR's send-once table (§3.1), verbatim.
  const onceKey = prompt.templateId === 'ticket.claim_prompt'
    ? `claim-prompt:${ticketExternalId || uid}`
    : `get-ticket:${uid}`;

  const result = await sendEmail({
    to: userDoc.email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    tag: prompt.templateId,
    source: 'ticketing-registration-prompt',
    onceKey,
    storeRendered: rendered.storeRendered,
    hasLegalFooterHtml: rendered.hasLegalFooterHtml,
    hasLegalFooterText: rendered.hasLegalFooterText,
  });

  if (result.status !== 'sent') {
    log.error(`registration prompt: send failed for ${uid}`, result.error);
    return { sent: false, reason: 'send-failed', templateId: prompt.templateId };
  }
  return { sent: true, reason: result.skipped ? 'already-sent' : 'sent', templateId: prompt.templateId };
}

/**
 * Core of the `onUserRegistrationPromptCreated` trigger.
 *
 * @param {{ db: object, provider: object, sendEmail: Function,
 *           getConfig: () => Promise<object>, now?: () => Date, log?: object }} deps
 * @returns {(event: { uid: string }) => Promise<object>}
 */
function createOnUserRegistrationPromptCreated({ db, provider, sendEmail, getConfig, now = () => new Date(), log = console }) {
  return async function onUserRegistrationPromptCreated({ uid }) {
    return sendRegistrationPrompt({ db, provider, sendEmail, getConfig, uid, trigger: 'account_created', now, log });
  };
}

/** Deployable exports (spec §1.3 ticketing/): onUserRegistrationPromptCreated. */
function buildHandlers() {
  const { onDocumentCreated } = require('firebase-functions/v2/firestore');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';

  return {
    onUserRegistrationPromptCreated: onDocumentCreated({
      region,
      document: 'users/{uid}',
      // At-least-once, like every other cross-module users/{uid} trigger
      // (users/projection.cjs syncUserPublic, ticketing/entitlement.cjs
      // onTicketWritten). Idempotent by construction: onceKey makes a
      // repeat delivery a no-op send, and everything else this handler
      // reads is re-read from the live document, never taken from the
      // event snapshot.
      retry: true,
    }, async (event) => {
      const { getDb } = require('../core/firestore.cjs');
      const { getEventConfig } = require('../core/config.cjs');
      const { getTicketingProvider } = require('./providers/index.cjs');
      const { createEmailCore } = require('../email/send.cjs');
      const { getEmailProvider } = require('../email/providers/index.cjs');

      const db = getDb();
      const getConfig = () => getEventConfig({ db });
      const provider = getTicketingProvider({ env: process.env, db, getConfig });
      const emailCore = createEmailCore({ db, provider: getEmailProvider({ env: process.env }), getConfig });

      await createOnUserRegistrationPromptCreated({
        db, provider, sendEmail: emailCore.send, getConfig,
      })({ uid: event.params.uid });
    }),
  };
}

module.exports = {
  sendRegistrationPrompt,
  createOnUserRegistrationPromptCreated,
  get handlers() {
    return buildHandlers();
  },
  internals: { buildContext, hasClaimedTicket, firstNameOf, formatClosesAt, USERS },
};
