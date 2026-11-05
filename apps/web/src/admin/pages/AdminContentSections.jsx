// Sections use the current page revision, so an unpublished rename remains
// visible here. Block counts wait for both content revisions before stating
// a total; one published block plus its draft is still one block.
import { Link, useParams } from 'react-router';
import { useAdminPages } from '../useAdminPages.js';
import { useAdminContent } from '../useAdminContent.js';
import { blockTypeLabel } from '../blockTypes.js';
import { contentManagementTarget, contentSectionPath, pageStructurePath } from '../contentBrowser.js';
import {
  Notice,
  Panel,
  linkButtonClass,
  rowTitleLinkClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import AdminPageHeader, {
  AdminEmptyState,
  AdminLoadingState,
} from '../components/adminChrome.jsx';
import '../contentBrowser.css';

export default function AdminContentSections() {
  const { pageId } = useParams();
  const { findRow, loading: pagesLoading, ready: pagesReady, error: pagesError } = useAdminPages();
  const { rows: contentRows, ready: contentReady, error: contentError } = useAdminContent();
  const page = findRow(pageId);
  const sections = Array.isArray(page?.current?.sections) ? page.current.sections : [];

  if (pagesLoading && !page) return <AdminLoadingState label="Loading page…" />;
  if (!page) {
    return (
      <AdminEmptyState
        title={pagesReady ? 'No such page' : 'The page is not available yet'}
        description={pagesReady ? 'That page id has neither a published nor a draft revision.' : 'We are waiting for the page list to reconnect.'}
        action={<Link to="/admin/content" className={linkButtonClass}>Back to content</Link>}
      />
    );
  }

  const pageName = page.current?.label || page.id;
  const target = contentManagementTarget(page);
  const identifiers = [page.current?.path, `${sections.length} section${sections.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ');

  return (
    <div className="admin-content-browser flex flex-col gap-md">
      <AdminPageHeader
        title={pageName}
        identifiers={identifiers}
        description="Choose a section to edit its content. Change the sections themselves in the page structure."
        actions={
          <>
            <Link to="/admin/content" className={linkButtonClass}>Back to content</Link>
            <Link to={pageStructurePath(page.id)} className={linkButtonClass}>Edit page structure</Link>
          </>
        }
      />

      {pagesError || contentError ? (
        <Notice tone="caution" message="We lost the connection to part of this page; showing the last values we received and retrying." />
      ) : null}

      {sections.length === 0 ? (
        <AdminEmptyState
          title="No sections"
          description={target ? `This page’s main content is managed in ${target.name}.` : 'Add a section to this page in Pages before editing its content.'}
          action={
            <Link to={target?.to ?? pageStructurePath(page.id)} className={secondaryButtonClass}>
              {target?.action ?? 'Edit page structure'}
            </Link>
          }
        />
      ) : (
        <Panel flush className="admin-content-browser__panel">
          <ol className="admin-content-sections" role="list" aria-label={`Sections in ${pageName}`}>
            {sections.map((section) => {
              const sectionName = section.label || section.id;
              const count = contentRows.filter((row) => row.current?.section === section.id).length;
              const types = Array.isArray(section.allowedBlocks) ? section.allowedBlocks.map(blockTypeLabel) : [];
              const to = contentSectionPath(page.id, section.id);
              return (
                <li key={section.id} className="admin-content-section">
                  <div className="admin-content-section__description">
                    <h2 className="font-admin-ui">
                      <Link to={to} className={`${rowTitleLinkClass} admin-content-page-name`}>{sectionName}</Link>
                    </h2>
                    {section.description ? <p>{section.description}</p> : null}
                    <p className="admin-content-section__types">
                      <span>Allowed content: </span>{types.length ? types.join(', ') : 'No new block types'}
                    </p>
                  </div>
                  <div className="admin-content-section__count">
                    <p>{contentReady ? `${count} block${count === 1 ? '' : 's'}` : contentError ? 'Block count unavailable' : 'Loading blocks…'}</p>
                    {Number.isFinite(section.maxBlocks) ? <p className="admin-content-section__limit">Limit: {section.maxBlocks} block{section.maxBlocks === 1 ? '' : 's'}</p> : null}
                  </div>
                  <Link to={to} className={`${linkButtonClass} admin-content-section__action`} aria-label={`Edit content in ${sectionName}`}>
                    Edit content <span aria-hidden="true">→</span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </Panel>
      )}
    </div>
  );
}
