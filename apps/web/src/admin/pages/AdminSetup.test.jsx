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

async function renderSetup(path = '/admin/setup') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return screen.findByRole('heading', { level: 1, name: 'Set up your event' }, { timeout: 10_000 });
}

/** The open step: its heading and the region it names. */
async function openStep(title) {
  const heading = await screen.findByRole('heading', { level: 2, name: title });
  return heading.closest('section');
}

function stepList() {
  return screen.getByRole('list', { name: 'Setup steps' });
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

describe('the setup stepper', () => {
  it('opens the first step that is not done, and lists every step with its state', async () => {
    fetch.mockResolvedValueOnce(okResponse(readiness(['admins', 'ticketing'])));
    await renderSetup();

    await screen.findByText('2 of 7 steps done');
    expect(endpoints()).toEqual(['webMcpCheckEventReadiness']);

    const step = await openStep('Upload your logos');
    expect(within(step).getByText('Step 2 of 7')).toBeInTheDocument();
    expect(within(step).getByText('To do')).toBeInTheDocument();
    expect(within(step).getByText('You')).toBeInTheDocument();
    expect(within(step).getByRole('link', { name: 'Open Branding' })).toHaveAttribute('href', '/admin/branding');
    expect(within(step).getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/admin/setup/team');
    expect(within(step).getByRole('link', { name: 'Next: Replace the placeholder text' })).toHaveAttribute('href', '/admin/setup/text');

    // Every step is in the list, in order, with its state in words.
    const items = within(stepList()).getAllByRole('link');
    expect(items.map((link) => link.getAttribute('href'))).toEqual(SETUP_STEPS.map((s) => `/admin/setup/${s.slug}`));
    expect(items[0]).toHaveTextContent('Add a second operatorDone');
    expect(items[1]).toHaveTextContent('Upload your logosTo do');
    expect(items[1]).toHaveAttribute('aria-current', 'step');
    expect(items.filter((link) => link.hasAttribute('aria-current'))).toHaveLength(1);
    // On a narrow screen the list folds into one line above the step.
    expect(screen.getByText('Show all 7 steps')).toBeInTheDocument();
  });

  it('moves between steps by address, and puts the focus on the new step', async () => {
    fetch.mockResolvedValueOnce(okResponse(readiness([])));
    await renderSetup('/admin/setup/text');
    const step = await openStep('Replace the placeholder text');
    expect(within(step).getByText('Step 3 of 7')).toBeInTheDocument();

    fireEvent.click(within(step).getByRole('link', { name: 'Next: Approve the privacy policy and terms' }));
    const next = await openStep('Approve the privacy policy and terms');
    await waitFor(() => expect(document.activeElement).toBe(within(next).getByRole('heading', { level: 2 })));
    expect(within(next).getByRole('link', { name: 'Open the privacy policy' })).toHaveAttribute('href', '/admin/content/privacy');
    // One check for the whole visit, not one per step.
    expect(endpoints()).toEqual(['webMcpCheckEventReadiness']);
  });

  it('has no Back on the first step and no Next on the last', async () => {
    fetch.mockResolvedValueOnce(okResponse(readiness([])));
    await renderSetup('/admin/setup/team');
    const first = await openStep('Add a second operator');
    expect(within(first).queryByRole('link', { name: 'Back' })).toBeNull();

    fireEvent.click(within(stepList()).getByRole('link', { name: /Turn on Google sign-in/ }));
    const last = await openStep('Turn on Google sign-in');
    expect(within(last).getByText('Step 7 of 7')).toBeInTheDocument();
    expect(within(last).queryByRole('link', { name: /^Next/ })).toBeNull();
    expect(within(last).getByText('Hosting team')).toBeInTheDocument();
  });

  it('sends an unknown step address to the first open step', async () => {
    fetch.mockResolvedValueOnce(okResponse(readiness(['admins'])));
    await renderSetup('/admin/setup/no-such-step');
    await openStep('Upload your logos');
  });

  it('speaks of the event email in plain words', async () => {
    fetch.mockResolvedValueOnce(okResponse(readiness([])));
    await renderSetup('/admin/setup/email');
    const step = await openStep('Set up your event email');
    expect(within(step).getByText('You and the hosting team')).toBeInTheDocument();
    expect(step.textContent).not.toMatch(/SPF|DKIM|DMARC|DNS/);
  });

  it('lets an operator mark the legal review complete, and checks again', async () => {
    fetch
      .mockResolvedValueOnce(okResponse(readiness([])))
      .mockResolvedValueOnce(okResponse({ ok: true }))
      .mockResolvedValueOnce(okResponse(readiness(['legal'])));
    await renderSetup('/admin/setup/legal');
    const legal = await openStep('Approve the privacy policy and terms');

    // The box must be ticked first; the press without it saves nothing.
    fireEvent.click(within(legal).getByRole('button', { name: 'Mark the review complete' }));
    expect(within(legal).getByText('Tick the box to confirm the review first.')).toBeInTheDocument();
    expect(endpoints()).toEqual(['webMcpCheckEventReadiness']);

    fireEvent.click(within(legal).getByRole('checkbox'));
    fireEvent.click(within(legal).getByRole('button', { name: 'Mark the review complete' }));

    await screen.findByText('1 of 7 steps done');
    expect(endpoints()).toEqual(['webMcpCheckEventReadiness', 'updateEventConfig', 'webMcpCheckEventReadiness']);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ event: { legal: { reviewRequired: false } } });
    const done = await openStep('Approve the privacy policy and terms');
    expect(within(done).getByText('Done')).toBeInTheDocument();
    expect(within(done).queryByRole('checkbox')).toBeNull();
  });

  it('states a refused legal save in place and keeps the step open', async () => {
    fetch
      .mockResolvedValueOnce(okResponse(readiness([])))
      .mockResolvedValueOnce(errorResponse(403, 'forbidden', 'Operator access required.'));
    await renderSetup('/admin/setup/legal');
    const legal = await openStep('Approve the privacy policy and terms');
    fireEvent.click(within(legal).getByRole('checkbox'));
    fireEvent.click(within(legal).getByRole('button', { name: 'Mark the review complete' }));

    expect(await within(legal).findByRole('alert')).toHaveTextContent('Operator access required.');
    expect(within(legal).getByText('To do')).toBeInTheDocument();
  });

  it('gives staff no operator links and no legal sign-off', async () => {
    tier.value = 'staff';
    fetch.mockResolvedValueOnce(okResponse(readiness([])));
    await renderSetup('/admin/setup/team');
    const team = await openStep('Add a second operator');
    expect(within(team).queryByRole('link', { name: 'Open Access' })).toBeNull();
    expect(within(team).getByText('An operator completes this step.')).toBeInTheDocument();

    fireEvent.click(within(team).getByRole('link', { name: /^Next/ }));
    fireEvent.click(within(await openStep('Upload your logos')).getByRole('link', { name: /^Next/ }));
    fireEvent.click(within(await openStep('Replace the placeholder text')).getByRole('link', { name: /^Next/ }));
    const legal = await openStep('Approve the privacy policy and terms');
    expect(within(legal).queryByRole('checkbox')).toBeNull();
    expect(within(legal).getByRole('link', { name: 'Open the privacy policy' })).toBeInTheDocument();
  });

  it('says so when every step is done', async () => {
    fetch.mockResolvedValueOnce(okResponse(readiness(ROW_IDS)));
    await renderSetup();
    expect(await screen.findByText(/Every step is done/)).toBeInTheDocument();
    expect(screen.getByText('7 of 7 steps done')).toBeInTheDocument();
    await openStep('Add a second operator');
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
    expect(stepList()).toBeInTheDocument();
  });
});

describe('the first-visit tour on the setup page', () => {
  it('waits on the setup page and opens on the next admin page', async () => {
    window.localStorage.clear();
    fetch.mockResolvedValue(okResponse(readiness([])));
    await renderSetup();
    await openStep('Add a second operator');
    expect(screen.queryByRole('heading', { name: 'Welcome to the admin panel' })).toBeNull();

    fireEvent.click(screen.getByRole('link', { name: 'Overview' }));
    expect(await screen.findByRole('heading', { name: 'Welcome to the admin panel' })).toBeInTheDocument();
  });
});
