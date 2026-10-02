// One record's version history (issue #195): clauses (a) what changed, (b)
// when, and (c) by which account, on the page that shows them. Mocks
// adminApi directly, the convention the email log and attendee page tests
// follow, and adminSource.js for the record's live and draft documents.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Profiler } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';

const callMock = vi.fn();
vi.mock('../adminApi.js', () => ({ useAdminApi: () => callMock }));
const listeners = new Map();
vi.mock('../adminSource.js', () => ({
  subscribeAdminCollection: (name, onNext, onError) => {
    const entry = { onNext, onError };
    listeners.set(name, entry);
    return () => {
      if (listeners.get(name) === entry) listeners.delete(name);
    };
  },
}));
vi.mock('../../contexts/EventConfigContext.jsx', () => ({
  useEventConfig: () => ({ eventConfig: { timezone: 'America/New_York' } }),
}));

import AdminVersionHistory from './AdminVersionHistory.jsx';
import { unavailableButtonClass } from '../components/formControls.jsx';
import { DELETE_FIELD_SENTINEL } from '../contentDoc.js';

const DOC_PATH = 'cmsContent/hero__subtitle';
// 2:02 PM on Sep 23, 2026 in New York.
const PUBLISHED = Date.UTC(2026, 8, 23, 18, 2);

function entry(revision, overrides = {}) {
  return {
    id: `row-${revision}`,
    docPath: DOC_PATH,
    revision,
    fields: { section: 'hero', field: 'subtitle', blockType: 'text', value: `Value ${revision}` },
    visible: true,
    publishedAt: PUBLISHED - (10 - revision) * 60_000,
    publishedBy: 'admin@example.org',
    publishedByUid: 'admin-1',
    previousRevision: revision > 1 ? revision - 1 : null,
    changes: [{ path: 'value', kind: 'changed', before: `Value ${revision - 1}`, after: `Value ${revision}` }],
    moreChanges: 0,
    ...overrides,
  };
}

const SEEDED = entry(1, {
  fields: { section: 'hero', field: 'subtitle', blockType: 'text', value: 'Three days of workshops.', seeded: true, seededAt: '2026-01-01T00:00:00.000Z' },
  publishedBy: 'init-event-script',
  changes: [
    { path: 'blockType', kind: 'added', before: null, after: 'text' },
    { path: 'value', kind: 'added', before: null, after: 'Three days of workshops.' },
  ],
});
const EDITED = entry(2, {
  publishedAt: PUBLISHED,
  fields: { section: 'hero', field: 'subtitle', blockType: 'text', value: 'Four days of workshops.' },
  changes: [{ path: 'value', kind: 'changed', before: 'Three days of workshops.', after: 'Four days of workshops.' }],
});

function serverError(status, code, text) {
  const error = new Error(text);
  error.status = status;
  error.code = code;
  return error;
}

/**
 * cmsGetVersionHistory answers each entry of `pages` in turn (the last
 * repeats); an Error entry is thrown, and a function entry is called for
 * a promise the test controls. The page calls no other endpoint.
 */
function serve({ pages = [{ entries: [EDITED, SEEDED], nextCursor: null }], others = {} } = {}) {
  let n = 0;
  callMock.mockImplementation((name, body) => {
    if (name === 'cmsGetVersionHistory') {
      const answer = pages[Math.min(n, pages.length - 1)];
      n += 1;
      if (typeof answer === 'function') return answer(body);
      if (answer instanceof Error) return Promise.reject(answer);
      return Promise.resolve(answer);
    }
    const answer = others[name];
    if (typeof answer === 'function') return answer(body);
    if (answer instanceof Error) return Promise.reject(answer);
    if (answer !== undefined) return Promise.resolve(answer);
    return Promise.reject(new Error(`unexpected call ${name}`));
  });
}

const historyCalls = () => callMock.mock.calls.filter(([name]) => name === 'cmsGetVersionHistory').map(([, body]) => body);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((r, fail) => {
    resolve = r;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const LIVE = { id: 'hero__subtitle', section: 'hero', field: 'subtitle', blockType: 'text', value: 'Four days of workshops.', visible: true, revision: 2 };
const CLEAN_DRAFT = { id: 'hero__subtitle', section: 'hero', field: 'subtitle', blockType: 'text', value: 'Four days of workshops.', status: 'clean' };

function reportRecord({ live = [LIVE], drafts = [CLEAN_DRAFT] } = {}) {
  act(() => {
    listeners.get('cmsContent').onNext(live);
    listeners.get('cmsContent_drafts').onNext(drafts);
  });
}

function reportPages({ live = [{ id: 'home', sections: [{ id: 'hero', allowedBlocks: ['text'] }] }], drafts = [] } = {}) {
  act(() => {
    listeners.get('cmsPages').onNext(live);
    listeners.get('cmsPages_drafts').onNext(drafts);
  });
}

async function renderPage(path = `/admin/versions/${DOC_PATH}`, options) {
  serve(options);
  const result = render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/admin/versions/:collection/:docId" element={<AdminVersionHistory />} />
        <Route path="/admin/versions" element={<p>The record list</p>} />
        <Route path="/signin" element={<p>Sign-in page</p>} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.queryByLabelText('Loading the version history…')).toBeNull());
  return result;
}

const versionItem = (revision) =>
  screen.getByRole('heading', { level: 2, name: `Version ${revision}` }).closest('li');

async function renderNavigablePage(options) {
  serve({
    pages: [
      { entries: [EDITED, SEEDED], nextCursor: null },
      {
        entries: [2, 1].map((revision) => entry(revision, {
          docPath: 'cmsContent/hero__title',
          fields: { section: 'hero', field: 'title', blockType: 'text', value: `Title ${revision}` },
        })),
        nextCursor: null,
      },
    ],
    ...options,
  });
  let navigate;
  function Navigator() {
    navigate = useNavigate();
    return null;
  }
  render(
    <MemoryRouter initialEntries={[`/admin/versions/${DOC_PATH}`]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Navigator />
      <Routes>
        <Route path="/admin/versions/:collection/:docId" element={<AdminVersionHistory />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole('heading', { name: 'Version 1' });
  return navigate;
}

beforeEach(() => {
  callMock.mockReset();
  listeners.clear();
});

describe('one record’s versions', () => {
  it('asks for this record’s first page of versions', async () => {
    await renderPage();
    expect(historyCalls()).toEqual([{ docPath: DOC_PATH, limit: 20 }]);
  });

  it('shows what changed, when, and by which account', async () => {
    await renderPage();
    reportRecord();
    const item = versionItem(2);
    // (b) when: on the event clock, with the instant in the markup.
    const time = item.querySelector('time');
    expect(time).toHaveTextContent('Sep 23, 2026, 2:02 PM EDT');
    expect(time).toHaveAttribute('dateTime', new Date(PUBLISHED).toISOString());
    // (c) by which account.
    expect(item).toHaveTextContent('Published Sep 23, 2026, 2:02 PM EDT by admin@example.org.');
    // (a) what changed.
    const table = within(item).getByRole('table', { name: 'What changed in version 2' });
    expect(within(table).getAllByRole('columnheader').map((head) => head.textContent)).toEqual(['Field', 'Before', 'After']);
    const cells = within(table).getAllByRole('row')[1];
    expect(within(cells).getByRole('rowheader')).toHaveTextContent('value');
    expect(within(cells).getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
      'Three days of workshops.',
      'Four days of workshops.',
    ]);
    expect(screen.getByText('This is the published version.')).toBeInTheDocument();
    // Merely reading the page does not write anything.
    expect(within(versionItem(1)).getByRole('button', { name: 'Restore version 1' })).toBeInTheDocument();
    expect(new Set(callMock.mock.calls.map(([name]) => name))).toEqual(new Set(['cmsGetVersionHistory']));
  });

  it('heads the page with the record’s name, state and path, and says how many versions it shows', async () => {
    await renderPage();
    reportRecord();
    expect(screen.getByRole('heading', { level: 1, name: 'hero › subtitle' })).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText(DOC_PATH)).toBeInTheDocument();
    expect(screen.getByText(/^2 versions shown, newest first, read at \d{1,2}:\d{2} (AM|PM) E[SD]T\.$/)).toHaveAttribute('role', 'status');
    expect(screen.getByRole('link', { name: 'Back to the list' })).toHaveAttribute('href', '/admin/versions?collection=cmsContent');
  });

  it('says the site shows nothing when the published version is hidden', async () => {
    await renderPage();
    reportRecord({ live: [{ ...LIVE, visible: false }] });
    expect(versionItem(2)).toHaveTextContent(
      'This is the published version, and it is hidden. The site shows nothing for this record until a shown version is published.',
    );
    expect(versionItem(1)).not.toHaveTextContent('published version');
  });

  it('marks a record whose live and draft documents are gone as removed, and keeps its versions', async () => {
    await renderPage();
    reportRecord({ live: [], drafts: [] });
    expect(screen.getByText('Removed')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'hero__subtitle' })).toBeInTheDocument();
    expect(versionItem(2)).toBeInTheDocument();
  });

  it('shows the first version as its values, in two columns', async () => {
    await renderPage();
    const item = versionItem(1);
    expect(item).toHaveTextContent('First published.');
    expect(item).toHaveTextContent('by init-event-script');
    const table = within(item).getByRole('table', { name: 'What changed in version 1' });
    expect(within(table).getAllByRole('columnheader').map((head) => head.textContent)).toEqual(['Field', 'Value']);
    expect(within(table).getByText('Three days of workshops.')).toBeInTheDocument();
  });

  it('calls the oldest version it holds the earliest on record when it is not version 1', async () => {
    await renderPage(undefined, { pages: [{ entries: [entry(9, { previousRevision: null })], nextCursor: null }] });
    expect(versionItem(9)).toHaveTextContent('Earliest version on record.');
  });

  it('renders a stored tag as characters, never as markup', async () => {
    const hostile = '<img src=x onerror="document.title=\'ran\'">';
    await renderPage(undefined, {
      pages: [{ entries: [entry(2, { changes: [{ path: 'url', kind: 'changed', before: 'javascript:alert(1)', after: hostile }] })], nextCursor: null }],
    });
    const item = versionItem(2);
    expect(within(item).getByText(hostile)).toBeInTheDocument();
    expect(item.querySelector('img')).toBeNull();
    expect(within(item).getByText('javascript:alert(1)').closest('a')).toBeNull();
  });

  it('shows the start of a long value and the rest behind a disclosure', async () => {
    const long = `${'a'.repeat(1_000)}${'b'.repeat(240)}`;
    await renderPage(undefined, {
      pages: [{ entries: [entry(2, { changes: [{ path: 'value', kind: 'changed', before: 'short', after: long }] })], nextCursor: null }],
    });
    const item = versionItem(2);
    const summary = within(item).getByText('Show all 1,240 characters');
    expect(summary.tagName).toBe('SUMMARY');
    expect(within(item).getByText(`${'a'.repeat(300)}…`)).toBeInTheDocument();
    expect(summary.closest('details')).toHaveTextContent(long);
  });

  it('reads the visibility flag as words', async () => {
    await renderPage(undefined, {
      pages: [{ entries: [entry(2, { changes: [{ path: 'visible', kind: 'changed', before: true, after: false }] })], nextCursor: null }],
    });
    const row = within(versionItem(2)).getAllByRole('row')[1];
    expect(within(row).getByRole('rowheader')).toHaveTextContent('Shown on the site');
    expect(within(row).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['Yes', 'No']);
  });

  it('reads a time change on the event clock, and a nested path in words', async () => {
    await renderPage(undefined, {
      pages: [{
        entries: [entry(2, {
          changes: [
            { path: 'publishAt', kind: 'changed', before: null, after: PUBLISHED, time: true },
            { path: 'sections.1.label', kind: 'changed', before: 'One', after: 'Two' },
          ],
        })],
        nextCursor: null,
      }],
    });
    const rows = within(versionItem(2)).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('publishAtNot setSep 23, 2026, 2:02 PM EDT');
    expect(within(rows[2]).getByRole('rowheader')).toHaveTextContent('sections › item 2 › label');
  });

  it('says when more changes than it lists were made, and when none were', async () => {
    await renderPage(undefined, {
      pages: [{
        entries: [
          entry(3, { moreChanges: 12 }),
          entry(2, { changes: [], moreChanges: 0 }),
        ],
        nextCursor: null,
      }],
    });
    expect(versionItem(3)).toHaveTextContent('12 more changes are not listed.');
    expect(versionItem(2)).toHaveTextContent('No field changed in this publish.');
    expect(within(versionItem(2)).queryByRole('table')).toBeNull();
  });

  it('says an account the version did not record is not recorded', async () => {
    await renderPage(undefined, { pages: [{ entries: [entry(2, { publishedBy: null })], nextCursor: null }] });
    expect(versionItem(2)).toHaveTextContent('Published Sep 23, 2026, 1:54 PM EDT. Account not recorded.');
  });

  it('loads older versions with the cursor, appends them, and moves focus to the first new one', async () => {
    await renderPage(undefined, {
      pages: [
        { entries: [entry(5), entry(4)], nextCursor: 4 },
        { entries: [entry(3), entry(2)], nextCursor: null },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Load older versions' }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Version 3' })).toHaveFocus());
    expect(historyCalls()[1]).toEqual({ docPath: DOC_PATH, limit: 20, cursor: 4 });
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Version 5', 'Version 4', 'Version 3', 'Version 2',
    ]);
    expect(screen.queryByRole('button', { name: 'Load older versions' })).toBeNull();
  });

  it('says Loading… while the pager runs, and ignores a second press', async () => {
    const older = deferred();
    await renderPage(undefined, {
      pages: [{ entries: [entry(5), entry(4)], nextCursor: 4 }, () => older.promise],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Load older versions' }));
    const pager = screen.getByRole('button', { name: 'Loading…' });
    expect(pager).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(pager);
    expect(historyCalls()).toHaveLength(2);
    await act(async () => older.resolve({ entries: [entry(3)], nextCursor: null }));
    expect(versionItem(3)).toBeInTheDocument();
  });

  it('refuses the pager during a refresh in words and in the disabled ink, and not while it runs itself', async () => {
    const refreshed = deferred();
    const older = deferred();
    await renderPage(undefined, {
      pages: [{ entries: [entry(5), entry(4)], nextCursor: 4 }, () => refreshed.promise, () => older.promise],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    const refused = screen.getByRole('button', { name: 'Load older versions after the refresh' });
    expect(refused).toHaveAttribute('aria-disabled', 'true');
    expect(refused).not.toHaveAttribute('aria-busy');
    // The disabled ink on the alternate ground, the pointer unchanged.
    for (const token of unavailableButtonClass.split(' ')) expect(refused.className).toContain(token);
    expect(refused.className).not.toMatch(/aria-disabled:(cursor-not-allowed|opacity-60)/);
    fireEvent.click(refused);
    expect(historyCalls()).toHaveLength(2);

    await act(async () => refreshed.resolve({ entries: [entry(5), entry(4)], nextCursor: 4 }));
    fireEvent.click(screen.getByRole('button', { name: 'Load older versions' }));
    // Busy is its own state: the label says so, and the control keeps its own look.
    const busy = screen.getByRole('button', { name: 'Loading…' });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy).not.toHaveAttribute('aria-disabled');
    expect(busy.className).not.toContain('aria-disabled:text-admin-ink-disabled');
    await act(async () => older.resolve({ entries: [entry(3)], nextCursor: null }));
  });

  it('drops an older page that a Refresh overtook, so no version shows twice', async () => {
    const older = deferred();
    await renderPage(undefined, {
      pages: [
        { entries: [entry(5), entry(4)], nextCursor: 4 },
        () => older.promise,
        { entries: [entry(6), entry(5)], nextCursor: 5 },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Load older versions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(versionItem(6)).toBeInTheDocument());
    await act(async () => older.resolve({ entries: [entry(3), entry(2)], nextCursor: null }));
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Version 6', 'Version 5']);
  });

  // Codex review on #284: React Router keeps this page mounted when the
  // address moves from one record to another, so its first render for the
  // new address must not draw the old record's versions. A Profiler's
  // onRender runs in the commit phase, before any passive effect, so it
  // sees exactly what that render put on screen.
  it('never draws one record’s versions under another record’s address', async () => {
    serve({ pages: [{ entries: [EDITED, SEEDED], nextCursor: null }, () => new Promise(() => {})] });
    let go;
    function Navigator() {
      go = useNavigate();
      return null;
    }
    const commits = [];
    render(
      <Profiler id="history" onRender={() => commits.push(document.body.textContent)}>
        <MemoryRouter initialEntries={[`/admin/versions/${DOC_PATH}`]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Navigator />
          <Routes>
            <Route path="/admin/versions/:collection/:docId" element={<AdminVersionHistory />} />
          </Routes>
        </MemoryRouter>
      </Profiler>,
    );
    await screen.findByText('Four days of workshops.');
    commits.length = 0;

    await act(async () => {
      go('/admin/versions/cmsContent/hero__title');
    });
    const underNewAddress = commits.filter((text) => text.includes('hero__title'));
    expect(underNewAddress.length).toBeGreaterThan(0);
    for (const text of underNewAddress) expect(text).not.toContain('Four days of workshops.');
  });

  it('says so when the record has never been published', async () => {
    await renderPage(undefined, { pages: [{ entries: [], nextCursor: null }] });
    expect(screen.getByRole('heading', { name: 'No published versions yet' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Back to the list' }).length).toBeGreaterThan(0);
  });

  it('makes no call for a collection it does not know', async () => {
    serve();
    render(
      <MemoryRouter initialEntries={['/admin/versions/users/u1']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/admin/versions/:collection/:docId" element={<AdminVersionHistory />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'No such collection' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the list' })).toHaveAttribute('href', '/admin/versions');
    expect(callMock).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });

  it('shows a first-load failure verbatim with one retry', async () => {
    await renderPage(undefined, {
      pages: [serverError(500, 'internal', 'Version history is temporarily unavailable.'), { entries: [EDITED], nextCursor: null }],
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Version history is temporarily unavailable.');
    expect(screen.queryByRole('heading', { name: 'No published versions yet' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(versionItem(2)).toBeInTheDocument());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the versions on screen when a later read fails', async () => {
    await renderPage(undefined, {
      pages: [{ entries: [EDITED], nextCursor: null }, serverError(500, 'internal', 'Version history is temporarily unavailable.')],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() =>
      expect(screen.getByText('The version history did not load. The versions already loaded stay on screen.')).toBeInTheDocument(),
    );
    expect(versionItem(2)).toBeInTheDocument();
  });

  it('sends a signed-out reader to sign in again', async () => {
    await renderPage(undefined, { pages: [serverError(401, 'unauthenticated', 'Your session has expired. Sign in again.')] });
    expect(screen.getByRole('alert')).toHaveTextContent('Your session has expired.');
    expect(screen.getByRole('link', { name: 'Sign in again' })).toHaveAttribute('href', '/signin');
  });

  it('says plainly when the account may not read version history', async () => {
    await renderPage(undefined, { pages: [serverError(403, 'forbidden', 'Admin access required.')] });
    expect(screen.getByRole('heading', { name: 'You don’t have access to version history' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('restoring a version', () => {
  it('refuses publishing while another restore is in flight and clears its busy state afterward', async () => {
    const pendingRestore = deferred();
    let restores = 0;
    await renderPage(undefined, {
      others: {
        cmsUpdateContent: () => ++restores === 1 ? Promise.resolve({ status: 'dirty' }) : pendingRestore.promise,
        cmsPublish: { status: 'done', results: { cmsContent: { published: ['hero__subtitle'], skipped: [] } } },
      },
    });
    reportRecord();
    fireEvent.click(within(versionItem(1)).getByRole('button', { name: 'Restore version 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore as draft' }));
    await screen.findByRole('button', { name: 'Publish now' });
    fireEvent.click(within(versionItem(1)).getByRole('button', { name: 'Restore version 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore as draft' }));
    const publish = screen.getByRole('button', { name: 'Publish now' });
    expect(publish).toBeDisabled();
    fireEvent.click(publish);
    expect(callMock.mock.calls.some(([name]) => name === 'cmsPublish')).toBe(false);
    await act(async () => pendingRestore.resolve({ status: 'dirty' }));
    expect(screen.getByRole('button', { name: 'Publish now' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Restore version 1' })).toBeEnabled();
  });

  it.each([false, true])('refuses an open restore confirmation during publish (dirty: %s)', async (dirty) => {
    const pendingPublish = deferred();
    await renderPage(undefined, {
      others: { cmsUpdateContent: { status: 'dirty' }, cmsPublish: pendingPublish.promise },
    });
    reportRecord();
    fireEvent.click(within(versionItem(1)).getByRole('button', { name: 'Restore version 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore as draft' }));
    const publish = await screen.findByRole('button', { name: 'Publish now' });
    if (dirty) reportRecord({ drafts: [{ ...CLEAN_DRAFT, status: 'dirty' }] });
    fireEvent.click(within(versionItem(1)).getByRole('button', { name: 'Restore version 1' }));
    fireEvent.click(publish);
    const restore = screen.getByRole('button', { name: 'Restore as draft' });
    expect(restore).toBeDisabled();
    fireEvent.click(restore);
    expect(callMock.mock.calls.filter(([name]) => name === 'cmsUpdateContent')).toHaveLength(1);
    await act(async () => pendingPublish.resolve({
      status: 'done', results: { cmsContent: { published: ['hero__subtitle'], skipped: [] } },
    }));
    expect(screen.queryByRole('button', { name: 'Publishing…' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Restore as draft' })).toBeEnabled();
  });

  it.each(['success', 'error'])('ignores a late restore %s after navigating to another record', async (outcome) => {
    const restore = deferred();
    const navigate = await renderNavigablePage({ others: { cmsUpdateContent: restore.promise } });
    reportRecord();
    fireEvent.click(within(versionItem(1)).getByRole('button', { name: 'Restore version 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore as draft' }));
    await waitFor(() => expect(callMock).toHaveBeenCalledWith('cmsUpdateContent', expect.any(Object)));

    await act(async () => navigate('/admin/versions/cmsContent/hero__title'));
    reportRecord({
      live: [{ ...LIVE, id: 'hero__title', field: 'title' }],
      drafts: [{ ...CLEAN_DRAFT, id: 'hero__title', field: 'title', status: 'dirty' }],
    });
    await act(async () => {
      if (outcome === 'success') restore.resolve({ status: 'dirty' });
      else restore.reject(new Error('The old record could not be restored.'));
    });

    expect(screen.queryByRole('button', { name: 'Publish now' })).toBeNull();
    expect(screen.queryByText(/is now the draft/)).toBeNull();
    expect(screen.queryByText('The old record could not be restored.')).toBeNull();
    expect(callMock.mock.calls.some(([name]) => name === 'cmsPublish')).toBe(false);
  });

  it('ignores a late publish result and does not refresh the previous record after navigation', async () => {
    const publish = deferred();
    const navigate = await renderNavigablePage({
      others: { cmsUpdateContent: { status: 'dirty' }, cmsPublish: publish.promise },
    });
    reportRecord();
    fireEvent.click(within(versionItem(1)).getByRole('button', { name: 'Restore version 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore as draft' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Publish now' }));
    await act(async () => navigate('/admin/versions/cmsContent/hero__title'));
    const reads = historyCalls().length;
    await act(async () => publish.resolve({
      status: 'done', results: { cmsContent: { published: ['hero__subtitle'], skipped: [] } },
    }));
    expect(historyCalls()).toHaveLength(reads);
    expect(screen.queryByText('Published. The public site picks it up live.')).toBeNull();
  });

  it('keeps a full snapshot restorable when its change details are omitted for size', async () => {
    await renderPage(undefined, {
      pages: [{ entries: [entry(1, { changes: [], moreChanges: 2, changeValuesOmitted: true })], nextCursor: null }],
    });
    reportRecord();
    expect(screen.getByText('Change details are too large to show. This version can still be restored.')).toBeInTheDocument();
    expect(screen.queryByText('No field changed in this publish.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Restore version 1' })).toBeEnabled();
  });

  it('offers a past version and not the version already live with no pending draft', async () => {
    await renderPage();
    expect(screen.queryByRole('button', { name: /Restore version/ })).toBeNull();
    reportRecord();
    expect(within(versionItem(2)).queryByRole('button', { name: /Restore/ })).toBeNull();
    expect(within(versionItem(1)).getByRole('button', { name: 'Restore version 1' })).toBeInTheDocument();
  });

  it('uses the destructive confirmation with the required warning when a dirty draft will be lost', async () => {
    await renderPage();
    reportRecord({ drafts: [{ ...CLEAN_DRAFT, value: 'Unpublished idea', status: 'dirty' }] });
    fireEvent.click(within(versionItem(2)).getByRole('button', { name: 'Restore version 2' }));
    const confirm = screen.getByRole('region', { name: 'Restore version 2?' });
    expect(confirm).toHaveTextContent('The unpublished changes in the current draft go, and no version keeps them.');
    expect(confirm).toHaveTextContent('This cannot be undone.');
    expect(within(confirm).getByRole('button', { name: 'Keep it' })).toBeInTheDocument();
    expect(callMock.mock.calls.filter(([name]) => name !== 'cmsGetVersionHistory')).toEqual([]);
  });

  it('uses a plain confirmation when no unpublished work will be lost, and Cancel returns focus', async () => {
    await renderPage();
    reportRecord();
    const trigger = within(versionItem(1)).getByRole('button', { name: 'Restore version 1' });
    fireEvent.click(trigger);
    const confirm = screen.getByRole('region', { name: 'Restore version 1?' });
    expect(within(confirm).getByRole('heading', { name: 'Restore version 1?' })).toHaveFocus();
    expect(confirm).toHaveTextContent('Version 1 becomes the draft of this record. The site does not change until you publish.');
    expect(confirm).not.toHaveTextContent('cannot be undone');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('region', { name: 'Restore version 1?' })).toBeNull();
    expect(within(versionItem(1)).getByRole('button', { name: 'Restore version 1' })).toHaveFocus();
  });

  it('switches an open plain confirmation to the destructive warning when the draft becomes dirty', async () => {
    await renderPage();
    reportRecord();
    fireEvent.click(within(versionItem(1)).getByRole('button', { name: 'Restore version 1' }));
    expect(screen.getByRole('region', { name: 'Restore version 1?' })).toHaveTextContent(
      'The site does not change until you publish.',
    );

    reportRecord({ drafts: [{ ...CLEAN_DRAFT, value: 'Another admin’s unpublished idea', status: 'dirty' }] });

    const confirm = screen.getByRole('region', { name: 'Restore version 1?' });
    expect(confirm).toHaveTextContent('The unpublished changes in the current draft go, and no version keeps them.');
    expect(confirm).toHaveTextContent('This cannot be undone.');
    expect(callMock.mock.calls.filter(([name]) => name !== 'cmsGetVersionHistory')).toEqual([]);
  });

  it('saves through the normal draft endpoint, then publishes only on request', async () => {
    await renderPage(undefined, {
      pages: [
        { entries: [EDITED, SEEDED], nextCursor: null },
        {
          entries: [
            entry(3, { changes: [{ path: 'value', kind: 'changed', before: 'Four days of workshops.', after: 'Three days of workshops.' }] }),
            EDITED,
            SEEDED,
          ],
          nextCursor: null,
        },
      ],
      others: {
        cmsUpdateContent: { status: 'dirty' },
        cmsPublish: { queueId: 'q1', status: 'done', results: { cmsContent: { published: ['hero__subtitle'], skipped: [] } } },
      },
    });
    reportRecord({ drafts: [{ ...CLEAN_DRAFT, order: 4 }] });
    fireEvent.click(within(versionItem(1)).getByRole('button', { name: 'Restore version 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore as draft' }));

    await waitFor(() =>
      expect(screen.getByText('Version 1 is now the draft. The site still shows version 2 until you publish.')).toBeInTheDocument(),
    );
    expect(callMock).toHaveBeenCalledWith('cmsUpdateContent', {
      collection: 'cmsContent',
      section: 'hero',
      field: 'subtitle',
      fields: {
        section: 'hero', field: 'subtitle', blockType: 'text', value: 'Three days of workshops.', order: DELETE_FIELD_SENTINEL,
      },
      visible: true,
    });
    expect(callMock.mock.calls.some(([name]) => name === 'cmsPublish')).toBe(false);
    expect(screen.getByText(/is now the draft/).closest('[tabindex="-1"]')).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Publish now' }));
    await waitFor(() => expect(screen.getByText('Published. The public site picks it up live.')).toBeInTheDocument());
    expect(callMock).toHaveBeenCalledWith('cmsPublish', { collection: 'cmsContent', docIds: ['hero__subtitle'] });
    await waitFor(() => expect(screen.getAllByRole('heading', { level: 2 })[0]).toHaveTextContent('Version 3'));
  });

  it('keeps a refused destructive restore open, shows its rule, and clears the busy state', async () => {
    await renderPage(undefined, {
      others: { cmsUpdateContent: serverError(400, 'bad-request', 'title: enter a public title') },
    });
    reportRecord({ drafts: [{ ...CLEAN_DRAFT, value: 'Unpublished idea', status: 'dirty' }] });
    fireEvent.click(within(versionItem(1)).getByRole('button', { name: 'Restore version 1' }));
    const confirm = screen.getByRole('region', { name: 'Restore version 1?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Restore as draft' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('title: enter a public title');
    expect(alert.parentElement).toHaveFocus();
    expect(screen.getByRole('region', { name: 'Restore version 1?' })).toBeInTheDocument();
    expect(within(confirm).getByRole('button', { name: 'Restore as draft' })).toBeEnabled();
  });

  it('keeps Publish now available when publishing the restored draft is refused', async () => {
    await renderPage(undefined, {
      others: {
        cmsUpdateContent: { status: 'dirty' },
        cmsPublish: { queueId: 'q1', status: 'done', results: { cmsContent: { published: [], skipped: [{ docId: 'hero__subtitle', reason: 'conflict' }] } } },
      },
    });
    reportRecord();
    fireEvent.click(within(versionItem(1)).getByRole('button', { name: 'Restore version 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore as draft' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Publish now' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Nothing was published'));
    expect(screen.getByRole('button', { name: 'Publish now' })).toBeInTheDocument();
  });

  it('recreates a deleted content block as a draft with its owning page id', async () => {
    await renderPage(undefined, { others: { cmsCreateContent: { status: 'dirty' } } });
    reportRecord({ live: [], drafts: [] });
    reportPages();
    fireEvent.click(within(versionItem(2)).getByRole('button', { name: 'Restore version 2' }));
    expect(screen.getByRole('region', { name: 'Restore version 2?' })).toHaveTextContent('The record is saved again as a draft.');
    fireEvent.click(screen.getByRole('button', { name: 'Restore as draft' }));
    await waitFor(() => expect(screen.getByText('Version 2 is now the draft. Nothing is on the site until you publish.')).toBeInTheDocument());
    expect(callMock).toHaveBeenCalledWith('cmsCreateContent', {
      collection: 'cmsContent',
      pageId: 'home',
      section: 'hero',
      field: 'subtitle',
      fields: EDITED.fields,
      visible: true,
    });
  });

  it('names the section rule when a deleted block no longer has an owning page', async () => {
    await renderPage();
    reportRecord({ live: [], drafts: [] });
    reportPages({ live: [{ id: 'home', sections: [{ id: 'other' }] }] });
    expect(within(versionItem(2)).queryByRole('button', { name: /Restore/ })).toBeNull();
    expect(versionItem(2)).toHaveTextContent('This version cannot be restored because its section is no longer on a page.');
  });
});
