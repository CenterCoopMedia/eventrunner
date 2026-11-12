import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useProfile } from '../../contexts/ProfileContext.jsx';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { useDeviceBookmarks } from '../../hooks/useDeviceBookmarks.js';
import { readBookmarkImportVisibility, setSessionBookmarked } from '../../lib/bookmarksSource.js';
import { getDeviceBookmarks, removeDeviceBookmarks, setDeviceMergePending } from '../../lib/deviceBookmarks.js';
import { quietActionClass } from '../controlClasses.js';

// Account changes or a remount may arrive while a request is in flight.
// Let that request settle before starting another import in this tab.
let importJob = Promise.resolve();
function enqueueImport(run) {
  const next = importJob.then(run);
  importJob = next.catch(() => {});
  return next;
}

export default function DeviceScheduleMerge() {
  const { user } = useAuth();
  const { attendeeAccess, profileConfirmed } = useProfile();
  const { features } = useEventConfig();
  const device = useDeviceBookmarks();
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const keepForUid = useRef(null);
  const failedForUid = useRef(null);
  const uid = user?.uid;
  const eligible = Boolean(uid && attendeeAccess && profileConfirmed
    && features.schedule && features.sessionBookmarks && device.available && device.ids.length);

  useEffect(() => {
    if (!eligible) return undefined;
    let current = true;
    const ids = device.ids;
    setPlan(null);
    if (failedForUid.current !== uid) setError('');

    async function run(visibility) {
      await enqueueImport(async () => {
        if (!current) return;
        setError('');
        setDeviceMergePending(ids);
        const completed = [];
        try {
          for (const sessionId of ids) {
            if (!current) break;
            if (!getDeviceBookmarks().ids.includes(sessionId)) continue;
            try {
              await setSessionBookmarked({ user, sessionId, bookmarked: true,
                expectedScheduleVisibility: visibility });
              completed.push(sessionId);
            } catch (err) {
              if (err.code === 'session-unavailable') completed.push(sessionId);
              else throw err;
            }
          }
        } catch (err) {
          if (current) {
            failedForUid.current = uid;
            setError(err.message || 'Your browser saves could not be added. They are still here. Try again.');
            if (err.status === 409) setRefresh((value) => value + 1);
          }
        } finally {
          setDeviceMergePending([]);
          // A failed or cancelled request retains its id. A successful
          // request can be removed even if the account changed meanwhile.
          if (completed.length) removeDeviceBookmarks(completed);
        }
      });
    }

    readBookmarkImportVisibility(uid).then((visibility) => {
      if (!current) return;
      setPlan({ uid, ids, visibility, run: () => run(visibility) });
      if (visibility === 'private' && keepForUid.current !== uid && failedForUid.current !== uid) {
        void run(visibility);
      }
    }).catch(() => {
      if (current) setError('Your schedule visibility could not be checked. Your browser saves are still here. Check your connection and try again.');
    });
    return () => { current = false; };
  }, [eligible, uid, user, device.ids, refresh]);

  if (!eligible) return null;
  const ready = plan?.uid === uid && plan.ids === device.ids;
  const saving = device.merging.length > 0;
  const count = device.ids.length;
  const sessions = `${count} ${count === 1 ? 'session' : 'sessions'}`;
  return (
    <section aria-label="Browser-saved sessions" className="mb-md border-b-hairline border-rule-hairline pb-md">
      <p className="max-w-prose text-body text-text-primary">
        {sessions} {count === 1 ? 'is' : 'are'} saved in this browser.
        {ready && plan.visibility === 'public' ? ` Adding ${sessions} to your account makes ${count === 1 ? 'it' : 'them'} visible to anyone with your schedule link.`
          : ready && plan.visibility === 'attendees_only' ? ` Adding ${sessions} to your account makes ${count === 1 ? 'it' : 'them'} visible to signed-in attendees with access.`
            : ready ? ' Your account schedule is private.'
              : keepForUid.current === uid ? ' They have not been added to your account.'
                : ' Checking your account schedule’s visibility…'}
      </p>
      <Link to="/schedule/mine" className={`${quietActionClass} mt-xs`}>Review browser saves</Link>
      {ready ? (
        <div className="mt-xs flex flex-wrap gap-xs">
          <button type="button" className={quietActionClass} aria-disabled={saving || undefined}
            aria-busy={saving || undefined} onClick={() => { if (!saving) void plan.run(); }}>
            {saving ? 'Adding your browser saves…' : plan.visibility === 'private'
              ? 'Add to my account' : 'Add and share these sessions'}
          </button>
          <button type="button" className={quietActionClass} aria-disabled={saving || undefined}
            onClick={() => {
              if (saving) return;
              keepForUid.current = uid;
              setPlan(null);
            }}>
            Keep in this browser
          </button>
        </div>
      ) : keepForUid.current === uid ? (
        <button type="button" className={`${quietActionClass} mt-xs`} onClick={() => setRefresh((value) => value + 1)}>
          Review adding to my account
        </button>
      ) : null}
      {error ? (
        <p role="alert" className="mt-xs text-body text-danger">{error}</p>
      ) : null}
      {!ready && error ? (
        <button type="button" className={`${quietActionClass} mt-xs`} onClick={() => setRefresh((value) => value + 1)}>
          Check schedule visibility again
        </button>
      ) : null}
    </section>
  );
}
