// Generic content page for the catch-all route (spec §5.2, issue #52):
// renders any visible non-system cmsPages document at its own root-level
// `path` (e.g. /scholarships), so a client adding a page is a CMS action,
// not a PR. This route matches whatever none of the system routes in
// App.jsx did, so a page match is resolved from the CURRENT URL, not a
// route param — there is exactly one lookup key, the stored `path`. System
// pages own dedicated routes matched before this catch-all ever runs, but
// the systemPage guard below stays as defense in depth. Anything that
// doesn't resolve to a visible, non-system page renders the same NotFound
// used by every other unknown URL — this route IS the site's 404 path.
import { Link, useLocation } from 'react-router-dom';
import { useContent } from '../contexts/ContentContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import NotFound from './NotFound.jsx';
import SectionBlocks from '../components/blocks/SectionBlocks.jsx';

export default function ContentPage() {
  const { pathname } = useLocation();
  const { getPage, getSectionBlocks } = useContent();

  const page = getPage(pathname);

  if (!page || page.systemPage) {
    return <NotFound />;
  }

  const sections = (page.sections ?? [])
    .map((section) => ({ section, blocks: getSectionBlocks(section.id) }))
    .filter(({ blocks }) => blocks.length > 0);

  return (
    <article>
      <h1 className="py-8 font-heading text-4xl font-semibold text-brand-ink">
        {page.label}
      </h1>
      {sections.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          description="This page is published but has no visible content. Check back soon."
          action={
            <Link
              to="/"
              className="touch-target inline-flex items-center rounded-brand bg-brand-primary px-6 py-3 font-semibold text-brand-surface hover:bg-brand-primary-dark"
            >
              Go to the home page
            </Link>
          }
        />
      ) : (
        sections.map(({ section, blocks }, index) => (
          <section
            key={section.id}
            aria-labelledby={`section-${section.id}`}
            className={index === 0 ? undefined : 'mt-12'}
          >
            {/* The first section's label usually repeats the page title;
                keep it for screen readers only. */}
            <h2
              id={`section-${section.id}`}
              className={
                index === 0
                  ? 'sr-only'
                  : 'font-heading text-2xl font-semibold text-brand-ink'
              }
            >
              {section.label}
            </h2>
            <div className={index === 0 ? undefined : 'mt-4'}>
              <SectionBlocks blocks={blocks} />
            </div>
          </section>
        ))
      )}
    </article>
  );
}
