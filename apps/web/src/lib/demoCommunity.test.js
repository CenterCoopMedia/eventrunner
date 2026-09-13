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
  it('returns local announcements without a Firestore listener', () => {
    const next = vi.fn();
    const unsubscribe = subscribeContentCollection('cmsUpdates', 'published', next);
    const updates = next.mock.calls[0][0];
    expect(updates).toHaveLength(4);
    for (const update of updates) {
      expect(update.visible).toBe(true);
      expect(update.publishAt).toMatch(/^2026-09-/);
    }
    expect(collection).not.toHaveBeenCalled();
    expect(onSnapshot).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('returns fictional directory rows and details without public profile reads', async () => {
    const next = vi.fn();
    const unsubscribe = subscribeDirectory({ includeAttendeesOnly: false }, next);
    const profiles = next.mock.calls[0][0];
    expect(profiles.length).toBeGreaterThanOrEqual(3);
    for (const profile of profiles) {
      expect(profile.profileVisibility).toBe('public');
      expect(profile.id).toMatch(/^demo-attendee-/);
      expect(profile).not.toHaveProperty('email');
      expect(profile).not.toHaveProperty('uid');
      expect(await fetchPublicProfile(profile.id)).toEqual(profile);
    }
    expect(await fetchPublicProfile('not-a-demo-profile')).toBeNull();
    expect(doc).not.toHaveBeenCalled();
    expect(getDoc).not.toHaveBeenCalled();
    expect(onSnapshot).not.toHaveBeenCalled();
    unsubscribe();
  });
});
