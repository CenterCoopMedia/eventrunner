import { useCallback, useEffect, useRef, useState } from 'react';
import { readAdminVersions } from './adminSource.js';

// History is independent of the live/draft listeners. Paging cannot hold up
// their list, and a late answer cannot enter another collection's results.
export function useAdminVersions(collection, enabled) {
  const [stored, setStored] = useState(null);
  const requestRef = useRef(null);
  const own = stored?.collection === collection ? stored : null;

  const load = useCallback(async (cursor = null) => {
    if (requestRef.current) return;
    const request = {};
    requestRef.current = request;
    setStored((current) => ({
      collection, entries: cursor ? current.entries : null, nextCursor: cursor,
      loading: true, error: null,
    }));
    try {
      const page = await readAdminVersions(collection, cursor);
      if (requestRef.current !== request) return;
      setStored((current) => ({
        collection, entries: [...(current.entries ?? []), ...page.entries],
        nextCursor: page.nextCursor, loading: false, error: null,
      }));
      return true;
    } catch (error) {
      if (requestRef.current === request) setStored((current) => ({ ...current, loading: false, error }));
    } finally {
      if (requestRef.current === request) requestRef.current = null;
    }
  }, [collection]);

  useEffect(() => {
    if (!enabled) return undefined;
    load();
    return () => { requestRef.current = null; };
  }, [enabled, load]);

  return { ...own, loadMore: () => load(own?.nextCursor ?? null) };
}
