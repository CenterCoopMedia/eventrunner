// The timeline list and editor (issue #194), rendered through the whole app
// at their real admin routes, with the endpoints behind fetch.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

const adminSubscriptions = new Map();
// When true, the admin listeners attach but deliver nothing yet: the window
// in which a page is still loading.
let holdAdminCollections = false;
vi.mock('../adminSource.js', () => ({
  subscribeAdminCollection: (name, onNext) => {
    adminSubscriptions.set(name, onNext);
    if (!holdAdminCollections) onNext([]);
    return () => adminSubscriptions.delete(name);
  },
}));
vi.mock('../../lib/configSource.js', () => ({
  subscribeConfigDoc: () => () => {},
}));
// The public content listeners, captured: the list reads the live home page
// to say whether it has a History section.
const contentSubscriptions = new Map();
vi.mock('../../lib/contentSource.js', () => ({
  subscribeContentCollection: (name, _readSource, onNext) => {
    contentSubscriptions.set(name, onNext);
    return () => contentSubscriptions.delete(name);
  },
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
import snapshotPages from '@generated/pagesData.js';

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

function published(ids) {
  return response({ results: { cmsTimeline: { published: ids, skipped: [] } } });
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

function pushTimeline(live, drafts) {
  act(() => {
    adminSubscriptions.get('cmsTimeline')(live);
    adminSubscriptions.get('cmsTimeline_drafts')(drafts);
  });
}

const endpointOf = (index) => String(fetch.mock.calls[index][0]).split('/').at(-1);
const bodyOf = (index) => JSON.parse(fetch.mock.calls[index][1].body);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const LIVE = [
  { id: 'edition-2025', year: 2025, title: 'Two workshop tracks', description: null, visible: true },
  { id: 'edition-2024', year: 2024, title: 'The first meeting', description: 'Teams met.', visible: true },
  { id: 'edition-2021', year: 2021, title: 'A hidden year', description: null, visible: false },
];
const DRAFTS = [
  { id: 'edition-2025', year: 2025, title: 'Two workshop tracks, edited', description: null, visible: true, status: 'dirty' },
  { id: 'edition-2024', year: 2024, title: 'The first meeting', description: 'Teams met.', visible: true, status: 'clean' },
  { id: 'edition-2019', year: 2019, title: 'A planning day', description: null, visible: true, status: 'dirty' },
];

async function openNewEntry() {
  await renderAt('/admin/timeline/new/entry');
  await screen.findByRole('heading', { level: 1, name: 'New entry' });
  await waitFor(() => expect(adminSubscriptions.has('cmsTimeline_drafts')).toBe(true));
}

function fillNewEntry({ year = '2023', title = 'A new edition' } = {}) {
  fireEvent.change(screen.getByLabelText('Year'), { target: { value: year } });
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: title } });
}

async function openEntry(id = 'edition-2024') {
  await renderAt(`/admin/timeline/${id}`);
  await waitFor(() => expect(adminSubscriptions.has('cmsTimeline_drafts')).toBe(true));
  pushTimeline(LIVE, DRAFTS);
}

beforeEach(() => {
  adminSubscriptions.clear();
  contentSubscriptions.clear();
  holdAdminCollections = false;
  currentPath = '';
  globalThis.fetch = vi.fn();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('the timeline list', () => {
  it('says it is loading until both revisions have arrived', async () => {
    holdAdminCollections = true;
    await renderAt('/admin/timeline');
    expect(await screen.findByRole('status', { name: 'Loading timeline…' })).toBeInTheDocument();
    await waitFor(() => expect(adminSubscriptions.has('cmsTimeline_drafts')).toBe(true));
    pushTimeline(LIVE, DRAFTS);
    expect(screen.queryByRole('status', { name: 'Loading timeline…' })).toBeNull();
  });

  it('offers the first entry when there is none', async () => {
    await renderAt('/admin/timeline');
    expect(await screen.findByRole('heading', { name: 'No timeline entries yet' })).toBeInTheDocument();
    expect(screen.getByText('Add the first entry. It stays a draft until you publish it.')).toBeInTheDocument();
    // One noun for the record: "past editions" only says what the entries are.
    const main = screen.getByRole('main');
    expect(main.textContent.match(/edition/gi)).toEqual(['edition']);
    expect(within(main).getByText(/^Past editions of the event\./)).toBeInTheDocument();
    const add = screen.getAllByRole('link', { name: 'Add an entry' });
    expect(add.length).toBeGreaterThan(0);
    for (const link of add) expect(link).toHaveAttribute('href', '/admin/timeline/new/entry');
    expect(screen.getByText('0 entries')).toBeInTheDocument();
  });

  it('lists the entries oldest first, each state in words, a hidden one marked Hidden', async () => {
    await renderAt('/admin/timeline');
    await screen.findByRole('heading', { level: 1, name: 'Timeline' });
    pushTimeline(LIVE, DRAFTS);

    expect(screen.getByText('4 entries')).toBeInTheDocument();
    const links = screen.getAllByRole('link').filter((link) => link.getAttribute('href')?.startsWith('/admin/timeline/edition-'));
    expect(links.map((link) => link.textContent)).toEqual([
      'A planning day', 'A hidden year', 'The first meeting', 'Two workshop tracks, edited',
    ]);
    const rows = links.map((link) => link.closest('li'));
    expect(within(rows[0]).getByText('2019 · edition-2019')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Draft')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Live')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Hidden')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Live')).toBeInTheDocument();
    expect(within(rows[2]).queryByText('Hidden')).toBeNull();
    expect(within(rows[3]).getByText('Live with unpublished changes')).toBeInTheDocument();
    // A row that is not live sits on the proof ground as a second signal.
    expect(rows[0].className).toContain('admin-proof-row');
    expect(rows[2].className).not.toContain('admin-proof-row');
    expect(links[2]).toHaveAttribute('href', '/admin/timeline/edition-2024');
  });

  it('publishes every entry that is not live, and only those', async () => {
    await renderAt('/admin/timeline');
    await screen.findByRole('heading', { level: 1, name: 'Timeline' });
    pushTimeline(LIVE, DRAFTS);
    fetch.mockResolvedValueOnce(published(['edition-2019', 'edition-2025']));

    fireEvent.click(screen.getByRole('button', { name: 'Publish all (2)' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(endpointOf(0)).toBe('cmsPublish');
    expect(bodyOf(0)).toEqual({ collection: 'cmsTimeline', docIds: ['edition-2019', 'edition-2025'] });
    expect(await screen.findAllByText('Published. The public site picks it up live.')).not.toHaveLength(0);
  });

  it('says so when the live home page has no History section, and not while it has one', async () => {
    await renderAt('/admin/timeline');
    await screen.findByRole('heading', { level: 1, name: 'Timeline' });
    const warning = (_content, element) =>
      element?.tagName === 'P'
      && element.textContent === 'The home page has no section with the id history, so published entries do not appear on the site. Add one to the home page under Pages.';
    // The snapshot's home page has the section.
    expect(screen.queryByText(warning)).toBeNull();

    const home = snapshotPages.find((page) => page.id === 'home');
    act(() => {
      contentSubscriptions.get('cmsPages')(
        snapshotPages.map((page) => (page.id === 'home'
          ? { ...home, sections: home.sections.filter((section) => section.id !== 'history') }
          : page)),
      );
    });
    const notice = screen.getByText(warning);
    // The id is a value the operator types, so it is set in the data face.
    const id = within(notice).getByText('history', { selector: 'code' });
    expect(id).toHaveClass('font-admin-data');
  });
});

describe('the timeline entry editor', () => {
  it('creates a draft under a new UUID, and publishes nothing', async () => {
    holdAdminCollections = true;
    await openNewEntry();
    pushTimeline(LIVE, DRAFTS);
    fetch.mockResolvedValueOnce(response({ docId: 'x', status: 'dirty' }));
    fillNewEntry();
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: '  One day of talks.  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(endpointOf(0)).toBe('cmsCreateContent');
    const body = bodyOf(0);
    expect(body.docId).toMatch(UUID_RE);
    expect(body).toEqual({
      collection: 'cmsTimeline',
      docId: body.docId,
      visible: true,
      fields: { year: 2023, title: 'A new edition', description: 'One day of talks.' },
    });
    // Stated in place, and repeated by the toast.
    expect(await screen.findAllByText('Draft saved. It is not live until you publish it.')).not.toHaveLength(0);
    await waitFor(() => expect(currentPath).toBe(`/admin/timeline/${body.docId}`));
    // The entry's own address, the same form, while the listener catches up.
    expect(screen.getByLabelText('Title')).toHaveValue('A new edition');
    expect(screen.getByRole('heading', { level: 1, name: 'A new edition' })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('saves and publishes in one press', async () => {
    await openNewEntry();
    fetch
      .mockImplementationOnce(async () => response({ status: 'dirty' }))
      .mockImplementationOnce(async (_url, init) => published(JSON.parse(init.body).docIds));
    fillNewEntry();
    fireEvent.click(screen.getByRole('button', { name: 'Save and publish' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(endpointOf(0)).toBe('cmsCreateContent');
    expect(endpointOf(1)).toBe('cmsPublish');
    expect(bodyOf(1)).toEqual({ collection: 'cmsTimeline', docIds: [bodyOf(0).docId] });
    expect(await screen.findAllByText('Published. The public site picks it up live.')).not.toHaveLength(0);
    await waitFor(() => expect(currentPath).toBe(`/admin/timeline/${bodyOf(0).docId}`));
  });

  it('retries a publish that failed after the create as an update on the same id, never a second create', async () => {
    await openNewEntry();
    fetch
      .mockImplementationOnce(async () => response({ status: 'dirty' }))
      .mockImplementationOnce(async () => refusal(500, 'Publish failed.', 'internal'))
      .mockImplementationOnce(async () => response({ status: 'dirty' }))
      .mockImplementationOnce(async (_url, init) => published(JSON.parse(init.body).docIds));
    fillNewEntry();
    fireEvent.click(screen.getByRole('button', { name: 'Save and publish' }));
    expect(await screen.findByText('Publish failed.')).toBeInTheDocument();
    // The form keeps what was typed.
    expect(screen.getByLabelText('Title')).toHaveValue('A new edition');

    fireEvent.click(screen.getByRole('button', { name: 'Save and publish' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
    expect(fetch.mock.calls.map((_, index) => endpointOf(index))).toEqual([
      'cmsCreateContent', 'cmsPublish', 'cmsUpdateContent', 'cmsPublish',
    ]);
    expect(bodyOf(2).docId).toBe(bodyOf(0).docId);
    expect(bodyOf(3).docIds).toEqual([bodyOf(0).docId]);
  });

  it('marks the year when the server refuses it, and moves focus to the summary', async () => {
    await openNewEntry();
    fetch.mockResolvedValueOnce(refusal(400, 'year: enter a year from 1900 to 2100 as four digits'));
    fillNewEntry();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    const summary = await screen.findByRole('alert');
    expect(summary).toHaveTextContent('year: enter a year from 1900 to 2100 as four digits');
    await waitFor(() => expect(document.activeElement).toBe(summary));
    expect(screen.getByLabelText('Year')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Year')).toHaveAccessibleDescription(
      expect.stringContaining('year: enter a year from 1900 to 2100 as four digits'),
    );
    expect(screen.getByLabelText('Title')).not.toHaveAttribute('aria-invalid');
  });

  it('answers a save with an invalid field by moving to it, and sends nothing', async () => {
    await openNewEntry();
    // A blank form shows no errors until the operator acts.
    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Save and publish' }));
    expect(fetch).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Year')));
    expect(screen.getByText('Enter a year as four digits.')).toBeInTheDocument();
    expect(screen.getByText('Enter a title.')).toBeInTheDocument();
    // The controls stay enabled, so the next press says the same.
    expect(screen.getByRole('button', { name: 'Save and publish' })).toBeEnabled();
  });

  it('names the record an entry in every control, heading and hint', async () => {
    await openNewEntry();
    const form = screen.getByLabelText('Year').closest('form');
    expect(within(form).getByRole('heading', { level: 2, name: 'Entry' })).toBeInTheDocument();
    expect(form.textContent).not.toMatch(/edition/i);
  });

  it('keeps a pasted five-digit year in the field and refuses it before any call', async () => {
    await openNewEntry();
    fillNewEntry({ year: '20245' });
    expect(screen.getByLabelText('Year')).toHaveValue('20245');
    expect(screen.getByLabelText('Year')).not.toHaveAttribute('maxlength');
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Year')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter a year as four digits.')).toBeInTheDocument();
  });

  it('saves a draft when Enter is pressed in the title', async () => {
    await openNewEntry();
    fetch.mockResolvedValueOnce(response({ status: 'dirty' }));
    fillNewEntry();
    const title = screen.getByLabelText('Title');
    // Enter in a one-line field submits its form through the first submit
    // control, which is Save draft.
    expect(title.form.querySelector('[type="submit"]')).toHaveTextContent('Save draft');
    fireEvent.submit(title.form);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(endpointOf(0)).toBe('cmsCreateContent');
  });

  it('edits a stored entry as an update, with no preview link', async () => {
    await openEntry('edition-2025');
    expect(await screen.findByDisplayValue('Two workshop tracks, edited')).toBeInTheDocument();
    expect(screen.getByLabelText('Year')).toHaveValue('2025');
    expect(screen.getByText('edition-2025')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /preview/i })).toBeNull();

    fetch.mockResolvedValueOnce(response({ status: 'dirty' }));
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Practice and planning.' } });
    fireEvent.click(screen.getByLabelText('Show this entry when it is published'));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(endpointOf(0)).toBe('cmsUpdateContent');
    expect(bodyOf(0)).toEqual({
      collection: 'cmsTimeline',
      docId: 'edition-2025',
      visible: false,
      fields: { year: 2025, title: 'Two workshop tracks, edited', description: 'Practice and planning.' },
    });
  });

  it('says so when an address names no entry', async () => {
    await openEntry('nobody');
    expect(await screen.findByRole('heading', { name: 'No such entry' })).toBeInTheDocument();
    expect(screen.getByText('That entry does not exist. It may have been deleted.')).toBeInTheDocument();
    // One next action, a verb first.
    expect(screen.getByRole('link', { name: 'Open the timeline list' })).toHaveAttribute('href', '/admin/timeline');
  });

  it('deletes after the confirmation names what goes', async () => {
    await openEntry('edition-2024');
    await screen.findByDisplayValue('The first meeting');
    fetch.mockResolvedValueOnce(response({ deleted: ['cmsTimeline/edition-2024', 'cmsTimeline_drafts/edition-2024'] }));

    fireEvent.click(screen.getByRole('button', { name: 'Delete this entry' }));
    const moment = screen.getByRole('region', { name: 'Delete The first meeting' });
    expect(moment).toHaveTextContent('The live entry and its draft are removed together. Its version history stays. This cannot be undone.');
    fireEvent.click(within(moment).getByRole('button', { name: 'Delete this entry' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(endpointOf(0)).toBe('cmsDeleteContent');
    expect(bodyOf(0)).toEqual({ collection: 'cmsTimeline', docId: 'edition-2024' });
    await waitFor(() => expect(currentPath).toBe('/admin/timeline'));
  });
});
