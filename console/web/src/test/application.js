// Test data for the guided-setup pages: an application as getApplication
// returns it, and a stand-in for callApi that answers each call by name.
import { callApi } from '../api.js';

export function emptyAnswers() {
  return {
    organization: { name: 'NC Local', website: '', address: '' },
    event: { name: '', shortName: '', tagline: '', timezone: 'America/New_York', days: [], venue: { name: '', address: '' } },
    webAddress: { name: '' },
    tickets: { choice: null },
    email: { senderName: '', replyTo: '' },
  };
}

export function fullAnswers() {
  return {
    organization: { name: 'NC Local', website: 'https://nclocal.org', address: '1 Main Street\nRaleigh, NC 27601' },
    event: {
      name: 'NC Local News Summit',
      shortName: 'News Summit',
      tagline: 'Local news for North Carolina',
      timezone: 'America/New_York',
      days: [{ date: '2027-05-13', startTime: '09:00', endTime: '17:00' }],
      venue: { name: 'City Hall', address: '2 Main Street' },
    },
    webAddress: { name: 'nclocal' },
    tickets: { choice: 'stripe' },
    email: { senderName: 'NC Local', replyTo: 'ops@nclocal.org' },
  };
}

const ALL_DONE = { organization: true, event: true, webAddress: true, team: true, tickets: true, email: true, review: true };

/** `connections` as getApplication returns it: a connected Stripe account. */
export function connections(overrides = {}) {
  return {
    canChange: true,
    canDisconnect: true,
    stripe: { available: true, connected: true, displayName: 'NC Local', connectedAt: '2026-11-02T00:00:00.000Z' },
    eventbrite: { available: true, connected: false, displayName: null, connectedAt: null, event: null },
    ...overrides,
  };
}

export function application(overrides = {}) {
  return {
    id: 'a1',
    orgId: 'o1',
    status: 'draft',
    answers: fullAnswers(),
    address: 'nclocal.eventrunner.org',
    note: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    submittedAt: null,
    history: [{ status: 'draft', at: '2026-11-01T00:00:00.000Z', note: null }],
    errors: {},
    progress: ALL_DONE,
    ownersNeeded: 0,
    myRole: 'owner',
    operator: false,
    canEdit: true,
    canSubmit: true,
    canWithdraw: true,
    connections: connections(),
    ...overrides,
  };
}

export function team(overrides = {}) {
  return {
    organization: { id: 'o1', name: 'NC Local' },
    myRole: 'owner',
    operator: false,
    members: [
      { uid: 'ana', email: 'ana@example.org', role: 'owner', joinedAt: '2026-10-01T00:00:00.000Z' },
      { uid: 'dee', email: 'dee@example.org', role: 'owner', joinedAt: '2026-10-02T00:00:00.000Z' },
    ],
    invites: [],
    ownersNeeded: 0,
    ...overrides,
  };
}

/**
 * Make callApi answer by name. A handler is a value or a function of the
 * body. getApplication and getTeam have defaults; saveApplicationStep
 * echoes a clean save.
 */
export function serveApi(handlers = {}) {
  const defaults = {
    getApplication: () => ({ application: application() }),
    getTeam: () => team(),
    saveApplicationStep: (body) => ({ step: body.step, saved: true, answers: body.answers, errors: {}, updatedAt: '2026-11-04T15:00:00.000Z' }),
    checkWebAddress: (body) => ({ name: body.name, address: `${body.name}.eventrunner.org`, available: true }),
  };
  const all = { ...defaults, ...handlers };
  callApi.mockImplementation(async (name, body) => {
    const handler = all[name];
    if (handler === undefined) return {};
    return typeof handler === 'function' ? handler(body) : handler;
  });
}

/** The bodies callApi got for one call name. */
export function callsTo(name) {
  return callApi.mock.calls.filter(([n]) => n === name).map(([, body]) => body);
}
