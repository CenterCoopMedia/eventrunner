// Updates list (issue #190): every post on the site's Updates page, its
// state, its date and its place in the feed, and the entry points to write,
// edit and publish one.
//
// The two-revision model (spec §8.4) is said in the admin's three words
// (admin/recordState.js): Draft, Live, Live with unpublished changes. A
// row that is not Live sits on the proof ground, and the word is always
// beside it (moment 1). Publishing is cmsPublish over the dirty drafts, the
// same action every other editor takes; an update's date is display
// scheduling and never holds a publish back.
//
// A RULED TABLE, DRAWN HERE. The rows are in the public feed's order
// (pinned first, then newest first), and each row that is not Live takes
// the proof tint, which the shared admin table does not carry. The head is the galley head
// the ticketing tables draw, sticky at the top of the table's own box, and
// the box is a focusable region so a keyboard can scroll it both ways.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { publishDateLabel, toPublishDate } from '../../lib/updateDates.js';
import { useAdminApi } from '../adminApi.js';
import { summarizePublish } from '../publishResult.js';
import { useAdminUpdates } from '../useAdminUpdates.js';
import {
  NEW_UPDATE_PATH,
  UPDATES_OFF_MESSAGE,
  UPDATES_ROOT,
  categoryOf,
  dirtyUpdateIds,
  placementOf,
} from '../updatesDoc.js';
import {
  Notice,
  primaryButtonClass,
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

// The galley head (AdminTicketing.jsx GalleyHead), copied rather than
// imported: that component is local to the ticketing page.
const HEAD_CLASS =
  'sticky top-0 z-10 border-b-admin-strong border-admin-rule-strong bg-admin-ground-soft px-sm py-xs ' +
  'text-start text-admin-xs font-semibold text-admin-ink-secondary';
const CELL_CLASS = 'px-sm py-xs align-top';

export default function AdminUpdatesList() {
  const { rows, loading, error } = useAdminUpdates();
  const { features, eventConfig } = useEventConfig();
  const call = useAdminApi();
  const { showToast } = useToast();
  const [publishing, setPublishing] = useState(null);
  const [notice, setNotice] = useState(null);
  const [resumeQueueId, setResumeQueueId] = useState(null);
  // Rows that published in this session: their proof tint resolves to the
  // base ground rather than vanishing (moment 1).
  const [resolvedIds, setResolvedIds] = useState(() => new Set());

  const dirtyIds = dirtyUpdateIds(rows);
  const timeZone = eventConfig?.timezone;

  /** cmsPublish answers 200 even when it skipped what you asked for. */
  function reportPublish(response, requestedIds) {
    const verdict = summarizePublish(response, 'cmsUpdates', requestedIds, 'updates');
    setNotice({ tone: verdict.ok ? 'ok' : 'error', message: verdict.message });
    if (verdict.ok) setResolvedIds((current) => new Set([...current, ...requestedIds]));
    showToast(verdict.message, verdict.ok ? { announce: false } : { tone: 'error', announce: false });
  }

  function reportFailure(err) {
    setNotice({ tone: 'error', message: err.message });
    showToast(err.message, { tone: 'error', announce: false });
    // A part-way failure names the queue row a retry must resume from, so
    // committed chunks are not published a second time.
    if (err?.queueId) setResumeQueueId(err.queueId);
  }

  async function publishAll() {
    if (publishing) return;
    setPublishing('all');
    setNotice(null);
    setResumeQueueId(null);
    const ids = dirtyIds;
    try {
      reportPublish(await call('cmsPublish', { collection: 'cmsUpdates', docIds: ids }), ids);
    } catch (err) {
      reportFailure(err);
    } finally {
      setPublishing(null);
    }
  }

  async function resumePublish() {
    if (publishing) return;
    setPublishing('resume');
    try {
      const response = await call('cmsPublish', { queueId: resumeQueueId });
      setResumeQueueId(null);
      reportPublish(response, dirtyIds);
    } catch (err) {
      reportFailure(err);
    } finally {
      setPublishing(null);
    }
  }

  const writeLink = (
    <Link to={NEW_UPDATE_PATH} className={primaryButtonClass}>
      Write an update
    </Link>
  );

  return (
    <div className="flex flex-col gap-md">
      <AdminPageHeader
        title="Updates"
        description="Every update on the site's Updates page, and whether each one is live. Short notices for the dashboard card are under Live updates."
        identifiers={loading ? null : `${rows.length} update${rows.length === 1 ? '' : 's'}`}
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
            {dirtyIds.length > 0 ? (
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={publishAll}
                disabled={publishing !== null}
                aria-busy={publishing === 'all' || undefined}
              >
                {publishing === 'all' ? 'Publishing…' : `Publish all (${dirtyIds.length})`}
              </button>
            ) : null}
            {writeLink}
          </>
        }
      />

      {features?.updates ? null : <Notice tone="caution" message={UPDATES_OFF_MESSAGE} />}

      {notice ? <Notice tone={notice.tone} message={notice.message} /> : null}

      {error ? (
        <Notice
          tone="caution"
          message="We lost the connection to the update list. Showing the last values we received and retrying."
        />
      ) : null}

      {loading ? (
        <AdminLoadingState label="Loading updates…" />
      ) : rows.length === 0 ? (
        <AdminEmptyState
          title="No updates yet"
          description="Write the first update. It stays a draft until you publish it."
          action={writeLink}
        />
      ) : (
        <div
          role="region"
          aria-label="Updates"
          tabIndex={0}
          className="max-h-[36rem] overflow-auto rounded-admin border-admin-hairline border-admin-rule-hairline bg-admin-ground-raised"
        >
          <table className="w-full min-w-[42rem] border-collapse text-admin-sm">
            <caption className="sr-only">Updates, pinned first, then newest first</caption>
            <thead>
              <tr>
                <th scope="col" className={HEAD_CLASS}>Update</th>
                <th scope="col" className={HEAD_CLASS}>State</th>
                <th scope="col" className={HEAD_CLASS}>Date</th>
                <th scope="col" className={HEAD_CLASS}>Category</th>
                <th scope="col" className={HEAD_CLASS}>Placement</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const update = row.current ?? {};
                const dateLabel = publishDateLabel(update.publishAt, timeZone);
                // The proof tint is drawn on each cell, not on the row: its
                // ground is a pseudo-element, and one on a <tr> takes a cell
                // of its own and pushes the row one column over. Every cell
                // holds one element, which the tint rule lifts above it.
                const cell = `${CELL_CLASS} ${proofRowClass(row.state.id, resolvedIds.has(row.id))}`;
                return (
                  <tr
                    key={row.id}
                    data-record-row={row.state.id}
                    className="border-b-admin-hairline border-admin-rule-hairline last:border-b-0"
                  >
                    <td className={cell}>
                      <div>
                        <Link to={`${UPDATES_ROOT}/${encodeURIComponent(row.id)}`} className={rowTitleLinkClass}>
                          {update.title || row.id}
                        </Link>
                        <p className={`mt-3xs break-words ${rowMetaClass}`}>{row.id}</p>
                      </div>
                    </td>
                    <td className={cell}>
                      <div className="flex flex-wrap items-center gap-2xs">
                        <RecordState state={row.state} />
                        {update.visible === false ? <StatusBadge tone="neutral">Hidden</StatusBadge> : null}
                      </div>
                    </td>
                    <td className={`${cell} whitespace-nowrap font-admin-data tabular-nums text-admin-ink-data`}>
                      {dateLabel ? (
                        <time className="block" dateTime={toPublishDate(update.publishAt).toISOString()}>{dateLabel}</time>
                      ) : (
                        <span className="block">Undated</span>
                      )}
                    </td>
                    <td className={`${cell} text-admin-ink-secondary`}>
                      <span className="block">{categoryOf(update) ?? 'None'}</span>
                    </td>
                    <td className={`${cell} text-admin-ink-secondary`}>
                      <span className="block">{placementOf(update)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
