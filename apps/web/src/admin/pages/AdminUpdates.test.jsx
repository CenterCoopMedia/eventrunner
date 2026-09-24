// The updates list and editor (issue #190), through the real App at the
// admin routes. The two listeners (adminSource.js) and fetch are mocked, so
// every endpoint call is read off the wire the page would send.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

const adminSubscriptions = new Map();
const adminErrors = new Map();
// When false, a listener reports only when a test pushes to it, so the
// loading state can be read.
let reportAtOnce = true;
vi.mock('../adminSource.js', () => ({
  subscribeAdminCollection: (name, onNext, onError) => {
    adminSubscriptions.set(name, onNext);
    adminErrors.set(name, onError);
    if (reportAtOnce) onNext([]);
    return () => adminSubscriptions.delete(name);
  },
}));
const configSubscriptions = new Map();
vi.mock('../../lib/configSource.js', () => ({
  subscribeConfigDoc: (docId, onNext) => {
    configSubscriptions.set(docId, onNext);
    return () => configSubscriptions.delete(docId);
  },
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
import { NEW_TAB_NOTE } from '../../components/ExternalLink.jsx';

function response(body, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

let currentPath = null;
function LocationProbe() {
  currentPath = useLocation().pathname;
  return null;
}

async function renderAt(path) {
  render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <App />
      <LocationProbe />
    </MemoryRouter>,
  );
  await waitFor(() => {
    expect(screen.queryByLabelText('Loading admin…')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Checking your access…')).not.toBeInTheDocument();
  }, { timeout: 10_000 });
}

function pushUpdates(live, drafts) {
  act(() => {
    adminSubscriptions.get('cmsUpdates')(live);
    adminSubscriptions.get('cmsUpdates_drafts')(drafts);
  });
}

function pushConfig(docId, doc) {
  act(() => {
    configSubscriptions.get(docId)(doc);
  });
}

const callsTo = (name) => fetch.mock.calls.filter(([url]) => String(url).endsWith(`/${name}`));
const bodyOf = (call) => JSON.parse(call[1].body);

const PUBLISHED = { id: 'published', title: 'Doors open at nine', body: 'Doors open.', publishAt: '2026-10-01T02:30:00Z', pinned: false, visible: true, revision: 1 };
const PUBLISHED_CLEAN = { ...PUBLISHED, status: 'clean' };
const EDITED_LIVE = { id: 'edited', title: 'Old wording', body: 'Old.', publishAt: '2026-09-20T12:00:00Z', pinned: true, visible: true, revision: 2 };
const EDITED_DRAFT = { ...EDITED_LIVE, title: 'New wording', status: 'dirty' };
const NEVER_PUBLISHED = { id: 'fresh', title: 'Not out yet', body: 'Soon.', publishAt: null, pinned: false, visible: false, status: 'dirty' };

beforeEach(() => {
  adminSubscriptions.clear();
  adminErrors.clear();
  configSubscriptions.clear();
  reportAtOnce = true;
  currentPath = null;
  globalThis.fetch = vi.fn();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('the updates list', () => {
  it('says it is loading until both revisions have reported', async () => {
    reportAtOnce = false;
    await renderAt('/admin/updates');
    // The page's own chunk loads first, then both listeners subscribe.
    await waitFor(() => expect(adminSubscriptions.has('cmsUpdates_drafts')).toBe(true));
    expect(screen.getByRole('status', { name: 'Loading updates…' })).toBeInTheDocument();
    act(() => adminSubscriptions.get('cmsUpdates')([PUBLISHED]));
    expect(screen.getByRole('status', { name: 'Loading updates…' })).toBeInTheDocument();
    act(() => adminSubscriptions.get('cmsUpdates_drafts')([PUBLISHED_CLEAN]));
    expect(screen.queryByRole('status', { name: 'Loading updates…' })).toBeNull();
    expect(screen.getByRole('link', { name: PUBLISHED.title })).toBeInTheDocument();
  });

  it('offers the first update when there is none', async () => {
    await renderAt('/admin/updates');
    expect(await screen.findByRole('heading', { name: 'No updates yet' })).toBeInTheDocument();
    expect(screen.getByText('Write the first update. It stays a draft until you publish it.')).toBeInTheDocument();
    for (const link of screen.getAllByRole('link', { name: 'Write an update' })) {
      expect(link).toHaveAttribute('href', '/admin/updates/new/update');
    }
    expect(screen.getByText('0 updates')).toBeInTheDocument();
  });

  it('lists every update in the feed’s order with its state, date, and placement in words', async () => {
    await renderAt('/admin/updates');
    pushConfig('event', { timezone: 'America/Los_Angeles' });
    pushUpdates([PUBLISHED, EDITED_LIVE], [PUBLISHED_CLEAN, EDITED_DRAFT, NEVER_PUBLISHED]);

    const table = screen.getByRole('table', { name: 'Updates, pinned first, then newest first' });
    const region = screen.getByRole('region', { name: 'Updates' });
    expect(region).toHaveAttribute('tabindex', '0');
    expect(region).toContainElement(table);
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      'Update', 'State', 'Date', 'Category', 'Placement',
    ]);
    const [, ...bodyRows] = within(table).getAllByRole('row');
    const cells = bodyRows.map((tr) => within(tr).getAllByRole('cell').map((td) => td.textContent));
    expect(cells).toEqual([
      ['New wordingedited', 'Live with unpublished changes', 'September 20, 2026', 'None', 'Pinned'],
      // 02:30 UTC on 1 October is 30 September on the event's clock.
      ['Doors open at ninepublished', 'Live', 'September 30, 2026', 'None', 'By date'],
      ['Not out yetfresh', 'DraftHidden', 'Undated', 'None', 'By date'],
    ]);
    // Each title opens its editor.
    expect(screen.getByRole('link', { name: 'New wording' })).toHaveAttribute('href', '/admin/updates/edited');
    // A row that is not Live sits on the proof ground; the word is beside
    // it. The tint is on every cell of the row and never on the <tr>: the
    // tint's ground is a pseudo-element, and one on a table row takes a
    // cell slot and pushes the row a column over.
    const tinted = (tr) => within(tr).getAllByRole('cell').map((td) => td.className.includes('admin-proof-row'));
    expect(tinted(bodyRows[0])).toEqual([true, true, true, true, true]);
    expect(tinted(bodyRows[1])).toEqual([false, false, false, false, false]);
    expect(tinted(bodyRows[2])).toEqual([true, true, true, true, true]);
    for (const tr of within(table).getAllByRole('row')) expect(tr.className).not.toContain('admin-proof-row');
    // Every tinted cell holds one element for the tint rule to lift above
    // the ground, so no bare text is painted under it.
    for (const td of bodyRows[2].querySelectorAll('td')) {
      expect(td.children).toHaveLength(1);
      expect([...td.childNodes].every((node) => node.nodeType === Node.ELEMENT_NODE)).toBe(true);
    }
    expect(screen.getByText('3 updates')).toBeInTheDocument();
  });

  it('publishes every dirty draft, and only those, through cmsPublish', async () => {
    await renderAt('/admin/updates');
    pushUpdates([PUBLISHED, EDITED_LIVE], [PUBLISHED_CLEAN, EDITED_DRAFT, NEVER_PUBLISHED]);
    fetch.mockResolvedValueOnce(response({ results: { cmsUpdates: { published: ['edited', 'fresh'], skipped: [] } } }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish all (2)' }));

    await waitFor(() => expect(callsTo('cmsPublish')).toHaveLength(1));
    expect(bodyOf(callsTo('cmsPublish')[0])).toEqual({ collection: 'cmsUpdates', docIds: ['edited', 'fresh'] });
    expect(await screen.findByText('Published. The public site picks it up live.', { selector: 'p[role="status"]' })).toBeInTheDocument();
  });

  it('says so while updates are off, since the site does not show them', async () => {
    await renderAt('/admin/updates');
    pushConfig('features', { updates: false });
    expect(screen.getByText(/Updates are off for this event, so the site does not show them\. An operator can turn them on under Features\./)).toBeInTheDocument();
    pushConfig('features', { updates: true });
    expect(screen.queryByText(/Updates are off for this event/)).toBeNull();
  });
});

describe('the update editor', () => {
  it('saves a new update as a draft only, and a retry after a failure reuses its id', async () => {
    await renderAt('/admin/updates/new/update');
    await screen.findByRole('heading', { level: 1, name: 'New update' });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '  Room change  ' } });
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'The clinic moves to Room B.' } });
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-15' } });
    expect(screen.getByLabelText('Show this update when it is published')).toBeChecked();

    fetch.mockResolvedValueOnce(response({ error: { code: 'internal', message: 'The update could not be saved.' } }, 500));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('The update could not be saved.')).toBeInTheDocument();

    fetch.mockResolvedValueOnce(response({ id: 'x', status: 'dirty' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(callsTo('cmsSaveUpdate')).toHaveLength(2));
    const [first, second] = callsTo('cmsSaveUpdate').map(bodyOf);
    expect(first.id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(second.id).toBe(first.id);
    expect(second).toEqual({
      id: first.id,
      update: {
        title: 'Room change',
        body: 'The clinic moves to Room B.',
        publishAt: '2026-10-15T16:00:00.000Z',
        pinned: false,
        category: null,
        featured: false,
      },
      visible: true,
    });
    expect(callsTo('cmsPublish')).toHaveLength(0);
    expect(await screen.findByText('Draft saved. It is not live until you publish it.', { selector: 'p[role="status"]' })).toBeInTheDocument();
    // The editor moves to the update's own address and keeps the form.
    await waitFor(() => expect(currentPath).toBe(`/admin/updates/${first.id}`));
    expect(screen.getByLabelText('Title')).toHaveValue('  Room change  ');
    pushUpdates([], [{ id: first.id, ...second.update, visible: true, status: 'dirty' }]);
    expect(screen.getByRole('heading', { level: 1, name: 'Room change' })).toBeInTheDocument();
    expect(screen.getByText('Draft', { selector: '[data-record-state]' })).toBeInTheDocument();
  });

  it('saves and publishes in that order, for a date a year ahead', async () => {
    await renderAt('/admin/updates/new/update');
    await screen.findByRole('heading', { level: 1, name: 'New update' });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Next year' } });
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Save the date.' } });
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2027-10-15' } });
    fetch.mockImplementation(async (url, init) => {
      const { id, docIds } = JSON.parse(init.body);
      if (String(url).endsWith('/cmsSaveUpdate')) return response({ id, status: 'dirty' });
      return response({ results: { cmsUpdates: { published: docIds, skipped: [] } } });
    });
    const publish = screen.getByRole('button', { name: 'Save and publish' });
    // A future date never holds the publish action back.
    expect(publish).toBeEnabled();
    fireEvent.click(publish);

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(String(fetch.mock.calls[0][0])).toMatch(/\/cmsSaveUpdate$/);
    expect(String(fetch.mock.calls[1][0])).toMatch(/\/cmsPublish$/);
    const saved = bodyOf(fetch.mock.calls[0]);
    expect(saved.update.publishAt).toBe('2027-10-15T16:00:00.000Z');
    expect(bodyOf(fetch.mock.calls[1])).toEqual({ collection: 'cmsUpdates', docIds: [saved.id] });
    expect(await screen.findByText('Published. The public site picks it up live.', { selector: 'p[role="status"]' })).toBeInTheDocument();
  });

  it('keeps the draft and says so when the publish after a save fails, and the retry writes the same draft', async () => {
    await renderAt('/admin/updates/new/update');
    await screen.findByRole('heading', { level: 1, name: 'New update' });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Retry me' } });
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Body.' } });
    fetch
      .mockImplementationOnce(async (_url, init) => response({ id: JSON.parse(init.body).id, status: 'dirty' }))
      .mockResolvedValueOnce(response({ error: { code: 'internal', message: 'Publish failed.' } }, 500));
    fireEvent.click(screen.getByRole('button', { name: 'Save and publish' }));
    expect(await screen.findByText('The draft is saved, and it is not published')).toBeInTheDocument();
    const id = bodyOf(callsTo('cmsSaveUpdate')[0]).id;
    await waitFor(() => expect(currentPath).toBe(`/admin/updates/${id}`));

    fetch.mockImplementation(async (url, init) => {
      const body = JSON.parse(init.body);
      if (String(url).endsWith('/cmsSaveUpdate')) return response({ id: body.id, status: 'dirty' });
      return response({ results: { cmsUpdates: { published: body.docIds, skipped: [] } } });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save and publish' }));
    await waitFor(() => expect(callsTo('cmsPublish')).toHaveLength(2));
    expect(callsTo('cmsSaveUpdate').map(bodyOf).map((body) => body.id)).toEqual([id, id]);
  });

  it('refuses a save with no title or text, marks the fields, and moves focus to the first', async () => {
    await renderAt('/admin/updates/new/update');
    await screen.findByRole('heading', { level: 1, name: 'New update' });
    // Nothing is marked before the first attempt.
    expect(screen.queryByText('Enter a title.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Enter a title.')).toBeInTheDocument();
    expect(screen.getByText('Enter the text of the update.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveFocus());
    expect(screen.getByLabelText('Title')).toHaveAttribute('aria-invalid', 'true');
    expect(fetch).not.toHaveBeenCalled();
  });

  // Review round, finding 3: a date control with only some of its parts
  // filled reports the value '' and validity.badInput. That is not a
  // blank date, and it must not save as undated.
  it('refuses a partly typed date, marks the field and moves focus to it, and saves once it is whole', async () => {
    await renderAt('/admin/updates/new/update');
    await screen.findByRole('heading', { level: 1, name: 'New update' });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Half a date' } });
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Body.' } });
    const date = screen.getByLabelText('Date');
    // jsdom has no date segments, so the browser's state is set by hand:
    // what Chromium reports for "10/dd/2026".
    Object.defineProperty(date, 'validity', { configurable: true, get: () => ({ badInput: true, valid: false }) });
    fireEvent.input(date, { target: { value: '' } });

    const save = screen.getByRole('button', { name: 'Save draft' });
    fireEvent.click(save);
    expect(await screen.findByText('Enter the full date, or clear the field.')).toBeInTheDocument();
    expect(date).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(date).toHaveFocus());
    expect(save).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Save and publish' })).toBeEnabled();
    expect(fetch).not.toHaveBeenCalled();

    Object.defineProperty(date, 'validity', { configurable: true, get: () => ({ badInput: false, valid: true }) });
    fireEvent.input(date, { target: { value: '2026-10-15' } });
    expect(screen.queryByText('Enter the full date, or clear the field.')).toBeNull();
    fetch.mockImplementation(async (_url, init) => response({ id: JSON.parse(init.body).id, status: 'dirty' }));
    fireEvent.click(save);
    await waitFor(() => expect(callsTo('cmsSaveUpdate')).toHaveLength(1));
    expect(bodyOf(callsTo('cmsSaveUpdate')[0]).update.publishAt).toBe('2026-10-15T16:00:00.000Z');
  });

  it('reads the date control’s state when the save is pressed, even with no input event before it', async () => {
    await renderAt('/admin/updates/new/update');
    await screen.findByRole('heading', { level: 1, name: 'New update' });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Half a date' } });
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Body.' } });
    Object.defineProperty(screen.getByLabelText('Date'), 'validity', {
      configurable: true,
      get: () => ({ badInput: true, valid: false }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save and publish' }));
    expect(await screen.findByText('Enter the full date, or clear the field.')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('saves a draft on Enter in a one-line field: Save draft is the form’s first submit control', async () => {
    await renderAt('/admin/updates/new/update');
    await screen.findByRole('heading', { level: 1, name: 'New update' });
    const title = screen.getByLabelText('Title');
    // A browser's implicit submission presses the form's first submit
    // button; jsdom does not implement it, so the test reads the structure
    // and submits the form the way the browser would.
    expect(title.form.querySelector('[type="submit"]')).toBe(screen.getByRole('button', { name: 'Save draft' }));
    fireEvent.change(title, { target: { value: 'By keyboard' } });
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Body.' } });
    fetch.mockImplementation(async (_url, init) => response({ id: JSON.parse(init.body).id, status: 'dirty' }));
    fireEvent.submit(title.form);
    await waitFor(() => expect(callsTo('cmsSaveUpdate')).toHaveLength(1));
    expect(callsTo('cmsPublish')).toHaveLength(0);
  });

  // Review round, finding 1: the two listeners report in no fixed order.
  // An update that is Live with unpublished changes must open with its
  // DRAFT, never with the live values that happened to arrive first.
  it('waits for both revisions before it fills the form, so a save keeps the unpublished draft', async () => {
    reportAtOnce = false;
    await renderAt('/admin/updates/edited');
    await waitFor(() => expect(adminSubscriptions.has('cmsUpdates_drafts')).toBe(true));
    const draft = { ...EDITED_DRAFT, body: 'New unpublished text.', category: 'Travel', featured: true };

    act(() => adminSubscriptions.get('cmsUpdates')([EDITED_LIVE]));
    // Only the live revision is in: no form yet, so nothing can be saved
    // from the live values.
    expect(screen.getByRole('status', { name: 'Loading update…' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Title')).toBeNull();

    act(() => adminSubscriptions.get('cmsUpdates_drafts')([draft]));
    expect(await screen.findByRole('heading', { level: 1, name: 'New wording' })).toBeInTheDocument();
    expect(screen.getByText('Live with unpublished changes', { selector: '[data-record-state]' })).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue('New wording');
    expect(screen.getByLabelText('Text')).toHaveValue('New unpublished text.');
    expect(screen.getByLabelText('Category')).toHaveValue('Travel');
    expect(screen.getByLabelText('Feature this update at the head of the list')).toBeChecked();

    fetch.mockResolvedValueOnce(response({ id: 'edited', status: 'dirty' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(callsTo('cmsSaveUpdate')).toHaveLength(1));
    expect(bodyOf(callsTo('cmsSaveUpdate')[0]).update).toMatchObject({
      title: 'New wording',
      body: 'New unpublished text.',
      category: 'Travel',
      featured: true,
    });
  });

  it('does not open the form from the live revision alone when the drafts listener fails, and says why', async () => {
    reportAtOnce = false;
    await renderAt('/admin/updates/edited');
    await waitFor(() => expect(adminSubscriptions.has('cmsUpdates_drafts')).toBe(true));
    act(() => adminSubscriptions.get('cmsUpdates')([EDITED_LIVE]));
    act(() => adminErrors.get('cmsUpdates_drafts')(new Error('unavailable')));

    expect(screen.getByText(
      'We could not load this update and its saved draft. The editor opens when both have loaded, so a save cannot replace a draft it has not read. We are trying again.',
    )).toBeInTheDocument();
    expect(screen.queryByLabelText('Title')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'No such update' })).toBeNull();

    // The listener's retry reports: the form opens with the draft.
    act(() => adminSubscriptions.get('cmsUpdates_drafts')([EDITED_DRAFT]));
    expect(await screen.findByLabelText('Title')).toHaveValue('New wording');
    expect(screen.queryByText(/We could not load this update/)).toBeNull();
  });

  it('opens an update whose id is `new` at /admin/updates/new, not the create form', async () => {
    await renderAt('/admin/updates/new');
    pushUpdates([{ id: 'new', title: 'An update called new', body: 'b', publishAt: null, pinned: false, visible: true }], []);
    expect(await screen.findByRole('heading', { level: 1, name: 'An update called new' })).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue('An update called new');
    expect(screen.getByRole('button', { name: 'Delete this update' })).toBeInTheDocument();
  });

  it('opens a seeded update, keeps its picture and blocks, and never sends its bookkeeping', async () => {
    await renderAt('/admin/updates/seeded');
    const seeded = {
      id: 'seeded',
      title: 'Seeded post',
      body: 'Body.',
      publishAt: '2026-09-12T13:00:00.000Z',
      pinned: true,
      visible: true,
      featuredImage: { url: 'demo/summit-gathering.webp', alt: 'A scene' },
      content: [
        { type: 'richtext', value: '<p>One</p>' },
        { type: 'richtext', value: '<p>Two</p>' },
        { type: 'button', label: 'Open the schedule', href: '/schedule' },
      ],
      seeded: true,
      seededAt: '2026-09-01T00:00:00.000Z',
      revision: 1,
      publishedBy: 'seed',
    };
    pushUpdates([seeded], []);
    expect(await screen.findByText('This update also has a picture and 3 content blocks. Saving here keeps them as they are.')).toBeInTheDocument();
    expect(screen.getByLabelText('Pin this update to the top of the list')).toBeChecked();
    // The preview reads the draft on the public page, in a new tab.
    expect(screen.getByRole('link', { name: `Preview draft (${NEW_TAB_NOTE})` })).toHaveAttribute('href', '/updates/seeded?preview=1');

    fetch.mockResolvedValueOnce(response({ id: 'seeded', status: 'dirty' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(callsTo('cmsSaveUpdate')).toHaveLength(1));
    expect(bodyOf(callsTo('cmsSaveUpdate')[0])).toEqual({
      id: 'seeded',
      update: {
        title: 'Seeded post',
        body: 'Body.',
        publishAt: '2026-09-12T13:00:00.000Z',
        pinned: true,
        category: null,
        featured: false,
        featuredImage: seeded.featuredImage,
        content: seeded.content,
      },
      visible: true,
    });
  });

  it('deletes an update and returns to the list', async () => {
    await renderAt('/admin/updates/published');
    pushUpdates([PUBLISHED], [PUBLISHED_CLEAN]);
    await screen.findByRole('heading', { level: 1, name: PUBLISHED.title });
    fetch.mockResolvedValueOnce(response({ id: 'published', deleted: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete this update' }));
    expect(screen.getByText('The live update and its draft are removed together. Its version history stays. This cannot be undone.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete this update' }));
    await waitFor(() => expect(callsTo('cmsDeleteUpdate')).toHaveLength(1));
    expect(bodyOf(callsTo('cmsDeleteUpdate')[0])).toEqual({ id: 'published' });
    await waitFor(() => expect(currentPath).toBe('/admin/updates'));
  });

  it('says an unknown update does not exist', async () => {
    await renderAt('/admin/updates/ghost');
    expect(await screen.findByRole('heading', { name: 'No such update' })).toBeInTheDocument();
    expect(screen.getByText('That update does not exist. It may have been deleted.')).toBeInTheDocument();
  });

  it('says so on the editor too while updates are off, and draws no preview link', async () => {
    await renderAt('/admin/updates/published');
    pushUpdates([PUBLISHED], [PUBLISHED_CLEAN]);
    pushConfig('features', { updates: false });
    await screen.findByRole('heading', { level: 1, name: PUBLISHED.title });
    expect(screen.getByText(/Updates are off for this event/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Preview draft/ })).toBeNull();
  });
});

describe('the category and the featured flag (issue 191)', () => {
  const TAGGED = {
    id: 'tagged', title: 'Arrival notes', body: 'Trains.', publishAt: '2026-09-08T15:00:00Z',
    pinned: true, featured: true, category: 'Travel', visible: true, revision: 1,
  };

  it('lists a category and a featured placement in words', async () => {
    await renderAt('/admin/updates');
    pushUpdates([TAGGED, { ...PUBLISHED, featured: true }], [{ ...TAGGED, status: 'clean' }, { ...PUBLISHED_CLEAN, featured: true }]);
    const [, ...bodyRows] = within(screen.getByRole('table')).getAllByRole('row');
    const cells = bodyRows.map((tr) => within(tr).getAllByRole('cell').map((td) => td.textContent));
    expect(cells.map((row) => row.slice(3))).toEqual([
      ['Travel', 'Featured and pinned'],
      ['None', 'Featured'],
    ]);
  });

  it('round trips a category and the featured flag through the editor', async () => {
    await renderAt('/admin/updates/tagged');
    pushUpdates([TAGGED, { ...PUBLISHED, category: 'Program' }], [{ ...TAGGED, status: 'clean' }, { ...PUBLISHED_CLEAN, category: 'Program' }]);
    await screen.findByRole('heading', { level: 1, name: 'Arrival notes' });
    const category = screen.getByLabelText('Category');
    expect(category).toHaveValue('Travel');
    expect(category).toHaveAttribute('maxlength', '24');
    expect(category).toHaveAccessibleDescription('One or two words shown as a tag beside the title. Leave it empty for none.');
    // The categories in use are offered as suggestions.
    const list = document.getElementById(category.getAttribute('list'));
    expect([...list.querySelectorAll('option')].map((option) => option.value)).toEqual(['Program', 'Travel']);
    const featured = screen.getByLabelText('Feature this update at the head of the list');
    expect(featured).toBeChecked();

    fireEvent.change(category, { target: { value: ' Travel and arrival notes ' } });
    fireEvent.click(featured);
    fetch.mockResolvedValueOnce(response({ id: 'tagged', status: 'dirty' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(callsTo('cmsSaveUpdate')).toHaveLength(1));
    expect(bodyOf(callsTo('cmsSaveUpdate')[0]).update).toMatchObject({ category: 'Travel and arrival notes', featured: false });

    fireEvent.change(category, { target: { value: '' } });
    fetch.mockResolvedValueOnce(response({ id: 'tagged', status: 'dirty' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(callsTo('cmsSaveUpdate')).toHaveLength(2));
    expect(bodyOf(callsTo('cmsSaveUpdate')[1]).update).toMatchObject({ category: null });
  });

  it('refuses a category over 24 characters before sending, and focuses the field', async () => {
    await renderAt('/admin/updates/tagged');
    pushUpdates([TAGGED], []);
    await screen.findByRole('heading', { level: 1, name: 'Arrival notes' });
    // maxLength stops typing; a value set another way is still checked.
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'x'.repeat(25) } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Use 24 characters or fewer.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Category')).toHaveFocus());
    expect(fetch).not.toHaveBeenCalled();
  });

  it('marks the category field with the server’s refusal', async () => {
    await renderAt('/admin/updates/tagged');
    pushUpdates([TAGGED], []);
    await screen.findByRole('heading', { level: 1, name: 'Arrival notes' });
    fetch.mockResolvedValueOnce(response({
      error: { code: 'invalid-argument', message: 'Invalid update: category: must be null or 1 to 24 characters on one line' },
    }, 400));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The server rejected this save');
    expect(screen.getByLabelText('Category')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Category')).toHaveAccessibleDescription(/category: must be null or 1 to 24 characters on one line/);
  });
});
