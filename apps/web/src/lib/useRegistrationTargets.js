// Everything the "Complete your registration" page and its dashboard card
// need (ADR 0008 §5): the live question form, what the attendee answers for
// (each valid ticket, or the account when no tickets are sold), and what
// each already has saved.
import { useCallback, useEffect, useState } from 'react';
import { activeQuestions } from 'shared/registrationForm';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { answerTargets, readOwnAnswers } from './registrationAnswersApi.js';
import { subscribeRegistrationForm } from './registrationFormSource.js';
import { ticketingRequest } from './ticketingCommerce.js';
import { readTicketingCatalog } from './useRegistrationLink.js';

// Enough pages for any one person's tickets; stops a bad cursor looping.
const MAX_TICKET_PAGES = 10;

async function readAllTickets(user) {
  // Tickets are claimed by a verified email, so an unverified account holds none.
  if (!user.emailVerified) return [];
  const tickets = [];
  let cursor = null;
  for (let page = 0; page < MAX_TICKET_PAGES; page += 1) {
    const result = await ticketingRequest('ticketingMyTickets', { user, body: cursor ? { cursor } : {} });
    tickets.push(...(result?.tickets ?? []));
    cursor = result?.nextCursor;
    if (!cursor) break;
  }
  return tickets;
}

/**
 * `form` is undefined until the first read, and null when no form is stored.
 *
 * @returns {{ status: 'loading'|'ready'|'error', form: object|null|undefined, questionCount: number,
 *   targets: object[], saved: Record<string, object|null>, setSaved: Function, retry: Function, error: string|null }}
 */
export function useRegistrationTargets(user) {
  const { eventConfig } = useEventConfig();
  const [form, setForm] = useState(undefined);
  // `asked` says whether this load ran for a form that asks something.
  const [load, setLoad] = useState({ status: 'loading', targets: [], saved: {}, error: null, asked: false });
  const [attempt, setAttempt] = useState(0);
  const uid = user?.uid ?? null;

  useEffect(() => subscribeRegistrationForm(setForm, () => setForm(null)), []);

  // Tickets and saved answers are read only when the form asks something,
  // so a dashboard visit at an event with no questions costs nothing.
  const asks = form ? activeQuestions(form).length > 0 : false;

  useEffect(() => {
    if (!user || !asks) {
      setLoad({ status: 'ready', targets: [], saved: {}, error: null, asked: false });
      return undefined;
    }
    let active = true;
    setLoad({ status: 'loading', targets: [], saved: {}, error: null, asked: true });
    (async () => {
      const catalog = await readTicketingCatalog(eventConfig?.id);
      const provider = catalog?.provider;
      const tickets = provider === 'none' ? [] : await readAllTickets(user);
      const targets = answerTargets({ provider, tickets, uid: user.uid });
      const records = await Promise.all(targets.map((target) => (target.account
        ? readOwnAnswers({ uid: user.uid })
        : readOwnAnswers({ ticketId: target.ticketId }))));
      return { targets, saved: Object.fromEntries(targets.map((target, i) => [target.id, records[i]])) };
    })().then(({ targets, saved }) => {
      if (active) setLoad({ status: 'ready', targets, saved, error: null, asked: true });
    }).catch((error) => {
      if (active) setLoad({ status: 'error', targets: [], saved: {}, error: error?.message || 'Your registration could not be loaded.', asked: true });
    });
    return () => { active = false; };
    // The uid, not the user object: a token refresh must not reload the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, eventConfig?.id, attempt, asks]);

  const setSaved = useCallback((id, record) => {
    setLoad((previous) => ({ ...previous, saved: { ...previous.saved, [id]: record } }));
  }, []);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  return {
    // Loading until the form is read, and, when it asks something, until the
    // tickets and answers for it are read: no "you need a ticket" flash.
    status: (form === undefined || (asks && !load.asked)) && load.status !== 'error' ? 'loading' : load.status,
    form,
    questionCount: form ? activeQuestions(form).length : 0,
    targets: load.targets,
    saved: load.saved,
    setSaved,
    retry,
    error: load.error,
  };
}
