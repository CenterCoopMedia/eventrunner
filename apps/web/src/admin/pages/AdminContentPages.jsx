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
import '../contentBrowser.css';

function PageSections({ row }) {
  const sections = Array.isArray(row.current?.sections) ? row.current.sections : [];
  if (sections.length > 0) {
    return (
      <ul className="admin-content-section-links" role="list" aria-label={`Sections in ${row.current?.label || row.id}`}>
        {sections.map((section) => (
          <li key={section.id}>
            <Link to={contentSectionPath(row.id, section.id)} className="admin-content-section-link">
              {section.label || section.id}
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
        description="Find a page or jump straight to a section."
        actions={<Link to="/admin/pages" className={linkButtonClass}>Manage page structure</Link>}
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
          title={ready ? 'No pages yet' : 'The page list is not available yet'}
          description={ready ? 'Create a page in Pages before editing its content.' : 'We are waiting for the page list to reconnect.'}
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
                    placeholder="Page name, path, or section"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    aria-describedby={resultId}
                  />
                </div>
                {query ? <button type="button" className={secondaryButtonClass} onClick={clearSearch}>Clear search</button> : null}
              </div>
            </div>
            <p id={resultId} role="status" aria-atomic="true" className="admin-content-browser__result">
              {hasQuery ? `${filtered.length} of ${rows.length} page${rows.length === 1 ? '' : 's'}` : `${rows.length} page${rows.length === 1 ? '' : 's'}`}
            </p>
          </div>

          {filtered.length === 0 ? (
            <AdminEmptyState
              title="No matching pages"
              description={`No page name, path, or section matches “${query.trim()}”. Clear the search to see every page.`}
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
                          {row.current?.label || row.id}
                        </Link>
                        {row.current?.path ? <p className="admin-content-page-path">{row.current.path}</p> : null}
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
          <p className="admin-content-browser__note">Page state is for the page’s structure. Open a section to review its content drafts.</p>
        </>
      )}
    </div>
  );
}
