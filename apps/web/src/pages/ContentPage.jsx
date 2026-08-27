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
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import NotFound from './NotFound.jsx';
import SectionBlocks from '../components/blocks/SectionBlocks.jsx';
import SectionHead from '../components/editorial/SectionHead.jsx';

/** First path segment ('' for '/'), no leading/trailing slash. */
function firstSegment(path) {
  return path.split('/').filter(Boolean)[0] ?? '';
}

// Pages seeded from the §5.5 legal templates. While
// config/event.legal.reviewRequired is set, both carry a visible public
// notice: the templates are a starting point composed from the deployment
// configuration, and a reader must not mistake an unreviewed template for
// the operator's actual policy. The flag is cleared from admin Settings
// after the client's counsel signs off — it is never cleared by a script.
const LEGAL_PAGE_IDS = ['privacy', 'terms'];

export default function ContentPage() {
  const { pathname } = useLocation();
  const { getPage, getSectionBlocks } = useContent();
  const { eventConfig } = useEventConfig();

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

  // Fail soft (§2.4): a runtime config/event doc can replace `legal`
  // wholesale with a partial object, so only an explicit `true` shows the
  // notice and a malformed doc simply shows the page.
  const showLegalNotice =
    LEGAL_PAGE_IDS.includes(page.id) && eventConfig?.legal?.reviewRequired === true;

  const sections = (page.sections ?? [])
    .map((section) => ({ section, blocks: getSectionBlocks(section.id) }))
    .filter(({ blocks }) => blocks.length > 0);

  return (
    <article>
      <h1 className="pb-lg font-heading text-h1 font-semibold text-text-primary">
        {page.label}
      </h1>
      {showLegalNotice ? (
        <p
          role="note"
          className="mb-xl border-hairline border-warning/40 bg-warning/10 p-md font-data text-caption text-text-primary"
        >
          This page is an unreviewed template. It has not been reviewed by the
          organizer&rsquo;s legal counsel and does not yet state their policy.
        </p>
      ) : null}
      {sections.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          description="This page is published but has no visible content. Check back soon."
          action={
            <Link
              to="/"
              className="touch-target inline-flex items-center rounded-brand bg-accent px-md py-xs font-data text-caption font-semibold text-surface hover:bg-accent-strong"
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
            className={index === 0 ? undefined : 'mt-2xl'}
          >
            {/* The first section's label usually repeats the page title;
                keep it for screen readers only — and with no visible heading
                there is no section boundary to draw either. */}
            {index === 0 ? (
              <h2 id={`section-${section.id}`} className="sr-only">
                {section.label}
              </h2>
            ) : (
              <SectionHead level={2} id={`section-${section.id}`} title={section.label} />
            )}
            <div className={index === 0 ? undefined : 'mt-md'}>
              <SectionBlocks blocks={blocks} />
            </div>
          </section>
        ))
      )}
    </article>
  );
}
