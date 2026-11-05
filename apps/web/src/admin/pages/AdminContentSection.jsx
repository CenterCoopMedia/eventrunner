// Content editor, step 3 (issue #61): every content block currently in one
// section, its publish state, and the entry points to create, edit, publish,
// and delete. "Add block" respects the section's own allowedBlocks/maxBlocks
// (set in Pages) — offered only when the section allows at least one block
// type, and disabled once the section is at its cap, same guardrail
// AdminPageEditor's block picker applies to defaultBlocks.
import { sectionBlockTypes } from 'shared/page';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useParams } from 'react-router';
import { isStarterContent } from 'shared/seed';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAdminApi } from '../adminApi.js';
import { useAdminPages } from '../useAdminPages.js';
import { useAdminContent } from '../useAdminContent.js';
import { BLOCK_TYPE_IDS, blockTypeLabel } from '../blockTypes.js';
import { contentBlockTitle } from '../contentDoc.js';
import { byStoredOrder, orderSaveMessage, ordersToWrite, saveOrderWrites, useDraftOrder } from '../reorder.js';
import { useUnsavedNavigation } from '../useUnsavedNavigation.js';
import { UnsavedChangesDialog } from '../components/UnsavedChanges.jsx';
import { summarizePublish } from '../publishResult.js';
import HomeHeroImageEditor from '../components/HomeHeroImageEditor.jsx';
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
import { ActionFeedback, EditRecordLink, useActionResultFocus } from '../components/ActionFeedback.jsx';
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
  const [busy, setBusy] = useState(null);
  const requestPending = useRef(false);
  const [rowResults, setRowResults] = useState({});
  const blockedReasonId = useId();
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
  const actionFocus = useActionResultFocus(busy !== null || savingOrder);
  const displayed = blocks.map((row) => ({ row, result: rowResults[row.id] }));
  for (const [id, result] of Object.entries(rowResults)) {
    if (result?.removed && !blocks.some((row) => row.id === id)) {
      displayed.splice(Math.min(result.position, displayed.length), 0, { row: { id }, result });
    }
  }
  const leaveGuard = useUnsavedNavigation(draft.dirty, { blocked: savingOrder || busy !== null });
  const allowed = sectionBlockTypes(page?.current, section, BLOCK_TYPE_IDS);
  const maxBlocks = Number.isFinite(section?.maxBlocks) ? section.maxBlocks : Infinity;
  // While either cmsContent revision is still loading, `blocks` can be an
  // undercount (e.g. the live listener reported an empty result but the
  // drafts listener, which might hold this section's only blocks, has not
  // yet) — treating that as "under the cap" would let an operator start a
  // create past maxBlocks on a slow connection. Block the action instead of
  // guessing until both listeners have actually reported.
  const atMax = !pagesReady || !contentReady || serverBlocks.length >= maxBlocks;
  const blockedReason = !pagesReady || !contentReady
    ? 'Waiting for this section and its draft blocks…'
    : atMax ? `This section already has its maximum of ${maxBlocks} blocks.` : '';
  const setRowResult = (id, result) => setRowResults((current) => ({ ...current, [id]: result }));

  useEffect(() => {
    if (!contentReady) return;
    const present = new Set(contentRows.filter((row) => row.current?.section === sectionId).map((row) => row.id));
    setRowResults((current) => {
      let next = current;
      for (const [id, result] of Object.entries(current)) {
        if (!result?.removed) continue;
        if (!present.has(id) && !result.removalObserved) {
          next = { ...next, [id]: { ...result, removalObserved: true } };
        } else if (present.has(id) && result.removalObserved) {
          // Another tab can create the same deterministic section/field ID.
          // Keep the focused result node while restoring the current controls.
          next = { ...next, [id]: { tone: 'ok', message: 'This block is available again. Review its current content.' } };
        }
      }
      return next;
    });
  }, [contentRows, contentReady, sectionId, rowResults]);

  useEffect(() => {
    const node = frameRef.current;
    if (!node) return undefined;
    if (leaveGuard.pending) node.setAttribute('inert', '');
    else node.removeAttribute('inert');
    return () => node.removeAttribute('inert');
  }, [leaveGuard.pending]);

  function moveRow(from, to) {
    if (!contentReady || savingOrder || busy !== null) return false;
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
    if (!contentReady || requestPending.current) return;
    requestPending.current = true;
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
    requestPending.current = false;
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
    if (requestPending.current) return;
    requestPending.current = true;
    actionFocus.remember(row.id);
    setBusy({ id: row.id, action: 'publish' });
    setRowResult(row.id, null);
    try {
      const response = await call('cmsPublish', { collection: 'cmsContent', docIds: [row.id] });
      const verdict = summarizePublish(response, 'cmsContent', [row.id], 'content blocks');
      setRowResult(row.id, { tone: verdict.ok ? 'ok' : 'error', message: verdict.message });
      if (verdict.ok) setResolvedIds((current) => new Set([...current, row.id]));
    } catch (err) {
      setRowResult(row.id, { tone: 'error', message: err.message });
    } finally {
      requestPending.current = false;
      setBusy(null);
    }
  }

  async function remove(row) {
    if (requestPending.current) return;
    requestPending.current = true;
    actionFocus.remember(row.id);
    setBusy({ id: row.id, action: 'delete' });
    setRowResult(row.id, null);
    const label = contentBlockTitle(row.current);
    const position = blocks.findIndex((block) => block.id === row.id);
    try {
      await call('cmsDeleteContent', { section: sectionId, field: row.current.field });
      setRowResult(row.id, { tone: 'ok', message: `${label} deleted. The live block and its draft were removed.`, removed: true, label, position });
    } catch (err) {
      setRowResult(row.id, { tone: 'error', message: err.message });
    } finally {
      requestPending.current = false;
      setBusy(null);
    }
  }

  const addBlockButton =
    atMax ? (
      <button
        type="button"
        className={primaryButtonClass}
        disabled
        aria-describedby={blockedReasonId}
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
        description={allowed.length === BLOCK_TYPE_IDS.length ? 'Add and edit content in this section.' : `Available content: ${allowed.map(blockTypeLabel).join(', ')}.`}
        actions={
          <>
            <OrderDraftButtons
              dirty={draft.dirty}
              saving={savingOrder}
              saveDisabled={!contentReady || busy !== null}
              onSave={saveOrder}
              onCancel={cancelOrder}
            />
            <Link to="../.." relative="path" className={linkButtonClass}>
              Back to content
            </Link>
            {addBlockButton}
            {allowed.length > 0 && blockedReason ? <p id={blockedReasonId} className="basis-full text-admin-sm text-admin-ink-secondary">{blockedReason}</p> : null}
            <ActionFeedback message={notice?.message} tone={notice?.tone} className="admin-editor-action-feedback" />
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

      {pageId === 'home' && sectionId === 'hero' && !serverBlocks.some((row) => row.current?.blockType === 'image') ? (
        <HomeHeroImageEditor
          page={page}
          rows={contentRows}
          ready={pagesReady && contentReady}
          disabled={savingOrder || busy !== null || draft.dirty}
        />
      ) : null}

      {displayed.length === 0 ? (
        <AdminEmptyState
          title="No blocks yet"
          description="Add the first content block for this section."
          action={addBlockButton}
        />
      ) : (
        <Panel flush>
          <ul>
            {displayed.map(({ row, result }) => {
              const index = blocks.findIndex((block) => block.id === row.id);
              const label = result?.removed ? result.label : contentBlockTitle(row.current);
              if (result?.removed) return (
                <li key={row.id} className="border-b-admin-hairline border-admin-rule-hairline last:border-b-0">
                  <div className={rowClass}><p className="font-admin-ui text-admin-base font-semibold text-admin-ink">{label}</p><StatusBadge tone="neutral">Deleted</StatusBadge></div>
                  <div ref={actionFocus.resultRef(row.id)} tabIndex={-1} className="admin-row-result"><ActionFeedback {...result} /></div>
                </li>
              );
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
                      ) : isStarterContent(row.current) ? (
                        <StatusBadge tone="caution">Hidden until filled in</StatusBadge>
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
                      disabled={!contentReady || savingOrder || busy !== null}
                    />
                    {row.state.id !== 'live' && !draft.dirty ? (
                      <button
                        type="button"
                        className={secondaryButtonClass}
                        disabled={savingOrder || (busy !== null && !(busy.id === row.id && busy.action === 'publish'))}
                        aria-disabled={busy !== null || savingOrder || undefined}
                        aria-busy={busy?.id === row.id && busy.action === 'publish' || undefined}
                        onClick={() => publishOne(row)}
                      >
                        {busy?.id === row.id && busy.action === 'publish' ? 'Publishing…' : 'Publish'}
                      </button>
                    ) : null}
                    <EditRecordLink to={row.current.field} label={`Edit ${label}`} />
                    <DestructiveConfirm
                      trigger="Delete"
                      title={`Delete ${contentBlockTitle(row.current)}`}
                      confirmLabel="Delete this block"
                      busyLabel="Deleting…"
                      busy={busy?.id === row.id && busy.action === 'delete'}
                      disabled={busy !== null || savingOrder}
                      consequence="The live revision and its draft both go, and the section renders without this block."
                      permanence="This cannot be undone."
                      onConfirm={() => remove(row)}
                    />
                  </div>
                </div>
                <div ref={actionFocus.resultRef(row.id)} tabIndex={-1} className="admin-row-result"><ActionFeedback message={result?.message} tone={result?.tone} /></div>
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
