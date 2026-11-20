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

  // Reads land in the order they started: the first answer shows at once,
  // and an older read that answers after a newer one has landed returns
  // null, so its caller leaves the state to the newer read.
  const reads = useRef({ started: 0, landed: 0 });
  const refreshes = useRef(0);
  const load = useCallback(async () => {
    const attempt = ++reads.current.started;
    try {
      const body = await callApi('getTeam', { orgId });
      if (attempt < reads.current.landed) return null;
      reads.current.landed = attempt;
      setData(body);
      setError('');
      setStale(false);
      return '';
    } catch (err) {
      if (attempt < reads.current.landed) return null;
      setError(err.message);
      return err.message;
    }
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  const refresh = useCallback(async () => {
    refreshes.current += 1;
    setRefreshing(true);
    const problem = await load();
    refreshes.current -= 1;
    setRefreshing(refreshes.current > 0);
    if (problem === null) return;
    setOutcome((current) => current ? { ...current, refreshError: problem ? `We could not refresh the team. ${problem}` : '' } : current);
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
      if (problem !== null) setStale(Boolean(problem));
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
