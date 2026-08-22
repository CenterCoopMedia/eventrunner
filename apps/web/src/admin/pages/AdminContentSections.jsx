// Content editor, step 2 (issue #61): the sections of one page, each with
// how many content blocks it currently holds. Section structure (id, label,
// allowedBlocks, maxBlocks) comes from the page's own doc — the CURRENT one
// (draft if it has one, else live), same as AdminPageEditor reads it — so a
// section just renamed in a draft shows its new label here immediately.
import { Link, useParams } from 'react-router-dom';
import EmptyState from '../../components/EmptyState.jsx';
import LoadingState from '../../components/LoadingState.jsx';
import { useAdminPages } from '../useAdminPages.js';
import { useAdminContent } from '../useAdminContent.js';
import { Panel, secondaryButtonClass } from '../components/formControls.jsx';

export default function AdminContentSections() {
  const { pageId } = useParams();
  const { findRow, loading: pagesLoading } = useAdminPages();
  const { rows: contentRows, loading: contentLoading } = useAdminContent();

  const page = findRow(pageId);
  const sections = page?.current?.sections ?? [];

  if (pagesLoading && !page) {
    return <LoadingState label="Loading page…" />;
  }
  if (!pagesLoading && !page) {
    return (
      <EmptyState
        title="No such page"
        description="That page id has neither a published nor a draft revision."
        action={
          <Link to=".." relative="path" className={secondaryButtonClass}>
            Back to content
          </Link>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-brand-ink">
            {page.current?.label || page.id} — sections
          </h1>
          <p className="text-sm text-brand-ink-muted">
            Each section holds the content blocks the public page renders in
            that slot.
          </p>
        </div>
        <Link to=".." relative="path" className={secondaryButtonClass}>
          Back to content
        </Link>
      </div>

      {sections.length === 0 ? (
        <EmptyState
          title="No sections"
          description="Add a section to this page in Pages before editing its content."
        />
      ) : (
        <Panel>
          <ul className="divide-y divide-brand-ink/10">
            {sections.map((section) => {
              const count = contentRows.filter(
                (row) => row.current?.section === section.id,
              ).length;
              return (
                <li
                  key={section.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <Link
                      to={section.id}
                      className="touch-target inline-flex items-center rounded-brand font-semibold text-brand-ink underline underline-offset-4 hover:text-brand-primary-dark"
                    >
                      {section.label || section.id}
                    </Link>
                    <p className="mt-1 truncate text-sm text-brand-ink-muted">
                      {contentLoading ? 'Loading…' : `${count} block${count === 1 ? '' : 's'}`}
                      {' · max '}
                      {section.maxBlocks}
                    </p>
                  </div>
                  <Link to={section.id} className={secondaryButtonClass}>
                    Open
                  </Link>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
    </div>
  );
}
