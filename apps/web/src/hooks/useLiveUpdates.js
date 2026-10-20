// The public live-updates feed (issue #28, spec §9 "Live updates card").
// One listener per mount, account and audience list; `loading` covers only
// the brief window before the first snapshot arrives — a listener error
// leaves `updates` at its last-known value rather than blanking the card
// (fail soft).
//
// The audience list (issue #200) comes from the reader's own account, the
// same document firestore.rules read. The listener and the rows it holds
// are keyed by the signed-in uid AND that list. When either changes
// (sign-in, sign-out, a direct switch to another account, an approval) the
// hook listens again and drops the rows it held, so rows read for one
// account are never shown to the next.
//
// The profile only widens the list when it is the signed-in account's own
// document (profile.id is the users/{uid} doc id). On a direct account
// switch the profile context still holds the previous account's document
// until its own listener reports; until then the new account asks for
// `everyone` only. A wider list than the rules allow would fail the query,
// not leak a row, but it would also leave the card empty for no reason.
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
  const uid = user?.uid ?? null;
  const ownProfile = uid !== null && profile?.id === uid ? profile : null;
  const audiences = readableAudiences({ signedIn: uid !== null, profile: ownProfile, isAdmin: uid !== null && isAdmin });
  const audienceKey = audiences.join(',');
  const key = `${uid ?? ''}|${audienceKey}`;
  // The rows are kept with the key they were read for, so rows from an
  // earlier account or list are never shown under a later one.
  const [snapshot, setSnapshot] = useState({ key: null, docs: [] });

  useEffect(() => {
    return subscribeLiveUpdates(audienceKey.split(','), (docs) => setSnapshot({ key, docs }));
  }, [key, audienceKey]);

  const current = snapshot.key === key;
  return { updates: current ? snapshot.docs : [], loading: !current };
}
