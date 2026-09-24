// The timeline list (issue #194): every past edition the home page's
// History section can list, live and draft, in the order it lists them.
//
// A galley of rows, as the sessions list draws, not a ruled table: an entry
// is a year and a title, and there is nothing to compare across columns.
// Each row states its record state as a word, and an entry the page will
// not draw says "Hidden" beside it, so no state is left to the tint.
//
// The list appears on the site only inside the home page's History section.
// A home page with no such section draws no entry at all, so the page says
// so above the list rather than leaving an operator to publish into nothing.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useContent } from '../../contexts/ContentContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAdminApi } from '../adminApi.js';
import { summarizePublish } from '../publishResult.js';
import { useAdminTimeline } from '../useAdminTimeline.js';
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
  StatusBadge,
  proofRowClass,
} from '../components/adminChrome.jsx';

const COLLECTION = 'cmsTimeline';

const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

export default function AdminTimelineList() {
  const { rows, loading, error } = useAdminTimeline();
  const { getPage } = useContent();
  const call = useAdminApi();
  const { showToast } = useToast();
  const [publishing, setPublishing] = useState(null);
  const [notice, setNotice] = useState(null);
  const [resumeQueueId, setResumeQueueId] = useState(null);
  const pendingIds = rows.filter((row) => row.state.id !== 'live').map((row) => row.id);
  const home = getPage('home') ?? getPage('/');
  const hasHistorySection = (home?.sections ?? []).some((section) => section?.id === 'history');

  function reportPublish(response, ids) {
    const verdict = summarizePublish(response, COLLECTION, ids, 'timeline entries');
    setNotice({ tone: verdict.ok ? 'ok' : 'error', message: verdict.message });
    showToast(verdict.message, verdict.ok ? { announce: false } : { tone: 'error', announce: false });
  }

  function reportFailure(err) {
    setNotice({ tone: 'error', message: err.message });
    showToast(err.message, { tone: 'error', announce: false });
    if (err?.queueId) setResumeQueueId(err.queueId);
  }

  async function publishAll() {
    const ids = pendingIds;
    setPublishing('all');
    setNotice(null);
    setResumeQueueId(null);
    try {
      reportPublish(await call('cmsPublish', { collection: COLLECTION, docIds: ids }), ids);
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
      reportPublish(response, pendingIds);
    } catch (err) {
      reportFailure(err);
    } finally {
      setPublishing(null);
    }
  }

  const addLink = (
    <Link to="new/entry" className={primaryButtonClass}>
      Add an entry
    </Link>
  );

  return (
    <div className="flex flex-col gap-md">
      <AdminPageHeader
        title="Timeline"
        identifiers={`${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`}
        description="Past editions of the event. The home page's History section lists them, oldest first."
        actions={
          <>
            {resumeQueueId ? (
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={resumePublish}
                disabled={publishing !== null}
                aria-busy={publishing === 'resume' || undefined}
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
                aria-busy={publishing === 'all' || undefined}
              >
                {publishing === 'all' ? 'Publishing…' : `Publish all (${pendingIds.length})`}
              </button>
            ) : null}
            {addLink}
          </>
        }
      />

      {notice ? <Notice tone={notice.tone} message={notice.message} /> : null}

      {hasHistorySection ? null : (
        <Notice
          tone="caution"
          message="The home page has no section with the id history, so published entries do not appear on the site. Add one to the home page under Pages."
        />
      )}

      {error ? (
        <Notice
          tone="caution"
          message="We lost the connection to the timeline; showing the last values we received and retrying."
        />
      ) : null}

      {loading ? (
        <AdminLoadingState label="Loading timeline…" />
      ) : rows.length === 0 ? (
        <AdminEmptyState
          title="No timeline entries yet"
          description="Add the first past edition. It stays a draft until you publish it."
          action={addLink}
        />
      ) : (
        <Panel flush>
          <ul>
            {rows.map((row) => {
              const entry = row.current ?? {};
              return (
                <li
                  key={row.id}
                  className={`border-admin-rule-hairline border-b-admin-hairline last:border-b-0 ${proofRowClass(row.state.id)}`}
                >
                  <div className={rowClass}>
                    <div className="min-w-0">
                      <Link to={encodeURIComponent(row.id)} className={rowTitleLinkClass}>
                        {text(entry.title) ?? row.id}
                      </Link>
                      <p className={`mt-3xs ${rowMetaClass}`}>
                        {[Number.isInteger(entry.year) ? String(entry.year) : 'No year', row.id].join(' · ')}
                      </p>
                    </div>
                    <span className="flex flex-wrap items-center gap-2xs">
                      <RecordState state={row.state} />
                      {entry.visible === false ? <StatusBadge tone="neutral">Hidden</StatusBadge> : null}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
    </div>
  );
}
