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
import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { firstPathSegment, isReservedPathSegment } from 'shared/routing';
import { useContent } from '../contexts/ContentContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import NotFound from './NotFound.jsx';
import SectionBlocks from '../components/blocks/SectionBlocks.jsx';
import SectionHead from '../components/editorial/SectionHead.jsx';
import SectionIndexNav from '../components/SectionIndexNav.jsx';
import { blockMatchesQuery } from '../lib/blockSearchText.js';
import { inputClass, primaryActionClass, quietActionClass } from '../components/controlClasses.js';

// Pages seeded from the §5.5 legal templates. While
// config/event.legal.reviewRequired is set, both carry a visible public
// notice: the templates are a starting point composed from the deployment
// configuration, and a reader must not mistake an unreviewed template for
// the operator's actual policy. The flag is cleared from admin Settings
// after the client's counsel signs off — it is never cleared by a script.
const LEGAL_PAGE_IDS = ['privacy', 'terms'];

// Search and a section index on a long content page (issue #14, spec
// M7-14). Generic over every content page, not FAQ-specific: any page
// rendered through this route gets the same treatment once it has enough
// sections for an index to earn its place. A one-section page has nothing
// to jump to and nothing worth narrowing, so the floor is two.
const SECTION_INDEX_MIN_SECTIONS = 2;

export default function ContentPage() {
  const { pathname } = useLocation();
  const { getPage, getSectionBlocks } = useContent();
  const { eventConfig } = useEventConfig();
  // Declared before the early return below so hook order stays fixed across
  // renders regardless of which page (or no page) this URL resolves to
  // (react-hooks/rules-of-hooks).
  const [query, setQuery] = useState('');

  // The requested URL itself may be reserved territory (a stale /p/... link,
  // a guess at /signin/help) even before a page lookup happens.
  const page = isReservedPathSegment(firstPathSegment(pathname)) ? null : getPage(pathname);

  // A non-system page whose STORED path starts with a reserved segment is
  // pre-#52 or hand-edited data, not something the current admin UI could
  // save today — treat it as unreachable rather than rendering it.
  const pageReserved =
    page && page.systemPage !== true && isReservedPathSegment(firstPathSegment(page.path));

  if (!page || page.systemPage || pageReserved) {
    return <NotFound />;
  }

  // Fail soft (§2.4): a runtime config/event doc can replace `legal`
  // wholesale with a partial object, so only an explicit `true` shows the
  // notice and a malformed doc simply shows the page.
  const showLegalNotice =
    LEGAL_PAGE_IDS.includes(page.id) && eventConfig?.legal?.reviewRequired === true;

  const baseSections = (page.sections ?? [])
    .map((section) => ({ section, blocks: getSectionBlocks(section.id) }))
    .filter(({ blocks }) => blocks.length > 0);

  // A one-section page has nothing to jump to and nothing worth narrowing
  // (SECTION_INDEX_MIN_SECTIONS above) — this is the ONLY thing that gates
  // the feature, so typing a query that thins the result list can never
  // make the filter box that produced it disappear.
  const isLongPage = baseSections.length >= SECTION_INDEX_MIN_SECTIONS;

  // An empty query matches every block (blockMatchesQuery), so this is a
  // no-op — and therefore safe to always compute — when the field is empty.
  const filteredSections = isLongPage
    ? baseSections
        .map(({ section, blocks }) => ({
          section,
          blocks: blocks.filter((block) => blockMatchesQuery(block, query)),
        }))
        .filter(({ blocks }) => blocks.length > 0)
    : baseSections;

  const trimmedQuery = query.trim();
  const totalBlocks = baseSections.reduce((sum, { blocks }) => sum + blocks.length, 0);
  const matchedBlocks = filteredSections.reduce((sum, { blocks }) => sum + blocks.length, 0);
  const resultsSummary = !trimmedQuery
    ? ''
    : matchedBlocks === 0
      ? `No matches for “${trimmedQuery}”.`
      : `${matchedBlocks} of ${totalBlocks} ${totalBlocks === 1 ? 'match' : 'matches'} for “${trimmedQuery}”.`;

  const indexSections = filteredSections.map(({ section }) => ({
    id: `section-${section.id}`,
    label: section.label,
  }));

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
          organizer’s legal counsel and does not yet state their policy.
        </p>
      ) : null}
      {isLongPage ? (
        <div className="mb-xl">
          <label
            htmlFor="content-page-filter"
            className="mb-2xs block font-data text-caption font-semibold text-text-primary"
          >
            Filter by keyword
          </label>
          <input
            id="content-page-filter"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter this page"
            className={inputClass}
          />
          {resultsSummary ? (
            <p role="status" className="mt-2xs text-caption text-text-secondary">
              {resultsSummary}
            </p>
          ) : null}
          {/* Filtering to nothing already gets its own Clear filter action
              inside the empty state below — a second one beside the input
              would just be the same control said twice. */}
          {trimmedQuery && filteredSections.length > 0 ? (
            <button
              type="button"
              className={`${quietActionClass} mt-2xs`}
              onClick={() => setQuery('')}
            >
              Clear filter
            </button>
          ) : null}
          <SectionIndexNav sections={indexSections} />
        </div>
      ) : null}
      {baseSections.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          description="This page is published but has no visible content. Check back soon."
          action={
            <Link to="/" className={primaryActionClass}>
              Go to the home page
            </Link>
          }
        />
      ) : filteredSections.length === 0 ? (
        <EmptyState
          title="Nothing matches that filter"
          description="Try a different word, or clear the filter to see the whole page."
          action={
            <button type="button" className={primaryActionClass} onClick={() => setQuery('')}>
              Clear filter
            </button>
          }
        />
      ) : (
        filteredSections.map(({ section, blocks }, index) => (
          <section
            key={section.id}
            aria-labelledby={`section-${section.id}`}
            className={index === 0 ? undefined : 'mt-2xl'}
          >
            {/* The first section's label usually repeats the page title;
                keep it for screen readers only — and with no visible heading
                there is no section boundary to draw either. tabIndex={-1} on
                both heading forms lets the section index (above) move focus
                here without pulling either into the tab order (interface
                guidelines: Accessibility — only tabindex 0 and -1). */}
            {index === 0 ? (
              <h2 id={`section-${section.id}`} tabIndex={-1} className="sr-only">
                {section.label}
              </h2>
            ) : (
              <SectionHead
                level={2}
                id={`section-${section.id}`}
                title={section.label}
                tabIndex={-1}
              />
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
