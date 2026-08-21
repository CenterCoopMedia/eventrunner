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
//
// validatePageDoc (functions/src/cms/pages.cjs) refuses a NEW/edited page
// whose path starts with a reserved segment, but that guard only runs at
// save time — a doc written before issue #52 (e.g. the old /p/faq path) or
// one edited straight in Firestore can still sit in cmsPages with a
// reserved-looking path. So the router re-checks RESERVED_PATH_SEGMENTS
// itself, on both the requested URL and the matched doc's stored path, and
// 404s rather than trusting stored data to already be clean.
import { Link, useLocation } from 'react-router-dom';
import { isReservedPathSegment } from 'shared/routing';
import { useContent } from '../contexts/ContentContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import NotFound from './NotFound.jsx';
import SectionBlocks from '../components/blocks/SectionBlocks.jsx';

/** First path segment ('' for '/'), no leading/trailing slash. */
function firstSegment(path) {
  return path.split('/').filter(Boolean)[0] ?? '';
}

export default function ContentPage() {
  const { pathname } = useLocation();
  const { getPage, getSectionBlocks } = useContent();

  // The requested URL itself may be reserved territory (a stale /p/... link,
  // a guess at /signin/help) even before a page lookup happens.
  const page = isReservedPathSegment(firstSegment(pathname)) ? null : getPage(pathname);

  // A non-system page whose STORED path starts with a reserved segment is
  // pre-#52 or hand-edited data, not something the current admin UI could
  // save today — treat it as unreachable rather than rendering it.
  const pageReserved =
    page && page.systemPage !== true && isReservedPathSegment(firstSegment(page.path));

  if (!page || page.systemPage || pageReserved) {
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
