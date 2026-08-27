// Content editor, step 2 (issue #61): the sections of one page, each with
// how many content blocks it currently holds. Section structure (id, label,
// allowedBlocks, maxBlocks) comes from the page's own doc — the CURRENT one
// (draft if it has one, else live), same as AdminPageEditor reads it — so a
// section just renamed in a draft shows its new label here immediately.
//
// The galley pattern here is the same one AdminContentSection.jsx (step 3,
// singular) uses for its blocks: hairline rows in a Panel, no zebra, no row
// cards. This list carries no publish state of its own — a section is
// structure, not a record — so its rows carry only the count in the data
// face.
import { Link, useParams } from 'react-router-dom';
import { useAdminPages } from '../useAdminPages.js';
import { useAdminContent } from '../useAdminContent.js';
import { Panel, secondaryButtonClass } from '../components/formControls.jsx';
import AdminPageHeader, {
  AdminEmptyState,
  AdminLoadingState,
} from '../components/adminChrome.jsx';

export default function AdminContentSections() {
  const { pageId } = useParams();
  const { findRow, loading: pagesLoading } = useAdminPages();
  const { rows: contentRows, loading: contentLoading } = useAdminContent();

  const page = findRow(pageId);
  const sections = page?.current?.sections ?? [];

  if (pagesLoading && !page) {
    return <AdminLoadingState label="Loading page…" />;
  }
  if (!pagesLoading && !page) {
    return (
      <AdminEmptyState
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
    <div className="flex flex-col gap-md">
      <AdminPageHeader
        title={page.current?.label || page.id}
        identifiers={`${sections.length} section${sections.length === 1 ? '' : 's'}`}
        description="Each section holds the content blocks the public page renders in that slot."
        actions={
          <Link to=".." relative="path" className={secondaryButtonClass}>
            Back to content
          </Link>
        }
      />

      {sections.length === 0 ? (
        <AdminEmptyState
          title="No sections"
          description="Add a section to this page in Pages before editing its content."
        />
      ) : (
        <Panel flush>
          <ul>
            {sections.map((section) => {
              const count = contentRows.filter(
                (row) => row.current?.section === section.id,
              ).length;
              return (
                <li
                  key={section.id}
                  className="border-admin-rule-hairline border-b-admin-hairline last:border-b-0"
                >
                  <div className="flex flex-wrap items-center justify-between gap-sm px-md py-xs">
                    <div className="min-w-0">
                      <Link
                        to={section.id}
                        className="admin-target inline-flex items-center rounded-admin font-semibold text-admin-ink underline underline-offset-4"
                      >
                        {section.label || section.id}
                      </Link>
                      <p className="mt-3xs truncate font-admin-data text-folio text-admin-ink-data">
                        {contentLoading ? 'Loading…' : `${count} block${count === 1 ? '' : 's'}`}
                        {' · max '}
                        {section.maxBlocks}
                      </p>
                    </div>
                    <Link to={section.id} className={secondaryButtonClass}>
                      Open
                    </Link>
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
