// Content editor, step 1 (issue #61): pick a page, then a section, then the
// content block inside it. AdminPageEditor already lets staff shape a page's
// structure — its sections, allowed block types, and default blocks — but it
// has no way to fill in what a block actually SAYS. This tree of screens is
// that: browse → section → block, editing the cmsContent VALUE the public
// renderers (components/blocks/) read.
import { Link } from 'react-router-dom';
import { useAdminPages } from '../useAdminPages.js';
import { Notice, Panel } from '../components/formControls.jsx';
import AdminPageHeader, {
  AdminEmptyState,
  AdminLoadingState,
  RecordState,
  proofRowClass,
} from '../components/adminChrome.jsx';

export default function AdminContentPages() {
  const { rows, loading, error } = useAdminPages();

  return (
    <div className="flex flex-col gap-md">
      <AdminPageHeader
        title="Content"
        identifiers={`${rows.length} page${rows.length === 1 ? '' : 's'}`}
        description="Pick a page, then a section, to edit the content blocks inside it. To change a page’s structure — its sections and which block types they allow — use Pages instead."
      />

      {error ? (
        <Notice
          tone="caution"
          message="We lost the connection to the page list; showing the last values we received and retrying."
        />
      ) : null}

      {loading ? (
        <AdminLoadingState label="Loading pages…" />
      ) : rows.length === 0 ? (
        <AdminEmptyState
          title="No pages yet"
          description="Create a page first, in Pages, before editing its content."
        />
      ) : (
        <Panel flush>
          <ul>
            {rows.map((row) => {
              const sectionCount = (row.current?.sections ?? []).length;
              return (
                <li
                  key={row.id}
                  className={`border-admin-rule-hairline border-b-admin-hairline last:border-b-0 ${proofRowClass(
                    row.state.id,
                  )}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-sm px-md py-xs">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-sm gap-y-3xs">
                        <Link
                          to={row.id}
                          className="admin-target inline-flex items-center rounded-admin font-semibold text-admin-ink underline underline-offset-4"
                        >
                          {row.current?.label || row.id}
                        </Link>
                        <RecordState state={row.state} />
                      </div>
                      <p className="mt-3xs truncate font-admin-data text-folio text-admin-ink-data">
                        {sectionCount} section{sectionCount === 1 ? '' : 's'}
                      </p>
                    </div>
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
