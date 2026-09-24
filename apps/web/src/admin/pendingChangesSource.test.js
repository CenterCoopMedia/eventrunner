// The unpublished changes seams (issue #196): the dirty drafts the shell
// counts, and the publish runs the page lists. src/test/setup.js mocks both
// modules for every test file; here the real modules run over setup's
// firebase/firestore stand-ins, which record the query each read builds.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onSnapshot } from 'firebase/firestore';

vi.unmock('./pendingChangesSource.js');
vi.unmock('./publishRunsSource.js');

const drafts = await import('./pendingChangesSource.js');
const runs = await import('./publishRunsSource.js');
const source = { ...drafts, ...runs };

beforeEach(() => {
  vi.mocked(onSnapshot).mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});

/** The query and callbacks of the last listener attached. */
function lastListener() {
  const [ref, onNext, onError] = vi.mocked(onSnapshot).mock.calls.at(-1);
  return { ref, onNext, onError };
}

const snapshotOf = (docs) => ({
  docs: docs.map(({ id, ...data }) => ({ id, data: () => data })),
});

describe('the unpublished changes reads', () => {
  it('keeps the publish run reads out of the module the shell loads', () => {
    expect(Object.keys(drafts).sort()).toEqual(['listenWithRetry', 'subscribeDirtyDrafts']);
    expect(Object.keys(runs).sort()).toEqual(['subscribeFailedPublishRuns', 'subscribeRecentPublishRuns']);
  });

  it('reads the dirty drafts of one collection with the listDirty predicate', () => {
    const onNext = vi.fn();
    source.subscribeDirtyDrafts('cmsContent', onNext);
    const { ref, onNext: deliver } = lastListener();
    expect(ref.ref.path).toBe('cmsContent_drafts');
    expect(ref.clauses).toEqual([{ where: ['status', '==', 'dirty'] }]);
    deliver(snapshotOf([{ id: 'hero__subtitle', status: 'dirty', value: 'x' }]));
    expect(onNext).toHaveBeenCalledWith([{ id: 'hero__subtitle', status: 'dirty', value: 'x' }]);
  });

  it('reads the most recent publish runs, newest first', () => {
    source.subscribeRecentPublishRuns(10, vi.fn());
    const { ref } = lastListener();
    expect(ref.ref.path).toBe('cmsPublishQueue');
    expect(ref.clauses).toEqual([{ orderBy: ['requestedAt', 'desc'] }, { limit: 10 }]);
  });

  it('reads the newest runs still marked failed, newest first', () => {
    source.subscribeFailedPublishRuns(20, vi.fn());
    const { ref } = lastListener();
    expect(ref.ref.path).toBe('cmsPublishQueue');
    expect(ref.clauses).toEqual([
      { where: ['status', '==', 'failed'] },
      { orderBy: ['requestedAt', 'desc'] },
      { limit: 20 },
    ]);
  });

  it('has the composite index the failed read needs declared for deploy', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const declared = JSON.parse(readFileSync(path.join(here, '..', '..', '..', '..', 'firestore.indexes.json'), 'utf8'));
    const shapes = declared.indexes
      .filter((index) => index.collectionGroup === 'cmsPublishQueue' && index.queryScope === 'COLLECTION')
      .map((index) => index.fields.map((field) => `${field.fieldPath} ${field.order}`).join(', '));
    expect(shapes).toContain('status ASCENDING, requestedAt DESCENDING');
  });

  it('reports an error, keeps quiet otherwise, and attaches a fresh listener later', () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const unsubscribe = source.subscribeDirtyDrafts('cmsPages', vi.fn(), onError);
    const attached = vi.mocked(onSnapshot).mock.calls.length;
    const failure = Object.assign(new Error('denied'), { code: 'permission-denied' });
    lastListener().onError(failure);
    expect(onError).toHaveBeenCalledWith(failure);
    vi.advanceTimersByTime(15_000);
    expect(vi.mocked(onSnapshot).mock.calls.length).toBe(attached + 1);
    expect(lastListener().ref.ref.path).toBe('cmsPages_drafts');
    unsubscribe();
  });
});
