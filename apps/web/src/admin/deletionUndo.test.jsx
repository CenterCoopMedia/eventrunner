import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, useLocation, useNavigate } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as routeCode from '../lib/routePage.jsx';
import { DeletionUndoProvider, DeletedRecordResult, useDeletedRecord } from './deletionUndo.jsx';

const { call } = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('./adminApi.js', () => ({ useAdminApi: () => call }));

const base = { collection: 'cmsTimeline', docId: 'entry', publishedRevision: 3, editorPath: '/admin/timeline/entry' };
let version;

function Desk({ record, owningPageId }) {
  const reportDeleted = useDeletedRecord();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  return <>
    <button type="button" onClick={() => reportDeleted(record, '/list')}>Return after confirmed delete</button>
    <button type="button" onClick={() => reportDeleted(record)}>Delete here</button>
    <Link to="/other">Another page</Link>
    <Link to="/list?sort=name">Change list order</Link>
    <button type="button" onClick={() => navigate(-1)}>Back</button>
    {pathname === '/list' ? <DeletedRecordResult owningPageId={owningPageId} /> : null}
    <DeletedRecordResult docId={record.docId} owningPageId={owningPageId} fallback={<span>Existing row receipt</span>} />
  </>;
}

function open(record = base, owningPageId = null) {
  render(<MemoryRouter initialEntries={['/editor']}><DeletionUndoProvider><Desk record={record} owningPageId={owningPageId} /></DeletionUndoProvider></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'Return after confirmed delete' }));
}

beforeEach(() => {
  version = { revision: 3, fields: { year: 2020, title: 'Last published', description: 'Saved description' }, visible: true };
  call.mockReset();
  call.mockImplementation(async (endpoint) => endpoint === 'cmsGetVersionHistory' ? { entries: [version] } : { status: 'dirty' });
});

describe('the result after a published delete', () => {
  it.each([
    ['cmsPages', 'page', { label: 'Published page', path: '/page', systemPage: false, sections: [] }, false, 'cmsSavePage', { page: { label: 'Published page', path: '/page', systemPage: false, sections: [], id: 'page', visible: false }, create: true }],
    ['cmsUpdates', 'update', { title: 'Published update', body: 'Published text', publishAt: null, pinned: false }, true, 'cmsSaveUpdate', { id: 'update', update: { title: 'Published update', body: 'Published text', publishAt: null, pinned: false }, visible: true, restore: true }],
    ['cmsSchedule', 'session', { title: 'Published session', dayId: 'day-1', startTime: '09:00', endTime: '10:00' }, true, 'cmsCreateContent', { collection: 'cmsSchedule', docId: 'session', fields: { title: 'Published session', dayId: 'day-1', startTime: '09:00', endTime: '10:00' }, visible: true }],
    ['cmsOrganizations', 'org', { name: 'Published organization', order: 2 }, true, 'cmsCreateContent', { collection: 'cmsOrganizations', docId: 'org', fields: { name: 'Published organization', order: 2 }, visible: true }],
    ['cmsTimeline', 'entry', { year: 2020, title: 'Last published', description: 'Saved description' }, true, 'cmsCreateContent', { collection: 'cmsTimeline', docId: 'entry', fields: { year: 2020, title: 'Last published', description: 'Saved description' }, visible: true }],
    ['cmsContent', 'hero__title', { section: 'hero', field: 'title', blockType: 'text', value: 'Published block' }, true, 'cmsCreateContent', { collection: 'cmsContent', section: 'hero', field: 'title', pageId: 'home', fields: { section: 'hero', field: 'title', blockType: 'text', value: 'Published block' }, visible: true }],
  ])('restores the pinned %s version as a draft through its existing endpoint', async (collection, docId, fields, visible, endpoint, body) => {
    version = { revision: 3, fields, visible };
    const editorPath = `/admin/record/${encodeURIComponent(docId)}`;
    open({ ...base, collection, docId, editorPath, pageId: 'home', removedMaterials: 0, removedRepresentatives: 0, removedQueuedEdit: false }, 'home');
    const undo = await screen.findByRole('button', { name: 'Undo' });
    expect(undo).toHaveFocus();
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(call).not.toHaveBeenCalled();
    fireEvent.click(undo);
    const link = await screen.findByRole('link', { name: 'Open draft' });
    expect(call).toHaveBeenNthCalledWith(1, 'cmsGetVersionHistory', { docPath: `${collection}/${docId}`, limit: 1, cursor: 4 });
    expect(call).toHaveBeenNthCalledWith(2, endpoint, body);
    expect(link).toHaveAttribute('href', editorPath);
    expect(link).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('is back as a draft. Publish it to show it on the site.');
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('states busy work and prevents another press while restoration is pending', async () => {
    let finish;
    call.mockImplementation(async (endpoint) => endpoint === 'cmsGetVersionHistory' ? { entries: [version] } : new Promise((resolve) => { finish = resolve; }));
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    const busy = await screen.findByRole('button', { name: 'Restoring…' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    await waitFor(() => expect(call).toHaveBeenCalledTimes(2));
    fireEvent.click(busy);
    expect(call).toHaveBeenCalledTimes(2);
    await act(async () => finish({ status: 'dirty' }));
    expect(await screen.findByRole('link', { name: 'Open draft' })).toHaveFocus();
  });

  it.each([
    ['never published', { publishedRevision: null }, null],
    ['materials', { collection: 'cmsSchedule', removedMaterials: 2 }, null],
    ['representatives', { collection: 'cmsOrganizations', removedRepresentatives: 1, removedQueuedEdit: false }, null],
    ['queued edit', { collection: 'cmsOrganizations', removedRepresentatives: 0, removedQueuedEdit: true }, null],
    ['unknown material result', { collection: 'cmsSchedule' }, null],
    ['missing section', { collection: 'cmsContent', docId: 'hero__title', pageId: 'home' }, null],
    ['section left its page', { collection: 'cmsContent', docId: 'hero__title', pageId: 'home' }, 'another-page'],
  ])('offers no Undo for %s', async (_case, fields, owner) => {
    open({ ...base, ...fields }, owner);
    expect(await screen.findByRole('status')).toHaveTextContent('deleted.');
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(call).not.toHaveBeenCalled();
  });

  it('states a failed Undo reason and links to its history without losing the result', async () => {
    call.mockImplementation(async (endpoint) => {
      if (endpoint === 'cmsGetVersionHistory') return { entries: [version] };
      throw new Error('A named speaker no longer exists.');
    });
    open({ ...base, docId: 'record?day#2', editorPath: '/admin/timeline/record%3Fday%232' });
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    const link = await screen.findByRole('link', { name: 'View version history' });
    expect(link).toHaveAttribute('href', '/admin/versions/cmsTimeline/record%3Fday%232');
    expect(screen.getByRole('status')).toHaveTextContent('Undo did not finish. A named speaker no longer exists.');
    expect(screen.queryByRole('link', { name: 'Open draft' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
  });

  it.each([2, 4])('does not restore a different history revision (%s)', async (revision) => {
    version.revision = revision;
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await screen.findByRole('link', { name: 'View version history' });
    expect(call).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('That published version is not available.');
  });

  it('keeps a failed helper import local and states a recovery action', async () => {
    vi.spyOn(routeCode, 'routePage').mockReturnValueOnce({ prefetch: async () => undefined });
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await screen.findByRole('link', { name: 'View version history' });
    expect(screen.getByRole('status')).toHaveTextContent('The restore controls could not load.');
    expect(call).not.toHaveBeenCalled();
  });

  it.each(['Another page', 'Change list order'])('clears on %s and does not return on Back', async (destination) => {
    open();
    await screen.findByRole('button', { name: 'Undo' });
    fireEvent.click(screen.getByRole('link', { name: destination }));
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Return after confirmed delete' }));
    expect(await screen.findByRole('button', { name: 'Undo' })).toHaveFocus();
  });

  it('keeps inline Undo on its row without navigation, then expires it on navigation and Back', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Delete here' }));
    expect(screen.getAllByRole('button', { name: 'Undo' })).toHaveLength(1);
    expect(screen.queryByText('Existing row receipt')).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'Another page' }));
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(screen.getByText('Existing row receipt')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });
});
