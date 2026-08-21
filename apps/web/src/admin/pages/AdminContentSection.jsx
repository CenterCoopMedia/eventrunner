// Content editor, step 3 (issue #61): every content block currently in one
// section, its publish state, and the entry points to create, edit, publish,
// and delete. "Add block" respects the section's own allowedBlocks/maxBlocks
// (set in Pages) — offered only when the section allows at least one block
// type, and disabled once the section is at its cap, same guardrail
// AdminPageEditor's block picker applies to defaultBlocks.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useToast } from '../../contexts/ToastContext.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import LoadingState from '../../components/LoadingState.jsx';
import { useAdminApi } from '../adminApi.js';
import { useAdminPages } from '../useAdminPages.js';
import { useAdminContent } from '../useAdminContent.js';
import { blockTypeLabel } from '../blockTypes.js';
import { summarizePublish } from '../publishResult.js';
import {
  Panel,
  dangerButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';

const STATE_CLASSES = {
  published: 'border-success/40 bg-success/10 text-success',
  dirty: 'border-warning/40 bg-warning/10 text-warning',
  unpublished: 'border-brand-ink/20 bg-brand-surface-alt text-brand-ink-muted',
  unknown: 'border-brand-ink/20 bg-brand-surface-alt text-brand-ink-muted',
};

function StateChip({ state }) {
  return (
    <span
      className={`inline-flex items-center rounded-brand border px-2 py-1 text-xs font-semibold ${
        STATE_CLASSES[state.id] ?? STATE_CLASSES.unknown
      }`}
    >
      {state.label}
    </span>
  );
}

export default function AdminContentSection() {
  const { pageId, sectionId } = useParams();
  const call = useAdminApi();
  const { showToast } = useToast();
  const { findRow: findPage, loading: pagesLoading } = useAdminPages();
  const { rows: contentRows, loading: contentLoading, error: contentError } = useAdminContent();
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState(null);

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
    return <LoadingState label="Loading section…" />;
  }
  if (!pagesLoading && (!page || !section)) {
    return (
      <EmptyState
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
      setNotice({ tone: verdict.ok ? 'info' : 'error', message: verdict.message });
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
        Add block
      </button>
    ) : (
      // '_new', not 'new' — see AdminApp.jsx's route comment: a field id
      // may legitimately be 'new', so the creation route uses a segment no
      // valid field id can ever match instead.
      <Link to="_new" className={primaryButtonClass}>
        Add block
      </Link>
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-brand-ink">
            {section?.label || sectionId} — blocks
          </h1>
          <p className="text-sm text-brand-ink-muted">
            {page?.current?.label} · allows{' '}
            {allowed.length ? allowed.map(blockTypeLabel).join(', ') : 'no block types yet'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="../.." relative="path" className={secondaryButtonClass}>
            Back to content
          </Link>
          {addBlockButton}
        </div>
      </div>

      {contentError ? (
        <p
          role="status"
          className="rounded-brand border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning"
        >
          We lost the connection to the content list; showing the last values
          we received and retrying.
        </p>
      ) : null}
      {notice ? (
        <p
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={
            notice.tone === 'error'
              ? 'rounded-brand border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger'
              : 'rounded-brand border border-success/40 bg-success/10 px-3 py-2 text-sm text-success'
          }
        >
          {notice.message}
        </p>
      ) : null}

      {blocks.length === 0 ? (
        <EmptyState
          title="No blocks yet"
          description="Add the first content block for this section."
          action={addBlockButton}
        />
      ) : (
        <Panel>
          <ul className="divide-y divide-brand-ink/10">
            {blocks.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      to={row.current.field}
                      className="touch-target inline-flex items-center rounded-brand font-semibold text-brand-ink underline underline-offset-4 hover:text-brand-primary-dark"
                    >
                      {row.current.field}
                    </Link>
                    <StateChip state={row.state} />
                    <span className="rounded-brand border border-brand-ink/20 px-2 py-1 text-xs text-brand-ink-muted">
                      {blockTypeLabel(row.current.blockType)}
                    </span>
                    {row.current.visible === false ? (
                      <span className="rounded-brand border border-brand-ink/20 px-2 py-1 text-xs text-brand-ink-muted">
                        Hidden
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {row.state.id !== 'published' ? (
                    <button
                      type="button"
                      className={secondaryButtonClass}
                      disabled={busyId !== null}
                      onClick={() => publishOne(row)}
                    >
                      {busyId === row.id ? 'Publishing…' : 'Publish'}
                    </button>
                  ) : null}
                  <Link to={row.current.field} className={secondaryButtonClass}>
                    Edit
                  </Link>
                  <button
                    type="button"
                    className={dangerButtonClass}
                    disabled={busyId !== null}
                    onClick={() => remove(row)}
                  >
                    {busyId === row.id ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
