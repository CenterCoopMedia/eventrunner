// The Unpublished changes page (issue #196), in the real admin shell at
// its route, with the publish endpoint answered through a mocked fetch.
//
// The done line: saving raises the count, publishing clears it, a failed
// publish run still reads Failed, and the banner and the page never
// disagree. The browser half of each clause is here; the E2E spec
// (e2e/cms-unpublished.spec.js) proves the same on the emulators.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// A docket that does not own an editor yet gives its rows no link. The
// editors land one branch at a time, so the tests that need an unlinked row
// take one editor off the docket here rather than naming one that is absent.
const unowned = vi.hoisted(() => new Set());
vi.mock('../AdminLayout.jsx', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    sectionTier: (path) => ([...unowned].some((prefix) => path.startsWith(prefix)) ? null : actual.sectionTier(path)),
  };
});

const adminSubscriptions = new Map();
vi.mock('../adminSource.js', () => ({
  subscribeAdminCollection: (name, onNext) => {
    adminSubscriptions.set(name, onNext);
    onNext([]);
    return () => adminSubscriptions.delete(name);
  },
}));
// The page's two seams: the dirty drafts per collection, and the two run
// reads. Callbacks are kept so each test delivers what a listener would.
const drafts = new Map();
const runs = { recent: null, failed: null };
vi.mock('../pendingChangesSource.js', () => ({
  subscribeDirtyDrafts: (collection, onNext, onError) => {
    drafts.set(collection, { onNext, onError });
    return () => drafts.delete(collection);
  },
}));
vi.mock('../publishRunsSource.js', () => ({
  subscribeRecentPublishRuns: (count, onNext, onError) => {
    runs.recent = { count, onNext, onError };
    return () => {
      runs.recent = null;
    };
  },
  subscribeFailedPublishRuns: (count, onNext, onError) => {
    runs.failed = { count, onNext, onError };
    return () => {
      runs.failed = null;
    };
  },
}));
vi.mock('../../lib/configSource.js', () => ({ subscribeConfigDoc: () => () => {} }));
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
// The tier probe: an operator may read admin_logs; staff is refused it.
let staff = false;
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, name) => ({ name })),
  query: vi.fn((ref) => ref),
  limit: vi.fn(() => ({})),
  getDocs: vi.fn((ref) =>
    staff && ref?.name === 'admin_logs'
      ? Promise.reject(Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }))
      : Promise.resolve({ docs: [] }),
  ),
}));

import App from '../../App.jsx';
import { unavailableButtonClass } from '../components/formControls.jsx';
import { markTourDone } from '../tourState.js';

const ALL = ['cmsContent', 'cmsPages', 'cmsSchedule', 'cmsOrganizations', 'cmsUpdates', 'cmsTimeline'];

function ok(body) {
  return { ok: true, status: 200, json: async () => body };
}
function refused(status, body) {
  return { ok: false, status, json: async () => body };
}

async function renderAt(path) {
  render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </MemoryRouter>,
  );
  await waitFor(() => {
    expect(screen.queryByLabelText('Loading admin…')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Checking your access…')).not.toBeInTheDocument();
  }, { timeout: 10_000 });
  await screen.findByRole('heading', { level: 1, name: 'Unpublished changes' }, { timeout: 5000 });
}

/** Deliver every collection's dirty drafts at once, as six listeners would. */
function pushDrafts(byCollection = {}) {
  act(() => {
    for (const collection of ALL) drafts.get(collection).onNext(byCollection[collection] ?? []);
  });
}

function pushRuns(recent = [], failed = []) {
  act(() => {
    runs.recent.onNext(recent);
    runs.failed.onNext(failed);
  });
}

function pushPages() {
  act(() => {
    adminSubscriptions.get('cmsPages')([
      { id: 'home', label: 'Home', path: '/', visible: true, revision: 1, sections: [{ id: 'hero', label: 'Hero' }] },
    ]);
    adminSubscriptions.get('cmsPages_drafts')([]);
  });
}

const block = (field, extra = {}) => ({
  id: `hero__${field}`,
  section: 'hero',
  field,
  value: 'x',
  status: 'dirty',
  basedOnRevision: 1,
  updatedBy: 'admin@example.org',
  updatedAt: { toMillis: () => Date.UTC(2026, 8, 23, 18, 2) },
  ...extra,
});

const at = (ms) => ({ toMillis: () => ms });

function bodyOf(index) {
  return JSON.parse(fetch.mock.calls[index][1].body);
}

const main = () => screen.getByRole('main');
const figure = () => main().querySelector('p[data-pending-total]');

/** The count's three readings on this page: the figure, the rows, the panel buttons. */
function expectPageAgrees() {
  const rows = main().querySelectorAll('table tbody tr');
  if (rows.length === 0) {
    expect(figure()).toBeNull();
    expect(within(main()).getByRole('heading', { name: 'Nothing is waiting to be published' })).toBeInTheDocument();
    return 0;
  }
  const total = Number(figure().getAttribute('data-pending-total'));
  expect(total).toBe(rows.length);
  expect(figure().textContent).toMatch(new RegExp(`^${total} unpublished change`));
  for (const table of main().querySelectorAll('table')) {
    const count = table.querySelectorAll('tbody tr').length;
    const panel = table.closest('section');
    const button = within(panel).getByRole('button', { name: /^Publish \d+ / });
    expect(Number(button.textContent.match(/^Publish (\d+)/)[1])).toBe(count);
  }
  expect(within(main()).getByRole('button', { name: `Publish all (${total})` })).toBeInTheDocument();
  return total;
}

beforeEach(() => {
  // The editor tour (issue #198) opens on a first visit and states the
  // record words this file reads; the account has already ended it.
  markTourDone('admin-1');
  unowned.clear();
  adminSubscriptions.clear();
  drafts.clear();
  runs.recent = null;
  runs.failed = null;
  staff = false;
  globalThis.fetch = vi.fn();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('the Unpublished changes page', () => {
  it('waits for every collection, then says nothing is waiting', async () => {
    await renderAt('/admin/unpublished');
    expect(screen.getByLabelText('Loading unpublished changes…')).toBeInTheDocument();
    expect(screen.getByLabelText('Loading recent publishes…')).toBeInTheDocument();
    act(() => {
      for (const collection of ALL.slice(0, 5)) drafts.get(collection).onNext([]);
    });
    expect(screen.getByLabelText('Loading unpublished changes…')).toBeInTheDocument();
    act(() => drafts.get('cmsTimeline').onNext([]));
    expect(screen.queryByLabelText('Loading unpublished changes…')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Nothing is waiting to be published' })).toBeInTheDocument();
    expect(screen.getByText(/Speaker edits are reviewed on each speaker’s page\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the pages list' })).toHaveAttribute('href', '/admin/pages');
    expect(screen.queryByRole('button', { name: /^Publish all/ })).toBeNull();
    pushRuns();
    expect(screen.getByText('No publish has run yet.')).toBeInTheDocument();
    // The docket names the page; the banner never renders on its own page.
    expect(screen.getByRole('link', { name: 'Unpublished changes' })).toHaveAttribute('aria-current', 'page');
    expect(runs.recent.count).toBe(10);
    expect(runs.failed.count).toBe(20);
  });

  it('(a) raises the figure and adds the row when a block is saved', async () => {
    await renderAt('/admin/unpublished');
    pushPages();
    pushDrafts();
    expectPageAgrees();
    act(() => drafts.get('cmsContent').onNext([block('subtitle')]));
    expect(figure()).toHaveAttribute('data-pending-total', '1');
    expect(figure()).toHaveTextContent('1 unpublished change: 1 content block.');
    const table = screen.getByRole('table', { name: 'Content blocks with unpublished changes, newest first' });
    const [row] = within(table).getAllByRole('row').slice(1);
    expect(within(row).getByRole('link', { name: 'hero › subtitle' })).toHaveAttribute(
      'href',
      '/admin/content/home/hero/subtitle',
    );
    expect(row).toHaveTextContent('hero__subtitle');
    expect(row).toHaveTextContent('Live with unpublished changes');
    expect(row).toHaveTextContent('admin@example.org');
    // The proof ground is on every cell of the row (a pseudo-element layer
    // on a <tr> is laid out as an extra cell).
    expect(row.className).not.toContain('admin-proof-row');
    // The tint's layer is lifted off element children only, so no cell
    // may hold bare text: it would sit under the tint.
    for (const cell of within(row).getAllByRole('cell')) {
      expect(cell.className).toContain('admin-proof-row');
      expect([...cell.childNodes].every((node) => node.nodeType === Node.ELEMENT_NODE)).toBe(true);
    }
    expect(within(row).getAllByRole('cell')).toHaveLength(4);
    expect(row).toHaveTextContent('Sep 23, 2026');
    expect(screen.getByRole('region', { name: 'Content blocks' })).toHaveAttribute('tabindex', '0');
    expectPageAgrees();
  });

  it('(b) publishes one collection with its ids, and the list clears when the drafts go clean', async () => {
    await renderAt('/admin/unpublished');
    pushDrafts({ cmsContent: [block('subtitle')], cmsPages: [{ id: 'home', label: 'Home', status: 'dirty', basedOnRevision: null }] });
    fetch.mockResolvedValueOnce(ok({
      queueId: 'q1', status: 'done', results: { cmsContent: { published: ['hero__subtitle'], skipped: [], chunksCommitted: 1 } },
    }));
    const button = screen.getByRole('button', { name: 'Publish 1 content block' });
    button.focus();
    fireEvent.click(button);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(String(fetch.mock.calls[0][0])).toMatch(/\/cmsPublish$/);
    expect(bodyOf(0)).toEqual({ collection: 'cmsContent', docIds: ['hero__subtitle'] });
    const notice = await within(main()).findByText('Published. The public site picks it up live.');
    expect(notice).toHaveAttribute('role', 'status');
    // The control is still here until the listener says the draft is clean.
    expect(document.activeElement).toBe(button);
    act(() => drafts.get('cmsContent').onNext([]));
    expect(screen.queryByRole('table', { name: /^Content blocks/ })).toBeNull();
    expect(figure()).toHaveAttribute('data-pending-total', '1');
    expectPageAgrees();
    // The pressed control left with its panel; focus is on the result.
    expect(document.activeElement).toBe(notice.parentElement);
    expect(notice.parentElement).toHaveAttribute('tabindex', '-1');
  });

  it('moves focus to the result once it arrives when the panel left before the answer', async () => {
    await renderAt('/admin/unpublished');
    pushDrafts({ cmsPages: [{ id: 'home', label: 'Home', status: 'dirty', basedOnRevision: 1 }] });
    let answer;
    fetch.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    const button = screen.getByRole('button', { name: 'Publish 1 page' });
    button.focus();
    fireEvent.click(button);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    // The listener reports the publish before the endpoint answers.
    pushDrafts();
    expect(button.isConnected).toBe(false);
    await act(async () => {
      answer(ok({ queueId: 'q6', status: 'done', results: { cmsPages: { published: ['home'], skipped: [] } } }));
    });
    const notice = await within(main()).findByText('Published. The public site picks it up live.');
    await waitFor(() => expect(document.activeElement).toBe(notice.parentElement));
  });

  it('publishes everything with { all: true } and reads the whole answer', async () => {
    await renderAt('/admin/unpublished');
    pushDrafts({ cmsContent: [block('subtitle'), block('title')], cmsSchedule: [{ id: 'opening', title: 'Opening', status: 'dirty' }] });
    fetch.mockResolvedValueOnce(ok({
      queueId: 'q2',
      status: 'done',
      results: {
        cmsContent: { published: ['hero__subtitle', 'hero__title'], skipped: [] },
        cmsSchedule: { published: ['opening'], skipped: [] },
      },
    }));
    const button = within(main()).getByRole('button', { name: 'Publish all (3)' });
    expect(button.className).toContain('bg-admin-action');
    button.focus();
    fireEvent.click(button);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(bodyOf(0)).toEqual({ all: true });
    expect(await within(main()).findByText('Published 3 changes. The public site picks them up live.')).toBeInTheDocument();
    pushDrafts();
    expect(document.activeElement).toBe(within(main()).getByText('Published 3 changes. The public site picks them up live.').parentElement);
  });

  it('(c) keeps a failed run listed as Failed with its error and one Resume, however many finished runs follow it', async () => {
    await renderAt('/admin/unpublished');
    pushDrafts();
    const failed = {
      id: 'q-failed',
      status: 'failed',
      request: { cmsContent: ['a', 'b', 'c'] },
      progress: { cmsContent: { published: ['a'], skipped: [] } },
      requestedBy: 'staff@example.org',
      requestedAt: at(Date.UTC(2026, 8, 20, 12, 0)),
      error: 'Publish stranded: no progress for 90 minutes.',
      note: 'Checked by hand.',
    };
    pushRuns([failed], [failed]);
    expect(screen.getByRole('heading', { name: 'Recent publishes' }).closest('section')).toHaveTextContent(
      'The last 10 publish runs, and the 20 newest runs still marked Failed, newest first.',
    );
    const list = screen.getByRole('list', { name: 'Publish runs' });
    let row = list.querySelector('[data-run="q-failed"]');
    expect(within(row).getByText('Failed')).toBeInTheDocument();
    expect(row).toHaveTextContent('1 of 3 published before it stopped.');
    expect(row).toHaveTextContent('Publish stranded: no progress for 90 minutes.');
    expect(row).toHaveTextContent('Checked by hand.');
    expect(row).toHaveTextContent('Resume publishes the current saved version of each record this run did not reach.');
    expect(row).toHaveTextContent('staff@example.org');
    expect(within(list).getAllByRole('button')).toHaveLength(1);

    // Ten newer runs push it out of the recent read; the failed read keeps it.
    const done = Array.from({ length: 10 }, (_, index) => ({
      id: `q-done-${index}`,
      status: 'done',
      request: { cmsPages: ['home'] },
      progress: { cmsPages: { published: ['home'], skipped: [] } },
      requestedBy: 'admin@example.org',
      requestedAt: at(Date.UTC(2026, 8, 21, 12, index)),
    }));
    pushRuns(done.slice().reverse(), [failed]);
    const items = within(screen.getByRole('list', { name: 'Publish runs' })).getAllByRole('listitem');
    expect(items).toHaveLength(11);
    expect(items[0]).toHaveTextContent('Done');
    expect(items[0]).toHaveTextContent('1 of 1 published.');
    expect(items.at(-1).getAttribute('data-run')).toBe('q-failed');
    row = items.at(-1);
    expect(within(row).getByText('Failed')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Publish runs' })).getAllByRole('button')).toHaveLength(1);

    fetch.mockResolvedValueOnce(ok({
      queueId: 'q-failed', status: 'done', results: { cmsContent: { published: ['a', 'b', 'c'], skipped: [] } },
    }));
    fireEvent.click(within(row).getByRole('button', { name: 'Resume publish' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(bodyOf(0)).toEqual({ queueId: 'q-failed' });
    expect(await within(main()).findByText('Published 3 changes. The public site picks them up live.')).toBeInTheDocument();
  });

  it('(d) never lets the figure, the rows, the panel buttons and the banner disagree', async () => {
    await renderAt('/admin/unpublished');
    pushPages();
    const snapshots = [
      {},
      { cmsContent: [block('subtitle')] },
      { cmsContent: [block('subtitle'), block('title')], cmsPages: [{ id: 'home', label: 'Home', status: 'dirty', basedOnRevision: 1 }] },
      {
        cmsContent: [block('title')],
        cmsPages: [{ id: 'home', label: 'Home', status: 'dirty', basedOnRevision: 1 }],
        cmsSchedule: [{ id: 's1', title: 'One', status: 'dirty' }, { id: 's2', title: 'Two', status: 'dirty' }],
        cmsTimeline: [{ id: 't1', status: 'dirty' }],
      },
    ];
    let total = 0;
    for (const snapshot of snapshots) {
      pushDrafts(snapshot);
      total = expectPageAgrees();
      expect(screen.queryByRole('complementary', { name: 'Unpublished changes' })).toBeNull();
    }
    // One collection moves on its own: the page follows it at once.
    act(() => drafts.get('cmsSchedule').onNext([{ id: 's1', title: 'One', status: 'dirty' }]));
    total = expectPageAgrees();
    expect(total).toBe(4);
    const sentence = figure().textContent;

    // Every other screen shows the same count in the banner.
    fireEvent.click(screen.getByRole('link', { name: 'Pages' }));
    await screen.findByRole('heading', { level: 1, name: 'Pages' });
    const banner = screen.getByRole('complementary', { name: 'Unpublished changes' });
    expect(banner).toHaveAttribute('data-pending-total', String(total));
    expect(banner.querySelector('p').firstChild.textContent).toBe(sentence);
    fireEvent.click(within(banner).getByRole('link', { name: 'Review unpublished changes' }));
    await screen.findByRole('heading', { level: 1, name: 'Unpublished changes' });
    expect(figure()).toHaveAttribute('data-pending-total', String(total));
  });

  it('holds every publish control while one call runs, and keeps focus on the pressed one', async () => {
    await renderAt('/admin/unpublished');
    pushDrafts({ cmsContent: [block('subtitle')], cmsPages: [{ id: 'home', label: 'Home', status: 'dirty' }] });
    let answer;
    fetch.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    const button = screen.getByRole('button', { name: 'Publish 1 page' });
    button.focus();
    fireEvent.click(button);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(button).toHaveTextContent('Publishing…');
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    const all = within(main()).getByRole('button', { name: 'Publish all (2)' });
    expect(all).toHaveAttribute('aria-disabled', 'true');
    expect(all).not.toHaveAttribute('aria-busy');
    expect(screen.getByRole('button', { name: 'Publish 1 content block' })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(all);
    fireEvent.click(button);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(button);
    await act(async () => {
      answer(ok({ queueId: 'q3', status: 'done', results: { cmsPages: { published: ['home'], skipped: [] } } }));
    });
    await waitFor(() => expect(button).toHaveTextContent('Publish 1 page'));
    expect(button).not.toHaveAttribute('aria-busy');
    expect(button).not.toHaveAttribute('aria-disabled');
    expect(document.activeElement).toBe(button);
  });

  it('states a part-way failure, a run still going, and a refusal in the server’s words', async () => {
    await renderAt('/admin/unpublished');
    pushDrafts({ cmsSchedule: [{ id: 'child', title: 'Child', status: 'dirty' }] });
    fetch.mockResolvedValueOnce(refused(500, {
      error: { code: 'publish-failed', message: 'Publish failed part-way. Re-run with { queueId } to resume.' },
      queueId: 'q4',
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish 1 session' }));
    const partWay = await within(main()).findByText(
      'The publish stopped part-way. Its run is marked Failed under Recent publishes. Resume it there.',
    );
    expect(partWay).toHaveAttribute('role', 'alert');

    fetch.mockResolvedValueOnce(refused(409, {
      error: { code: 'already-running', message: 'That publish is still running. If it is stranded, mark it failed via cmsUpdatePublishStatus, then resume.' },
    }));
    fireEvent.click(within(main()).getByRole('button', { name: 'Publish all (1)' }));
    expect(await within(main()).findByText(
      'That run is still publishing. Wait for it to finish. A run with no progress for 90 minutes is marked Failed and can then be resumed.',
    )).toBeInTheDocument();
    expect(within(main()).queryByText(/cmsUpdatePublishStatus/)).toBeNull();

    fetch.mockResolvedValueOnce(refused(400, {
      error: { code: 'invalid-argument', message: 'cmsSchedule/child names parent opening, which is not published.' },
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish 1 session' }));
    expect(await within(main()).findByText('cmsSchedule/child names parent opening, which is not published.')).toBeInTheDocument();
  });

  it('reads an answer that skipped a change as a problem, naming it', async () => {
    await renderAt('/admin/unpublished');
    pushDrafts({ cmsContent: [block('subtitle'), block('title')] });
    fetch.mockResolvedValueOnce(ok({
      queueId: 'q5',
      status: 'done',
      results: { cmsContent: { published: ['hero__subtitle'], skipped: [{ docId: 'hero__title', reason: 'conflict' }] } },
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish 2 content blocks' }));
    expect(await within(main()).findByText(
      'Published 1 of 2 content blocks. Not published: hero__title was edited while publishing, so its newer draft stayed unpublished.',
    )).toHaveAttribute('role', 'alert');
  });

  it('keeps the rows and says so when the list cannot be refreshed; says so plainly before it has any', async () => {
    await renderAt('/admin/unpublished');
    act(() => drafts.get('cmsPages').onError(new Error('offline')));
    expect(within(main()).getByText('We could not count the unpublished changes. We will try again.')).toHaveAttribute('role', 'alert');
    pushDrafts({ cmsPages: [{ id: 'home', label: 'Home', status: 'dirty' }] });
    expect(within(main()).queryByText('We could not count the unpublished changes. We will try again.')).toBeNull();
    act(() => drafts.get('cmsPages').onError(new Error('offline again')));
    expect(within(main()).getByText(
      'The list could not be refreshed. Until it is, the buttons on each table wait. Publish all reads the current list. It will try again.',
    )).toHaveAttribute('role', 'status');
    expect(screen.getByRole('table', { name: /^Pages with unpublished changes/ })).toBeInTheDocument();
    act(() => runs.recent.onError(new Error('offline')));
    expect(within(main()).getByText('The publish runs could not be refreshed. The list will try again.')).toBeInTheDocument();
  });

  it('holds the collection buttons while the list is stale, and keeps Publish all, which reads the current list', async () => {
    await renderAt('/admin/unpublished');
    pushDrafts({ cmsPages: [{ id: 'home', label: 'Home', status: 'dirty' }] });
    act(() => drafts.get('cmsPages').onError(new Error('offline')));
    // The row may have been published elsewhere since: sending its id again
    // would publish a clean draft as a new live revision.
    const stale = screen.getByRole('button', { name: 'Publish 1 page' });
    expect(stale).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(stale);
    expect(within(main()).getByText(
      'The list could not be refreshed. Until it is, the buttons on each table wait. Publish all reads the current list. It will try again.',
    )).toHaveAttribute('role', 'status');
    const all = screen.getByRole('button', { name: 'Publish all (1)' });
    expect(all).not.toHaveAttribute('aria-disabled');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetch).not.toHaveBeenCalled();
    // The next delivery clears the error and frees the buttons.
    pushDrafts({ cmsPages: [{ id: 'home', label: 'Home', status: 'dirty' }] });
    expect(screen.getByRole('button', { name: 'Publish 1 page' })).not.toHaveAttribute('aria-disabled');
  });

  it('asks for Publish all past 2,000 changes in one collection', async () => {
    await renderAt('/admin/unpublished');
    pushDrafts({
      cmsSchedule: Array.from({ length: 2001 }, (_, index) => ({ id: `s-${String(index).padStart(4, '0')}`, status: 'dirty' })),
    });
    const table = screen.getByRole('table', { name: /^Sessions with unpublished changes/ });
    const panel = table.closest('section');
    // The control stays, unavailable, and says why: never a removed control.
    const button = within(panel).getByRole('button', { name: 'Publish 2001 sessions' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button.className).toContain(unavailableButtonClass);
    expect(button).toHaveAccessibleDescription('Use Publish all. One collection publish takes at most 2,000 changes.');
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(fetch).not.toHaveBeenCalled();
    expect(button).not.toHaveAttribute('aria-busy');
    expect(within(main()).getByRole('button', { name: 'Publish all (2001)' })).not.toHaveAttribute('aria-disabled');
  }, 20_000);

  it('renders a hostile title as text, marks a hidden record, and links only where an editor exists', async () => {
    unowned.add('/admin/updates');
    await renderAt('/admin/unpublished');
    pushDrafts({
      cmsSchedule: [{ id: 's1', title: '<img src=x onerror="alert(1)">', status: 'dirty', visible: false }],
      cmsUpdates: [{ id: 'u1', title: 'An update', status: 'dirty' }],
    });
    const sessions = screen.getByRole('table', { name: /^Sessions with unpublished changes/ });
    expect(sessions.querySelector('img')).toBeNull();
    expect(within(sessions).getByRole('link', { name: '<img src=x onerror="alert(1)">' })).toHaveAttribute(
      'href',
      '/admin/sessions/s1',
    );
    expect(within(sessions).getByText('Hidden')).toBeInTheDocument();
    expect(within(sessions).getByText('Draft')).toBeInTheDocument();
    const updates = screen.getByRole('table', { name: /^Updates with unpublished changes/ });
    expect(within(updates).queryByRole('link')).toBeNull();
    expect(within(updates).getByText('An update')).toBeInTheDocument();
  });

  it('lets a reader read a name cut at 80 characters in full, with or without an editor link', async () => {
    unowned.add('/admin/updates');
    await renderAt('/admin/unpublished');
    const long = `A long update title ${'that keeps going '.repeat(8)}until the end`;
    const session = `A long session title ${'that keeps going '.repeat(8)}until the end`;
    pushDrafts({
      cmsUpdates: [{ id: 'u-long', title: long, status: 'dirty' }],
      cmsSchedule: [{ id: 's-long', title: session, status: 'dirty' }],
    });
    // The docket does not own the updates editor here, so this row has no link.
    const updates = screen.getByRole('table', { name: /^Updates with unpublished changes/ });
    const [row] = within(updates).getAllByRole('row').slice(1);
    expect(within(row).queryByRole('link')).toBeNull();
    const shown = within(row).getByText(`${long.slice(0, 79)}…`);
    expect(shown).toHaveAttribute('title', long);
    expect(within(row).getByText(long)).toHaveClass('sr-only');
    // A linked row is named in full too.
    const sessions = screen.getByRole('table', { name: /^Sessions with unpublished changes/ });
    expect(within(sessions).getByRole('link', { name: session })).toHaveAttribute('href', '/admin/sessions/s-long');
  });

  it('opens for a staff account', async () => {
    staff = true;
    await renderAt('/admin/unpublished');
    expect(screen.queryByRole('heading', { name: 'This section needs operator access' })).toBeNull();
    pushDrafts({ cmsContent: [block('subtitle')] });
    expect(figure()).toHaveAttribute('data-pending-total', '1');
    expect(screen.queryByRole('link', { name: 'Branding' })).toBeNull();
  });
});
