// The approved-materials list (and count) for one session (issue #23,
// spec §4.4). One listener per mount over `session_materials_public`,
// shared by SessionCard's MaterialsPill (count only) and SessionDetail's
// materials list (the full rows) — same "shared subscription hook" shape
// as useMyBookmarks.js.
import { useEffect, useState } from 'react';
import { subscribeSessionMaterials } from '../lib/materialsSource.js';

/**
 * @param {string|undefined} sessionId
 * @returns {{ materials: Array<{id: string, sessionId: string, type: string,
 *   filename: string, reviewStatus: string}>, loading: boolean }}
 */
export function useSessionMaterials(sessionId) {
  const [materials, setMaterials] = useState([]);
  const [loading, setLoading] = useState(Boolean(sessionId));

  useEffect(() => {
    // Clear immediately on a sessionId change (same class of bug the
    // reactions hook fixes): without this, switching from session A to B
    // keeps rendering A's rows until B's first snapshot arrives — usually
    // instant off the shared listener's in-memory grouping
    // (materialsSource.js), but not guaranteed. Fail-soft retention
    // (subscribeSessionMaterials keeping last-known values on a listener
    // error) still applies AFTER this reset, so it only ever retains data
    // for the CURRENT session, never a stale previous one.
    setMaterials([]);
    setLoading(Boolean(sessionId));
    const unsubscribe = subscribeSessionMaterials(
      sessionId,
      (rows) => {
        setMaterials(rows);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsubscribe;
  }, [sessionId]);

  return { materials, loading };
}

/**
 * Materials count for a session, or null when there are none — the shape
 * SessionCard's MaterialsPill (`if (!count) return null`) expects. This is
 * the live replacement for SessionCard.jsx's TODO-stubbed
 * useSessionMaterialsCount.
 *
 * @param {{ id?: string }} [session]
 * @returns {number|null}
 */
export function useSessionMaterialsCount(session) {
  const { materials } = useSessionMaterials(session?.id);
  return materials.length > 0 ? materials.length : null;
}
