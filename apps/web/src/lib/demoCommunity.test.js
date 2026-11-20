import { describe, expect, it, vi } from 'vitest';

vi.mock('./demoMode.js', () => ({ IS_DEMO: true }));
vi.mock('../firebase.js', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(), doc: vi.fn(), getDoc: vi.fn(), onSnapshot: vi.fn(),
  query: vi.fn(), serverTimestamp: vi.fn(), updateDoc: vi.fn(), where: vi.fn(),
}));

import { collection, doc, getDoc, onSnapshot } from 'firebase/firestore';
import { subscribeContentCollection } from './contentSource.js';
import { subscribeDirectory, fetchPublicProfile } from './profileSource.js';

describe('static demo community data', () => {
  it('loads local announcements on demand without a Firestore listener', async () => {
    const cancelled = vi.fn();
    const cancel = subscribeContentCollection('cmsUpdates', 'published', cancelled);
    cancel();
    const next = vi.fn();
    const unsubscribe = subscribeContentCollection('cmsUpdates', 'published', next);
    expect(next).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
    expect(cancelled).not.toHaveBeenCalled();
    const updates = next.mock.calls[0][0];
    expect(updates).toHaveLength(1);
    for (const update of updates) {
      expect(update.visible).toBe(true);
      expect(update.publishAt).toBe('2026-04-01T12:00:00.000Z');
      expect(update.body).toContain('Demo-authored historical note');
    }
    expect(collection).not.toHaveBeenCalled();
    expect(onSnapshot).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('returns no historical attendee directory or profile reads', async () => {
    const next = vi.fn();
    const unsubscribe = subscribeDirectory({ includeAttendeesOnly: false }, next);
    const profiles = next.mock.calls[0][0];
    expect(profiles).toEqual([]);
    expect(await fetchPublicProfile('not-a-demo-profile')).toBeNull();
    expect(doc).not.toHaveBeenCalled();
    expect(getDoc).not.toHaveBeenCalled();
    expect(onSnapshot).not.toHaveBeenCalled();
    unsubscribe();
  });
});
