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
//
// Issue #448: the row order is the navigation order. A move stays in this
// list until Save draft. Publish stays its own action.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAdminApi } from '../adminApi.js';
import { useAdminPages } from '../useAdminPages.js';
import { toEditablePage, toPagePayload } from '../pageDoc.js';
import { orderSaveMessage, ordersToWrite, saveOrderWrites, useDraftOrder } from '../reorder.js';
import { useUnsavedNavigation } from '../useUnsavedNavigation.js';
import { UnsavedChangesDialog } from '../components/UnsavedChanges.jsx';
import { summarizePublish } from '../publishResult.js';
import {
  Notice,
  Panel,
  linkButtonClass,
  primaryButtonClass,
  rowClass,
  rowMetaClass,
  rowTitleLinkClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import {
  OrderAnnouncement,
  OrderDraftButtons,
  ReorderControls,
  bindReorderDrop,
  useRowDrag,
} from '../components/ReorderControls.jsx';
import AdminPageHeader, {
  AdminEmptyState,
  AdminLoadingState,
  RecordState,
  StatusBadge,
  proofRowClass,
} from '../components/adminChrome.jsx';

function PageRow({ row, index, count, moveRow, disabled, resolved }) {
  const label = row.current?.label || row.id;
  const drag = useRowDrag(`page:${index}`, disabled);
  const drop = bindReorderDrop('page:', index, moveRow);
  const [over, setOver] = useState(false);
  const sections = row.current?.sections ?? [];
  return (
    <li
      className={`border-admin-rule-hairline border-b-admin-hairline last:border-b-0 ${proofRowClass(
        row.state.id,
        resolved,
      )}${over ? ' reorder-target' : ''}`}
      {...drag}
      onDragOver={(event) => {
        drop.onDragOver(event);
        setOver(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        setOver(false);
      }}
      onDrop={(event) => {
        drop.onDrop(event);
        setOver(false);
      }}
    >
      <div className={rowClass}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-sm gap-y-2xs">
            <Link to={row.id} className={rowTitleLinkClass} data-reorder-block="">
              {label}
            </Link>
            <RecordState state={row.state} />
            {row.current?.systemPage ? (
              <StatusBadge tone="neutral">System page</StatusBadge>
            ) : null}
            {row.current?.visible === false ? (
              <StatusBadge tone="neutral">Hidden</StatusBadge>
            ) : null}
          </div>
          <p className={`mt-3xs truncate ${rowMetaClass}`} data-reorder-block="">
            {row.current?.path} · {sections.length} section
            {sections.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-xs">
          <ReorderControls
            label={label}
            index={index}
            count={count}
            dragToken={`page:${index}`}
            onMove={moveRow}
            disabled={disabled}
          />
          <Link to={row.id} className={linkButtonClass} data-reorder-block="">
            Edit this page
          </Link>
        </div>
      </div>
    </li>
  );
}

export default function AdminPagesList() {
  const { rows, loading, error } = useAdminPages();
  const call = useAdminApi();
  const { showToast } = useToast();
  const draft = useDraftOrder(rows);
  const [publishing, setPublishing] = useState(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [notice, setNotice] = useState(null);
  const [spoken, setSpoken] = useState('');
  // A failed run's queue and the ids it asked for. A resume is reported
  // against those ids, never the drafts that are dirty now.
  const [resume, setResume] = useState(null);
  // Rows that published in THIS session. Their proof tint resolves to the
  // base ground rather than vanishing: the row is the same row, and the
  // operator watched it change (moment 1).
  const [resolvedIds, setResolvedIds] = useState(() => new Set());
  const frameRef = useRef(null);
  const leaveGuard = useUnsavedNavigation(draft.dirty, { blocked: savingOrder || publishing !== null });

  useEffect(() => {
    const node = frameRef.current;
    if (!node) return undefined;
    if (leaveGuard.pending) node.setAttribute('inert', '');
    else node.removeAttribute('inert');
    return () => node.removeAttribute('inert');
  }, [leaveGuard.pending]);

  const ordered = draft.rows;
  const pendingIds = rows.filter((row) => row.state.id !== 'live').map((row) => row.id);

  function moveRow(from, to) {
    if (savingOrder || publishing !== null) return false;
    const label = ordered[from]?.current?.label || ordered[from]?.id || 'Page';
    const count = ordered.length;
    const moved = draft.move(from, to);
    if (moved) setSpoken(`${label} moved to position ${to + 1} of ${count}`);
    return moved;
  }

  function cancelOrder() {
    draft.cancel();
    setSpoken('');
  }

  async function saveOrder() {
    if (publishing !== null) return;
    const writes = ordersToWrite(ordered);
    setSavingOrder(true);
    setNotice(null);
    const failed = await saveOrderWrites(
      writes,
      async ({ row, order }) => {
        const page = toEditablePage({ ...row.current, id: row.id, order });
        await call('cmsSavePage', { page: toPagePayload(page) });
      },
      (row) => row.current?.label || row.id,
    );
    const verdict = orderSaveMessage(failed);
    setNotice(verdict);
    showToast(verdict.message, verdict.tone === 'ok' ? { announce: false } : { tone: 'error', announce: false });
    setSavingOrder(false);
  }

  async function publishAll() {
    const ids = pendingIds;
    setPublishing('all');
    setNotice(null);
    setResume(null);
    try {
      // Only the pages with something to publish: cmsPublish republishes any
      // doc that has a draft, bumping its revision, so sending clean pages
      // would churn revisions for no change.
      const response = await call('cmsPublish', {
        collection: 'cmsPages',
        docIds: ids,
      });
      reportPublish(response, ids);
    } catch (err) {
      showToast(err.message, { tone: 'error' });
      setNotice({ tone: 'error', message: err.message });
      // A part-way failure names the queue row a retry must resume from,
      // so committed chunks are not published a second time.
      if (err?.queueId) setResume({ queueId: err.queueId, ids });
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
    if (!resume) return;
    const { queueId, ids } = resume;
    setPublishing('resume');
    try {
      const response = await call('cmsPublish', { queueId });
      setResume(null);
      reportPublish(response, ids);
    } catch (err) {
      showToast(err.message, { tone: 'error' });
      setNotice({ tone: 'error', message: err.message });
      if (err?.queueId) setResume({ queueId: err.queueId, ids });
    } finally {
      setPublishing(null);
    }
  }

  const dirtyCount = pendingIds.length;

  return (
    <div ref={frameRef} className="flex flex-col gap-md">
      <AdminPageHeader
        title="Pages"
        description="Every page on the site, and whether its latest edit is live yet."
        identifiers={`${rows.length} page${rows.length === 1 ? '' : 's'}`}
        actions={
          <>
            <OrderDraftButtons
              dirty={draft.dirty}
              saving={savingOrder}
              saveDisabled={publishing !== null}
              onSave={saveOrder}
              onCancel={cancelOrder}
            />
            {resume && !draft.dirty ? (
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={resumePublish}
                disabled={publishing !== null || savingOrder}
              >
                {publishing === 'resume' ? 'Resuming…' : 'Resume publish'}
              </button>
            ) : null}
            {dirtyCount > 0 && !draft.dirty ? (
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={publishAll}
                disabled={publishing !== null || savingOrder}
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

      <OrderAnnouncement message={spoken} />
      {notice ? <Notice tone={notice.tone} message={notice.message} /> : null}

      {error ? (
        <Notice
          tone="caution"
          message="We lost the connection to the page list; showing the last values we received and retrying."
        />
      ) : null}

      {loading ? (
        <AdminLoadingState label="Loading pages…" />
      ) : ordered.length === 0 ? (
        <AdminEmptyState
          title="No pages yet"
          description="Create the first page — a title, a path, and the sections its content lives in."
          action={
            <Link to="new" className={primaryButtonClass}>
              Create a page
            </Link>
          }
        />
      ) : (
        <Panel flush>
          {/* The galley: hairline rows, fixed column order, no zebra
              striping and no row cards — the hairline already does that
              work, and striping is the tell of a default table. */}
          <ul>
            {ordered.map((row, index) => (
              <PageRow
                key={row.id}
                row={row}
                index={index}
                count={ordered.length}
                moveRow={moveRow}
                disabled={savingOrder || publishing !== null}
                resolved={resolvedIds.has(row.id)}
              />
            ))}
          </ul>
        </Panel>
      )}
      {leaveGuard.pending ? createPortal(
        <UnsavedChangesDialog
          onStay={leaveGuard.stay}
          onDiscard={leaveGuard.discard}
          canDiscard={leaveGuard.canDiscard}
        />,
        document.body,
      ) : null}
    </div>
  );
}
