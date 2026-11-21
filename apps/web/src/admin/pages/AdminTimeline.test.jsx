// The timeline list and editor (issue #194), rendered through the whole app
// at their real admin routes, with the endpoints behind fetch.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';

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
const contentSubscriptions = new Map();
vi.mock('../../lib/contentSource.js', () => ({
  subscribeContentCollection: (name, _readSource, onNext, onConfirmed) => {
    contentSubscriptions.set(name, { onNext, onConfirmed });
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
  doc: vi.fn(() => ({})),
  onSnapshot: vi.fn(() => () => {}),
  query: vi.fn(() => ({})),
  limit: vi.fn(() => ({})),
  getDocs: vi.fn(() => Promise.resolve({ docs: [], metadata: { fromCache: false } })),
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

function published(ids) {
  return response({ results: { cmsTimeline: { published: ids, skipped: [] } } });
}

async function renderAt(path) {
  render(
    <MemoryRouter
      initialEntries={[path]}
    >
      <App />
      <PathProbe />
    </MemoryRouter>,
  );
  await waitFor(() => {
    expect(screen.queryByText('Loading admin…', { selector: '.loading-status__label' })).not.toBeInTheDocument();
    expect(screen.queryByText('Checking your access…', { selector: '.loading-status__label' })).not.toBeInTheDocument();
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
  // The editor tour (issue #198) opens on a first visit and states the
  // record words this file reads; the account has already ended it.
  markTourDone('admin-1');
  adminSubscriptions.clear();
  adminErrors.clear();
  contentSubscriptions.clear();
  holdAdminCollections = false;
  currentPath = '';
  globalThis.fetch = vi.fn();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('timeline editor server adoption', () => {
  it.each(['live', 'drafts'])('ignores cached revisions until both server answers arrive (%s first)', async (first) => {
    holdAdminCollections = true;
    await renderAt('/admin/timeline/edition-2025');
    await waitFor(() => expect(adminSubscriptions.has('cmsTimeline_drafts')).toBe(true));
    const nextLive = adminSubscriptions.get('cmsTimeline');
    const nextDrafts = adminSubscriptions.get('cmsTimeline_drafts');
    act(() => {
      nextLive(LIVE, { fromCache: true });
      nextDrafts([], { fromCache: true });
    });
    expect(screen.queryByLabelText('Title')).toBeNull();
    act(() => {
      if (first === 'live') nextLive(LIVE, { fromCache: false });
      else nextDrafts(DRAFTS, { fromCache: false });
    });
    expect(screen.queryByLabelText('Title')).toBeNull();
    act(() => {
      if (first === 'live') nextDrafts(DRAFTS, { fromCache: false });
      else nextLive(LIVE, { fromCache: false });
    });
    expect(await screen.findByLabelText('Title')).toHaveValue(DRAFTS[0].title);
    act(() => nextDrafts([], { fromCache: true }));
    expect(screen.getByLabelText('Title')).toHaveValue(DRAFTS[0].title);

    fetch.mockResolvedValueOnce(response({ status: 'dirty' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(bodyOf(0).fields.title).toBe(DRAFTS[0].title);
  });
});

describe('the timeline list', () => {
  it('says it is loading until both revisions have arrived', async () => {
    holdAdminCollections = true;
    await renderAt('/admin/timeline');
    // The lazy-route fallback has the same label as the data wait. The
    // Timeline listeners identify the mounted page whose readiness we test.
    await waitFor(() => {
      expect(adminSubscriptions.has('cmsTimeline')).toBe(true);
      expect(adminSubscriptions.has('cmsTimeline_drafts')).toBe(true);
    });
    expect(await screen.findByText('Loading timeline…', { selector: '.loading-status__label' })).toBeInTheDocument();
    act(() => adminSubscriptions.get('cmsTimeline')(LIVE, { fromCache: false }));
    expect(screen.getByText('Loading timeline…', { selector: '.loading-status__label' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'The first meeting', exact: true })).toBeNull();
    act(() => adminSubscriptions.get('cmsTimeline_drafts')(DRAFTS, { fromCache: false }));
    expect(screen.queryByText('Loading timeline…', { selector: '.loading-status__label' })).toBeNull();
    expect(screen.getByText('4 entries')).toBeInTheDocument();
  });

  it('offers the first entry when there is none', async () => {
    await renderAt('/admin/timeline');
    expect(await screen.findByRole('heading', { name: 'No timeline entries yet' })).toBeInTheDocument();
    expect(screen.getByText('An entry describes one past edition. To display published entries on a page, add a Timeline block in its content editor.')).toBeInTheDocument();
    const add = screen.getAllByRole('link', { name: 'Add an entry' });
    expect(add.length).toBeGreaterThan(0);
    for (const link of add) expect(link).toHaveAttribute('href', '/admin/timeline/new/entry');
    expect(screen.getByText('0 entries')).toBeInTheDocument();
  });

  it('warns when entries have no published placement and clears the warning once placed', async () => {
    await renderAt('/admin/timeline');
    await screen.findByRole('heading', { level: 1, name: 'Timeline' });
    pushTimeline(LIVE, DRAFTS);
    const notice = () => screen.queryByText(/Published entries have no place to appear yet/);
    expect(notice()).toBeNull();
    const page = { id: 'archive', path: '/archive', visible: true, sections: [{ id: 'past-editions' }] };
    const block = { id: 'past-editions__timeline', section: 'past-editions', blockType: 'timeline' };
    const pageListener = contentSubscriptions.get('cmsPages');
    const blockListener = contentSubscriptions.get('cmsContent');
    act(() => {
      pageListener.onNext([page]);
      pageListener.onConfirmed(true);
      blockListener.onNext([{ ...block, visible: false }]);
    });
    expect(within(notice()).getByRole('link', { name: 'page content' })).toHaveAttribute('href', '/admin/content');
    act(() => blockListener.onNext([{ ...block, visible: true }]));
    expect(notice()).toBeNull();
    act(() => pageListener.onNext([{ ...page, visible: false }]));
    expect(notice()).toBeInTheDocument();
    act(() => pageListener.onNext([{ id: 'home', path: '/', visible: true, sections: [{ id: 'history' }] }]));
    expect(notice()).toBeNull();
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
    expect(within(rows[0]).getByText('2019')).toBeInTheDocument();
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
    expect(bodyOf(0)).toEqual({
      collection: 'cmsTimeline', docIds: ['edition-2019', 'edition-2025'], requestId: expect.any(String),
    });
    expect(await screen.findAllByText('Published.')).not.toHaveLength(0);
  });

  // Codex review on #288, the same flaw #281 found in the organizations
  // list: a resumed run is reported against the ids the failed run asked
  // for, not the drafts that are dirty now.
  it('reports a resumed publish against the ids the failed run asked for', async () => {
    await renderAt('/admin/timeline');
    await screen.findByRole('heading', { level: 1, name: 'Timeline' });
    pushTimeline(LIVE, DRAFTS);
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: { code: 'publish-failed', message: 'Publish failed part-way.' }, queueId: 'queue-7' }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Publish all (2)' }));
    const resume = await screen.findByRole('button', { name: 'Resume publish' });

    // A third entry gains a draft after the failed run.
    pushTimeline(LIVE, [...DRAFTS.filter((doc) => doc.id !== 'edition-2024'), { ...DRAFTS[1], title: 'The first meeting, again', status: 'dirty' }]);
    fetch.mockResolvedValueOnce(published(['edition-2019', 'edition-2025']));
    fireEvent.click(resume);
    expect(await screen.findByText('Published.', { selector: 'p[role="status"]' })).toBeInTheDocument();
    expect(bodyOf(1)).toEqual({ queueId: 'queue-7' });
  });

  // Codex review on #288: one listener's delivery must not clear the other's
  // failure.
  it('keeps the drafts listener’s failure while the live listener reports', async () => {
    await renderAt('/admin/timeline');
    await screen.findByRole('heading', { level: 1, name: 'Timeline' });
    pushTimeline(LIVE, DRAFTS);
    const lost = 'The timeline could not refresh. Check your connection.';
    act(() => adminErrors.get('cmsTimeline_drafts')(new Error('unavailable')));
    expect(screen.getByText(lost)).toBeInTheDocument();
    act(() => adminSubscriptions.get('cmsTimeline')(LIVE));
    expect(screen.getByText(lost)).toBeInTheDocument();
    act(() => adminSubscriptions.get('cmsTimeline_drafts')(DRAFTS));
    expect(screen.queryByText(lost)).toBeNull();
  });

});

describe('the timeline entry editor', () => {
  it('creates a draft under a new UUID, and publishes nothing', async () => {
    holdAdminCollections = true;
    await openNewEntry();
    expect(screen.getByText('An entry describes one past edition. Published entries appear in Timeline blocks and in the History section on Home when that section is present.')).toBeInTheDocument();
    pushTimeline(LIVE, DRAFTS);
    fetch.mockResolvedValueOnce(response({ docId: 'x', status: 'dirty' }));
    fillNewEntry();
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: '  One day of talks.  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(endpointOf(0)).toBe('cmsCreateContent');
    const body = bodyOf(0);
    expect(body.docId).toMatch(UUID_RE);
    expect(body).toEqual({
      collection: 'cmsTimeline',
      docId: body.docId,
      visible: true,
      fields: { year: 2023, title: 'A new edition', description: 'One day of talks.', url: null, image: null, alt: null },
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
    fireEvent.click(screen.getByRole('button', { name: 'Publish', exact: true }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(endpointOf(0)).toBe('cmsCreateContent');
    expect(endpointOf(1)).toBe('cmsPublish');
    expect(bodyOf(1)).toEqual({ collection: 'cmsTimeline', docIds: [bodyOf(0).docId] });
    expect(await screen.findAllByText('Published.')).not.toHaveLength(0);
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
    fireEvent.click(screen.getByRole('button', { name: 'Publish', exact: true }));
    expect(await screen.findByText('Publishing did not finish. Your draft is saved. Try again.')).toBeInTheDocument();
    // The form keeps what was typed.
    expect(screen.getByLabelText('Title')).toHaveValue('A new edition');

    fireEvent.click(screen.getByRole('button', { name: 'Publish', exact: true }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));

    const summary = await screen.findByRole('alert');
    expect(summary).toHaveTextContent('Check year and try again.');
    await waitFor(() => expect(document.activeElement).toBe(summary));
    expect(screen.getByLabelText('Year')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Year')).toHaveAccessibleDescription(
      expect.stringContaining('Check year and try again.'),
    );
    expect(screen.getByLabelText('Title')).not.toHaveAttribute('aria-invalid');
  });

  it('answers a save with an invalid field by moving to it, and sends nothing', async () => {
    await openNewEntry();
    // A blank form shows no errors until the operator acts.
    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Publish', exact: true }));
    expect(fetch).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Year')));
    expect(screen.getByText('Enter a year as four digits.')).toBeInTheDocument();
    expect(screen.getByText('Enter a title.')).toBeInTheDocument();
    // The controls stay enabled, so the next press says the same.
    expect(screen.getByRole('button', { name: 'Publish', exact: true })).toBeEnabled();
  });

  it('names the record an entry in the form heading', async () => {
    await openNewEntry();
    const form = screen.getByLabelText('Year').closest('form');
    expect(within(form).getByRole('heading', { level: 2, name: 'Entry' })).toBeInTheDocument();
  });

  it('keeps a pasted five-digit year in the field and refuses it before any call', async () => {
    await openNewEntry();
    fillNewEntry({ year: '20245' });
    expect(screen.getByLabelText('Year')).toHaveValue('20245');
    expect(screen.getByLabelText('Year')).not.toHaveAttribute('maxlength');
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
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
    expect(title.form.querySelector('[type="submit"]')).toHaveTextContent('Save');
    fireEvent.submit(title.form);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(endpointOf(0)).toBe('cmsCreateContent');
  });

  it('edits a stored entry as an update, with no preview link', async () => {
    await openEntry('edition-2025');
    expect(await screen.findByDisplayValue('Two workshop tracks, edited')).toBeInTheDocument();
    expect(screen.getByLabelText('Year')).toHaveValue('2025');
    expect(screen.queryByText('edition-2025')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /preview/i })).toBeNull();

    fetch.mockResolvedValueOnce(response({ status: 'dirty' }));
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Practice and planning.' } });
    fireEvent.click(screen.getByLabelText('Show this entry when it is published'));
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(endpointOf(0)).toBe('cmsUpdateContent');
    expect(bodyOf(0)).toEqual({
      collection: 'cmsTimeline',
      docId: 'edition-2025',
      visible: false,
      fields: { year: 2025, title: 'Two workshop tracks, edited', description: 'Practice and planning.', url: null, image: null, alt: null },
    });
  });

  it('keeps alt text while editing an image path and clears it when removing the image', async () => {
    await renderAt('/admin/timeline/edition-2025');
    await waitFor(() => expect(adminSubscriptions.has('cmsTimeline_drafts')).toBe(true));
    pushTimeline(LIVE, [
      { ...DRAFTS[0], image: 'cms-images/edition/meeting.webp', alt: 'Attendees at a table' },
      ...DRAFTS.slice(1),
    ]);
    const image = await screen.findByLabelText('Image');
    fireEvent.change(image, { target: { value: 'cms-images/edition/gathering.webp' } });
    expect(screen.getByLabelText('Alt text')).toHaveValue('Attendees at a table');
    fireEvent.click(screen.getByRole('button', { name: 'Remove image' }));
    expect(screen.queryByLabelText('Alt text')).toBeNull();
    fireEvent.change(image, { target: { value: 'cms-images/edition/gathering.webp' } });
    expect(screen.getByLabelText('Alt text')).toHaveValue('');
  });

  // Codex review on #288, the race #281 found in the organizations editor.
  it('waits for both revisions before it fills the form, so a save keeps the unpublished draft', async () => {
    holdAdminCollections = true;
    await renderAt('/admin/timeline/edition-2025');
    await waitFor(() => expect(adminSubscriptions.has('cmsTimeline_drafts')).toBe(true));

    act(() => adminSubscriptions.get('cmsTimeline')(LIVE));
    // Only the live revision is in: no form yet, so nothing can be saved
    // from the live values.
    expect(screen.getByText('Loading entry…', { selector: '.loading-status__label' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Title')).toBeNull();

    act(() => adminSubscriptions.get('cmsTimeline_drafts')(DRAFTS));
    expect(await screen.findByLabelText('Title')).toHaveValue('Two workshop tracks, edited');
    fetch.mockResolvedValueOnce(response({ ok: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(bodyOf(0).fields).toMatchObject({ title: 'Two workshop tracks, edited' });
  });

  it('does not open the form from the live revision alone when the drafts listener fails, and says why', async () => {
    holdAdminCollections = true;
    await renderAt('/admin/timeline/edition-2025');
    await waitFor(() => expect(adminSubscriptions.has('cmsTimeline_drafts')).toBe(true));
    act(() => adminSubscriptions.get('cmsTimeline')(LIVE));
    act(() => adminErrors.get('cmsTimeline_drafts')(new Error('unavailable')));

    expect(screen.getByText(
      'This entry could not load. Check your connection and try again.',
    )).toBeInTheDocument();
    expect(screen.queryByLabelText('Title')).toBeNull();
    act(() => adminSubscriptions.get('cmsTimeline_drafts')(DRAFTS));
    expect(await screen.findByLabelText('Title')).toHaveValue('Two workshop tracks, edited');
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
    fetch.mockResolvedValueOnce(response({ entries: [{ revision: 1 }], nextCursor: null }));
    fetch.mockResolvedValueOnce(response({ deleted: ['cmsTimeline/edition-2024', 'cmsTimeline_drafts/edition-2024'] }));

    fireEvent.click(screen.getByRole('button', { name: 'Delete this entry' }));
    const moment = screen.getByRole('region', { name: 'Delete The first meeting' });
    expect(moment).toHaveTextContent('The live entry and its draft are removed together. Its version history stays.');
    await waitFor(() => expect(moment).toHaveTextContent('Published versions can be restored as a draft'));
    expect(moment).toHaveTextContent('Unpublished edits are lost.');
    fireEvent.click(within(moment).getByRole('button', { name: 'Delete this entry' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(endpointOf(0)).toBe('cmsGetVersionHistory');
    expect(endpointOf(1)).toBe('cmsDeleteContent');
    expect(bodyOf(1)).toEqual({ collection: 'cmsTimeline', docId: 'edition-2024' });
    await waitFor(() => expect(currentPath).toBe('/admin/timeline'));
  });
});
