import { beforeEach, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
const getDocs = vi.fn();
const onSnapshot = vi.fn();
vi.mock('../firebase.js', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: (_db, name) => ({ name }),
  doc: vi.fn(), onSnapshot: (...args) => onSnapshot(...args),
  where: (...args) => ({ kind: 'where', args }),
  orderBy: (...args) => ({ kind: 'orderBy', args }),
  startAfter: (cursor) => ({ kind: 'cursor', cursor }),
  limit: (count) => ({ kind: 'limit', count }),
  query: (source, ...constraints) => ({ source, constraints }),
  getDocs: (...args) => getDocs(...args),
}));
import { readAdminVersions, subscribeAdminCollection } from './adminSource.js';
import { useAdminContent } from './useAdminContent.js';

beforeEach(() => {
  getDocs.mockReset();
  onSnapshot.mockReset();
});

it('keeps cache delivery for other readers while content waits for both server revisions', () => {
  const listeners = new Map();
  onSnapshot.mockImplementation((source, options, next) => {
    expect(options).toEqual({ includeMetadataChanges: true });
    listeners.set(source.name, next);
    return vi.fn();
  });
  const pages = vi.fn();
  const stopPages = subscribeAdminCollection('cmsPages', pages);
  const { result, unmount } = renderHook(() => useAdminContent());
  const deliver = (collection, rows, fromCache) => listeners.get(collection)({
    docs: rows.map(({ id, ...data }) => ({ id, data: () => data })),
    metadata: { fromCache },
  });
  const live = { id: 'hero__title', section: 'hero', field: 'title', value: 'Published' };
  const draft = { ...live, value: 'Unpublished', status: 'dirty' };
  act(() => {
    deliver('cmsPages', [{ id: 'home' }], true);
    deliver('cmsContent', [live], true);
    deliver('cmsContent_drafts', [], true);
  });
  expect(pages).toHaveBeenCalledWith([{ id: 'home' }], { fromCache: true });
  expect(result.current.ready).toBe(false);
  act(() => deliver('cmsContent', [live], false));
  expect(result.current.ready).toBe(false);
  act(() => deliver('cmsContent_drafts', [draft], false));
  expect(result.current.ready).toBe(true);
  expect(result.current.rows[0].current).toEqual(draft);
  act(() => deliver('cmsContent_drafts', [], true));
  expect(result.current.rows[0].current).toEqual(draft);
  unmount();
  stopPages();
});

it('bounds a collection history read and carries the record cursor into the next query', async () => {
  const cursor = 'cmsPages/previous';
  getDocs.mockResolvedValue({ docs: [{ data: () => ({ docPath: 'cmsPages/one', revision: 1 }) }] });
  const page = await readAdminVersions('cmsPages', cursor);
  const request = getDocs.mock.calls[0][0];
  expect(request.source.name).toBe('cmsVersionHistory');
  const bound = request.constraints.find((item) => item.kind === 'limit');
  // The existing history endpoint permits at most 100 versions plus one
  // lookahead. A collection listing must never become an unbounded read.
  expect(bound.count).toBeGreaterThan(0);
  expect(bound.count).toBeLessThanOrEqual(101);
  expect(request.constraints).toContainEqual({ kind: 'cursor', cursor });
  expect(page).toEqual({ entries: [{ docPath: 'cmsPages/one', revision: 1 }], nextCursor: null });
});
