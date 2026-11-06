// The Content index opens a page or goes straight to one of its sections.
// Page state describes the page document, not the blocks inside it; those
// retain their own publication states in the section editor.
import { useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useAdminPages } from '../useAdminPages.js';
import {
  contentManagementTarget,
  contentPagePath,
  contentSectionPath,
  filterContentPages,
  pageStructurePath,
} from '../contentBrowser.js';
import {
  Notice,
  Panel,
  fieldLabelClass,
  inputClass,
  linkButtonClass,
  rowTitleLinkClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import AdminPageHeader, {
  AdminEmptyState,
  AdminLoadingState,
  RecordState,
} from '../components/adminChrome.jsx';
import AdminIconControl from '../components/AdminIconControl.jsx';
import '../contentBrowser.css';

function PageSections({ row }) {
  const sections = Array.isArray(row.current?.sections) ? row.current.sections : [];
  if (sections.length > 0) {
    return (
      <ul className="admin-content-section-links" role="list" aria-label={`Sections in ${row.current?.label || 'Untitled page'}`}>
        {sections.map((section) => (
          <li key={section.id}>
            <Link to={contentSectionPath(row.id, section.id)} className="admin-content-section-link">
              {section.label || 'Untitled section'}
            </Link>
          </li>
        ))}
      </ul>
    );
  }
  const target = contentManagementTarget(row);
  return (
    <div className="admin-content-no-sections">
      <p>{target ? `Managed in ${target.name}.` : 'No sections yet.'}</p>
      <Link to={target?.to ?? pageStructurePath(row.id)} className="admin-content-section-link">
        {target?.action ?? 'Edit page structure'}
      </Link>
    </div>
  );
}

export default function AdminContentPages() {
  const { rows, loading, ready, error } = useAdminPages();
  const [query, setQuery] = useState('');
  const searchId = useId();
  const searchRef = useRef(null);
  const resultId = `${searchId}-results`;
  const filtered = filterContentPages(rows, query);
  const hasQuery = query.trim().length > 0;

  function clearSearch() {
    setQuery('');
    searchRef.current?.focus();
  }

  return (
    <div className="admin-content-browser flex flex-col gap-md">
      <AdminPageHeader
        title="Content"
        actions={<Link to="/admin/pages" className={linkButtonClass}>Manage page structure</Link>}
      />

      {error ? (
        <Notice
          tone="caution"
          message="The page list could not refresh. Check your connection."
        />
      ) : null}

      {loading ? (
        <AdminLoadingState label="Loading pages…" />
      ) : rows.length === 0 ? (
        <AdminEmptyState
          title={ready ? 'No pages yet' : 'The page list is not available yet'}
          description={ready ? 'Create your first page to add content.' : 'Check your connection to load the page list.'}
          action={ready ? <Link to="/admin/pages/new" className={secondaryButtonClass}>Create a page</Link> : null}
        />
      ) : (
        <>
          <div className="admin-content-browser__toolbar" role="search" aria-label="Find content">
            <div className="admin-content-search">
              <label htmlFor={searchId} className={fieldLabelClass}>Search pages and sections</label>
              <div className="admin-content-search__controls">
                <div className="admin-content-search__field">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
                    <circle cx="10.5" cy="10.5" r="6.5" />
                    <path d="m15.5 15.5 5 5" />
                  </svg>
                  <input
                    ref={searchRef}
                    id={searchId}
                    type="search"
                    className={inputClass}
                    placeholder="Page or section name"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    aria-describedby={resultId}
                  />
                </div>
                {query ? <AdminIconControl label="Clear search" icon="close" onClick={clearSearch} /> : null}
              </div>
            </div>
            <p id={resultId} role="status" aria-atomic="true" className="admin-content-browser__result">
              {hasQuery ? `${filtered.length} of ${rows.length} page${rows.length === 1 ? '' : 's'}` : `${rows.length} page${rows.length === 1 ? '' : 's'}`}
            </p>
          </div>

          {filtered.length === 0 ? (
            <AdminEmptyState
              title="No matching pages"
              description={`No pages match “${query.trim()}”.`}
              action={<AdminIconControl label="Clear search" icon="close" onClick={clearSearch} />}
            />
          ) : (
            <Panel flush className="admin-content-browser__panel">
              {/* Explicit native roles keep the table's reading order when
                  narrow screens stack its cells into one compact record. */}
              <table className="admin-content-index" role="table">
                <caption className="sr-only">Pages, their content sections, and page publication states.</caption>
                <thead role="rowgroup">
                  <tr role="row">
                    <th scope="col" role="columnheader">Page</th>
                    <th scope="col" role="columnheader">Sections</th>
                    <th scope="col" role="columnheader">Page state</th>
                  </tr>
                </thead>
                <tbody role="rowgroup">
                  {filtered.map((row) => (
                    <tr key={row.id} role="row" data-page-state={row.state.id}>
                      <th scope="row" role="rowheader" className="admin-content-index__page">
                        <Link to={contentPagePath(row.id)} className={`${rowTitleLinkClass} admin-content-page-name`}>
                          {row.current?.label || 'Untitled page'}
                        </Link>
                      </th>
                      <td role="cell" className="admin-content-index__sections">
                        <span className="admin-content-index__mobile-label" aria-hidden="true">Sections</span>
                        <PageSections row={row} />
                      </td>
                      <td role="cell" className="admin-content-index__state">
                        <span className="admin-content-index__mobile-label" aria-hidden="true">Page state</span>
                        <RecordState state={row.state} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
