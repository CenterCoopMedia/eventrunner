import { useCallback, useEffect, useState } from 'react';
import { callApi } from '../api.js';

/**
 * The team of one organization, and a way to change it. The Team page
 * and the team step of the guided setup both use it.
 *
 * `change(name, body, done)` runs one call, shows `done` as the notice,
 * reloads the team, and returns true when the call worked.
 */
export function useTeam(orgId) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await callApi('getTeam', { orgId }));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  const change = useCallback(async (name, body, done) => {
    setNotice('');
    setError('');
    try {
      await callApi(name, { orgId, ...body });
      setNotice(done);
      await load();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  }, [orgId, load]);

  return { data, error, notice, change };
}
