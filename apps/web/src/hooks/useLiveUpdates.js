// The public live-updates feed (issue #28, spec §9 "Live updates card").
// One listener per mount and audience list; `loading` covers only the brief
// window before the first snapshot arrives — a listener error leaves
// `updates` at its last-known value rather than blanking the card (fail
// soft).
//
// The audience list (issue #200) comes from the reader's own account, the
// same document firestore.rules read. When it changes (sign-in, sign-out,
// an approval) the hook listens again with the new list and drops the rows
// it held, so a reader who signs out does not keep rows meant for speakers.
import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useProfile } from '../contexts/ProfileContext.jsx';
import { readableAudiences, subscribeLiveUpdates } from '../lib/liveUpdatesSource.js';

/**
 * @returns {{ updates: Array<object>, loading: boolean }}
 */
export function useLiveUpdates() {
  const { user, isAdmin } = useAuth();
  const { profile } = useProfile();
  const key = readableAudiences({ signedIn: Boolean(user), profile, isAdmin }).join(',');
  // The rows are kept with the list they were read for, so rows from an
  // earlier list are never shown under a later one.
  const [snapshot, setSnapshot] = useState({ key: null, docs: [] });

  useEffect(() => {
    return subscribeLiveUpdates(key.split(','), (docs) => setSnapshot({ key, docs }));
  }, [key]);

  const current = snapshot.key === key;
  return { updates: current ? snapshot.docs : [], loading: !current };
}
