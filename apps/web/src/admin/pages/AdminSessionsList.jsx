import { useState } from 'react';
import { Link } from 'react-router';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAdminApi } from '../adminApi.js';
import { summarizePublish } from '../publishResult.js';
import { useAdminSessions } from '../useAdminSessions.js';
import {
  Notice,
  Panel,
  primaryButtonClass,
  rowClass,
  rowMetaClass,
  rowTitleLinkClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import AdminPageHeader, {
  AdminEmptyState,
  AdminLoadingState,
  RecordState,
  proofRowClass,
} from '../components/adminChrome.jsx';
import SessionPopularityPanel from '../components/SessionPopularityPanel.jsx';

export default function AdminSessionsList() {
  const { eventConfig } = useEventConfig();
  const { groups, rows, loading, error } = useAdminSessions();
  const call = useAdminApi();
  const { showToast } = useToast();
  const [publishing, setPublishing] = useState(null);
  const [notice, setNotice] = useState(null);
  const [resume, setResume] = useState(null);
  const placeNames = new Map(
    (eventConfig.venue?.places ?? []).map((place) => [place.id, place.name]),
  );
  const pendingIds = rows.filter((row) => row.state.id !== 'live').map((row) => row.id);

  function reportPublish(response, ids) {
    const verdict = summarizePublish(response, 'cmsSchedule', ids, 'sessions');
    setNotice({ tone: verdict.ok ? 'ok' : 'error', message: verdict.message });
    showToast(verdict.message, verdict.ok ? { announce: false } : { tone: 'error', announce: false });
  }

  function reportFailure(err, ids) {
    setNotice({ tone: 'error', message: err.message });
    showToast(err.message, { tone: 'error', announce: false });
    if (err?.queueId) setResume({ queueId: err.queueId, ids });
  }

  async function publishAll() {
    if (publishing !== null) return;
    const ids = pendingIds;
    setPublishing('all');
    setNotice(null);
    setResume(null);
    try {
      const response = await call('cmsPublish', {
        collection: 'cmsSchedule',
        docIds: ids,
      });
      reportPublish(response, ids);
    } catch (err) {
      reportFailure(err, ids);
    } finally {
      setPublishing(null);
    }
  }

  async function resumePublish() {
    if (!resume || publishing !== null) return;
    const { queueId, ids } = resume;
    setPublishing('resume');
    try {
      const response = await call('cmsPublish', { queueId });
      setResume(null);
      reportPublish(response, ids);
    } catch (err) {
      reportFailure(err, ids);
    } finally {
      setPublishing(null);
    }
  }

  return (
    <div className="flex flex-col gap-md">
      <AdminPageHeader
        title="Sessions"
        identifiers={`${rows.length} session${rows.length === 1 ? '' : 's'}`}
        description="The programme in event-day order. Child sessions stay directly below their parent."
        actions={
          <>
            {resume ? (
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={resumePublish}
                disabled={publishing !== null}
              >
                {publishing === 'resume' ? 'Resuming…' : 'Resume publish'}
              </button>
            ) : null}
            {pendingIds.length > 0 ? (
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={publishAll}
                disabled={publishing !== null}
              >
                {publishing === 'all' ? 'Publishing…' : `Publish all (${pendingIds.length})`}
              </button>
            ) : null}
            <Link to="new/session" className={primaryButtonClass}>
              Create a session
            </Link>
          </>
        }
      />

      {notice ? <Notice tone={notice.tone} message={notice.message} /> : null}

      {error ? (
        <Notice
          tone="caution"
          message="We lost the connection to the session register; showing the last values we received and retrying."
        />
      ) : null}

      {loading ? (
        <AdminLoadingState label="Loading sessions…" />
      ) : rows.length === 0 ? (
        <AdminEmptyState
          title="No sessions yet"
          description="Create the first session, then save its draft before publishing it."
          action={
            <Link to="new/session" className={primaryButtonClass}>
              Create a session
            </Link>
          }
        />
      ) : (
        <>
          {/* The sessions attendees saved most (issue #182), above the
              day groups, from the public bookmark counts. */}
          <SessionPopularityPanel groups={groups} />
          {groups.map((group) => (
            <Panel key={group.dayId} title={group.label} flush>
              <ul>
                {group.rows.map((row) => {
                  const session = row.current;
                  const place = placeNames.get(session.placeId) || session.location || 'No place';
                  return (
                    <li
                      key={row.id}
                      className={`border-admin-rule-hairline border-b-admin-hairline last:border-b-0 ${proofRowClass(row.state.id)}`}
                    >
                      <div className={`${rowClass} ${session.parentId ? 'ms-md' : ''}`}>
                        <div className="min-w-0">
                          <Link to={encodeURIComponent(row.id)} className={rowTitleLinkClass}>
                            {session.title || row.id}
                          </Link>
                          <p className={`mt-3xs ${rowMetaClass}`}>
                            {[`${session.startTime || 'Time unset'}${session.endTime ? `–${session.endTime}` : ''}`,
                              session.track ? `Track ${session.track}` : null,
                              place]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        </div>
                        <RecordState state={row.state} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          ))}
        </>
      )}
    </div>
  );
}
