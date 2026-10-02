import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listeners = new Map();

vi.mock('./adminSource.js', () => ({
  subscribeAdminCollection: (name, onNext, onError) => {
    listeners.set(name, { onNext, onError });
    return () => listeners.delete(name);
  },
}));

vi.mock('../contexts/EventConfigContext.jsx', () => ({
  useEventConfig: () => ({ eventConfig: { days: [], timezone: 'UTC' } }),
}));

import { useAdminContent } from './useAdminContent.js';
import { useAdminOrganizations } from './useAdminOrganizations.js';
import { useAdminPages } from './useAdminPages.js';
import { useAdminSessions } from './useAdminSessions.js';
import { useAdminUpdates } from './useAdminUpdates.js';

const cases = [
  ['content', 'cmsContent', () => useAdminContent()],
  ['organizations', 'cmsOrganizations', () => useAdminOrganizations()],
  ['pages', 'cmsPages', () => useAdminPages()],
  ['sessions', 'cmsSchedule', () => useAdminSessions()],
  ['updates', 'cmsUpdates', () => useAdminUpdates()],
];

beforeEach(() => {
  listeners.clear();
});

describe('admin live and draft listeners', () => {
  it.each(cases)(
    'keeps the %s drafts error while the live listener delivers',
    (_label, collection, useCollection) => {
      const { result } = renderHook(useCollection);
      const failure = new Error('draft stream unavailable');

      act(() => listeners.get(`${collection}_drafts`).onError(failure));
      act(() => listeners.get(collection).onNext([]));

      expect(result.current.error).toBe(failure);
      expect(result.current.loading).toBe(false);

      act(() => listeners.get(`${collection}_drafts`).onNext([]));
      expect(result.current.error).toBe(null);
    },
  );
});
