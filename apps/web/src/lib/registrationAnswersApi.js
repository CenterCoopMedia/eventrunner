// The attendee's own registration answers (ADR 0008 §5). Saves go through
// saveTicketAnswers, which checks them against the live form; reads come
// straight from `ticket_answers`, which the rules open to the record's own
// account.
import { doc, getDoc } from 'firebase/firestore';
import { callAdminEndpoint } from '../admin/adminApi.js';
import { db } from '../firebase.js';

function idTokenGetter(user) {
  return () => (user && typeof user.getIdToken === 'function'
    ? user.getIdToken()
    : Promise.reject(new Error('not signed in')));
}

/** The record id for an event that sells no tickets: one per account. */
const accountRecordId = (uid) => `account-${uid}`;

/**
 * What the attendee answers for: each valid ticket they hold, or their
 * account when the event sells no tickets.
 */
export function answerTargets({ provider, tickets, uid }) {
  if (provider === 'none') return uid ? [{ account: true, id: accountRecordId(uid), label: 'Your registration' }] : [];
  return (Array.isArray(tickets) ? tickets : [])
    .filter((ticket) => ticket?.status === 'valid' && ticket.id)
    .map((ticket) => {
      const name = [ticket.firstName, ticket.lastName].filter(Boolean).join(' ');
      return { id: ticket.id, ticketId: ticket.id, label: `Ticket: ${ticket.ticketClass || 'Ticket'}${name ? ` for ${name}` : ''}` };
    });
}

/** @returns {Promise<{ ticketId: string, answers: object, formRevision: number }>} */
export function saveRegistrationAnswers({ user, ticketId, account, formRevision, answers }) {
  const target = account ? { account: true } : { ticketId };
  return callAdminEndpoint('saveTicketAnswers', { ...target, formRevision, answers }, idTokenGetter(user));
}

/**
 * The caller's saved record, or null when not answered. The rules check the
 * record's uid, so a record that does not exist yet is refused rather than
 * empty; a refusal reads as not answered.
 */
export async function readOwnAnswers({ ticketId, uid }) {
  const id = ticketId || accountRecordId(uid);
  try {
    const snapshot = await getDoc(doc(db, 'ticket_answers', id));
    return snapshot.exists() ? snapshot.data() : null;
  } catch (error) {
    if (error?.code === 'permission-denied') return null;
    throw error;
  }
}
