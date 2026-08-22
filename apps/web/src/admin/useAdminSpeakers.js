// Live `speakers` for the admin area.
//
// One subscription, not two: unlike cmsPages, speakers are NOT under the
// two-revision publish model (spec §4.3). There is one canonical record per
// speaker with a pipeline `status`; the public surface is the
// `speakers_public` projection the onSpeakerWritten trigger maintains, and
// nothing in the admin UI reads or writes that projection.
//
// firestore.rules allows an admin to read `speakers` (and nobody else — the
// record carries email, uid, and inviteToken). A non-admin's listener simply
// errors, which is the fail-soft path below: `error` is set for a
// non-blocking notice and the last known rows keep rendering.
import { useEffect, useMemo, useState } from 'react';
import { speakerDisplayName } from 'shared/speaker';
import { subscribeAdminCollection } from './adminSource.js';

export function useAdminSpeakers() {
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    return subscribeAdminCollection(
      'speakers',
      (rows) => {
        setDocs(rows);
        setError(null);
      },
      setError,
    );
  }, []);

  const speakers = useMemo(() => {
    const rows = (docs ?? []).map((doc) => ({ ...doc, displayName: speakerDisplayName(doc) }));
    // Sorted by the rendered name, which is what an admin scans for — the
    // document id is derived from the slug and is not what they remember.
    return rows.sort((a, b) => a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id));
  }, [docs]);

  return {
    speakers,
    loading: docs === null && !error,
    error,
    findSpeaker: (id) => speakers.find((speaker) => speaker.id === id) ?? null,
  };
}
