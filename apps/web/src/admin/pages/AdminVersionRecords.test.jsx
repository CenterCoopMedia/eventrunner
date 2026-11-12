// The version history record list (issue #195): clause (d), per record, and
// clause (e), the filter by collection. The page reads the live collection
// and its drafts through adminSource.js, mocked here so each test decides
// when each listener reports. A location probe beside the page reads what
// the router holds, and how it got there.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router';

const listeners = new Map();
const subscribed = [];
const readVersions = vi.fn();
vi.mock('../adminSource.js', () => ({
  readAdminVersions: (...args) => readVersions(...args),
  subscribeAdminCollection: (name, onNext, onError) => {
    const entry = { onNext, onError };
    listeners.set(name, entry);
    subscribed.push(name);
    return () => {
      if (listeners.get(name) === entry) listeners.delete(name);
    };
  },
}));
vi.mock('../../contexts/EventConfigContext.jsx', () => ({
  useEventConfig: () => ({ eventConfig: { timezone: 'America/New_York' } }),
}));

import AdminVersionRecords, { figureSentence } from './AdminVersionRecords.jsx';

const at = (iso) => ({ toMillis: () => Date.parse(iso) });

const CONTENT_LIVE = [
  { id: 'hero__subtitle', section: 'hero', field: 'subtitle', value: 'Hello', visible: true, revision: 3, publishedAt: at('2026-09-23T18:02:00Z') },
  { id: 'faq__parking', section: 'faq', field: 'parking', question: 'Where do I park?', visible: true, revision: 1, publishedAt: at('2026-09-01T12:00:00Z') },
];
const CONTENT_DRAFTS = [
  { id: 'hero__subtitle', section: 'hero', field: 'subtitle', value: 'Hello', status: 'clean' },
  { id: 'faq__parking', section: 'faq', field: 'parking', question: 'Where do I park?', status: 'dirty' },
  { id: 'about__intro', section: 'about', field: 'intro', value: 'New', status: 'dirty' },
];

function report(name, docs) {
  act(() => listeners.get(name).onNext(docs));
}

function fail(name) {
  act(() => listeners.get(name).onError(new Error('unavailable')));
}

function reportContent() {
  report('cmsContent', CONTENT_LIVE);
  report('cmsContent_drafts', CONTENT_DRAFTS);
}

function LocationProbe() {
  const location = useLocation();
  const type = useNavigationType();
  return (
    <>
      <p data-testid="location">{`${location.pathname}${location.search}`}</p>
      <p data-testid="navigation">{type}</p>
    </>
  );
}

function renderPage(path = '/admin/versions') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/admin/versions"
          element={(
            <>
              <AdminVersionRecords />
              <LocationProbe />
            </>
          )}
        />
      </Routes>
    </MemoryRouter>,
  );
}

const location = () => screen.getByTestId('location').textContent;
const table = () => screen.getByRole('region', { name: 'Records' });
const recordLinks = () => within(table()).getAllByRole('link').map((link) => link.textContent);
const searchField = () => screen.getByRole('searchbox', { name: 'Search by name' });
// The figure sentence: the one status line that is not the loading line.
const figure = () => document.querySelector('p[role="status"]:not([aria-label])');

beforeEach(() => {
  listeners.clear();
  subscribed.length = 0;
  readVersions.mockReset().mockReturnValue(new Promise(() => {}));
});

describe('the record list', () => {
  it('opens on content blocks, listing each record with its state, live version and last publish', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Version history' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Content type' })).toHaveValue('cmsContent');
    expect(subscribed).toEqual(['cmsContent', 'cmsContent_drafts']);
    reportContent();

    expect(recordLinks()).toEqual(['Hello', 'Where do I park?', 'New']);
    const hero = within(table()).getByRole('link', { name: 'Hello' }).closest('tr');
    expect(within(hero).getByText('Live')).toBeInTheDocument();
    expect(within(hero).getByText('3')).toBeInTheDocument();
    const time = hero.querySelector('time');
    expect(time).toHaveTextContent('Sep 23, 2026, 2:02 PM EDT');
    expect(time).toHaveAttribute('dateTime', '2026-09-23T18:02:00.000Z');
    const faq = within(table()).getByRole('link', { name: 'Where do I park?' }).closest('tr');
    expect(within(faq).getByText('Live with unpublished changes')).toBeInTheDocument();
    expect(within(faq).queryByText('faq__parking')).not.toBeInTheDocument();
    const about = within(table()).getByRole('link', { name: 'New' }).closest('tr');
    expect(within(about).getByText('Draft')).toBeInTheDocument();
    expect(within(about).getByText('Not published')).toBeInTheDocument();
    expect(within(about).getByText('Never')).toBeInTheDocument();
    expect(figure()).toHaveTextContent('3 content blocks, most recently published first.');
  });

  it('marks a record whose live version is hidden, since the site shows nothing for it', () => {
    renderPage();
    report('cmsContent', [{ ...CONTENT_LIVE[0], visible: false }, CONTENT_LIVE[1]]);
    report('cmsContent_drafts', []);
    const hidden = within(table()).getByRole('link', { name: 'Hello' }).closest('tr');
    expect(within(hidden).getByText('Live')).toBeInTheDocument();
    expect(within(hidden).getByText('Hidden')).toBeInTheDocument();
    const shown = within(table()).getByRole('link', { name: 'Where do I park?' }).closest('tr');
    expect(within(shown).queryByText('Hidden')).toBeNull();
  });

  it('links each name to its record’s versions, the id encoded', () => {
    renderPage();
    report('cmsContent', [{ ...CONTENT_LIVE[0], id: 'odd id' }]);
    report('cmsContent_drafts', []);
    expect(within(table()).getByRole('link')).toHaveAttribute('href', '/admin/versions/cmsContent/odd%20id');
  });

  it('switches collection from the filter, keeps it in the URL, and shows no row of the last one while the next loads', () => {
    renderPage();
    reportContent();
    fireEvent.change(screen.getByRole('combobox', { name: 'Content type' }), { target: { value: 'cmsPages' } });

    expect(location()).toBe('/admin/versions?collection=cmsPages');
    expect(subscribed.slice(-2)).toEqual(['cmsPages', 'cmsPages_drafts']);
    // The content listeners are closed, and nothing of theirs is drawn.
    expect(listeners.has('cmsContent')).toBe(false);
    expect(screen.getByRole('status', { name: 'Loading the records…' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Hello' })).toBeNull();

    report('cmsPages', [{ id: 'about', label: 'About', title: 'About the event', revision: 2, publishedAt: at('2026-09-20T10:00:00Z') }]);
    expect(screen.getByRole('status', { name: 'Loading the records…' })).toBeInTheDocument();
    report('cmsPages_drafts', []);
    expect(recordLinks()).toEqual(['About the event']);
    expect(within(table()).getByRole('link')).toHaveAttribute('href', '/admin/versions/cmsPages/about');
    expect(figure()).toHaveTextContent('1 page, most recently published first.');
  });

  it('reads an unknown or missing collection as content blocks', () => {
    renderPage('/admin/versions?collection=users');
    expect(screen.getByRole('combobox', { name: 'Content type' })).toHaveValue('cmsContent');
    expect(subscribed).toEqual(['cmsContent', 'cmsContent_drafts']);
  });

  it('opens on the collection a shared link names', () => {
    renderPage('/admin/versions?collection=cmsTimeline');
    expect(screen.getByRole('combobox', { name: 'Content type' })).toHaveValue('cmsTimeline');
    expect(subscribed).toEqual(['cmsTimeline', 'cmsTimeline_drafts']);
  });

  it('searches names and ids without regard to case, keeping the search in the URL by replacement', () => {
    renderPage();
    reportContent();
    fireEvent.change(searchField(), { target: { value: 'PARK' } });
    expect(recordLinks()).toEqual(['Where do I park?']);
    expect(location()).toBe('/admin/versions?q=PARK');
    expect(screen.getByTestId('navigation')).toHaveTextContent('REPLACE');
    expect(figure()).toHaveTextContent('1 of 3 content blocks matches “PARK”.');

    // Internal ids are not search labels.
    fireEvent.change(searchField(), { target: { value: 'hero__' } });
    expect(screen.queryByRole('region', { name: 'Records' })).toBeNull();
  });

  it('orders by name from the sort control, in the URL, with aria-sort on the sorted column', () => {
    renderPage();
    reportContent();
    const heads = () => within(table()).getAllByRole('columnheader');
    expect(heads()[3]).toHaveAttribute('aria-sort', 'descending');
    expect(heads()[0]).not.toHaveAttribute('aria-sort');

    fireEvent.change(screen.getByRole('combobox', { name: 'Order records by' }), { target: { value: 'name' } });
    expect(location()).toBe('/admin/versions?sort=name');
    expect(recordLinks()).toEqual(['Hello', 'New', 'Where do I park?']);
    expect(heads()[0]).toHaveAttribute('aria-sort', 'ascending');
    expect(heads()[3]).not.toHaveAttribute('aria-sort');
    expect(figure()).toHaveTextContent('3 content blocks, by name.');
  });

  it('names the search that found nothing, and Clear search clears it and returns to the field', () => {
    renderPage('/admin/versions?q=zzz');
    reportContent();
    expect(screen.getByRole('heading', { name: 'No content blocks match “zzz”' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(location()).toBe('/admin/versions');
    expect(searchField()).toHaveValue('');
    expect(searchField()).toHaveFocus();
    expect(recordLinks()).toHaveLength(3);
  });

  it('clears the search from the Clear button beside the field', () => {
    renderPage('/admin/versions?q=hero');
    reportContent();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(searchField()).toHaveValue('');
    expect(searchField()).toHaveFocus();
  });

  it('says so when a collection holds no records', () => {
    renderPage('/admin/versions?collection=cmsUpdates');
    report('cmsUpdates', []);
    report('cmsUpdates_drafts', []);
    expect(screen.getByRole('heading', { name: 'No current updates' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Records' })).toBeNull();
  });

  it('waits for both listeners before drawing anything', () => {
    renderPage();
    expect(screen.getByRole('status', { name: 'Loading the records…' })).toBeInTheDocument();
    report('cmsContent', CONTENT_LIVE);
    expect(screen.getByRole('status', { name: 'Loading the records…' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Records' })).toBeNull();
    report('cmsContent_drafts', CONTENT_DRAFTS);
    expect(screen.queryByRole('status', { name: 'Loading the records…' })).toBeNull();
    expect(recordLinks()).toHaveLength(3);
  });

  it('keeps the rows when a listener fails after both reported', () => {
    renderPage();
    reportContent();
    fail('cmsContent_drafts');
    expect(screen.getByText('The list did not refresh. The page tries again on its own.')).toBeInTheDocument();
    expect(recordLinks()).toHaveLength(3);
  });

  it('draws no table and no empty state when a listener fails before both reported', () => {
    renderPage();
    report('cmsContent', CONTENT_LIVE);
    fail('cmsContent_drafts');
    expect(screen.getByRole('alert')).toHaveTextContent('The records did not load. The page tries again on its own.');
    expect(screen.queryByRole('region', { name: 'Records' })).toBeNull();
    expect(screen.queryByRole('heading', { name: /No content blocks/ })).toBeNull();
    expect(screen.queryByRole('status', { name: 'Loading the records…' })).toBeNull();
  });
});

describe('removed records', () => {
  it('checks another history page only on request, retains newest names, and searches loaded results without another read', async () => {
    const cursor = 'cmsPages/gone';
    readVersions.mockResolvedValueOnce({ entries: [{ docPath: 'cmsPages/gone', revision: 3, fields: { title: 'Newest name' } }], nextCursor: cursor });
    renderPage('/admin/versions?collection=cmsPages');
    report('cmsPages', []);
    await act(async () => report('cmsPages_drafts', []));
    expect(screen.getByRole('link', { name: 'Newest name' })).toBeInTheDocument();
    expect(screen.getByText(/Search includes the removed records loaded so far/)).toBeInTheDocument();
    expect(readVersions).toHaveBeenCalledTimes(1);
    readVersions.mockResolvedValueOnce({ entries: [
      { docPath: 'cmsPages/gone', revision: 1, fields: { title: 'Old name' } },
      { docPath: 'cmsPages/another', revision: 1, fields: { title: 'Another record' } },
    ], nextCursor: null });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Check more history' })));
    expect(readVersions).toHaveBeenLastCalledWith('cmsPages', cursor);
    expect(screen.getByRole('link', { name: 'Newest name' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Another record' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Old name' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Check more history' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Removed records' })).toHaveFocus();
    fireEvent.change(searchField(), { target: { value: 'Another' } });
    expect(screen.queryByRole('link', { name: 'Newest name' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Another record' })).toBeInTheDocument();
    expect(readVersions).toHaveBeenCalledTimes(2);
  });

  it('retains loaded removed records on a page failure, retries that cursor and drops its answer after a collection change', async () => {
    const cursor = 'cmsPages/gone';
    readVersions.mockResolvedValueOnce({ entries: [{ docPath: 'cmsPages/gone', revision: 1, fields: { title: 'Kept result' } }], nextCursor: cursor });
    renderPage('/admin/versions?collection=cmsPages');
    report('cmsPages', []);
    await act(async () => report('cmsPages_drafts', []));
    readVersions.mockRejectedValueOnce(new Error('Unavailable'));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Check more history' })));
    expect(screen.getByRole('link', { name: 'Kept result' })).toBeInTheDocument();
    let finish;
    readVersions.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled();
    expect(readVersions).toHaveBeenCalledTimes(3);
    readVersions.mockResolvedValueOnce({ entries: [], nextCursor: null });
    fireEvent.change(screen.getByRole('combobox', { name: 'Content type' }), { target: { value: 'cmsUpdates' } });
    report('cmsUpdates', []);
    await act(async () => report('cmsUpdates_drafts', []));
    await act(async () => finish({ entries: [{ docPath: 'cmsPages/stale', revision: 1, fields: { title: 'Stale result' } }], nextCursor: null }));
    expect(screen.queryByRole('link', { name: 'Stale result' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Kept result' })).toBeNull();
  });

  it('renders the current list before history answers, finds a removed record without admin logs, and removes it after draft restoration', async () => {
    let answer;
    readVersions.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    renderPage('/admin/versions?collection=cmsPages');
    expect(readVersions).not.toHaveBeenCalled();
    report('cmsPages', [{ id: 'live', title: 'Current page' }]);
    expect(readVersions).not.toHaveBeenCalled();
    report('cmsPages_drafts', []);
    expect(recordLinks()).toEqual(['Current page']);
    expect(screen.getByRole('status', { name: 'Loading removed records…' })).toBeInTheDocument();
    expect(readVersions).toHaveBeenCalledExactlyOnceWith('cmsPages', null);
    expect(subscribed).toEqual(['cmsPages', 'cmsPages_drafts']);
    await act(async () => answer({ entries: [
      { docPath: 'cmsPages/gone id', revision: 2, fields: { title: 'Newest page name' } },
      { docPath: 'cmsPages/gone id', revision: 1, fields: { title: 'Old page name' } },
      { docPath: 'cmsPages/live', revision: 1, fields: { title: 'Published current' } },
      { docPath: 'cmsSchedule/session', revision: 1, fields: { title: 'Other collection' } },
    ], nextCursor: null }));
    const removed = screen.getByRole('region', { name: 'Removed records' });
    expect(within(removed).getAllByRole('link')).toHaveLength(1);
    expect(within(removed).getByRole('link', { name: 'Newest page name' })).toHaveAttribute('href', '/admin/versions/cmsPages/gone%20id');
    report('cmsPages_drafts', [{ id: 'gone id', title: 'Restored page', status: 'dirty' }]);
    expect(within(removed).queryByRole('link')).toBeNull();
    expect(recordLinks()).toContain('Restored page');
    expect(readVersions).toHaveBeenCalledTimes(1);
  });

  it('drops an old collection answer and keeps current records when the new history read fails', async () => {
    let oldAnswer;
    readVersions.mockReturnValueOnce(new Promise((resolve) => { oldAnswer = resolve; }));
    renderPage();
    reportContent();
    readVersions.mockRejectedValueOnce(new Error('Unavailable'));
    fireEvent.change(screen.getByRole('combobox', { name: 'Content type' }), { target: { value: 'cmsPages' } });
    report('cmsPages', [{ id: 'live', title: 'Current page' }]);
    await act(async () => report('cmsPages_drafts', []));
    expect(screen.getByText('Removed records did not load. Current records remain available.')).toBeInTheDocument();
    await act(async () => oldAnswer({ entries: [{ docPath: 'cmsContent/gone', revision: 1, fields: { value: 'Old collection' } }], nextCursor: null }));
    expect(screen.queryByRole('link', { name: 'Old collection' })).toBeNull();
    expect(recordLinks()).toEqual(['Current page']);
    readVersions.mockResolvedValueOnce({ entries: [], nextCursor: null });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Try again' })));
    expect(screen.getByText(/0 removed records with published versions/)).toBeInTheDocument();
  });
});

describe('figureSentence', () => {
  const choice = { singular: 'timeline entry', plural: 'timeline entries' };
  it('counts in the collection’s own words, one and many', () => {
    expect(figureSentence({ choice, shown: 1, total: 1, query: '', sort: 'published' })).toBe(
      '1 timeline entry, most recently published first.',
    );
    expect(figureSentence({ choice, shown: 0, total: 1200, query: 'x', sort: 'name' })).toBe(
      '0 of 1,200 timeline entries match “x”.',
    );
  });
});
