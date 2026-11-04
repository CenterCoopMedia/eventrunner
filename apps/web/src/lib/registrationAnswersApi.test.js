// The attendee's registration answers (ADR 0008 §5): what to answer for,
// the save request, and the own-answers read.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getDoc = vi.fn();
vi.mock('../firebase.js', () => ({ db: { name: 'db' } }));
vi.mock('firebase/firestore', () => ({
  doc: (db, ...path) => ({ path: path.join('/') }),
  getDoc: (ref) => getDoc(ref),
}));

const { answerTargets, readOwnAnswers, saveRegistrationAnswers } = await import('./registrationAnswersApi.js');

const user = { getIdToken: async () => 'id-token' };
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

beforeEach(() => {
  globalThis.fetch = vi.fn();
  getDoc.mockReset();
});

describe('answerTargets', () => {
  const tickets = [
    { id: 't1', ticketClass: 'General', firstName: 'Ada', lastName: 'Lovelace', status: 'valid' },
    { id: 't2', ticketClass: 'General', firstName: 'Bo', lastName: 'Diddley', status: 'refunded' },
    { id: 't3', ticketClass: 'Student', firstName: 'Cy', lastName: '', status: 'valid' },
  ];

  it('lists one target per valid ticket', () => {
    expect(answerTargets({ provider: 'stripe', tickets, uid: 'u1' })).toEqual([
      { id: 't1', ticketId: 't1', label: 'Ticket: General for Ada Lovelace' },
      { id: 't3', ticketId: 't3', label: 'Ticket: Student for Cy' },
    ]);
  });

  it('answers once for the account when the event sells no tickets', () => {
    expect(answerTargets({ provider: 'none', tickets, uid: 'u1' })).toEqual([
      { account: true, id: 'account-u1', label: 'Your registration' },
    ]);
  });

  it('has nothing to answer for without tickets or an account', () => {
    expect(answerTargets({ provider: 'stripe', tickets: null, uid: 'u1' })).toEqual([]);
    expect(answerTargets({ provider: 'none', tickets: [], uid: '' })).toEqual([]);
  });
});

describe('saveRegistrationAnswers', () => {
  it('saves a ticket’s answers with the bearer token', async () => {
    fetch.mockResolvedValueOnce(response(200, { ticketId: 't1', answers: { organization: 'Acme' }, formRevision: 3 }));
    const saved = await saveRegistrationAnswers({ user, ticketId: 't1', formRevision: 3, answers: { organization: 'Acme' } });
    expect(saved.ticketId).toBe('t1');
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toMatch(/\/saveTicketAnswers$/);
    expect(init.headers.Authorization).toBe('Bearer id-token');
    expect(JSON.parse(init.body)).toEqual({ ticketId: 't1', formRevision: 3, answers: { organization: 'Acme' } });
  });

  it('saves the account’s answers when there is no ticket', async () => {
    fetch.mockResolvedValueOnce(response(200, { ticketId: 'account-u1', answers: {}, formRevision: 1 }));
    await saveRegistrationAnswers({ user, account: true, formRevision: 1, answers: {} });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ account: true, formRevision: 1, answers: {} });
  });

  it('passes the server’s error code on', async () => {
    fetch.mockResolvedValueOnce(response(409, { error: { code: 'form-changed', message: 'The questions changed.' } }));
    await expect(saveRegistrationAnswers({ user, ticketId: 't1', formRevision: 1, answers: {} }))
      .rejects.toMatchObject({ code: 'form-changed' });
  });
});

describe('readOwnAnswers', () => {
  it('reads the ticket’s answers record', async () => {
    getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ answers: { organization: 'Acme' }, formRevision: 2 }) });
    expect(await readOwnAnswers({ ticketId: 't1' })).toEqual({ answers: { organization: 'Acme' }, formRevision: 2 });
    expect(getDoc.mock.calls[0][0].path).toBe('ticket_answers/t1');
  });

  it('reads the account’s record by uid', async () => {
    getDoc.mockResolvedValueOnce({ exists: () => false });
    expect(await readOwnAnswers({ uid: 'u1' })).toBeNull();
    expect(getDoc.mock.calls[0][0].path).toBe('ticket_answers/account-u1');
  });

  it('reads a refused read as not answered, since a missing record is refused too', async () => {
    getDoc.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    expect(await readOwnAnswers({ ticketId: 't9' })).toBeNull();
    getDoc.mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'unavailable' }));
    await expect(readOwnAnswers({ ticketId: 't9' })).rejects.toThrow('offline');
  });
});
