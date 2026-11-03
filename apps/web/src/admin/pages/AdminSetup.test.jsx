// "Set up your event" (ADR 0007 §6): every step's state is the state
// webMcpCheckEventReadiness answered, and the only write is the operator's
// legal sign-off through updateEventConfig.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../../lib/configSource.js', () => ({ subscribeConfigDoc: () => () => {} }));
vi.mock('../../lib/contentSource.js', () => ({
  subscribeContentCollection: () => () => {},
  subscribeSpeakersPublic: () => () => {},
}));
vi.mock('../../lib/profileSource.js', () => ({ subscribeOwnProfile: () => () => {} }));
vi.mock('../adminSource.js', () => ({
  subscribeAdminCollection: (_name, onNext) => {
    onNext([]);
    return () => {};
  },
}));
vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: class {},
  onAuthStateChanged: (_auth, next) => {
    next({ uid: 'admin-1', email: 'admin@example.org', getIdToken: async () => 'id-token' });
    return () => {};
  },
  signInWithCustomToken: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
}));

// The tier probe: admin_logs answers for an operator and is refused for staff.
const tier = { value: 'operator' };
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name) => ({ name })),
  doc: vi.fn(() => ({})),
  onSnapshot: vi.fn(() => () => {}),
  query: vi.fn((ref) => ref),
  limit: vi.fn(() => ({})),
  getDocs: vi.fn((ref) => (ref?.name === 'admin_logs' && tier.value === 'staff'
    ? Promise.reject(Object.assign(new Error('denied'), { code: 'permission-denied' }))
    : Promise.resolve({ docs: [] }))),
}));

import App from '../../App.jsx';
import { markTourDone } from '../tourState.js';
import { SETUP_STEPS, joinSetupSteps } from '../setupSteps.js';

const ROW_IDS = ['legal', 'sender', 'seeded', 'branding', 'admins', 'ticketing', 'auth'];

/** The endpoint's answer, with the named rows met. */
function readiness(readyIds) {
  const items = ROW_IDS.map((name) => ({
    name,
    label: name,
    state: readyIds.includes(name) ? 'ready' : 'action-required',
  }));
  return { ready: items.every((item) => item.state === 'ready'), checks: { items, total: items.length, truncated: 0 } };
}

function okResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}
function errorResponse(status, code, message) {
  return { ok: false, status, json: async () => ({ error: { code, message } }) };
}

function endpoints() {
  return fetch.mock.calls.map(([url]) => String(url).split('/').pop());
}

async function renderSetup() {
  render(
    <MemoryRouter initialEntries={['/admin/setup']}>
      <App />
    </MemoryRouter>,
  );
  return screen.findByRole('heading', { level: 1, name: 'Set up your event' }, { timeout: 10_000 });
}

function step(title) {
  return screen.getByRole('listitem', { name: title });
}

beforeEach(() => {
  markTourDone('admin-1');
  tier.value = 'operator';
  globalThis.fetch = vi.fn();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('joinSetupSteps', () => {
  it('has one step for every launch-readiness row', () => {
    expect(SETUP_STEPS.map((s) => s.id).sort()).toEqual([...ROW_IDS].sort());
  });

  it('keeps a row it does not know, under the server label', () => {
    const steps = joinSetupSteps([{ name: 'future-row', label: 'Future row', state: 'action-required' }]);
    expect(steps).toEqual([expect.objectContaining({ id: 'future-row', title: 'Future row', owner: 'host', ready: false })]);
  });
});

describe('the setup page', () => {
  it('shows each step with the state the server answered, who does it, and where to go', async () => {
    fetch.mockResolvedValueOnce(okResponse(readiness(['seeded', 'ticketing'])));
    await renderSetup();

    await screen.findByText('2 of 7 steps done');
    expect(endpoints()).toEqual(['webMcpCheckEventReadiness']);

    const admins = step('Add a second operator');
    expect(within(admins).getByText('To do')).toBeInTheDocument();
    expect(within(admins).getByText('You')).toBeInTheDocument();
    expect(within(admins).getByRole('link', { name: 'Open Access' })).toHaveAttribute('href', '/admin/access');

    const seeded = step('Replace the placeholder text');
    expect(within(seeded).getByText('Done')).toBeInTheDocument();
    expect(within(seeded).getByText('No placeholder text is left.')).toBeInTheDocument();
    expect(within(seeded).queryByRole('link')).toBeNull();

    expect(within(step('Verify your email domain')).getByText('You and the hosting team')).toBeInTheDocument();
    expect(within(step('Turn on Google sign-in')).getByText('Hosting team')).toBeInTheDocument();

    // The steps the client can do today come first.
    const titles = within(screen.getByRole('list', { name: 'Setup steps' }))
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent);
    expect(titles).toEqual(SETUP_STEPS.map((s) => s.title));
  });

  it('lets an operator mark the legal review complete, and checks again', async () => {
    fetch
      .mockResolvedValueOnce(okResponse(readiness([])))
      .mockResolvedValueOnce(okResponse({ ok: true }))
      .mockResolvedValueOnce(okResponse(readiness(['legal'])));
    await renderSetup();
    const legal = await screen.findByRole('listitem', { name: 'Approve the privacy policy and terms' });

    // The box must be ticked first; the press without it saves nothing.
    fireEvent.click(within(legal).getByRole('button', { name: 'Mark the review complete' }));
    expect(within(legal).getByText('Tick the box to confirm the review first.')).toBeInTheDocument();
    expect(endpoints()).toEqual(['webMcpCheckEventReadiness']);

    fireEvent.click(within(legal).getByRole('checkbox'));
    fireEvent.click(within(legal).getByRole('button', { name: 'Mark the review complete' }));

    await screen.findByText('1 of 7 steps done');
    expect(endpoints()).toEqual(['webMcpCheckEventReadiness', 'updateEventConfig', 'webMcpCheckEventReadiness']);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ event: { legal: { reviewRequired: false } } });
    expect(within(step('Approve the privacy policy and terms')).getByText('Done')).toBeInTheDocument();
  });

  it('states a refused legal save in place and keeps the step open', async () => {
    fetch
      .mockResolvedValueOnce(okResponse(readiness([])))
      .mockResolvedValueOnce(errorResponse(403, 'forbidden', 'Operator access required.'));
    await renderSetup();
    const legal = await screen.findByRole('listitem', { name: 'Approve the privacy policy and terms' });
    fireEvent.click(within(legal).getByRole('checkbox'));
    fireEvent.click(within(legal).getByRole('button', { name: 'Mark the review complete' }));

    expect(await within(legal).findByRole('alert')).toHaveTextContent('Operator access required.');
    expect(within(legal).getByText('To do')).toBeInTheDocument();
  });

  it('gives staff no operator links and no legal sign-off', async () => {
    tier.value = 'staff';
    fetch.mockResolvedValueOnce(okResponse(readiness([])));
    await renderSetup();
    const admins = await screen.findByRole('listitem', { name: 'Add a second operator' });

    expect(within(admins).queryByRole('link')).toBeNull();
    expect(within(admins).getByText('An operator completes this step.')).toBeInTheDocument();
    const legal = step('Approve the privacy policy and terms');
    expect(within(legal).queryByRole('checkbox')).toBeNull();
    expect(within(legal).getByRole('link', { name: 'Open Content' })).toBeInTheDocument();
  });

  it('says so when every step is done', async () => {
    fetch.mockResolvedValueOnce(okResponse(readiness(ROW_IDS)));
    await renderSetup();
    expect(await screen.findByText(/Every step is done/)).toBeInTheDocument();
    expect(screen.getByText('7 of 7 steps done')).toBeInTheDocument();
  });

  it('states a failed first check with the server words and no steps', async () => {
    fetch.mockResolvedValueOnce(errorResponse(503, 'unavailable', 'The diagnostic is temporarily unavailable.'));
    await renderSetup();
    expect(await screen.findByRole('alert')).toHaveTextContent('The diagnostic is temporarily unavailable.');
    expect(screen.queryByRole('list', { name: 'Setup steps' })).toBeNull();
  });

  it('keeps the last results under a caution when a second check fails', async () => {
    fetch
      .mockResolvedValueOnce(okResponse(readiness(['auth'])))
      .mockResolvedValueOnce(errorResponse(503, 'unavailable', 'Down.'));
    await renderSetup();
    await screen.findByText('1 of 7 steps done');
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(screen.getByText(/We could not check again/)).toBeInTheDocument());
    expect(screen.getByRole('list', { name: 'Setup steps' })).toBeInTheDocument();
  });
});
