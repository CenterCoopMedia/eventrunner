'use strict';

/**
 * Speaker invite pipeline (spec §4.3, §9 "Speaker invite pipeline", issue
 * #21).
 *
 *   sendSpeakerInvite      admin POST — draft → invited, mints one
 *                          single-use token, mails speaker.invite
 *   resendSpeakerInvite    admin POST — new token, old one dies, rate-limited
 *   cancelSpeakerInvite    admin POST — token dies, invited → draft
 *   listSpeakerInvites     admin POST — invite status for the admin list
 *   validateSpeakerInvite  public POST — token → "is this link usable, and
 *                          whose is it", nothing more
 *   acceptSpeakerInvite    authenticated POST — the §4.3 seam: link the
 *                          account, transition invited → accepted, burn the
 *                          token, mail the confirmation
 *
 * **The token is hashed at rest** and the digest is the `speaker_invites`
 * document id; ./inviteTokens.cjs explains why the digest is SHA-256 here
 * and scrypt in auth/challenges.cjs.
 *
 * **Acceptance requires an authenticated uid.** There is no sign-in inside
 * this pipeline: the speaker signs in first, through the paths that already
 * exist (Google popup, or the emailed six-digit code in auth/otp.cjs), and
 * acceptance verifies the resulting ID token. §9 retires `sendCustomMagicLink`
 * entirely, so an invite link is NOT a credential that logs anybody in — it
 * is a claim ticket presented BY an already-authenticated account. That is
 * also why a leaked invite URL cannot, on its own, take over an identity:
 * the leaker still has to sign in as somebody, and whoever they sign in as
 * is the account the invitation gets bound to and audited against.
 *
 * **Ordering inside acceptance: link first, invalidate second.** The pair
 * write (`linkSpeakerToUser`, §4.3 seam #3) is its own transaction and the
 * status/token transition is a second one. Doing it the other way round —
 * burning the token first — makes a failed link unrecoverable: the speaker
 * would hold a consumed invitation, no account link, and no way back
 * without an admin resend. In this order a failure leaves the invitation
 * intact and the whole handler safely repeatable, because re-linking the
 * SAME (speaker, uid) pair passes lifecycle.cjs's occupant check by
 * construction. The window it opens — linked but still `invited` — cannot
 * be exploited by a second holder of the same token: their link attempt is
 * refused with the 409 `link-occupied` naming the occupying speaker.
 *
 * **Invite address vs. signed-in address.** A mismatch is ACCEPTED and
 * recorded, never refused. §4.3 states exactly one rule about who may hold
 * the link — the pair is single-valued and written only here — and
 * lifecycle.cjs already enforces it by refusing an occupied target. An
 * address equality check would add no security (a token holder can create
 * an account at any address they control, so it filters nobody) while
 * breaking the ordinary case the spec's own §4.3 note anticipates: the
 * organizer has the speaker's work address, the speaker signs in with the
 * Google account they actually use. So acceptance stores `acceptedEmail`
 * beside the invited address and reports the mismatch to both parties —
 * the accept page tells the speaker which account they just bound, and
 * listSpeakerInvites shows the admin the address that accepted.
 */

const { requireAdmin, verifyAuthToken } = require('../core/auth.cjs');
const { sendError, badRequest, notFound, methodNotAllowed, internal } = require('../core/errors.cjs');
const { logAdminAction, isValidDocId, isAlreadyExistsError } = require('../cms/store.cjs');
const { speakerDisplayName } = require('shared/speaker');
const { linkSpeakerToUser } = require('./lifecycle.cjs');
const {
  SPEAKER_INVITES,
  INVITE_TTL_MS,
  INVITABLE_SPEAKER_STATUSES,
  mintInviteToken,
  hashInviteToken,
  isWellFormedToken,
  timestampMs,
  buildInviteUrl,
  maskEmail,
  invalidateInviteInTx,
} = require('./inviteTokens.cjs');

const SPEAKERS = 'speakers';

/**
 * What an invitation is FOR. Rendered into `{{invite_type}}` (spec §6.2),
 * so it is an allowlist rather than free text: the value reaches an email
 * body, and an admin-supplied string there is user content in a template
 * slot the shipped copy reads as a noun.
 */
const INVITE_TYPES = Object.freeze(['speaker', 'panelist', 'moderator', 'workshop leader']);
const DEFAULT_INVITE_TYPE = 'speaker';

/**
 * Per-speaker send budget: 5 invite mails (send + resend together) per
 * hour. This is a control on the SPEAKER'S inbox, not on the admin — an
 * organizer clicking "resend" repeatedly, or two organizers doing it at
 * once, is the realistic way a speaker gets mail-bombed by their own event.
 *
 * It is NOT the OTP send ceiling (auth/challenges.cjs). That one guards an
 * unauthenticated endpoint against a stranger spending the deployment's
 * mail budget; this endpoint is already behind `requireAdmin`, so the
 * threat is volume at one recipient rather than an anonymous flood, and
 * borrowing the global ceiling would let invite traffic lock every attendee
 * out of sign-in.
 *
 * Stored as a timestamp list on the speaker document (`inviteSends`) and
 * filtered on read — the same shape `auth_rate_limits` uses — because it is
 * written inside the transaction that mints the token anyway, so it costs
 * no extra document and cannot disagree with the send it is counting.
 */
const SEND_LIMIT_MAX = 5;
const SEND_LIMIT_WINDOW_MS = 60 * 60 * 1000;

/** Newest-first cap for listSpeakerInvites. */
const MAX_LISTED_INVITES = 200;

/** Shared admin-POST preamble. Sends the response itself on failure. */
async function gateAdminPost({ auth, getConfig }, req, res) {
  if (req.method !== 'POST') {
    methodNotAllowed(res, ['POST']);
    return null;
  }
  const verdict = await requireAdmin({ auth, getConfig }, req);
  if (!verdict.ok) {
    sendError(res, verdict.status, verdict.code, verdict.message);
    return null;
  }
  return { uid: verdict.uid, email: verdict.email };
}

/** ISO string for whatever timestamp shape the store handed back. */
function isoOrNull(value) {
  const ms = timestampMs(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * Mint and record one invitation.
 *
 * The token is returned to the CALLER (the handler, which mails it) and is
 * never part of an HTTP response: the only way to learn it is to receive
 * the invitation.
 *
 * @param {{ db: object, speakerId: unknown, inviteType: string, mode: 'send'|'resend',
 *           actor: { uid: string, email: string }, now?: () => number }} args
 * @returns {Promise<{ ok: true, token: string, tokenHash: string, speakerId: string,
 *                     speaker: object, expiresAt: Date } |
 *                    { ok: false, status: number, code: string, message: string }>}
 */
async function applyMintInvite({ db, speakerId, inviteType, mode, actor, now = Date.now }) {
  if (!isValidDocId(speakerId)) {
    return { ok: false, status: 400, code: 'bad-request', message: 'speakerId: required' };
  }
  if (!INVITE_TYPES.includes(inviteType)) {
    return {
      ok: false,
      status: 400,
      code: 'bad-request',
      message: `inviteType: must be one of ${INVITE_TYPES.join(', ')}`,
    };
  }

  const nowMs = now();
  const at = new Date(nowMs);
  const expiresAt = new Date(nowMs + INVITE_TTL_MS);
  const token = mintInviteToken();
  const tokenHash = hashInviteToken(token);
  const speakerRef = db.collection(SPEAKERS).doc(speakerId);

  let speaker;
  try {
    speaker = await db.runTransaction(async (tx) => {
      const snap = await tx.get(speakerRef);
      if (!snap.exists) {
        const err = new Error('NOT_FOUND');
        err.conflict = { status: 404, code: 'not-found', message: `No speaker with id "${speakerId}".` };
        throw err;
      }
      const stored = snap.data();

      const email = typeof stored.email === 'string' ? stored.email.trim() : '';
      if (!email) {
        const err = new Error('NO_EMAIL');
        err.conflict = {
          status: 400,
          code: 'bad-request',
          message: 'email: this speaker has no email address; add one before inviting them.',
        };
        throw err;
      }

      // Transition guards. `approved` and `removed` are refused by name so
      // the admin learns WHY rather than seeing a generic rejection: an
      // approved speaker is already through the pipeline, and inviting a
      // removed one would resurrect them into `invited` behind the
      // organizer's back.
      const status = typeof stored.status === 'string' ? stored.status : 'draft';
      if (mode === 'send' && !INVITABLE_SPEAKER_STATUSES.includes(status)) {
        const err = new Error('BAD_STATUS');
        err.conflict = {
          status: 409,
          code: 'invalid-status',
          message: status === 'invited'
            ? 'This speaker already has an outstanding invitation. Resend it, or cancel it first.'
            : `A speaker with status "${status}" cannot be invited. Only a draft speaker can.`,
        };
        throw err;
      }
      if (mode === 'resend' && status !== 'invited') {
        const err = new Error('BAD_STATUS');
        err.conflict = {
          status: 409,
          code: 'invalid-status',
          message: `There is no outstanding invitation to resend; this speaker's status is "${status}".`,
        };
        throw err;
      }

      // Per-speaker send budget, in the same commit as the token it counts.
      const sends = (Array.isArray(stored.inviteSends) ? stored.inviteSends : [])
        .map((value) => timestampMs(value))
        .filter((ms) => Number.isFinite(ms) && nowMs - ms < SEND_LIMIT_WINDOW_MS);
      if (sends.length >= SEND_LIMIT_MAX) {
        const oldest = Math.min(...sends);
        const err = new Error('RATE_LIMITED');
        err.conflict = {
          status: 429,
          code: 'rate-limited',
          message:
            `This speaker has already been sent ${sends.length} invitation emails in the last hour. ` +
            'Nothing was changed; try again later.',
          retryAfterMs: Math.max(0, oldest + SEND_LIMIT_WINDOW_MS - nowMs),
        };
        throw err;
      }
      sends.push(nowMs);

      // A resend kills the previous token in this same commit, so there is
      // never a moment where two invitations for one speaker both work.
      const invalidation = mode === 'resend'
        ? invalidateInviteInTx({ tx, db, speaker: stored, at, status: 'superseded', actorEmail: actor.email })
        : {};

      tx.create(db.collection(SPEAKER_INVITES).doc(tokenHash), {
        speakerId,
        email: email.toLowerCase(),
        inviteType,
        status: 'pending',
        expiresAt,
        createdAt: at,
        createdBy: actor.email,
        // Stamped only once the provider has accepted the mail, so an
        // invitation that was recorded but never delivered is visible as
        // such in the admin list instead of looking sent.
        sentAt: null,
        updatedAt: at,
      });
      tx.set(
        speakerRef,
        {
          ...invalidation,
          status: 'invited',
          inviteToken: tokenHash,
          inviteSends: sends.map((ms) => new Date(ms)),
          updatedAt: at,
          updatedBy: actor.email,
        },
        { merge: true },
      );
      return { ...stored, email };
    });
  } catch (err) {
    if (err?.conflict) return { ok: false, ...err.conflict };
    if (isAlreadyExistsError(err)) {
      // Two mints colliding on one 32-byte token is not a real event; if it
      // ever happens, refusing is right — the caller retries and gets a new
      // token rather than overwriting somebody's live invitation.
      return { ok: false, status: 409, code: 'already-exists', message: 'Could not mint an invitation; try again.' };
    }
    throw err;
  }

  return { ok: true, token, tokenHash, speakerId, speaker, expiresAt };
}

/**
 * Render and send one speaker.invite mail.
 *
 * The send-boundary gate mirrors §6.1's auth-mail rule: refuse to send a
 * rendered invitation whose html and text do not BOTH carry the invite URL.
 * A mail without its link is exactly as useless as an OTP mail without its
 * code, and the recipient has no way to tell that the version they got was
 * broken.
 *
 * @returns {Promise<{ ok: true } | { ok: false, code: string, message: string }>}
 */
async function sendInviteEmail({
  db, sendEmail, getConfig, speaker, token, inviteType, actor, onceKey, now = Date.now, log = console,
}) {
  const { render } = require('../email/render.cjs');
  const { getDefaultTemplate, loadTemplate } = require('../email/templates.cjs');

  const config = await getConfig();
  const inviteUrl = buildInviteUrl(config, token);
  const template = getDefaultTemplate('speaker.invite');
  const { override } = await loadTemplate({ db, id: 'speaker.invite', now });
  const rendered = render({
    template,
    override,
    tokenValues: {
      speaker_name: speakerDisplayName(speaker),
      invite_url: inviteUrl,
      invite_type: inviteType,
      // The organizer who sent it, so a confused recipient reaches a human
      // rather than a shared inbox; the deployment's support address is the
      // fallback when the actor has none.
      admin_contact_email: actor.email || config?.event?.legal?.supportEmail || '',
    },
    config,
  });

  if (!(rendered.html || '').includes(inviteUrl) || !(rendered.text || '').includes(inviteUrl)) {
    log.error('speaker.invite render lacks the invite URL in html and/or text; refusing to send');
    return { ok: false, code: 'internal', message: 'The invitation email could not be prepared.' };
  }

  const result = await sendEmail({
    to: speaker.email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    tag: 'speaker.invite',
    source: 'speaker-invite',
    onceKey,
    storeRendered: rendered.storeRendered,
    hasLegalFooterHtml: rendered.hasLegalFooterHtml,
    hasLegalFooterText: rendered.hasLegalFooterText,
  });
  if (result.status !== 'sent') {
    return { ok: false, code: 'send-failed', message: 'The invitation could not be emailed. Try resending it.' };
  }
  return { ok: true };
}

/**
 * Cancel an outstanding invitation: the token dies and the speaker goes
 * back to `draft`.
 *
 * `draft` is the only reversion the §4.3 vocabulary allows — it is defined
 * as "an admin-created record that has not been invited", which is exactly
 * what a cancelled invitation leaves behind. There is no separate
 * "cancelled" speaker status, and inventing one would put a value on
 * `speakers.status` that neither the projection nor the admin CRUD knows.
 *
 * @param {{ db: object, speakerId: unknown, actor: { uid: string, email: string },
 *           now?: () => number }} args
 */
async function applyCancelInvite({ db, speakerId, actor, now = Date.now }) {
  if (!isValidDocId(speakerId)) {
    return { ok: false, status: 400, code: 'bad-request', message: 'speakerId: required' };
  }
  const at = new Date(now());
  const speakerRef = db.collection(SPEAKERS).doc(speakerId);

  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(speakerRef);
      if (!snap.exists) {
        const err = new Error('NOT_FOUND');
        err.conflict = { status: 404, code: 'not-found', message: `No speaker with id "${speakerId}".` };
        throw err;
      }
      const stored = snap.data();
      if (stored.status !== 'invited') {
        const err = new Error('BAD_STATUS');
        err.conflict = {
          status: 409,
          code: 'invalid-status',
          message: stored.status === 'accepted'
            ? 'This invitation has already been accepted. Removing the speaker is what unlinks the account.'
            : `There is no outstanding invitation to cancel; this speaker's status is "${stored.status}".`,
        };
        throw err;
      }
      const invalidation = invalidateInviteInTx({
        tx, db, speaker: stored, at, status: 'cancelled', actorEmail: actor.email,
      });
      tx.set(
        speakerRef,
        { ...invalidation, status: 'draft', updatedAt: at, updatedBy: actor.email },
        { merge: true },
      );
    });
  } catch (err) {
    if (err?.conflict) return { ok: false, ...err.conflict };
    throw err;
  }
  return { ok: true, speakerId, status: 'draft' };
}

/**
 * Resolve a raw token to its invitation, with ONE failure vocabulary.
 *
 * Two outcomes only: `invalid` and `expired`. Everything a token holder
 * could otherwise learn — unknown token, cancelled by an admin, superseded
 * by a resend, already accepted, speaker deleted — collapses into
 * `invalid`, so the answer never reports an organizer's decision back to
 * whoever is holding the link.
 *
 * `expired` is kept distinct deliberately, and it is not an oracle worth
 * the name: distinguishing it requires already holding a real 256-bit
 * token, which no guessing reaches, and the distinction exists entirely for
 * the legitimate holder of a stale link — who otherwise sees "this link is
 * invalid" for a link that WAS theirs and needs a resend, not a support
 * ticket.
 *
 * @param {{ db: object, token: unknown, now?: () => number }} args
 * @returns {Promise<{ ok: true, tokenHash: string, invite: object, speaker: object, speakerId: string } |
 *                    { ok: false, reason: 'invalid'|'expired' }>}
 */
async function resolveInvite({ db, token, now = Date.now }) {
  if (!isWellFormedToken(token)) return { ok: false, reason: 'invalid' };
  const tokenHash = hashInviteToken(token);

  const inviteSnap = await db.collection(SPEAKER_INVITES).doc(tokenHash).get();
  if (!inviteSnap.exists) return { ok: false, reason: 'invalid' };
  const invite = inviteSnap.data();
  if (invite.status !== 'pending') return { ok: false, reason: 'invalid' };

  const expires = timestampMs(invite.expiresAt);
  if (!Number.isFinite(expires) || now() >= expires) return { ok: false, reason: 'expired' };

  const speakerSnap = await db.collection(SPEAKERS).doc(invite.speakerId).get();
  if (!speakerSnap.exists) return { ok: false, reason: 'invalid' };
  const speaker = speakerSnap.data();
  // Both halves must agree. The speaker document is authoritative about
  // which token is current, so an invite row that survived a rotation
  // (a partially applied write, a hand edit) can never be accepted.
  if (speaker.status !== 'invited' || speaker.inviteToken !== tokenHash) {
    return { ok: false, reason: 'invalid' };
  }
  return { ok: true, tokenHash, invite, speaker, speakerId: invite.speakerId };
}

/**
 * The §4.3 acceptance seam.
 *
 * @param {{ db: object, token: unknown, uid: string, email: string|null,
 *           now?: () => number }} args
 * @returns {Promise<{ ok: true, speakerId: string, speakerName: string,
 *                     emailMismatch: boolean, alreadyAccepted: boolean, speaker: object,
 *                     invitedEmail: string } |
 *                    { ok: false, status: number, code: string, message: string }>}
 */
async function applyAcceptInvite({ db, token, uid, email, now = Date.now }) {
  const resolved = await resolveInvite({ db, token, now });
  if (!resolved.ok) {
    return resolved.reason === 'expired'
      ? {
        ok: false,
        status: 410,
        code: 'invite-expired',
        message: 'This invitation has expired. Ask the organizers to send a new one.',
      }
      : {
        ok: false,
        status: 401,
        code: 'invite-invalid',
        message: 'This invitation link is not valid. Ask the organizers to send a new one.',
      };
  }

  const { speakerId, tokenHash } = resolved;
  const accountEmail = typeof email === 'string' ? email.trim().toLowerCase() : null;
  const invitedEmail = typeof resolved.speaker.email === 'string' ? resolved.speaker.email : '';

  // Step 1 — the pair write (§4.3 seam #3). Idempotent for the same
  // (speaker, uid), which is what makes the whole handler retriable.
  const link = await linkSpeakerToUser({ db, speakerId, uid, now });
  if (!link.ok) {
    if (link.code === 'link-occupied') {
      return {
        ok: false,
        status: 409,
        code: 'link-occupied',
        // lifecycle.cjs's message names the occupying speaker, which is the
        // only actionable part; it is admin-facing detail, so the handler
        // trims it for the public response.
        message:
          'The account you are signed in as is already linked to a different speaker record. ' +
          'Sign in with the account you use for this event, or ask the organizers to unlink the other record.',
      };
    }
    if (link.code === 'link-target-missing') {
      return {
        ok: false,
        status: 409,
        code: 'account-not-ready',
        message: 'Your account is still being set up. Wait a moment and try again.',
      };
    }
    return { ok: false, status: link.status, code: link.code, message: link.message };
  }

  // Step 2 — burn the token and move the pipeline state.
  const at = new Date(now());
  let alreadyAccepted = false;
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(db.collection(SPEAKERS).doc(speakerId));
      if (!snap.exists) {
        const err = new Error('NOT_FOUND');
        err.conflict = { status: 404, code: 'not-found', message: 'This invitation is no longer valid.' };
        throw err;
      }
      const stored = snap.data();
      // A retry after a dropped response, or a double-click: the pair is
      // already ours and the token is already burned, so report success
      // rather than a conflict the speaker cannot act on.
      if (stored.status === 'accepted' && stored.uid === uid) {
        alreadyAccepted = true;
        return;
      }
      if (stored.status !== 'invited' || stored.inviteToken !== tokenHash) {
        const err = new Error('RACED');
        err.conflict = {
          status: 409,
          code: 'invite-invalid',
          message: 'This invitation is no longer valid. Ask the organizers to send a new one.',
        };
        throw err;
      }
      tx.set(
        db.collection(SPEAKER_INVITES).doc(tokenHash),
        {
          status: 'accepted',
          acceptedAt: at,
          acceptedByUid: uid,
          acceptedEmail: accountEmail,
          updatedAt: at,
        },
        { merge: true },
      );
      tx.set(
        db.collection(SPEAKERS).doc(speakerId),
        {
          status: 'accepted',
          inviteToken: null,
          acceptedAt: at,
          // Recorded, never enforced (see the module header): the address
          // that actually accepted, beside the address that was invited.
          acceptedEmail: accountEmail,
          updatedAt: at,
          updatedBy: accountEmail || uid,
        },
        { merge: true },
      );
    });
  } catch (err) {
    if (err?.conflict) return { ok: false, ...err.conflict };
    throw err;
  }

  return {
    ok: true,
    speakerId,
    speakerName: speakerDisplayName(resolved.speaker),
    speaker: resolved.speaker,
    invitedEmail,
    emailMismatch: Boolean(accountEmail && invitedEmail && accountEmail !== invitedEmail.toLowerCase()),
    alreadyAccepted,
  };
}

/**
 * The acceptance confirmation (spec §3.1 send-once table:
 * `speaker.accepted` → `speaker-accepted:{speakerId}`).
 *
 * Best-effort by design: the acceptance is already durable when this runs,
 * and a mail failure must not turn a completed link into an error the
 * speaker would answer by trying again with a token that no longer exists.
 */
async function sendAcceptedEmail({ db, sendEmail, getConfig, speakerId, speaker, now = Date.now, log = console }) {
  try {
    const { render } = require('../email/render.cjs');
    const { getDefaultTemplate, loadTemplate } = require('../email/templates.cjs');
    const config = await getConfig();
    const site = String(config?.tierA?.publicUrl || '').replace(/\/+$/, '');
    const days = Array.isArray(config?.event?.days) ? config.event.days : [];
    const template = getDefaultTemplate('speaker.accepted');
    const { override } = await loadTemplate({ db, id: 'speaker.accepted', now });
    const rendered = render({
      template,
      override,
      tokenValues: {
        speaker_name: speakerDisplayName(speaker),
        profile_wizard_url: site ? `${site}/profile` : '',
        // Declared but unreferenced in the shipped copy; a client override
        // that wants a deadline gets the event's first day rather than an
        // empty substitution and a warning.
        deadline: typeof days[0]?.date === 'string' ? days[0].date : '',
      },
      config,
    });
    await sendEmail({
      to: speaker.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      tag: 'speaker.accepted',
      source: 'speaker-accept',
      onceKey: `speaker-accepted:${speakerId}`,
      storeRendered: rendered.storeRendered,
      hasLegalFooterHtml: rendered.hasLegalFooterHtml,
      hasLegalFooterText: rendered.hasLegalFooterText,
    });
    return { ok: true };
  } catch (err) {
    log.error('speaker.accepted email failed', err);
    return { ok: false };
  }
}

/**
 * Invite rows for the admin list. Never returns the document id: the id is
 * the token digest, and nothing in the admin UI addresses an invitation by
 * anything other than its speaker.
 *
 * @param {{ db: object, speakerId?: unknown, limit?: number }} args
 */
async function listInvites({ db, speakerId = null, limit = MAX_LISTED_INVITES }) {
  const collection = db.collection(SPEAKER_INVITES);
  const query = isValidDocId(speakerId) ? collection.where('speakerId', '==', speakerId) : collection;
  const snap = await query.get();
  const rows = snap.docs.map((doc) => {
    const data = doc.data() || {};
    return {
      speakerId: data.speakerId ?? null,
      email: data.email ?? null,
      inviteType: data.inviteType ?? null,
      status: data.status ?? null,
      createdAt: isoOrNull(data.createdAt),
      createdBy: data.createdBy ?? null,
      sentAt: isoOrNull(data.sentAt),
      expiresAt: isoOrNull(data.expiresAt),
      acceptedAt: isoOrNull(data.acceptedAt),
      acceptedEmail: data.acceptedEmail ?? null,
      closedAt: isoOrNull(data.closedAt),
    };
  });
  rows.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
  return rows.slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* Handlers                                                            */
/* ------------------------------------------------------------------ */

/** @param {{ db, auth, getConfig, sendEmail, now?, log? }} deps */
function createSendSpeakerInviteHandler({ db, auth, getConfig, sendEmail, now = Date.now, log = console }) {
  return async function sendSpeakerInvite(req, res) {
    const actor = await gateAdminPost({ auth, getConfig }, req, res);
    if (!actor) return;
    await runInviteSend({
      db, getConfig, sendEmail, now, log, req, res, actor, mode: 'send',
    });
  };
}

/** @param {{ db, auth, getConfig, sendEmail, now?, log? }} deps */
function createResendSpeakerInviteHandler({ db, auth, getConfig, sendEmail, now = Date.now, log = console }) {
  return async function resendSpeakerInvite(req, res) {
    const actor = await gateAdminPost({ auth, getConfig }, req, res);
    if (!actor) return;
    await runInviteSend({
      db, getConfig, sendEmail, now, log, req, res, actor, mode: 'resend',
    });
  };
}

/** Shared body of the send and resend handlers. */
async function runInviteSend({ db, getConfig, sendEmail, now, log, req, res, actor, mode }) {
  const rawType = req.body?.inviteType;
  const inviteType = rawType === undefined || rawType === null || rawType === ''
    ? DEFAULT_INVITE_TYPE
    : rawType;

  let minted;
  try {
    minted = await applyMintInvite({
      db, speakerId: req.body?.speakerId, inviteType, mode, actor, now,
    });
  } catch (err) {
    log.error(`${mode === 'send' ? 'sendSpeakerInvite' : 'resendSpeakerInvite'} failed`, err);
    return internal(res, 'The invitation could not be created.');
  }
  if (!minted.ok) {
    if (minted.status === 404) return notFound(res, minted.message);
    if (minted.retryAfterMs) {
      res.set('Retry-After', String(Math.ceil(minted.retryAfterMs / 1000)));
    }
    return sendError(res, minted.status, minted.code, minted.message);
  }

  await logAdminAction({
    db,
    action: mode === 'send' ? 'sendSpeakerInvite' : 'resendSpeakerInvite',
    docPath: `${SPEAKERS}/${minted.speakerId}`,
    actor,
    now,
    log,
  });

  let sent;
  try {
    sent = await sendInviteEmail({
      db,
      sendEmail,
      getConfig,
      speaker: minted.speaker,
      token: minted.token,
      inviteType,
      actor,
      // A resend is an admin-initiated resend of a mail the recipient may
      // already have — §3.1's table gives that its own key shape so the
      // claim on the original send cannot suppress it, while a
      // double-submitted click inside the same minute still sends once.
      onceKey: mode === 'send'
        ? `speaker-invite:${minted.tokenHash}`
        : `speaker-invite:resend:${actor.uid}:${new Date(now()).toISOString().slice(0, 16)}`,
      now,
      log,
    });
  } catch (err) {
    log.error('speaker.invite send threw', err);
    sent = { ok: false, code: 'send-failed', message: 'The invitation could not be emailed. Try resending it.' };
  }

  if (!sent.ok) {
    // The invitation is already durable and the token is live; the admin
    // list shows it with no `sentAt`, and Resend mints a fresh one. Saying
    // so beats a bare 502 that leaves an organizer guessing whether to
    // press the button again.
    return sendError(
      res,
      502,
      sent.code,
      `${sent.message} The invitation is recorded but shows as not delivered until an email goes out.`,
    );
  }

  try {
    await db.collection(SPEAKER_INVITES).doc(minted.tokenHash).set(
      { sentAt: new Date(now()), updatedAt: new Date(now()) },
      { merge: true },
    );
  } catch (err) {
    // Cosmetic: the invitation works either way, it just reads as
    // undelivered in the admin list.
    log.warn('speaker_invites sentAt stamp failed', err);
  }

  res.status(200).json({
    speakerId: minted.speakerId,
    status: 'invited',
    expiresAt: minted.expiresAt.toISOString(),
  });
}

/** @param {{ db, auth, getConfig, now?, log? }} deps */
function createCancelSpeakerInviteHandler({ db, auth, getConfig, now = Date.now, log = console }) {
  return async function cancelSpeakerInvite(req, res) {
    const actor = await gateAdminPost({ auth, getConfig }, req, res);
    if (!actor) return;
    let result;
    try {
      result = await applyCancelInvite({ db, speakerId: req.body?.speakerId, actor, now });
    } catch (err) {
      log.error('cancelSpeakerInvite failed', err);
      return internal(res, 'The invitation could not be cancelled.');
    }
    if (!result.ok) {
      return result.status === 404
        ? notFound(res, result.message)
        : sendError(res, result.status, result.code, result.message);
    }
    await logAdminAction({
      db,
      action: 'cancelSpeakerInvite',
      docPath: `${SPEAKERS}/${result.speakerId}`,
      actor,
      now,
      log,
    });
    res.status(200).json({ speakerId: result.speakerId, status: result.status });
  };
}

/** @param {{ db, auth, getConfig, log? }} deps */
function createListSpeakerInvitesHandler({ db, auth, getConfig, log = console }) {
  return async function listSpeakerInvites(req, res) {
    const actor = await gateAdminPost({ auth, getConfig }, req, res);
    if (!actor) return;
    const speakerId = req.body?.speakerId;
    if (speakerId !== undefined && speakerId !== null && !isValidDocId(speakerId)) {
      return badRequest(res, 'speakerId: must be a document id');
    }
    let invites;
    try {
      invites = await listInvites({ db, speakerId: speakerId ?? null });
    } catch (err) {
      log.error('listSpeakerInvites failed', err);
      return internal(res, 'The invitations could not be listed.');
    }
    res.status(200).json({ invites });
  };
}

/** @param {{ db, now?, log? }} deps */
function createValidateSpeakerInviteHandler({ db, now = Date.now, log = console }) {
  return async function validateSpeakerInvite(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    let resolved;
    try {
      resolved = await resolveInvite({ db, token: req.body?.token, now });
    } catch (err) {
      log.error('validateSpeakerInvite failed', err);
      return internal(res, 'The invitation could not be checked.');
    }
    if (!resolved.ok) {
      // 200 with `{ valid: false }`, not a 4xx: the page renders a state
      // either way, and a status code is the one part of the answer a
      // network log keeps — so both misses look identical there too.
      return res.status(200).json({ valid: false, reason: resolved.reason });
    }
    res.status(200).json({
      valid: true,
      speakerId: resolved.speakerId,
      speakerName: speakerDisplayName(resolved.speaker),
      inviteType: resolved.invite.inviteType ?? DEFAULT_INVITE_TYPE,
      // Masked: enough to say which inbox this came to, without printing
      // the address into a page opened from a link that may have travelled.
      invitedEmailMasked: maskEmail(resolved.speaker.email),
      expiresAt: isoOrNull(resolved.invite.expiresAt),
    });
  };
}

/** @param {{ db, auth, getConfig, sendEmail, now?, log? }} deps */
function createAcceptSpeakerInviteHandler({ db, auth, getConfig, sendEmail, now = Date.now, log = console }) {
  return async function acceptSpeakerInvite(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

    const decoded = await verifyAuthToken({ auth }, req);
    if (!decoded?.uid) {
      return sendError(res, 401, 'unauthorized', 'Sign in first, then open your invitation link again.');
    }

    let result;
    try {
      result = await applyAcceptInvite({
        db,
        token: req.body?.token,
        uid: decoded.uid,
        email: typeof decoded.email === 'string' ? decoded.email : null,
        now,
      });
    } catch (err) {
      log.error('acceptSpeakerInvite failed', err);
      return internal(res, 'The invitation could not be accepted.');
    }
    if (!result.ok) return sendError(res, result.status, result.code, result.message);

    // onceKey-gated, so the retriable handler still mails once per speaker.
    if (typeof sendEmail === 'function' && typeof getConfig === 'function') {
      await sendAcceptedEmail({
        db, sendEmail, getConfig, speakerId: result.speakerId, speaker: result.speaker, now, log,
      });
    }

    res.status(200).json({
      speakerId: result.speakerId,
      speakerName: result.speakerName,
      status: 'accepted',
      emailMismatch: result.emailMismatch,
    });
  };
}

/** Deployable exports (spec §1.3 speakers/invites.cjs). */
function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const { defineSecret } = require('firebase-functions/params');
  const { SEND_SECRETS_BY_PROVIDER } = require('../email/send.cjs').internals;
  const { internals: otpInternals } = require('../auth/otp.cjs');

  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';
  const providerName = (process.env.EVENT_EMAIL_PROVIDER || '').trim();
  const secrets = (SEND_SECRETS_BY_PROVIDER[providerName] || []).map(defineSecret);
  const enforced = otpInternals.appCheckEnforced(process.env);

  const buildDeps = () => {
    const { getDb } = require('../core/firestore.cjs');
    const { getAuth } = require('firebase-admin/auth');
    const { getEventConfig } = require('../core/config.cjs');
    const { getEmailProvider } = require('../email/providers/index.cjs');
    const { createEmailCore } = require('../email/send.cjs');
    const db = getDb();
    const getConfig = () => getEventConfig({ db });
    const emailCore = createEmailCore({ db, provider: getEmailProvider({ env: process.env }), getConfig });
    return { db, auth: getAuth(), getConfig, sendEmail: emailCore.send, now: Date.now, log: console };
  };

  const withCors = (handler) => async (req, res) => {
    const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
    const handled = applyCors(req, res, {
      allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS),
      methods: ['POST'],
    });
    if (handled) return;
    await handler(req, res);
  };

  // The two endpoints a stranger can reach get the SAME App Check gate the
  // OTP pair uses (§3.1, issue #45) — same flag, same fail-closed behavior,
  // same "CORS outside the gate" ordering, so a deployment that turns
  // enforcement on covers its whole unauthenticated surface rather than
  // half of it. acceptSpeakerInvite is included because its Firebase ID
  // token proves an account, not a browser.
  const gated = (handler) => withCors(otpInternals.withAppCheckGate(handler, {
    enforced,
    getAppCheck: () => require('firebase-admin/app-check').getAppCheck(),
  }));

  return {
    sendSpeakerInvite: onRequest({ region, secrets }, withCors(async (req, res) => {
      await createSendSpeakerInviteHandler(buildDeps())(req, res);
    })),
    resendSpeakerInvite: onRequest({ region, secrets }, withCors(async (req, res) => {
      await createResendSpeakerInviteHandler(buildDeps())(req, res);
    })),
    cancelSpeakerInvite: onRequest({ region }, withCors(async (req, res) => {
      await createCancelSpeakerInviteHandler(buildDeps())(req, res);
    })),
    listSpeakerInvites: onRequest({ region }, withCors(async (req, res) => {
      await createListSpeakerInvitesHandler(buildDeps())(req, res);
    })),
    validateSpeakerInvite: onRequest({ region }, gated(async (req, res) => {
      await createValidateSpeakerInviteHandler(buildDeps())(req, res);
    })),
    acceptSpeakerInvite: onRequest({ region, secrets }, gated(async (req, res) => {
      await createAcceptSpeakerInviteHandler(buildDeps())(req, res);
    })),
  };
}

module.exports = {
  applyMintInvite,
  applyCancelInvite,
  applyAcceptInvite,
  resolveInvite,
  listInvites,
  sendInviteEmail,
  sendAcceptedEmail,
  createSendSpeakerInviteHandler,
  createResendSpeakerInviteHandler,
  createCancelSpeakerInviteHandler,
  createListSpeakerInvitesHandler,
  createValidateSpeakerInviteHandler,
  createAcceptSpeakerInviteHandler,
  get handlers() {
    return buildHandlers();
  },
  internals: {
    SPEAKERS,
    INVITE_TYPES,
    DEFAULT_INVITE_TYPE,
    SEND_LIMIT_MAX,
    SEND_LIMIT_WINDOW_MS,
    MAX_LISTED_INVITES,
    gateAdminPost,
    isoOrNull,
  },
};
