'use strict';

/**
 * saveTicketAnswers: one attendee's answers to the registration questions
 * (ADR 0008 §4), stored privately in `ticket_answers/{ticketId}` (one per
 * ticket, so each attendee on a group order answers for themselves).
 *
 * Who may save: the account that holds the ticket (`claimedByUid`), until
 * registration closes, or staff at any time. The answers are checked with
 * shared/registrationForm against the form revision the attendee answered;
 * a form changed since then is refused (409), so an answer is never stored
 * against questions the attendee did not see.
 *
 * The record carries `uid` so firestore.rules can let the holder read their
 * own answers, and so deleteAttendee removes them with the account
 * (users/records.cjs PER_ACCOUNT_STORES). Answers never reach users_public.
 *
 * An event with no ticketing provider (`none`) has no tickets, so the
 * attendee sends `{ account: true }` and the answers are stored under
 * `ticket_answers/account-{uid}` with `ticketId: null`. Only then.
 *
 * The directory answer sets the account's `profileVisibility`. `public`
 * needs config/features.publicAttendeeProfiles, the same rule the profile
 * page follows; without it the answer is stored as "attendees only".
 */

const { BOOTSTRAP_UNAVAILABLE, BootstrapUnavailableError, loadBootstrap, resolveAdminTier, verifyAuthToken } = require('../core/auth.cjs');
const { sendError, badRequest, methodNotAllowed, internal } = require('../core/errors.cjs');
const { isValidDocId, logAdminAction } = require('../cms/store.cjs');
const { answeredQuestions, checkAnswers, readRegistrationForm } = require('shared/registrationForm');
const { getEventPhase } = require('shared/config');

const ANSWERS = 'ticket_answers';
const CLOSED_PHASES = Object.freeze(['registration_closed', 'in_progress', 'ended', 'archived']);
const MAX_BODY_BYTES = 32 * 1024;

function refuse(status, code, message) {
  const err = new Error(code);
  err.conflict = { status, code, message };
  throw err;
}

async function callerOf({ auth, db, getConfig }, req) {
  const decoded = await verifyAuthToken({ auth }, req);
  if (!decoded?.uid) return { ok: false, status: 401, code: 'unauthorized', message: 'Sign in to answer the registration questions.' };
  const email = typeof decoded.email === 'string' ? decoded.email.trim().toLowerCase() : '';
  let staff = false;
  if (email && decoded.email_verified === true) {
    try {
      staff = resolveAdminTier(await loadBootstrap({ db, getConfig }), email) !== null;
    } catch (err) {
      if (err instanceof BootstrapUnavailableError) return { ...BOOTSTRAP_UNAVAILABLE };
      throw err;
    }
  }
  return { ok: true, uid: decoded.uid, email, staff };
}

/** Answers for an event with no tickets live under the account, not a ticket. */
const ACCOUNT_PREFIX = 'account-';

/** What the answers belong to when they are saved against a ticket. */
function ticketTarget(db, caller, ticketId) {
  return {
    recordId: ticketId,
    async load(tx) {
      const ticketSnap = await tx.get(db.collection('tickets').doc(ticketId));
      const ticket = ticketSnap.exists ? ticketSnap.data() : null;
      // Same answer for a missing ticket and someone else's.
      if (!caller.staff && (!ticket || ticket.claimedByUid !== caller.uid)) refuse(403, 'forbidden', 'You can answer only for a ticket you hold.');
      if (!ticket) refuse(404, 'not-found', 'No such ticket.');
      if (ticket.status !== 'valid') refuse(409, 'ticket-not-valid', 'This ticket is not valid, so it takes no answers.');
      // Answers belong to an account: the holder reads them, the record and
      // export show them, and deleteAttendee removes them by uid.
      if (typeof ticket.claimedByUid !== 'string' || !ticket.claimedByUid) {
        refuse(409, 'ticket-unclaimed', 'Nobody has claimed this ticket yet. Answers can be saved once the attendee claims it.');
      }
      // Kept in step with the ticket by syncAnswerStatus.
      return { uid: ticket.claimedByUid, fields: { ticketId, ticketStatus: ticket.status } };
    },
  };
}

/** What the answers belong to when the event has no tickets: the caller's own account. */
function accountTarget(caller) {
  return {
    recordId: `${ACCOUNT_PREFIX}${caller.uid}`,
    // No ticket can be refunded, so the record always counts as valid.
    async load() { return { uid: caller.uid, fields: { ticketId: null, account: true, ticketStatus: 'valid' } }; },
  };
}

/** Check the answers against the current form and store them for `target`. One body for both kinds of record. */
function saveAnswers({ db, config, caller, at, target, answers, formRevision }) {
  return db.runTransaction(async (tx) => {
    const [owner, formSnap] = await Promise.all([target.load(tx), tx.get(db.collection('config').doc('registration_form'))]);
    const form = readRegistrationForm(formSnap.exists ? formSnap.data() : null);
    if (form.revision !== formRevision) refuse(409, 'form-changed', 'The registration questions changed. Reload the page to see the current questions; your answers are still on the page.');
    const checked = checkAnswers(answers, form);
    if (!checked.ok) refuse(400, 'bad-request', Object.entries(checked.errors).map(([id, message]) => `answers.${id}: ${message}`).join('; '));
    let userRef = null;
    if (checked.answers.directoryListing) {
      userRef = db.collection('users').doc(owner.uid);
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) userRef = null;
    }
    tx.set(db.collection(ANSWERS).doc(target.recordId), {
      ...owner.fields, uid: owner.uid, answers: checked.answers, formRevision,
      // The questions as the attendee saw them, so a later change to the
      // form never misreads these answers.
      questions: answeredQuestions(form, checked.answers),
      updatedAt: at, updatedBy: caller.email || caller.uid,
    });
    if (userRef) {
      const allowPublic = config?.features?.publicAttendeeProfiles === true;
      const visibility = checked.answers.directoryListing === 'public' && !allowPublic ? 'attendees_only' : checked.answers.directoryListing;
      tx.set(userRef, { profileVisibility: visibility, updatedAt: at }, { merge: true });
    }
    return { answers: checked.answers };
  });
}

function createSaveTicketAnswersHandler({ db, auth, getConfig, providerName = null, now = Date.now, log = console }) {
  return async function saveTicketAnswers(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    if (Buffer.byteLength(JSON.stringify(req.body ?? {})) > MAX_BODY_BYTES) return sendError(res, 413, 'payload-too-large', 'The answers are too long.');
    const { ticketId, answers, formRevision, account } = req.body || {};
    const forAccount = account === true;
    if (forAccount && ticketId !== undefined) return badRequest(res, 'Send either ticketId or account, not both.');
    if (!forAccount && !isValidDocId(ticketId)) return badRequest(res, 'ticketId: required');
    if (!Number.isSafeInteger(formRevision) || formRevision < 0) return badRequest(res, 'formRevision: the form revision you answered is required.');
    // With tickets on sale, answers belong to a ticket so each attendee on a
    // group order answers for themselves.
    if (forAccount && providerName !== 'none') {
      return sendError(res, 409, 'account-answers-unavailable', 'This event uses tickets, so the answers are saved with your ticket.');
    }
    const caller = await callerOf({ auth, db, getConfig }, req);
    if (!caller.ok) return sendError(res, caller.status, caller.code, caller.message);
    const config = await getConfig();
    const at = new Date(now());
    // The account form always answers for the caller's own account, so a
    // staff member there is an attendee like any other, closing time included.
    // Staff are exempt only when they correct an attendee's ticket answers.
    if ((forAccount || !caller.staff) && CLOSED_PHASES.includes(getEventPhase(config?.event, at))) {
      return sendError(res, 409, 'registration-closed', 'Registration has closed, so these answers can no longer be changed. Contact the organizers.');
    }
    const target = forAccount ? accountTarget(caller) : ticketTarget(db, caller, ticketId);
    let saved;
    try {
      saved = await saveAnswers({ db, config, caller, at, target, answers, formRevision });
    } catch (err) {
      if (err?.conflict) return sendError(res, err.conflict.status, err.conflict.code, err.conflict.message);
      log.error('saveTicketAnswers failed', err);
      return internal(res, 'Your answers could not be saved. They are still on the page; try again.');
    }
    if (caller.staff && !forAccount) {
      await logAdminAction({ db, action: 'saveTicketAnswers', docPath: `${ANSWERS}/${ticketId}`, actor: { uid: caller.uid, email: caller.email }, now, log });
    }
    if (forAccount) return res.status(200).json({ account: true, ticketId: null, answers: saved.answers, formRevision });
    return res.status(200).json({ ticketId, answers: saved.answers, formRevision });
  };
}

/**
 * Keep an answer record's `ticketStatus` in step with its ticket, so a
 * refunded or cancelled ticket drops out of the planning counts while its
 * answers stay on record. Run from onTicketWritten (ticketing/
 * entitlement.cjs). Idempotent: it re-reads both records and writes only a
 * change. A deleted ticket reads as cancelled.
 */
async function syncAnswerStatus({ db, ticketId }) {
  // Account answers (an event with no tickets) have no ticket to follow.
  if (!isValidDocId(ticketId) || ticketId.startsWith(ACCOUNT_PREFIX)) return { changed: false };
  return db.runTransaction(async (tx) => {
    const answersRef = db.collection(ANSWERS).doc(ticketId);
    const [ticketSnap, answersSnap] = await Promise.all([tx.get(db.collection('tickets').doc(ticketId)), tx.get(answersRef)]);
    if (!answersSnap.exists) return { changed: false };
    const status = ticketSnap.exists && typeof ticketSnap.data().status === 'string' ? ticketSnap.data().status : 'cancelled';
    if (answersSnap.data().ticketStatus === status) return { changed: false };
    tx.update(answersRef, { ticketStatus: status });
    return { changed: true };
  });
}

function buildHandlers() {
  const { onRequest } = require('firebase-functions/v2/https');
  const { applyCors, parseAllowedOrigins } = require('../core/http.cjs');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';
  return {
    saveTicketAnswers: onRequest({ region }, async (req, res) => {
      if (applyCors(req, res, { allowedOrigins: parseAllowedOrigins(process.env.EVENT_ALLOWED_ORIGINS), methods: ['POST'] })) return;
      const { getDb } = require('../core/firestore.cjs');
      const { getAuth } = require('firebase-admin/auth');
      const { getEventConfig } = require('../core/config.cjs');
      const db = getDb();
      const providerName = (process.env.EVENT_TICKETING_PROVIDER || '').trim();
      await createSaveTicketAnswersHandler({ db, auth: getAuth(), getConfig: () => getEventConfig({ db }), providerName })(req, res);
    }),
  };
}

module.exports = { ANSWERS, createSaveTicketAnswersHandler, syncAnswerStatus, get handlers() { return buildHandlers(); } };
