import { useCallback, useEffect, useRef, useState } from 'react';
import { callApi } from '../api.js';

/** Keep a completed mutation separate from a failed, safely repeatable read. */
export function useTeam(orgId) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState(null);
  const [pending, setPending] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [stale, setStale] = useState(false);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    try {
      setData(await callApi('getTeam', { orgId }));
      setError('');
      setStale(false);
      return '';
    } catch (err) {
      setError(err.message);
      return err.message;
    }
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const problem = await load();
    setOutcome((current) => current ? { ...current, refreshError: problem ? `We could not refresh the team. ${problem}` : '' } : current);
    setRefreshing(false);
  }, [load]);

  const change = useCallback(async (name, body, message) => {
    if (inFlight.current || stale) return false;
    const key = body.uid || 'invite';
    inFlight.current = true;
    setPending(key);
    setOutcome(null);
    try {
      await callApi(name, { orgId, ...body });
      const problem = await load();
      setStale(Boolean(problem));
      setOutcome({ key, kind: 'success', message, refreshError: problem ? `The change is saved, but we could not refresh the team. ${problem}` : '' });
      return true;
    } catch (err) {
      setOutcome({ key, kind: 'error', message: err.message });
      return false;
    } finally {
      inFlight.current = false;
      setPending('');
    }
  }, [orgId, load, stale]);

  return { data, error, outcome, pending, stale, refreshing, change, refresh };
}
