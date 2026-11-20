// The timeline list (issue #194): every past edition, live and draft, in the
// order it appears in a Timeline block or the history on Home.
//
// A galley of rows, as the sessions list draws, not a ruled table: an entry
// is a year and a title, and there is nothing to compare across columns.
// Each row states its record state as a word, and an entry the page will
// not draw says "Hidden" beside it, so no state is left to the tint.
//
import { useState } from 'react';
import { Link } from 'react-router';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useContent } from '../../contexts/ContentContext.jsx';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { useAdminApi } from '../adminApi.js';
import { DeletedRecordResult } from '../deletionUndo.jsx';
import { contentError } from '../contentError.js';
import { summarizePublish } from '../publishResult.js';
import { useAdminTimeline } from '../useAdminTimeline.js';
import usePublishRun from '../usePublishRun.js';
import PublishRunProgress from '../components/PublishRunProgress.jsx';
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
  const { pages, getPublicPage, pageHasTimelineBlock, publicPagesConfirmed, contentSource } = useContent();
  const { features } = useEventConfig();
  const { publish, run } = usePublishRun(useAdminApi());
  const { showToast } = useToast();
  const [publishing, setPublishing] = useState(null);
  const [notice, setNotice] = useState(null);
  // A failed run's queue and the ids it asked for. A resume is reported
  // against those ids, not the drafts that are dirty when it is pressed.
  const [resume, setResume] = useState(null);
  const pendingIds = rows.filter((row) => row.state.id !== 'live').map((row) => row.id);
  const showPlacementNotice = rows.length > 0 && publicPagesConfirmed && contentSource === 'live'
    && !pages.some((page) => getPublicPage(page.id, features) && (pageHasTimelineBlock(page)
      || (page.id === 'home' && page.sections?.some((section) => section?.id === 'history'))));

  function reportPublish(response, ids) {
    const verdict = summarizePublish(response, COLLECTION, ids, 'timeline entries');
    const message = verdict.ok ? 'Published.' : verdict.message;
    setNotice({ tone: verdict.ok ? 'ok' : 'error', message });
    showToast(message, verdict.ok ? { announce: false } : { tone: 'error', announce: false });
  }

  function reportFailure(err, ids) {
    setNotice({ tone: 'error', message: contentError(err, { fallback: 'Publishing did not finish. Try again.' }).message });
    showToast(contentError(err, { fallback: 'Publishing did not finish. Try again.' }).message, { tone: 'error', announce: false });
    if (err?.queueId) setResume({ queueId: err.queueId, ids });
  }

  async function publishAll() {
    const ids = pendingIds;
    setPublishing('all');
    setNotice(null);
    setResume(null);
    try {
      reportPublish(await publish({ collection: COLLECTION, docIds: ids }), ids);
    } catch (err) {
      reportFailure(err, ids);
    } finally {
      setPublishing(null);
    }
  }

  async function resumePublish() {
    if (!resume) return;
    const { queueId, ids } = resume;
    setPublishing('resume');
    try {
      const response = await publish({ queueId });
      setResume(null);
      reportPublish(response, ids);
    } catch (err) {
      reportFailure(err, ids);
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
      <AdminPageHeader help="Add a Timeline block in a page’s content editor to show these entries."
        title="Timeline"
        identifiers={`${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`}
        description="Published entries appear in Timeline blocks and in the History section on Home when that section is present."
        actions={
          <>
            {resume ? (
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
      <PublishRunProgress run={run} />

      <DeletedRecordResult />
      {notice ? <Notice tone={notice.tone} message={notice.message} /> : null}

      {showPlacementNotice ? (
        <Notice tone="caution" message={(
          <>Published entries have no place to appear yet. Add a Timeline block in <Link to="/admin/content" className="underline">page content</Link>.</>
        )} />
      ) : null}

      {error ? (
        <Notice
          tone="caution"
          message="The timeline could not refresh. Check your connection."
        />
      ) : null}

      {loading ? (
        <AdminLoadingState label="Loading timeline…" />
      ) : rows.length === 0 ? (
        <AdminEmptyState
          title="No timeline entries yet"
          description="An entry describes one past edition. To display published entries on a page, add a Timeline block in its content editor."
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
                        {text(entry.title) ?? 'Untitled entry'}
                      </Link>
                      <p className={`mt-3xs ${rowMetaClass}`}>
                        {Number.isInteger(entry.year) ? String(entry.year) : 'No year'}
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
