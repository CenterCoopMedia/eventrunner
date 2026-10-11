// Content editor, step 3 (issue #61): every content block currently in one
// section, its publish state, and the entry points to create, edit, publish,
// and delete. "Add block" respects the section's own allowedBlocks/maxBlocks
// (set in Pages) — offered only when the section allows at least one block
// type, and disabled once the section is at its cap, same guardrail
// AdminPageEditor's block picker applies to defaultBlocks.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useParams } from 'react-router-dom';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAdminApi } from '../adminApi.js';
import { useAdminPages } from '../useAdminPages.js';
import { useAdminContent } from '../useAdminContent.js';
import { blockTypeLabel } from '../blockTypes.js';
import { contentBlockTitle } from '../contentDoc.js';
import { byStoredOrder, orderSaveMessage, ordersToWrite, saveOrderWrites, useDraftOrder } from '../reorder.js';
import { useUnsavedNavigation } from '../useUnsavedNavigation.js';
import { UnsavedChangesDialog } from '../components/UnsavedChanges.jsx';
import { summarizePublish } from '../publishResult.js';
import {
  DestructiveConfirm,
  Notice,
  Panel,
  linkButtonClass,
  primaryButtonClass,
  rowClass,
  rowTitleLinkClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import {
  OrderAnnouncement,
  OrderDraftButtons,
  ReorderControls,
  bindReorderDrop,
} from '../components/ReorderControls.jsx';
import AdminPageHeader, {
  AdminEmptyState,
  AdminLoadingState,
  RecordState,
  StatusBadge,
  proofRowClass,
} from '../components/adminChrome.jsx';

export default function AdminContentSection() {
  const { pageId, sectionId } = useParams();
  const call = useAdminApi();
  const { showToast } = useToast();
  const { findRow: findPage, loading: pagesLoading, ready: pagesReady } = useAdminPages();
  const { rows: contentRows, loading: contentLoading, ready: contentReady, error: contentError } = useAdminContent();
  const [busyId, setBusyId] = useState(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [notice, setNotice] = useState(null);
  const [spoken, setSpoken] = useState('');
  // Blocks published in THIS session: their proof tint resolves to the base
  // ground rather than vanishing (moment 1).
  const [resolvedIds, setResolvedIds] = useState(() => new Set());
  const frameRef = useRef(null);

  const page = findPage(pageId);
  const section = (page?.current?.sections ?? []).find((candidate) => candidate.id === sectionId);
  const serverBlocks = byStoredOrder(contentRows.filter((row) => row.current?.section === sectionId));
  const draft = useDraftOrder(serverBlocks);
  const blocks = draft.rows;
  const leaveGuard = useUnsavedNavigation(draft.dirty, { blocked: savingOrder || busyId !== null });
  const allowed = section?.allowedBlocks ?? [];
  const maxBlocks = Number.isFinite(section?.maxBlocks) ? section.maxBlocks : Infinity;
  // While either cmsContent revision is still loading, `blocks` can be an
  // undercount (e.g. the live listener reported an empty result but the
  // drafts listener, which might hold this section's only blocks, has not
  // yet) — treating that as "under the cap" would let an operator start a
  // create past maxBlocks on a slow connection. Block the action instead of
  // guessing until both listeners have actually reported.
  const atMax = !pagesReady || !contentReady || serverBlocks.length >= maxBlocks;

  useEffect(() => {
    const node = frameRef.current;
    if (!node) return undefined;
    if (leaveGuard.pending) node.setAttribute('inert', '');
    else node.removeAttribute('inert');
    return () => node.removeAttribute('inert');
  }, [leaveGuard.pending]);

  function moveRow(from, to) {
    if (!contentReady || savingOrder || busyId !== null) return false;
    const label = contentBlockTitle(blocks[from]?.current);
    const count = blocks.length;
    const moved = draft.move(from, to);
    if (moved) setSpoken(`${label} moved to position ${to + 1} of ${count}`);
    return moved;
  }

  function cancelOrder() {
    draft.cancel();
    setSpoken('');
  }

  async function saveOrder() {
    if (!contentReady) return;
    const writes = ordersToWrite(blocks);
    setSavingOrder(true);
    setNotice(null);
    const failed = await saveOrderWrites(
      writes,
      async ({ row, order }) => {
        await call('cmsUpdateContent', {
          section: sectionId,
          field: row.current.field,
          visible: row.current.visible !== false,
          fields: { order },
        });
      },
      (row) => contentBlockTitle(row.current),
    );
    const verdict = orderSaveMessage(failed);
    setNotice(verdict);
    showToast(verdict.message, verdict.tone === 'ok' ? { announce: false } : { tone: 'error', announce: false });
    setSavingOrder(false);
  }

  if ((pagesLoading || contentLoading) && !section) {
    return <AdminLoadingState label="Loading section…" />;
  }
  if (!pagesLoading && (!page || !section)) {
    return (
      <AdminEmptyState
        title="No such section"
        description="That section doesn’t exist on this page (any more)."
        action={
          <Link to="../.." relative="path" className={linkButtonClass}>
            Back to content
          </Link>
        }
      />
    );
  }

  async function publishOne(row) {
    setBusyId(row.id);
    setNotice(null);
    try {
      const response = await call('cmsPublish', { collection: 'cmsContent', docIds: [row.id] });
      const verdict = summarizePublish(response, 'cmsContent', [row.id], 'content blocks');
      setNotice({ tone: verdict.ok ? 'ok' : 'error', message: verdict.message });
      if (verdict.ok) setResolvedIds((current) => new Set([...current, row.id]));
      showToast(verdict.message, verdict.ok ? undefined : { tone: 'error' });
    } catch (err) {
      setNotice({ tone: 'error', message: err.message });
      showToast(err.message, { tone: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  async function remove(row) {
    setBusyId(row.id);
    setNotice(null);
    try {
      await call('cmsDeleteContent', { section: sectionId, field: row.current.field });
      showToast('Block deleted.');
    } catch (err) {
      setNotice({ tone: 'error', message: err.message });
      showToast(err.message, { tone: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  const addBlockButton =
    allowed.length === 0 ? null : atMax ? (
      <button
        type="button"
        className={primaryButtonClass}
        disabled
        title={
          !pagesReady || !contentReady
            ? 'Waiting for this section and its draft blocks…'
            : `This section already has its maximum of ${maxBlocks} blocks.`
        }
      >
        Add a block
      </button>
    ) : (
      // '_new', not 'new' — see AdminApp.jsx's route comment: a field id
      // may legitimately be 'new', so the creation route uses a segment no
      // valid field id can ever match instead.
      <Link to="_new" className={primaryButtonClass}>
        Add a block
      </Link>
    );

  return (
    <div ref={frameRef} className="flex flex-col gap-md">
      <AdminPageHeader
        title={section?.label || sectionId}
        identifiers={`${page?.current?.label || pageId} · ${section?.label || sectionId} · ${blocks.length} block${
          blocks.length === 1 ? '' : 's'
        }`}
        description={`${page?.current?.label ?? pageId} · allows ${
          allowed.length ? allowed.map(blockTypeLabel).join(', ') : 'no block types yet'
        }`}
        actions={
          <>
            <OrderDraftButtons
              dirty={draft.dirty}
              saving={savingOrder}
              saveDisabled={!contentReady}
              onSave={saveOrder}
              onCancel={cancelOrder}
            />
            <Link to="../.." relative="path" className={linkButtonClass}>
              Back to content
            </Link>
            {addBlockButton}
          </>
        }
      />

      <OrderAnnouncement message={spoken} />
      {contentError ? (
        <Notice
          tone="caution"
          message="We lost the connection to the content list; showing the last values we received and retrying."
        />
      ) : null}
      {notice ? <Notice tone={notice.tone} message={notice.message} /> : null}

      {blocks.length === 0 ? (
        <AdminEmptyState
          title="No blocks yet"
          description="Add the first content block for this section."
          action={addBlockButton}
        />
      ) : (
        <Panel flush>
          <ul>
            {blocks.map((row, index) => {
              const label = contentBlockTitle(row.current);
              return (
              <li
                key={row.id}
                className={`border-admin-rule-hairline border-b-admin-hairline last:border-b-0 ${proofRowClass(
                  row.state.id,
                  resolvedIds.has(row.id),
                )}`}
                {...(contentReady ? bindReorderDrop('content:', index, moveRow) : {})}
              >
                <div className={rowClass}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-sm gap-y-2xs">
                      <Link
                        to={row.current.field}
                        className={rowTitleLinkClass}
                      >
                        {label}
                      </Link>
                      <RecordState state={row.state} />
                      <StatusBadge tone="info">{blockTypeLabel(row.current.blockType)}</StatusBadge>
                      {row.current.visible === false ? (
                        <StatusBadge tone="neutral">Hidden</StatusBadge>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-xs">
                    <ReorderControls
                      label={label}
                      index={index}
                      count={blocks.length}
                      dragToken={`content:${index}`}
                      onMove={moveRow}
                      disabled={!contentReady || savingOrder || busyId !== null}
                    />
                    {row.state.id !== 'live' && !draft.dirty ? (
                      <button
                        type="button"
                        className={secondaryButtonClass}
                        disabled={busyId !== null || savingOrder}
                        onClick={() => publishOne(row)}
                      >
                        {busyId === row.id ? 'Publishing…' : 'Publish'}
                      </button>
                    ) : null}
                    <Link to={row.current.field} className={linkButtonClass}>
                      Edit
                    </Link>
                    <DestructiveConfirm
                      trigger="Delete"
                      title={`Delete ${contentBlockTitle(row.current)}`}
                      confirmLabel="Delete this block"
                      busyLabel="Deleting…"
                      busy={busyId === row.id}
                      disabled={busyId !== null}
                      consequence="The live revision and its draft both go, and the section renders without this block."
                      permanence="This cannot be undone."
                      onConfirm={() => remove(row)}
                    />
                  </div>
                </div>
              </li>
              );
            })}
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
