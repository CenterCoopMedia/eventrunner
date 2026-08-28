import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAdminApi } from '../adminApi.js';
import { summarizePublish } from '../publishResult.js';
import { useAdminSessions } from '../useAdminSessions.js';
import {
  Notice,
  Panel,
  primaryButtonClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import AdminPageHeader, {
  AdminEmptyState,
  AdminLoadingState,
  RecordState,
  proofRowClass,
} from '../components/adminChrome.jsx';

export default function AdminSessionsList() {
  const { eventConfig } = useEventConfig();
  const { groups, rows, loading, error } = useAdminSessions();
  const call = useAdminApi();
  const { showToast } = useToast();
  const [publishing, setPublishing] = useState(null);
  const [notice, setNotice] = useState(null);
  const [resumeQueueId, setResumeQueueId] = useState(null);
  const placeNames = new Map(
    (eventConfig.venue?.places ?? []).map((place) => [place.id, place.name]),
  );
  const pendingIds = rows.filter((row) => row.state.id !== 'live').map((row) => row.id);

  function reportPublish(response) {
    const verdict = summarizePublish(response, 'cmsSchedule', pendingIds, 'sessions');
    setNotice({ tone: verdict.ok ? 'ok' : 'error', message: verdict.message });
    showToast(verdict.message, verdict.ok ? undefined : { tone: 'error' });
  }

  function reportFailure(err) {
    setNotice({ tone: 'error', message: err.message });
    showToast(err.message, { tone: 'error' });
    if (err?.queueId) setResumeQueueId(err.queueId);
  }

  async function publishAll() {
    setPublishing('all');
    setNotice(null);
    setResumeQueueId(null);
    try {
      const response = await call('cmsPublish', {
        collection: 'cmsSchedule',
        docIds: pendingIds,
      });
      reportPublish(response);
    } catch (err) {
      reportFailure(err);
    } finally {
      setPublishing(null);
    }
  }

  async function resumePublish() {
    setPublishing('resume');
    try {
      const response = await call('cmsPublish', { queueId: resumeQueueId });
      setResumeQueueId(null);
      reportPublish(response);
    } catch (err) {
      reportFailure(err);
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
            {resumeQueueId ? (
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
        groups.map((group) => (
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
                    <div className={`flex flex-wrap items-center justify-between gap-sm px-md py-xs ${session.parentId ? 'ms-md' : ''}`}>
                      <div className="min-w-0">
                        <Link
                          to={encodeURIComponent(row.id)}
                          className="font-admin-ui text-caption font-semibold text-admin-ink-link underline underline-offset-2"
                        >
                          {session.title || row.id}
                        </Link>
                        <p className="mt-3xs font-admin-data text-folio text-admin-ink-data">
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
        ))
      )}
    </div>
  );
}
