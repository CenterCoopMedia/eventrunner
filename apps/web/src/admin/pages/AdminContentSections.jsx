import HelpTooltip from '../components/HelpTooltip.jsx';
// Sections use the current page revision, so an unpublished rename remains
// visible here. Block counts wait for both content revisions before stating
// a total; one published block plus its draft is still one block.
import { builtInSectionBlockTypes } from 'shared/page';
import { Link, useParams } from 'react-router';
import { useAdminPages } from '../useAdminPages.js';
import { useAdminContent } from '../useAdminContent.js';
import { blockTypeFor } from '../blockTypes.js';
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
import AdminIconControl from '../components/AdminIconControl.jsx';
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
        description={pagesReady ? 'This page is no longer available. Choose another page.' : 'Check your connection to load the page.'}
        action={<Link to="/admin/content" className={linkButtonClass}>Back to content</Link>}
      />
    );
  }

  const pageName = page.current?.label || 'Untitled page';
  const target = contentManagementTarget(page);
  const identifiers = `${sections.length} section${sections.length === 1 ? '' : 's'}`;

  return (
    <div className="admin-content-browser flex flex-col gap-md">
      <AdminPageHeader help="Choose a section to edit."
        title={pageName}
        identifiers={identifiers}
        description="Choose a section to edit."
        actions={
          <>
            <Link to="/admin/content" className={linkButtonClass}>Back to content</Link>
            <AdminIconControl as={Link} to={pageStructurePath(page.id)} icon="edit" label="Edit page structure" />
          </>
        }
      />

      {pagesError || contentError ? (
        <Notice tone="caution" message="Some content could not refresh. Check your connection." />
      ) : null}

      {sections.length === 0 ? (
        <AdminEmptyState
          title="No sections"
          description={target ? `This page’s main content is managed in ${target.name}.` : 'Add a section to start writing.'}
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
              const sectionName = section.label || 'Untitled section';
              const count = contentRows.filter((row) => row.current?.section === section.id).length;
              const types = (builtInSectionBlockTypes(page, section) ?? []).map((type) => blockTypeFor(type)?.label ?? 'Content block');
              const to = contentSectionPath(page.id, section.id);
              return (
                <li key={section.id} className="admin-content-section">
                  <div className="admin-content-section__description">
                    <div className="flex items-center gap-2xs"><h2 className="font-admin-ui">
                      <Link to={to} className={`${rowTitleLinkClass} admin-content-page-name`}>{sectionName}</Link></h2><HelpTooltip label="{sectionName}">Open this section to edit its content blocks.</HelpTooltip></div>
                    {section.description ? <p>{section.description}</p> : null}
                    <p className="admin-content-section__types">
                      <span>Content: </span>{types.length ? types.join(', ') : 'Any content'}
                    </p>
                  </div>
                  <div className="admin-content-section__count">
                    <p>{contentReady ? `${count} block${count === 1 ? '' : 's'}` : contentError ? 'Block count unavailable' : 'Loading blocks…'}</p>
                    {Number.isFinite(section.maxBlocks) ? <p className="admin-content-section__limit">Limit: {section.maxBlocks} block{section.maxBlocks === 1 ? '' : 's'}</p> : null}
                  </div>
                  <AdminIconControl as={Link} to={to} icon="edit" label={`Edit content in ${sectionName}`} className="admin-content-section__action" />
                </li>
              );
            })}
          </ol>
        </Panel>
      )}
    </div>
  );
}
