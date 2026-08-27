// Content editor, step 3 (issue #61): every content block currently in one
// section, its publish state, and the entry points to create, edit, publish,
// and delete. "Add block" respects the section's own allowedBlocks/maxBlocks
// (set in Pages) — offered only when the section allows at least one block
// type, and disabled once the section is at its cap, same guardrail
// AdminPageEditor's block picker applies to defaultBlocks.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAdminApi } from '../adminApi.js';
import { useAdminPages } from '../useAdminPages.js';
import { useAdminContent } from '../useAdminContent.js';
import { blockTypeLabel } from '../blockTypes.js';
import { summarizePublish } from '../publishResult.js';
import {
  DestructiveConfirm,
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

export default function AdminContentSection() {
  const { pageId, sectionId } = useParams();
  const call = useAdminApi();
  const { showToast } = useToast();
  const { findRow: findPage, loading: pagesLoading } = useAdminPages();
  const { rows: contentRows, loading: contentLoading, error: contentError } = useAdminContent();
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState(null);
  // Blocks published in THIS session: their proof tint resolves to the base
  // ground rather than vanishing (moment 1).
  const [resolvedIds, setResolvedIds] = useState(() => new Set());

  const page = findPage(pageId);
  const section = (page?.current?.sections ?? []).find((candidate) => candidate.id === sectionId);
  const blocks = contentRows.filter((row) => row.current?.section === sectionId);
  const allowed = section?.allowedBlocks ?? [];
  const maxBlocks = Number.isFinite(section?.maxBlocks) ? section.maxBlocks : Infinity;
  // While either cmsContent revision is still loading, `blocks` can be an
  // undercount (e.g. the live listener reported an empty result but the
  // drafts listener, which might hold this section's only blocks, has not
  // yet) — treating that as "under the cap" would let an operator start a
  // create past maxBlocks on a slow connection. Block the action instead of
  // guessing until both listeners have actually reported.
  const atMax = contentLoading || blocks.length >= maxBlocks;

  if ((pagesLoading || contentLoading) && !section) {
    return <AdminLoadingState label="Loading section…" />;
  }
  if (!pagesLoading && (!page || !section)) {
    return (
      <AdminEmptyState
        title="No such section"
        description="That section doesn’t exist on this page (any more)."
        action={
          <Link to="../.." relative="path" className={secondaryButtonClass}>
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
          contentLoading
            ? 'Loading this section’s blocks…'
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
    <div className="flex flex-col gap-md">
      <AdminPageHeader
        title={section?.label || sectionId}
        identifiers={`${pageId} · ${sectionId} · ${blocks.length} block${
          blocks.length === 1 ? '' : 's'
        }`}
        description={`${page?.current?.label ?? pageId} · allows ${
          allowed.length ? allowed.map(blockTypeLabel).join(', ') : 'no block types yet'
        }`}
        actions={
          <>
            <Link to="../.." relative="path" className={secondaryButtonClass}>
              Back to content
            </Link>
            {addBlockButton}
          </>
        }
      />

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
            {blocks.map((row) => (
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
                        to={row.current.field}
                        className="admin-target inline-flex items-center rounded-admin font-admin-data font-semibold text-admin-ink underline underline-offset-4"
                      >
                        {row.current.field}
                      </Link>
                      <RecordState state={row.state} />
                      <span className="text-folio text-admin-ink-secondary">
                        {blockTypeLabel(row.current.blockType)}
                      </span>
                      {row.current.visible === false ? (
                        <span className="font-admin-data text-folio text-admin-ink-secondary">
                          Hidden
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-xs">
                    {row.state.id !== 'live' ? (
                      <button
                        type="button"
                        className={secondaryButtonClass}
                        disabled={busyId !== null}
                        onClick={() => publishOne(row)}
                      >
                        {busyId === row.id ? 'Publishing…' : 'Publish this block'}
                      </button>
                    ) : null}
                    <Link to={row.current.field} className={secondaryButtonClass}>
                      Edit
                    </Link>
                    <DestructiveConfirm
                      trigger="Delete"
                      title={`Delete ${row.current.field}`}
                      confirmLabel="Delete this block"
                      busyLabel="Deleting…"
                      busy={busyId === row.id}
                      disabled={busyId !== null}
                      consequence={`The live revision of ${row.current.field} and its draft both go, and the section renders without it.`}
                      permanence="This cannot be undone."
                      onConfirm={() => remove(row)}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
