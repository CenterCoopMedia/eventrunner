// Pages list (issue #13): every cmsPages document with its publish state —
// live revision, draft revision, or both — plus the entry points to create,
// edit, and publish.
//
// The two-revision model (spec §8.4) is visible rather than hidden: a page
// can be "Never published" (draft only), have "Unpublished changes" (a dirty
// draft over a live doc), or be "Published". Publishing is a Firestore
// revision copy via cmsPublish, so it happens right here — no deploy.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../contexts/ToastContext.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import LoadingState from '../../components/LoadingState.jsx';
import { useAdminApi } from '../adminApi.js';
import { useAdminPages } from '../useAdminPages.js';
import { Panel, primaryButtonClass, secondaryButtonClass } from '../components/formControls.jsx';

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

export default function AdminPagesList() {
  const { rows, loading, error } = useAdminPages();
  const call = useAdminApi();
  const { showToast } = useToast();
  const [publishing, setPublishing] = useState(null);

  const pendingIds = rows.filter((row) => row.state.id !== 'published').map((row) => row.id);

  async function publishAll() {
    setPublishing('all');
    try {
      // Only the pages with something to publish: cmsPublish republishes any
      // doc that has a draft, bumping its revision, so sending clean pages
      // would churn revisions for no change.
      await call('cmsPublish', { collection: 'cmsPages', docIds: pendingIds });
      showToast('Published. The public site picks it up live.');
    } catch (err) {
      showToast(err.message, { tone: 'error' });
    } finally {
      setPublishing(null);
    }
  }

  const dirtyCount = pendingIds.length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-brand-ink">Pages</h1>
          <p className="text-sm text-brand-ink-muted">
            Every page on the site, and whether its latest edit is live yet.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
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
            New page
          </Link>
        </div>
      </div>

      {error ? (
        <p role="status" className="rounded-brand border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          We lost the connection to the page list; showing the last values we
          received and retrying.
        </p>
      ) : null}

      {loading ? (
        <LoadingState label="Loading pages…" />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No pages yet"
          description="Create the first page — a title, a path, and the sections its content lives in."
          action={
            <Link to="new" className={primaryButtonClass}>
              New page
            </Link>
          }
        />
      ) : (
        <Panel>
          <ul className="divide-y divide-brand-ink/10">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      to={row.id}
                      className="touch-target inline-flex items-center rounded-brand font-semibold text-brand-ink underline underline-offset-4 hover:text-brand-primary-dark"
                    >
                      {row.current?.label || row.id}
                    </Link>
                    <StateChip state={row.state} />
                    {row.current?.systemPage ? (
                      <span className="rounded-brand border border-brand-ink/20 px-2 py-1 text-xs text-brand-ink-muted">
                        System page
                      </span>
                    ) : null}
                    {row.current?.visible === false ? (
                      <span className="rounded-brand border border-brand-ink/20 px-2 py-1 text-xs text-brand-ink-muted">
                        Hidden
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 truncate text-sm text-brand-ink-muted">
                    {row.current?.path} · {(row.current?.sections ?? []).length} section
                    {(row.current?.sections ?? []).length === 1 ? '' : 's'}
                  </p>
                </div>
                <Link to={row.id} className={secondaryButtonClass}>
                  Edit
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
