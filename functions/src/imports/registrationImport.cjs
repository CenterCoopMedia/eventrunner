'use strict';

/**
 * Registration rows for the record import (./recordImport.cjs), ADR 0008 §7.
 *
 * MANUAL TICKETS ONLY. A row is one attendee's ticket from another system:
 * the external ID is the ticket ID, as in the ticket CSV import. Another
 * ticketing provider owns its own tickets, so with any provider but
 * `manual` every row is refused and nothing is written.
 *
 * ANSWERS BELONG TO AN ACCOUNT. Answers come as `answer:<question id>`
 * columns, read with answerFromText and checked against the live form. A
 * required question the file leaves out is not an error: the attendee
 * answers it later at /registration. Until someone claims the ticket the
 * answers wait in server-only `ticket_answer_holds/{ticketId}`, and
 * claimTicket (ticketing/registration.cjs) moves them to `ticket_answers`,
 * as it does for checkout seat answers. On a claimed ticket the import
 * writes the account's record itself.
 *
 * RE-IMPORT is the three-way merge every import type uses: a name, ticket
 * type or answer that staff or the attendee changed since the last import
 * is kept and reported. A claimed ticket's email never changes by import:
 * the address is what links the ticket to its account. A new email on an
 * unclaimed ticket is a new person, so the held answers are replaced by
 * the row's own. The directory question is never imported: who can see a
 * person is their own choice.
 */

const { EMAIL_ADDRESS_RE } = require('shared/email');
const {
  activeQuestions, answeredQuestions, answerFromText, checkAnswers, readRegistrationForm,
} = require('shared/registrationForm');
const { internals: { isSafeDocId } } = require('../ticketing/index.cjs');
const { ANSWERS, HOLDS } = require('../ticketing/ticketAnswers.cjs');
const {
  reconcileFields,
  internals: { cell, cellOrNull, externalIdError, conflictNote, matchNote, DELETED_NOTE },
} = require('./recordImport.cjs');

const TYPE = 'registrations';
const TICKETS = 'tickets';
const ANSWER_PREFIX = 'answer:';
const TICKET_FIELDS = Object.freeze(['email', 'firstName', 'lastName', 'ticketClass']);

const FIELDS = Object.freeze([
  { id: 'externalId', required: true },
  { id: 'email', required: true },
  { id: 'firstName' },
  { id: 'lastName' },
  { id: 'ticketClass' },
]);

function mappingError(mapping) {
  if (!mapping.externalId) return 'mapping.externalId: map a column to the ticket ID';
  if (!mapping.email) return "mapping.email: map a column to the attendee's email";
  // The directory listing sets who can see a person. The attendee chooses
  // it on their own profile; a staff file never does.
  if (mapping[`${ANSWER_PREFIX}directoryListing`]) {
    return `mapping.${ANSWER_PREFIX}directoryListing: the attendee chooses their directory listing on their profile, so it cannot be imported`;
  }
  return null;
}

/** Every question optional: an import fills what the file has. */
function optionalForm(form) {
  return {
    ...form,
    standard: Object.fromEntries(Object.entries(form.standard).map(([id, entry]) => [id, { ...entry, required: false }])),
    custom: form.custom.map((question) => ({ ...question, required: false })),
  };
}

async function loadContext({ db }) {
  const formSnap = await db.collection('config').doc('registration_form').get();
  const form = readRegistrationForm(formSnap.exists ? formSnap.data() : null);
  return {
    provider: (process.env.EVENT_TICKETING_PROVIDER || '').trim() || 'none',
    form,
    questions: new Map(activeQuestions(form).map((question) => [question.id, question])),
  };
}

function mapRow({ row, mapping, context }) {
  const externalId = cell(row[mapping.externalId]);
  if (context.provider !== 'manual') {
    return {
      ok: false, externalId: externalId || null,
      reasons: [`The registrations import makes tickets for the manual ticketing provider. This event uses "${context.provider}", so its tickets come from there.`],
    };
  }
  const reasons = [];
  const idError = externalIdError(externalId);
  if (idError) reasons.push(idError);
  else if (!isSafeDocId(externalId)) reasons.push('externalId: a ticket ID cannot contain "/" and cannot be "." or ".."');
  const email = cell(row[mapping.email]).toLowerCase();
  if (!EMAIL_ADDRESS_RE.test(email)) reasons.push('email: enter a valid email address');

  const values = { email };
  for (const field of ['firstName', 'lastName', 'ticketClass']) {
    if (mapping[field]) values[field] = cellOrNull(row[mapping[field]]);
  }
  const answerIds = [];
  const given = {};
  for (const [field, column] of Object.entries(mapping)) {
    if (!field.startsWith(ANSWER_PREFIX)) continue;
    const id = field.slice(ANSWER_PREFIX.length);
    const question = context.questions.get(id);
    if (!question) { reasons.push(`${field}: the registration form does not ask this question`); continue; }
    answerIds.push(id);
    const value = answerFromText(question, cell(row[column]));
    if (value !== undefined) given[id] = value;
  }
  const checked = checkAnswers(given, optionalForm(context.form));
  if (!checked.ok) for (const [id, message] of Object.entries(checked.errors)) reasons.push(`${ANSWER_PREFIX}${id}: ${message}`);
  if (reasons.length) return { ok: false, externalId: externalId || null, reasons };
  for (const id of answerIds) values[`${ANSWER_PREFIX}${id}`] = checked.answers[id] ?? null;
  // The ticket ID is the external ID, as in the ticket CSV import.
  return { ok: true, externalId, input: { values, ticketId: externalId } };
}

const isAnswerField = (field) => field.startsWith(ANSWER_PREFIX);

/** The answers a set of field values holds, blanks left out. */
function answersFrom(values) {
  const answers = {};
  for (const [field, value] of Object.entries(values)) {
    if (isAnswerField(field) && value !== null && value !== undefined) answers[field.slice(ANSWER_PREFIX.length)] = value;
  }
  return answers;
}

function labelOf(values) {
  return [values.firstName, values.lastName].filter(Boolean).join(' ') || values.email || null;
}

/**
 * The answer document as the import writes it: a hold, or the account's
 * record. `kept` holds the saved question for each answer this import did
 * not change, so an answer stays readable after its question changes.
 */
function answerRecord({ ticketId, uid, answers, form, status, at, kept = new Map() }) {
  const current = new Map(answeredQuestions(form, answers).map((question) => [question.id, question]));
  const questions = Object.keys(answers).map((id) => kept.get(id) ?? current.get(id)).filter(Boolean);
  return {
    ticketId, ...(uid ? { uid } : {}), answers, formRevision: form.revision,
    questions, ticketStatus: status, updatedAt: at, updatedBy: 'import',
  };
}

async function planRow({ db, tx, input, key, context, now }) {
  const { values, ticketId: id } = input;
  const ticketRef = db.collection(TICKETS).doc(id);
  const ticketSnap = await tx.get(ticketRef);
  const label = labelOf(values);
  if (!ticketSnap.exists) {
    if (key) return { verdict: 'unchanged', docId: id, label, notes: [DELETED_NOTE] };
    const answers = answersFrom(values);
    return {
      verdict: 'create',
      docId: id,
      label,
      changedFields: Object.keys(values).filter((field) => values[field] !== null),
      values,
      claims: [`ticket:${id}`],
      async write(writeTx) {
        const at = new Date(now());
        writeTx.set(ticketRef, {
          // The ID doubles as the order reference, as in the ticket CSV
          // import: the claim page looks a manual ticket up by it.
          externalId: id, orderId: id, email: values.email, firstName: values.firstName ?? null,
          lastName: values.lastName ?? null, ticketClass: values.ticketClass ?? null, quantity: 1,
          purchasedAt: null, status: 'valid', provider: 'manual', source: 'import', raw: null,
          claimedByUid: null, claimedAt: null, claimPromptSentAt: null, createdAt: at, updatedAt: at,
        });
        if (Object.keys(answers).length) {
          writeTx.set(db.collection(HOLDS).doc(id), answerRecord({ ticketId: id, answers, form: context.form, status: 'valid', at }));
        }
      },
    };
  }

  const ticket = ticketSnap.data();
  if (ticket.provider !== 'manual') {
    return { verdict: 'error', docId: id, label, reasons: [`externalId: ticket "${id}" came from ${ticket.provider || 'another source'}, not a manual import`] };
  }
  const claimedBy = typeof ticket.claimedByUid === 'string' && ticket.claimedByUid ? ticket.claimedByUid : null;
  const answersRef = db.collection(claimedBy ? ANSWERS : HOLDS).doc(id);
  const answersSnap = await tx.get(answersRef);
  const storedAnswers = answersSnap.exists && answersSnap.data()?.answers && typeof answersSnap.data().answers === 'object'
    ? answersSnap.data().answers : {};
  const current = {};
  for (const field of TICKET_FIELDS) current[field] = ticket[field] ?? null;
  for (const [answerId, value] of Object.entries(storedAnswers)) current[`${ANSWER_PREFIX}${answerId}`] = value;

  const { patch, conflicts } = reconcileFields({ incoming: values, last: key?.values ?? null, current });
  if (claimedBy && Object.prototype.hasOwnProperty.call(patch, 'email')) {
    return {
      verdict: 'error', docId: id, label,
      reasons: ['email: this ticket is claimed by an account, so its email cannot change by import. Change it on the attendee record.'],
    };
  }
  // A new email on an unclaimed ticket is a new person: answers given for
  // the first one never pass to them (as commerceAdmin correctAttendee).
  // The hold is replaced by this row's own answers, or removed.
  const newPerson = !claimedBy && Object.prototype.hasOwnProperty.call(patch, 'email');
  if (newPerson) {
    for (const field of Object.keys(patch)) if (isAnswerField(field)) delete patch[field];
    for (const field of Object.keys(values)) if (isAnswerField(field) && values[field] !== null) patch[field] = values[field];
  }
  const notes = (newPerson ? conflicts.filter((field) => !isAnswerField(field)) : conflicts).map(conflictNote);
  if (newPerson && answersSnap.exists) notes.push('email: a new email is a new person, so the answers held for the old one are removed.');
  const matched = !key;
  if (matched) notes.unshift(matchNote('ticket', id, 'ticket ID'));
  const changedFields = Object.keys(patch);
  if (changedFields.length === 0) {
    return { verdict: matched ? 'update' : 'unchanged', matched, docId: id, label, notes, values, claims: matched ? [`ticket:${id}`] : [] };
  }
  const ticketPatch = Object.fromEntries(Object.entries(patch).filter(([field]) => !isAnswerField(field)));
  const answerPatch = Object.fromEntries(Object.entries(patch).filter(([field]) => isAnswerField(field)));
  return {
    verdict: 'update',
    matched,
    claims: matched ? [`ticket:${id}`] : [],
    docId: id,
    label,
    changedFields,
    notes,
    values,
    async write(writeTx) {
      const at = new Date(now());
      if (Object.keys(ticketPatch).length) writeTx.set(ticketRef, { ...ticketPatch, updatedAt: at }, { merge: true });
      if (newPerson) {
        const answers = answersFrom(answerPatch);
        if (Object.keys(answers).length) writeTx.set(answersRef, answerRecord({ ticketId: id, answers, form: context.form, status: ticket.status, at }));
        else writeTx.delete(answersRef);
      } else if (Object.keys(answerPatch).length) {
        const answers = answersFrom({ ...Object.fromEntries(Object.entries(storedAnswers).map(([k, v]) => [`${ANSWER_PREFIX}${k}`, v])), ...answerPatch });
        const changed = new Set(Object.keys(answerPatch).map((field) => field.slice(ANSWER_PREFIX.length)));
        const stored = Array.isArray(answersSnap.data()?.questions) ? answersSnap.data().questions : [];
        const kept = new Map(stored.filter((question) => question?.id && !changed.has(question.id)).map((question) => [question.id, question]));
        writeTx.set(answersRef, answerRecord({ ticketId: id, uid: claimedBy, answers, form: context.form, status: ticket.status, at, kept }));
      }
    },
  };
}

module.exports = {
  type: TYPE,
  docPath: TICKETS,
  fields: FIELDS,
  mappingPrefix: ANSWER_PREFIX,
  mappingError,
  loadContext,
  mapRow,
  planRow,
  internals: { optionalForm, answersFrom },
};
