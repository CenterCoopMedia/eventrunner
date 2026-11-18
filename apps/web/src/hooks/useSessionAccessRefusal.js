import { useEffect, useState } from 'react';
import { functionsOrigin } from '../lib/firebaseSettings.js';
import { RETRY_DELAY_MS } from '../lib/retrySubscription.js';
import { ticketAccessState } from '../lib/ticketAccess.js';

/** Refresh visible ticket feedback without replaying a bookmark or reaction. */
export function useSessionAccessRefusal(user, sessionId, attendeeAccess, interactions = false) {
  const [refusal, setRefusal] = useState(null);
  const uid = user?.uid;
  const current = attendeeAccess && refusal?.uid === uid && refusal?.sessionId === sessionId ? refusal : null;

  useEffect(() => setRefusal(null), [uid, sessionId, attendeeAccess]);

  useEffect(() => {
    if (!current) return undefined;
    const controller = new AbortController();
    let timer = setTimeout(check, RETRY_DELAY_MS);

    async function check() {
      if (globalThis.document.hidden) {
        timer = setTimeout(check, RETRY_DELAY_MS);
        return;
      }
      try {
        const token = await user.getIdToken();
        const response = await fetch(`${functionsOrigin()}/checkSessionAccess`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, interactions }),
          signal: controller.signal,
        });
        const result = await response.json();
        const allowed = response.ok && result?.ok === true;
        const state = response.status === 403 ? ticketAccessState(result?.error?.code) : null;
        if (!controller.signal.aborted && (allowed || (state && state !== current.state))) {
          setRefusal((latest) => latest === current ? (state ? { ...current, state } : null) : latest);
          return;
        }
      } catch {
        // Keep the last confirmed refusal when the check cannot reach the server.
      }
      if (!controller.signal.aborted) timer = setTimeout(check, RETRY_DELAY_MS);
    }

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [current, interactions, sessionId, user]);

  return [current?.state ?? null, setRefusal];
}
