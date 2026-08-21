// Content editor, step 1 (issue #61): pick a page, then a section, then the
// content block inside it. AdminPageEditor already lets staff shape a page's
// structure — its sections, allowed block types, and default blocks — but it
// has no way to fill in what a block actually SAYS. This tree of screens is
// that: browse → section → block, editing the cmsContent VALUE the public
// renderers (components/blocks/) read.
import { Link } from 'react-router-dom';
import EmptyState from '../../components/EmptyState.jsx';
import LoadingState from '../../components/LoadingState.jsx';
import { useAdminPages } from '../useAdminPages.js';
import { Panel } from '../components/formControls.jsx';

export default function AdminContentPages() {
  const { rows, loading, error } = useAdminPages();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-brand-ink">Content</h1>
        <p className="text-sm text-brand-ink-muted">
          Pick a page, then a section, to edit the content blocks inside it.
          To change a page&rsquo;s structure — its sections and which block
          types they allow — use Pages instead.
        </p>
      </div>

      {error ? (
        <p
          role="status"
          className="rounded-brand border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning"
        >
          We lost the connection to the page list; showing the last values we
          received and retrying.
        </p>
      ) : null}

      {loading ? (
        <LoadingState label="Loading pages…" />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No pages yet"
          description="Create a page first, in Pages, before editing its content."
        />
      ) : (
        <Panel>
          <ul className="divide-y divide-brand-ink/10">
            {rows.map((row) => {
              const sectionCount = (row.current?.sections ?? []).length;
              return (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <Link
                      to={row.id}
                      className="touch-target inline-flex items-center rounded-brand font-semibold text-brand-ink underline underline-offset-4 hover:text-brand-primary-dark"
                    >
                      {row.current?.label || row.id}
                    </Link>
                    <p className="mt-1 truncate text-sm text-brand-ink-muted">
                      {sectionCount} section{sectionCount === 1 ? '' : 's'}
                    </p>
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
