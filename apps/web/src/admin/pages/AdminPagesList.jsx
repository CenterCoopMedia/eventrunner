// Pages list (issue #13): the galley — every cmsPages document with its
// publish state, plus the entry points to create, edit, and publish.
//
// The two-revision model (spec §8.4) is visible rather than hidden. It is
// said in the admin's three words (admin/recordState.js): a page is `Draft`
// (draft only), `Live with unpublished changes` (a dirty draft over a live
// doc), or `Live`. Publishing is a Firestore revision copy via cmsPublish,
// so it happens right here — no deploy.
//
// Moment 1: a row with a draft sits on the proof ground, the word is always
// beside it, and a successful publish resolves the tint away over 160ms on
// opacity — instantly under reduced motion.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../contexts/ToastContext.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import LoadingState from '../../components/LoadingState.jsx';
import { useAdminApi } from '../adminApi.js';
import { useAdminPages } from '../useAdminPages.js';
import { summarizePublish } from '../publishResult.js';
import {
  Notice,
  Panel,
  primaryButtonClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import AdminPageHeader, { RecordState, proofRowClass } from '../components/adminChrome.jsx';

export default function AdminPagesList() {
  const { rows, loading, error } = useAdminPages();
  const call = useAdminApi();
  const { showToast } = useToast();
  const [publishing, setPublishing] = useState(null);
  const [notice, setNotice] = useState(null);
  const [resumeQueueId, setResumeQueueId] = useState(null);
  // Rows that published in THIS session. Their proof tint resolves to the
  // base ground rather than vanishing: the row is the same row, and the
  // operator watched it change (moment 1).
  const [resolvedIds, setResolvedIds] = useState(() => new Set());

  const pendingIds = rows.filter((row) => row.state.id !== 'live').map((row) => row.id);

  async function publishAll() {
    setPublishing('all');
    setNotice(null);
    setResumeQueueId(null);
    try {
      // Only the pages with something to publish: cmsPublish republishes any
      // doc that has a draft, bumping its revision, so sending clean pages
      // would churn revisions for no change.
      const response = await call('cmsPublish', {
        collection: 'cmsPages',
        docIds: pendingIds,
      });
      reportPublish(response, pendingIds);
    } catch (err) {
      showToast(err.message, { tone: 'error' });
      setNotice({ tone: 'error', message: err.message });
      // A part-way failure names the queue row a retry must resume from,
      // so committed chunks are not published a second time.
      if (err?.queueId) setResumeQueueId(err.queueId);
    } finally {
      setPublishing(null);
    }
  }

  /** cmsPublish answers 200 even when it skipped what you asked for. */
  function reportPublish(response, requestedIds) {
    const verdict = summarizePublish(response, 'cmsPages', requestedIds);
    setNotice({ tone: verdict.ok ? 'ok' : 'error', message: verdict.message });
    if (verdict.ok) {
      setResolvedIds((current) => new Set([...current, ...requestedIds]));
    }
    showToast(verdict.message, verdict.ok ? undefined : { tone: 'error' });
  }

  /** Resume a part-way publish; { queueId } skips the committed chunks. */
  async function resumePublish() {
    setPublishing('resume');
    try {
      const response = await call('cmsPublish', { queueId: resumeQueueId });
      setResumeQueueId(null);
      reportPublish(response, pendingIds);
    } catch (err) {
      showToast(err.message, { tone: 'error' });
      setNotice({ tone: 'error', message: err.message });
      if (err?.queueId) setResumeQueueId(err.queueId);
    } finally {
      setPublishing(null);
    }
  }

  const dirtyCount = pendingIds.length;

  return (
    <div className="flex flex-col gap-md">
      <AdminPageHeader
        title="Pages"
        description="Every page on the site, and whether its latest edit is live yet."
        identifiers={`${rows.length} page${rows.length === 1 ? '' : 's'}`}
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
            {dirtyCount > 0 ? (
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={publishAll}
                disabled={publishing !== null}
              >
                {publishing === 'all' ? 'Publishing…' : `Publish all (${dirtyCount})`}
              </button>
            ) : null}
            <Link to="new" className={primaryButtonClass}>
              Create a page
            </Link>
          </>
        }
      />

      {notice ? <Notice tone={notice.tone} message={notice.message} /> : null}

      {error ? (
        <Notice
          tone="caution"
          message="We lost the connection to the page list; showing the last values we received and retrying."
        />
      ) : null}

      {loading ? (
        <LoadingState label="Loading pages…" />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No pages yet"
          description="Create the first page — a title, a path, and the sections its content lives in."
          action={
            <Link to="new" className={primaryButtonClass}>
              Create a page
            </Link>
          }
        />
      ) : (
        <Panel className="p-0">
          {/* The galley: hairline rows, fixed column order, no zebra
              striping and no row cards — the hairline already does that
              work, and striping is the tell of a default table. */}
          <ul>
            {rows.map((row) => (
              <li
                key={row.id}
                className={`border-admin-rule-hairline border-b-admin-hairline last:border-b-0 ${proofRowClass(
                  row.state.id,
                  resolvedIds.has(row.id),
                )}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-sm px-md py-xs">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-sm gap-y-3xs">
                      <Link
                        to={row.id}
                        className="admin-target inline-flex items-center rounded-admin font-semibold text-admin-ink underline underline-offset-4"
                      >
                        {row.current?.label || row.id}
                      </Link>
                      <RecordState state={row.state} />
                      {row.current?.systemPage ? (
                        <span className="font-admin-data text-folio text-admin-ink-secondary">
                          System page
                        </span>
                      ) : null}
                      {row.current?.visible === false ? (
                        <span className="font-admin-data text-folio text-admin-ink-secondary">
                          Hidden
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-3xs truncate font-admin-data text-folio text-admin-ink-data">
                      {row.current?.path} · {(row.current?.sections ?? []).length} section
                      {(row.current?.sections ?? []).length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <Link to={row.id} className={secondaryButtonClass}>
                    Edit this page
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
