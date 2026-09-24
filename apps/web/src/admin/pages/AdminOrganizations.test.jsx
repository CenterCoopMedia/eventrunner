// The organizations list and editor (issue #192), rendered through the
// whole app at their real admin routes, with the endpoints behind fetch.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

const adminSubscriptions = new Map();
const adminErrors = new Map();
// When true, the admin listeners attach but deliver nothing yet: the window
// in which a page is still loading.
let holdAdminCollections = false;
vi.mock('../adminSource.js', () => ({
  subscribeAdminCollection: (name, onNext, onError) => {
    adminSubscriptions.set(name, onNext);
    adminErrors.set(name, onError);
    if (!holdAdminCollections) onNext([]);
    return () => adminSubscriptions.delete(name);
  },
}));
vi.mock('../../lib/configSource.js', () => ({
  subscribeConfigDoc: () => () => {},
}));
vi.mock('../../lib/contentSource.js', () => ({
  subscribeContentCollection: () => () => {},
  subscribeSpeakersPublic: () => () => {},
}));
vi.mock('../../lib/profileSource.js', () => ({ subscribeOwnProfile: () => () => {} }));
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
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({})),
  query: vi.fn(() => ({})),
  limit: vi.fn(() => ({})),
  getDocs: vi.fn(() => Promise.resolve({ docs: [] })),
}));

import App from '../../App.jsx';
import { markTourDone } from '../tourState.js';

let currentPath = '';
function PathProbe() {
  currentPath = useLocation().pathname;
  return null;
}

function response(body) {
  return { ok: true, status: 200, json: async () => body };
}

function refusal(status, message, code = 'bad-request') {
  return { ok: false, status, json: async () => ({ error: { code, message } }) };
}

/**
 * Let every pending promise settle. A save reaches fetch only after
 * `await getIdToken()`, so a check for "no call" made straight after the
 * click passes even when a request is on its way.
 */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function published(ids) {
  return response({ results: { cmsOrganizations: { published: ids, skipped: [] } } });
}

async function renderAt(path) {
  render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <App />
      <PathProbe />
    </MemoryRouter>,
  );
  await waitFor(() => {
    expect(screen.queryByLabelText('Loading admin…')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Checking your access…')).not.toBeInTheDocument();
  }, { timeout: 10_000 });
}

function pushOrganizations(live, drafts) {
  act(() => {
    adminSubscriptions.get('cmsOrganizations')(live);
    adminSubscriptions.get('cmsOrganizations_drafts')(drafts);
  });
}

const endpointOf = (index) => String(fetch.mock.calls[index][0]).split('/').at(-1);
const bodyOf = (index) => JSON.parse(fetch.mock.calls[index][1].body);

const LIVE = [
  { id: 'beacon-fund', name: 'Beacon Fund', tier: 'presenting', order: 0, visible: true },
  { id: 'hidden-press', name: 'Hidden Press', tier: 'supporting', order: 2, visible: false },
  { id: 'tide-media', name: 'Tide Media', tier: 'partner', order: 1, visible: true },
];
const DRAFTS = [
  { id: 'tide-media', name: 'Tide Media Collective', tier: 'partner', order: 1, visible: true, status: 'dirty' },
  { id: 'new-grant', name: 'New Grant', tier: null, order: 3, visible: true, status: 'dirty' },
  { id: 'beacon-fund', name: 'Beacon Fund', tier: 'presenting', order: 0, visible: true, status: 'clean' },
];

async function openNewOrganization() {
  await renderAt('/admin/organizations/new/organization');
  await screen.findByRole('heading', { level: 1, name: 'New organization' });
  await waitFor(() => expect(adminSubscriptions.has('cmsOrganizations_drafts')).toBe(true));
}

async function fillNewOrganization(name = 'Example Fund') {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Tier'), { target: { value: 'supporting' } });
}

beforeEach(() => {
  // The editor tour (issue #198) opens on a first visit and states the
  // record words this file reads; the account has already ended it.
  markTourDone('admin-1');
  adminSubscriptions.clear();
  adminErrors.clear();
  holdAdminCollections = false;
  currentPath = '';
  globalThis.fetch = vi.fn();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('the organizations list', () => {
  it('says it is loading until both revisions have arrived', async () => {
    holdAdminCollections = true;
    await renderAt('/admin/organizations');
    expect(await screen.findByRole('status', { name: 'Loading organizations…' })).toBeInTheDocument();
    await waitFor(() => expect(adminSubscriptions.has('cmsOrganizations_drafts')).toBe(true));
    pushOrganizations(LIVE, DRAFTS);
    expect(screen.queryByRole('status', { name: 'Loading organizations…' })).toBeNull();
  });

  it('offers the first organization when there is none', async () => {
    await renderAt('/admin/organizations');
    expect(await screen.findByRole('heading', { name: 'No organizations yet' })).toBeInTheDocument();
    const add = screen.getAllByRole('link', { name: 'Add an organization' });
    expect(add.length).toBeGreaterThan(0);
    for (const link of add) expect(link).toHaveAttribute('href', '/admin/organizations/new/organization');
    expect(screen.getByText('0 organizations')).toBeInTheDocument();
  });

  it('rules a table in the order the sponsors page draws, with each state in words', async () => {
    await renderAt('/admin/organizations');
    await screen.findByRole('heading', { level: 1, name: 'Organizations' });
    pushOrganizations(LIVE, DRAFTS);

    const region = screen.getByRole('region', { name: 'Organizations' });
    expect(region).toHaveAttribute('tabindex', '0');
    const table = within(region).getByRole('table', { name: 'Organizations in the order the sponsors page draws them.' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => within(row).getByRole('link').textContent)).toEqual([
      'Beacon Fund', 'Tide Media Collective', 'Hidden Press', 'New Grant',
    ]);
    expect(within(table).getByRole('columnheader', { name: 'Order' })).toHaveAttribute('aria-sort', 'ascending');
    expect(within(rows[0]).getByText('/sponsors/beacon-fund')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Live')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Live with unpublished changes')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Hidden')).toBeInTheDocument();
    expect(within(rows[3]).getByText('Draft')).toBeInTheDocument();
    expect(within(rows[3]).getByText('None')).toBeInTheDocument();
    // A row that is not live sits on the proof ground as a second signal.
    expect(rows[1].className).toContain('admin-proof-row');
    expect(rows[0].className).not.toContain('admin-proof-row');
    expect(within(rows[0]).getByRole('link')).toHaveAttribute('href', '/admin/organizations/beacon-fund');
    expect(screen.getByText('4 organizations')).toBeInTheDocument();
  });

  it('publishes every saved draft, and only those', async () => {
    await renderAt('/admin/organizations');
    await screen.findByRole('heading', { level: 1, name: 'Organizations' });
    pushOrganizations(LIVE, DRAFTS);
    fetch.mockResolvedValueOnce(published(['tide-media', 'new-grant']));

    fireEvent.click(screen.getByRole('button', { name: 'Publish all (2)' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(endpointOf(0)).toBe('cmsPublish');
    expect(bodyOf(0)).toEqual({ collection: 'cmsOrganizations', docIds: ['tide-media', 'new-grant'] });
    // Stated in place, and repeated by the toast.
    expect(await screen.findAllByText('Published. The public site picks it up live.')).not.toHaveLength(0);
  });
});

// Review round (c2, finding 3). The notice in place is the record and the
// announcement; the toast repeats it with no live role.
describe('the organizations list, announcing a publish', () => {
  /** The live regions (status or alert) whose text holds `message`. */
  const liveRegionsSaying = (message) =>
    [...document.querySelectorAll('[role="status"], [role="alert"]')]
      .filter((node) => node.textContent.includes(message));

  it('announces a published result once, and a failure once', async () => {
    await renderAt('/admin/organizations');
    await screen.findByRole('heading', { level: 1, name: 'Organizations' });
    pushOrganizations(LIVE, DRAFTS);
    fetch.mockResolvedValueOnce(published(['tide-media', 'new-grant']));
    fireEvent.click(screen.getByRole('button', { name: 'Publish all (2)' }));
    const message = 'Published. The public site picks it up live.';
    await waitFor(() => expect(screen.getAllByText(message)).toHaveLength(2));
    expect(liveRegionsSaying(message)).toHaveLength(1);

    fetch.mockResolvedValueOnce(refusal(500, 'Publish failed part-way.', 'publish-failed'));
    fireEvent.click(screen.getByRole('button', { name: 'Publish all (2)' }));
    await waitFor(() => expect(screen.getAllByText('Publish failed part-way.')).toHaveLength(2));
    expect(liveRegionsSaying('Publish failed part-way.')).toHaveLength(1);
    // The repeat keeps its error tone, stated as a word.
    const toast = screen.getAllByText('Publish failed part-way.').find((node) => !node.closest('[role]'));
    expect(toast.parentElement).toHaveTextContent(/^Problem/);
  });
});

// Review round (c2, finding 4): a busy control says so in its words and
// in aria-busy.
describe('the organizations list, while a publish runs', () => {
  it('marks Publish all and Resume publish busy while they run', async () => {
    await renderAt('/admin/organizations');
    await screen.findByRole('heading', { level: 1, name: 'Organizations' });
    pushOrganizations(LIVE, DRAFTS);
    let finish;
    fetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: { code: 'publish-failed', message: 'Publish failed part-way.' }, queueId: 'queue-7' }),
      })
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));

    fireEvent.click(screen.getByRole('button', { name: 'Publish all (2)' }));
    const resume = await screen.findByRole('button', { name: 'Resume publish' });
    expect(resume).not.toHaveAttribute('aria-busy');
    fireEvent.click(resume);
    const resuming = await screen.findByRole('button', { name: 'Resuming…' });
    expect(resuming).toHaveAttribute('aria-busy', 'true');
    await act(async () => finish(published(['tide-media', 'new-grant'])));

    const publishAll = await screen.findByRole('button', { name: 'Publish all (2)' });
    expect(publishAll).not.toHaveAttribute('aria-busy');
    fireEvent.click(publishAll);
    const publishing = await screen.findByRole('button', { name: 'Publishing…' });
    expect(publishing).toHaveAttribute('aria-busy', 'true');
    await act(async () => finish(published(['tide-media', 'new-grant'])));
  });
});

describe('the organizations list, resuming a publish', () => {
  // Codex review on #281: a resumed run is reported against the ids the
  // failed run asked for, not the drafts that are dirty now. A draft saved
  // after the failure was never part of the run.
  it('reports a resumed publish against the ids the failed run asked for', async () => {
    await renderAt('/admin/organizations');
    await screen.findByRole('heading', { level: 1, name: 'Organizations' });
    pushOrganizations(LIVE, DRAFTS);
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: { code: 'publish-failed', message: 'Publish failed part-way.' }, queueId: 'queue-7' }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Publish all (2)' }));
    const resume = await screen.findByRole('button', { name: 'Resume publish' });

    // A third organization gains a draft after the failed run.
    pushOrganizations(LIVE, [...DRAFTS, { id: 'hidden-press', name: 'Hidden Press Ltd', tier: 'supporting', order: 2, visible: false, status: 'dirty' }]);
    fetch.mockResolvedValueOnce(published(['tide-media', 'new-grant']));
    fireEvent.click(resume);
    const results = await screen.findAllByText('Published. The public site picks it up live.');
    expect(results.some((node) => node.getAttribute('role') === 'status')).toBe(true);
    expect(bodyOf(1)).toEqual({ queueId: 'queue-7' });
    // The new draft is still waiting, and the list still counts it.
    expect(screen.getByRole('button', { name: /^Publish all \(\d\)$/ })).toBeInTheDocument();
  });
});

describe('the organization editor', () => {
  it('creates a draft at the address the name suggests', async () => {
    holdAdminCollections = true;
    await openNewOrganization();
    pushOrganizations(LIVE, DRAFTS);
    fetch.mockResolvedValueOnce(response({ docId: 'example-fund', status: 'dirty' }));
    await fillNewOrganization();
    expect(screen.getByLabelText(/^Page address/)).toHaveValue('example-fund');
    fireEvent.change(screen.getByLabelText('Website'), { target: { value: 'https://example.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(endpointOf(0)).toBe('cmsCreateContent');
    expect(bodyOf(0)).toEqual({
      collection: 'cmsOrganizations',
      docId: 'example-fund',
      visible: true,
      fields: {
        name: 'Example Fund',
        tier: 'supporting',
        // After the last organization on the wall.
        order: 4,
        logoPath: null,
        url: 'https://example.org',
        description: null,
      },
    });
    await waitFor(() => expect(currentPath).toBe('/admin/organizations/example-fund'));
    expect(await screen.findByText('Draft saved. It is not live until you publish it.')).toBeInTheDocument();
  });

  it('saves and publishes in one press', async () => {
    await openNewOrganization();
    fetch
      .mockResolvedValueOnce(response({ docId: 'example-fund', status: 'dirty' }))
      .mockResolvedValueOnce(published(['example-fund']));
    await fillNewOrganization();
    fireEvent.click(screen.getByRole('button', { name: 'Save and publish' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(endpointOf(0)).toBe('cmsCreateContent');
    expect(endpointOf(1)).toBe('cmsPublish');
    expect(bodyOf(1)).toEqual({ collection: 'cmsOrganizations', docIds: ['example-fund'] });
    expect(await screen.findAllByText('Published. The public site picks it up live.')).not.toHaveLength(0);
  });

  it('retries a publish that failed after the create as an update, never a second create', async () => {
    await openNewOrganization();
    fetch
      .mockResolvedValueOnce(response({ docId: 'example-fund', status: 'dirty' }))
      .mockResolvedValueOnce(refusal(500, 'Publish failed.', 'internal'))
      .mockResolvedValueOnce(response({ docId: 'example-fund', status: 'dirty' }))
      .mockResolvedValueOnce(published(['example-fund']));
    await fillNewOrganization();
    fireEvent.click(screen.getByRole('button', { name: 'Save and publish' }));
    expect(await screen.findByText('Publish failed.')).toBeInTheDocument();
    // The page already stands at the record's own address.
    await waitFor(() => expect(currentPath).toBe('/admin/organizations/example-fund'));
    // The form is still here, with what was typed, while the listener catches up.
    expect(screen.getByLabelText('Name')).toHaveValue('Example Fund');

    fireEvent.click(screen.getByRole('button', { name: 'Save and publish' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
    expect(fetch.mock.calls.map((_, index) => endpointOf(index))).toEqual([
      'cmsCreateContent', 'cmsPublish', 'cmsUpdateContent', 'cmsPublish',
    ]);
    expect(bodyOf(2).docId).toBe('example-fund');
  });

  it('marks the name when the server refuses it, and moves focus to the summary', async () => {
    await openNewOrganization();
    fetch.mockResolvedValueOnce(refusal(400, 'name: must be text'));
    await fillNewOrganization();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    const summary = await screen.findByRole('alert');
    expect(summary).toHaveTextContent('name: must be text');
    await waitFor(() => expect(document.activeElement).toBe(summary));
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Name')).toHaveAccessibleDescription('name: must be text');
    expect(screen.getByLabelText('Website')).not.toHaveAttribute('aria-invalid');
  });

  it('marks the page address when the server says another organization holds it (issue 193)', async () => {
    await openNewOrganization();
    fetch.mockResolvedValueOnce(refusal(409, 'slug: another organization already uses "example-fund"', 'already-exists'));
    await fillNewOrganization();
    fireEvent.click(screen.getByRole('button', { name: 'Save and publish' }));

    const summary = await screen.findByRole('alert');
    expect(summary).toHaveTextContent('slug: another organization already uses "example-fund"');
    const address = screen.getByLabelText(/^Page address/);
    expect(address).toHaveAttribute('aria-invalid', 'true');
    expect(address).toHaveAccessibleDescription(
      expect.stringContaining('slug: another organization already uses "example-fund"'),
    );
    // Refused at the save: nothing was published.
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(currentPath).toBe('/admin/organizations/new/organization');
  });

  it('catches an address a loaded organization holds before any call (issue 193)', async () => {
    await openNewOrganization();
    pushOrganizations(LIVE, DRAFTS);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Tide Media' } });
    const address = screen.getByLabelText(/^Page address/);
    expect(address).toHaveValue('tide-media');
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await settle();
    expect(fetch).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(address));
    expect(screen.getByText('Another organization already uses this address.')).toBeInTheDocument();
  });

  it('answers a save with an invalid field by moving to it, and sends nothing', async () => {
    await openNewOrganization();
    // A blank form shows no errors until the operator acts.
    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Order'), { target: { value: 'first' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and publish' }));
    await settle();
    expect(fetch).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Name')));
    expect(screen.getByLabelText('Order')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter a number.')).toBeInTheDocument();
  });

  it('edits a stored organization as an update and keeps its address fixed', async () => {
    await renderAt('/admin/organizations/tide-media');
    await waitFor(() => expect(adminSubscriptions.has('cmsOrganizations_drafts')).toBe(true));
    pushOrganizations(LIVE, DRAFTS);
    expect(await screen.findByDisplayValue('Tide Media Collective')).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Page address/)).toBeNull();
    expect(screen.getByText('/sponsors/tide-media')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Preview draft/ })).toHaveAttribute('href', '/sponsors/tide-media?preview=1');

    fetch.mockResolvedValueOnce(response({ docId: 'tide-media', status: 'dirty' }));
    fireEvent.change(screen.getByLabelText('Order'), { target: { value: '5' } });
    fireEvent.click(screen.getByLabelText('Show this organization when it is published'));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(endpointOf(0)).toBe('cmsUpdateContent');
    expect(bodyOf(0)).toMatchObject({
      collection: 'cmsOrganizations',
      docId: 'tide-media',
      visible: false,
      fields: { name: 'Tide Media Collective', order: 5 },
    });
  });

  // Codex review on #281: the two listeners report in no fixed order. A
  // form filled from the live doc alone, before the draft arrives, would
  // save the live values over the unpublished draft.
  it('waits for both revisions before it fills the form, so a save keeps the unpublished draft', async () => {
    holdAdminCollections = true;
    await renderAt('/admin/organizations/tide-media');
    await waitFor(() => expect(adminSubscriptions.has('cmsOrganizations_drafts')).toBe(true));
    act(() => adminSubscriptions.get('cmsOrganizations')(LIVE));
    expect(screen.queryByLabelText('Name')).toBeNull();
    act(() => adminSubscriptions.get('cmsOrganizations_drafts')(DRAFTS));
    expect(await screen.findByDisplayValue('Tide Media Collective')).toBeInTheDocument();

    fetch.mockResolvedValueOnce(response({ docId: 'tide-media', status: 'dirty' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(bodyOf(0).fields.name).toBe('Tide Media Collective');
  });

  it('stays closed and says why when the drafts listener fails before it reports', async () => {
    holdAdminCollections = true;
    await renderAt('/admin/organizations/tide-media');
    await waitFor(() => expect(adminErrors.has('cmsOrganizations_drafts')).toBe(true));
    act(() => adminSubscriptions.get('cmsOrganizations')(LIVE));
    act(() => adminErrors.get('cmsOrganizations_drafts')(new Error('permission-denied')));
    expect(await screen.findByText(/could not load this organization and its saved draft/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).toBeNull();
    // The retried listener reports, and the form opens on the draft.
    act(() => adminSubscriptions.get('cmsOrganizations_drafts')(DRAFTS));
    expect(await screen.findByDisplayValue('Tide Media Collective')).toBeInTheDocument();
  });

  // Codex review on #281: an organization stored before slugs were checked
  // may have any id, `_new` among them. Its address must open its editor,
  // not a blank create form.
  it('opens a stored organization whose id is _new, because the create form has its own two-part address', async () => {
    await renderAt('/admin/organizations/_new');
    await waitFor(() => expect(adminSubscriptions.has('cmsOrganizations_drafts')).toBe(true));
    pushOrganizations([{ id: '_new', name: 'Legacy Fund', tier: 'partner', order: 4, visible: true }], []);
    expect(await screen.findByDisplayValue('Legacy Fund')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'New organization' })).toBeNull();
  });

  it('says so when an address names no organization', async () => {
    await renderAt('/admin/organizations/nobody');
    expect(await screen.findByRole('heading', { name: 'No such organization' })).toBeInTheDocument();
  });

  it('deletes after the confirmation names what goes', async () => {
    await renderAt('/admin/organizations/tide-media');
    await waitFor(() => expect(adminSubscriptions.has('cmsOrganizations_drafts')).toBe(true));
    pushOrganizations(LIVE, DRAFTS);
    await screen.findByDisplayValue('Tide Media Collective');
    fetch.mockResolvedValueOnce(response({ deleted: ['cmsOrganizations/tide-media', 'cmsOrganizations_drafts/tide-media'] }));

    fireEvent.click(screen.getByRole('button', { name: 'Delete this organization' }));
    const moment = screen.getByRole('region', { name: 'Delete Tide Media Collective' });
    expect(moment).toHaveTextContent('Its page address is free again. The logo stays in the media library.');
    fireEvent.click(within(moment).getByRole('button', { name: 'Delete this organization' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(endpointOf(0)).toBe('cmsDeleteContent');
    expect(bodyOf(0)).toEqual({ collection: 'cmsOrganizations', docId: 'tide-media' });
    await waitFor(() => expect(currentPath).toBe('/admin/organizations'));
  });
});
