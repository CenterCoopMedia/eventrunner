'use strict';

/**
 * Account lifecycle for `users/{uid}` (spec §3.4, §4.1, issue #17).
 *
 *   onUserCreated           auth onCreate — seeds the account document with
 *                           the server-owned defaults: registrationStatus
 *                           'pending' (the only entry state in the §3.4
 *                           table), speakerId null, and the default
 *                           profile visibility. Then it sends the
 *                           `account.welcome` email once (ADR 0001 §3.1).
 *   onUserDeleted          auth onDelete — removes the account document, so
 *                           a deleted sign-in does not leave an unreachable
 *                           profile or a public schedule behind.
 *   maintainProfileComplete users onWrite — recomputes the derived
 *                           `profileComplete` flag.
 *
 * `users` is `allow create: if false` for clients (firestore.rules): the
 * account document is created here, on the server, so no client can hand
 * itself a registrationStatus or a speakerId at creation time. The profile
 * setup flow in apps/web *updates* this document; it never creates it.
 *
 * The auth trigger is the one hook both sign-in paths share — Google popup
 * sign-in never reaches a function of ours, so seeding from the OTP
 * handler would leave Google accounts without a document.
 */

const {
  DEFAULT_PROFILE_VISIBILITY,
  isProfileComplete,
} = require('shared/profile');

const { checkDemoWrites, throwIfDemoPolicyUnavailable } = require('../core/demoWrites.cjs');
const { REPRESENTATIVES, EDIT_REQUESTS } = require('../cms/organizationRepresentatives.cjs');

const USERS = 'users';
const USERS_PUBLIC = 'users_public';
const SCHEDULE_SHARES = 'schedule_shares';

/**
 * The server-owned shape of a brand-new account (spec §3.4).
 * Pure — no db, no clock beyond the injected `now`.
 *
 * @param {{ uid: string, email?: string|null, displayName?: string|null }} authUser
 * @param {Date} now
 * @returns {object} the users/{uid} document
 */
function buildNewUserDoc(authUser, now) {
  const email = typeof authUser?.email === 'string' ? authUser.email.trim().toLowerCase() : null;
  const displayName = typeof authUser?.displayName === 'string' ? authUser.displayName.trim() : '';
  return {
    uid: authUser.uid,
    email,
    // Seeded from the identity provider when it supplied one, so a Google
    // sign-in lands with a usable name; the owner can change it in the
    // profile flow. Never guessed from the email local part.
    displayName,
    pronouns: '',
    bio: '',
    organization: '',
    jobTitle: '',
    photoPath: null,
    socialHandles: {},
    badges: [],
    profileVisibility: DEFAULT_PROFILE_VISIBILITY,
    profileComplete: false,
    // Server-owned from here down (spec §3.4): the client rules deny every
    // one of these fields on self-update.
    registrationStatus: 'pending',
    approvalSource: null,
    speakerId: null,
    role: 'attendee',
    createdAt: now,
    updatedAt: now,
  };
}

/** First word of a display name, or 'there'. Never guessed from the email local part. */
function welcomeName(displayName) {
  const trimmed = typeof displayName === 'string' ? displayName.trim() : '';
  return trimmed ? trimmed.split(/\s+/)[0] : 'there';
}

/**
 * The welcome email (ADR 0001 §3.1, §6.2): once per account, through the
 * one send path. The `welcome:{uid}` claim makes a repeat delivery send
 * nothing. Never throws: the account document is already written, and a
 * retry for a lost email would only repeat the trigger. An admin resend is
 * the recovery path.
 *
 * @returns {Promise<{ sent: boolean, reason: string }>}
 */
async function sendWelcomeEmail({ db, sendEmail, getConfig, uid, email, displayName, now, log }) {
  if (!email) return { sent: false, reason: 'no-email' };
  try {
    const { render } = require('../email/render.cjs');
    const { loadTemplate } = require('../email/templates.cjs');
    const { transactionalStream } = require('../email/stream.cjs');
    const { listedAdminTier, loadBootstrap } = require('../core/auth.cjs');
    // Whoever runs the site is not welcomed to it: an Owner or an Editor
    // gets no welcome, as with the ticket prompt (ticketing/registrationPrompt.cjs).
    if (listedAdminTier(await loadBootstrap({ db }), email)) return { sent: false, reason: 'site-team' };
    const config = await getConfig();
    const site = String(config?.tierA?.publicUrl || '').trim().replace(/\/+$/, '');
    // login_url is the required token; without a site address it is empty.
    if (!site) return { sent: false, reason: 'no-site-url' };
    // Never on the announcement stream (issue #330).
    const channel = transactionalStream(config);
    if (!channel.ok) return { sent: false, reason: 'transactional-stream' };
    const { template, override } = await loadTemplate({ db, id: 'account.welcome', now: () => now().getTime() });
    const rendered = render({
      template, override, config, now,
      tokenValues: { first_name: welcomeName(displayName), profile_url: `${site}/profile` },
    });
    if (rendered.usedFallback) log.warn('account.welcome used the shipped wording', { reason: 'invalid-template-override' });
    const result = await sendEmail({
      to: email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      tag: 'account.welcome',
      source: 'account-welcome',
      onceKey: `welcome:${uid}`,
      storeRendered: rendered.storeRendered,
      hasLegalFooterHtml: rendered.hasLegalFooterHtml,
      hasLegalFooterText: rendered.hasLegalFooterText,
      ...(channel.stream ? { messageStream: channel.stream } : {}),
    });
    // The send boundary checks the demo policy again; its refusal is a skip.
    if (result?.error === 'read-only-demo') return { sent: false, reason: 'read-only-demo' };
    if (result?.status !== 'sent') {
      log.error('account.welcome email was not sent', { uid, error: result?.error ?? null });
      return { sent: false, reason: 'send-failed' };
    }
    return { sent: true, reason: result.skipped ? 'already-sent' : 'sent' };
  } catch (err) {
    log.error('account.welcome email failed', { uid, error: String(err?.message || err) });
    return { sent: false, reason: 'error' };
  }
}

/**
 * Core of the auth onCreate trigger.
 *
 * Uses create(), not set(): if a document already exists for the uid (a
 * retried trigger delivery, or an account re-created against a
 * hand-seeded document) the existing record — which may already carry an
 * approval — must win over a fresh `pending` default. ALREADY_EXISTS is
 * therefore success, not an error.
 *
 * Then the welcome email, when `sendEmail` is given. It goes in both cases:
 * the ticket path (createUserFromTicket) can write the document before
 * this trigger runs, and the send-once key stops a second email.
 *
 * @param {{ db: object, now?: () => Date, log?: { error: Function, warn?: Function },
 *           sendEmail?: Function, getConfig?: () => Promise<object> }} deps
 * @returns {(authUser: { uid: string, email?: string|null, displayName?: string|null })
 *   => Promise<{ created: boolean }>}
 */
function createOnUserCreated({ db, now = () => new Date(), log = console, sendEmail = null, getConfig = null }) {
  return async function onUserCreated(authUser) {
    if (!authUser || typeof authUser.uid !== 'string' || authUser.uid.length === 0) {
      log.error('onUserCreated called without a uid');
      return { created: false };
    }
    // Auth onCreate runs after the identity exists (including Google sign-in).
    // Suppress our account record and downstream signup work, not the identity.
    const policy = await checkDemoWrites({ db });
    throwIfDemoPolicyUnavailable(policy);
    if (!policy.ok) return { created: false, reason: policy.code };

    const doc = buildNewUserDoc(authUser, now());
    let created = true;
    try {
      await db.collection(USERS).doc(authUser.uid).create(doc);
    } catch (err) {
      if (!(err && (err.code === 6 || err.code === 'already-exists'))) throw err;
      created = false;
    }
    if (sendEmail && getConfig) {
      await sendWelcomeEmail({
        db, sendEmail, getConfig, uid: authUser.uid, email: doc.email, displayName: doc.displayName, now, log,
      });
    }
    return { created };
  };
}

/**
 * Remove a deleted account's organization representative access (issue
 * #334). deleteAttendee clears both stores itself, but an account deleted
 * straight from Firebase Auth reaches only this trigger. The grant goes
 * first, so no new edit can be queued under the account; then every edit
 * this account sent and nobody has reviewed. The query runs in a
 * transaction, so an edit another representative sent in the meantime is
 * read as theirs and kept. Idempotent, so a retried delivery is safe.
 */
async function removeRepresentativeAccess({ db, uid }) {
  const grantRef = db.collection(REPRESENTATIVES).doc(uid);
  if ((await grantRef.get()).exists) await grantRef.delete();
  await db.runTransaction(async (tx) => {
    const sent = await tx.get(db.collection(EDIT_REQUESTS).where('submittedByUid', '==', uid));
    for (const request of sent.docs) tx.delete(request.ref);
  });
}

/**
 * Core of the auth onDelete trigger.
 *
 * A deleted Firebase Auth account whose `users/{uid}` document survives is
 * a profile nobody can sign in to, edit, or remove — and its `users_public`
 * projection stays readable in the directory forever. Deleting the account
 * document and both public projections are removed directly. Cleanup does
 * not depend on downstream trigger delivery; retries also remove projections
 * when the account document is already absent.
 * Organization representative access goes in either case (issue #334).
 *
 * @param {{ db: object, log?: { error: Function } }} deps
 * @returns {(authUser: { uid: string }) => Promise<{ deleted: boolean }>}
 */
function createOnUserDeleted({ db, getBucket, now = () => new Date(), log = console, clearStores = defaultClearStores }) {
  return async function onUserDeleted(authUser) {
    const uid = authUser && typeof authUser.uid === 'string' ? authUser.uid : '';
    if (uid.length === 0) {
      log.error('onUserDeleted called without a uid');
      return { deleted: false };
    }
    await removeRepresentativeAccess({ db, uid });
    const userRef = db.collection(USERS).doc(uid);
    const existing = await userRef.get();
    if (existing.exists) {
      await userRef.delete();
    }
    await db.collection(USERS_PUBLIC).doc(uid).delete();
    await db.collection(SCHEDULE_SHARES).doc(uid).delete();
    // The same clearing deleteAttendee does: release the ticket claims, so
    // another account can claim them, and remove answers, notes, bookmarks,
    // photos and change requests. A store that fails throws, so the trigger
    // retries; every sweep is idempotent.
    const { failed } = await clearStores({ db, getBucket, uid, now, log });
    if (failed.length > 0) throw new Error(`onUserDeleted: could not clear ${failed.join(', ')}`);
    return { deleted: existing.exists };
  };
}

function defaultClearStores(deps) {
  // Required here, not at the top: records.cjs loads the admin and CMS
  // modules, which the sign-up trigger does not need.
  return require('./records.cjs').clearAccountStores(deps);
}

/**
 * Core of the derived-field trigger: `users.profileComplete` mirrors
 * isProfileComplete() over the fields the owner does control.
 *
 * Loop-safe by construction — it writes only when the stored flag differs
 * from the computed one, so the write it makes cannot trigger another
 * write.
 *
 * @param {{ db: object, log?: { error: Function } }} deps
 * @returns {(change: { uid: string, after: object|null }) =>
 *   Promise<{ action: 'written'|'unchanged' }>}
 */
function createMaintainProfileComplete({ db, log = console }) {
  return async function maintainProfileComplete({ uid, after }) {
    if (typeof uid !== 'string' || uid.length === 0) {
      log.error('maintainProfileComplete called without a uid');
      return { action: 'unchanged' };
    }
    if (after == null) return { action: 'unchanged' }; // account deleted
    const computed = isProfileComplete(after);
    if (after.profileComplete === computed) return { action: 'unchanged' };
    await db.collection(USERS).doc(uid).update({ profileComplete: computed });
    return { action: 'written' };
  };
}

/** Deployable exports (spec §1.3 users/): onUserCreated, onUserDeleted,
 * maintainProfileComplete. */
function buildHandlers() {
  // Auth background triggers have no v2 equivalent (v2 offers only the
  // blocking identity functions, which run inside the sign-in request and
  // fail it on error). Seeding an account document must never be able to
  // block a sign-in, so this stays a v1 background trigger.
  const functionsV1 = require('firebase-functions/v1');
  const { onDocumentWritten } = require('firebase-functions/v2/firestore');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';

  // failurePolicy: retry on error. Clients cannot create their own account
  // document (firestore.rules), so a single transient failure here would
  // otherwise leave an account that can never be seeded — permanently
  // stuck at "setting up your account". Retries are safe by construction:
  // onUserCreated uses create() and treats ALREADY_EXISTS as success, its
  // welcome email has a send-once key and never throws, and onUserDeleted's
  // deletes are idempotent.
  const retryOnFailure = { failurePolicy: true };
  // onUserCreated sends the welcome email, so it binds the provider's send
  // secrets.
  const { defineSecret } = require('firebase-functions/params');
  const { SEND_SECRETS_BY_PROVIDER } = require('../email/send.cjs').internals;
  const sendSecrets = (SEND_SECRETS_BY_PROVIDER[(process.env.EVENT_EMAIL_PROVIDER || '').trim()] || []).map(defineSecret);

  return {
    onUserCreated: functionsV1
      .runWith({ ...retryOnFailure, secrets: sendSecrets })
      .region(region)
      .auth.user()
      .onCreate(async (authUser) => {
        const { getDb } = require('../core/firestore.cjs');
        const { getEventConfig } = require('../core/config.cjs');
        const db = getDb();
        const getConfig = () => getEventConfig({ db });
        // Built on first use, so a missing email provider fails only the
        // email, never the account document.
        const sendEmail = (message) => {
          const { createEmailCore } = require('../email/send.cjs');
          const { getEmailProvider } = require('../email/providers/index.cjs');
          return createEmailCore({ db, provider: getEmailProvider({ env: process.env }), getConfig }).send(message);
        };
        await createOnUserCreated({ db, sendEmail, getConfig })({
          uid: authUser.uid,
          email: authUser.email,
          displayName: authUser.displayName,
        });
      }),
    onUserDeleted: functionsV1
      .runWith(retryOnFailure)
      .region(region)
      .auth.user()
      .onDelete(async (authUser) => {
        const { getDb } = require('../core/firestore.cjs');
        const { getBucket } = require('../core/storage.cjs');
        await createOnUserDeleted({ db: getDb(), getBucket })({ uid: authUser.uid });
      }),
    maintainProfileComplete: onDocumentWritten(
      { region, document: 'users/{uid}' },
      async (event) => {
        const { getDb } = require('../core/firestore.cjs');
        const after = event.data?.after;
        await createMaintainProfileComplete({ db: getDb() })({
          uid: event.params.uid,
          after: after && after.exists ? after.data() : null,
        });
      },
    ),
  };
}

module.exports = {
  buildNewUserDoc,
  createOnUserCreated,
  createOnUserDeleted,
  createMaintainProfileComplete,
  get handlers() {
    return buildHandlers();
  },
  internals: { USERS, USERS_PUBLIC },
};
