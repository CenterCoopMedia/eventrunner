import { beforeEach, expect, it, vi } from 'vitest';
const getDocs = vi.fn();
vi.mock('../firebase.js', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: (_db, name) => ({ name }),
  doc: vi.fn(), onSnapshot: vi.fn(),
  where: (...args) => ({ kind: 'where', args }),
  orderBy: (...args) => ({ kind: 'orderBy', args }),
  startAfter: (cursor) => ({ kind: 'cursor', cursor }),
  limit: (count) => ({ kind: 'limit', count }),
  query: (source, ...constraints) => ({ source, constraints }),
  getDocs: (...args) => getDocs(...args),
}));
import { readAdminVersions } from './adminSource.js';

beforeEach(() => getDocs.mockReset());

it('bounds a collection history read and carries the document cursor into the next query', async () => {
  const cursor = { id: 'previous' };
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
