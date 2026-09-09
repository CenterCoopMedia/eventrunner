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
import { useEffect, useRef, useState } from 'react';
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
import { useDocumentTitle } from '../lib/useDocumentTitle.js';
import { inputClass, primaryActionClass, quietActionClass } from '../components/controlClasses.js';

// Pages seeded from the §5.5 legal templates. While
// config/event.legal.reviewRequired is set, both carry a visible public
// notice: the templates are a starting point composed from the deployment
// configuration, and a reader must not mistake an unreviewed template for
// the operator's actual policy. The flag is cleared from admin Settings
// after the client's counsel signs off — it is never cleared by a script.
const LEGAL_PAGE_IDS = ['privacy', 'terms'];

// Search and a section index on a long content page (issue #14, spec
// M7-14). Generic over every content page, not FAQ-specific: the gate below
// asks "is this page shaped like a search surface", not "is this the FAQ
// page" — an FAQ block just happens to be the one block type that answers
// that question by itself, on any page, at any length. Three ways in:
//   - the page carries at least one faq_item block. An FAQ is a set of
//     independent questions a reader scans for one of, by nature a search
//     surface, even at the seeded size (two sections, two blocks) that the
//     size rule below would otherwise turn the feature off for; or
//   - three or more populated sections; or
//   - two sections carrying a real amount of content between them.
// A page that matches none of the three has nothing worth jumping to or
// narrowing.
const SECTION_INDEX_MIN_SECTIONS = 3;
const SECTION_INDEX_MIN_SECTIONS_WITH_BLOCKS = 2;
const SECTION_INDEX_MIN_BLOCKS = 8;

// How long a reader's keystrokes have to go quiet before the status region
// restates itself. The visible list narrows on every keystroke; the ANNOUNCED
// text does not, or a screen reader hears "3 of 12 items match" rebuilt on
// every letter typed.
const STATUS_SETTLE_MS = 300;

/** The page's sections whose block list still has something matching `query`
 * (an empty query matches every block, so this is the identity map then).
 * A block matches on its own text OR its section's label, so a query for
 * "Venue" finds every block filed under a Venue section. */
function filterSections(sections, query) {
  return sections
    .map(({ section, blocks }) => ({
      section,
      blocks: blocks.filter((block) =>
        blockMatchesQuery(block, query, { sectionLabel: section.label }),
      ),
    }))
    .filter(({ blocks }) => blocks.length > 0);
}

export default function ContentPage() {
  const { pathname } = useLocation();
  const { getPage, getSectionBlocks } = useContent();
  const { eventConfig } = useEventConfig();
  // Declared before the early return below so hook order stays fixed across
  // renders regardless of which page (or no page) this URL resolves to
  // (react-hooks/rules-of-hooks).
  const [query, setQuery] = useState('');
  const [settledQuery, setSettledQuery] = useState('');
  const filterInputRef = useRef(null);

  // App.jsx renders this component from one catch-all route with no
  // per-page key, so moving from one content page to another reuses this
  // same instance rather than remounting it — a filter typed on /faq must
  // not still be narrowing /travel a moment later.
  useEffect(() => {
    setQuery('');
    setSettledQuery('');
  }, [pathname]);

  // The debounce for the status text specifically (see STATUS_SETTLE_MS
  // above) — the visible filteredSections below stays driven by the raw
  // query, so the list itself still narrows instantly.
  useEffect(() => {
    const id = setTimeout(() => setSettledQuery(query), STATUS_SETTLE_MS);
    return () => clearTimeout(id);
  }, [query]);

  // The requested URL itself may be reserved territory (a stale /p/... link,
  // a guess at /signin/help) even before a page lookup happens.
  const page = isReservedPathSegment(firstPathSegment(pathname)) ? null : getPage(pathname);

  // A non-system page whose STORED path starts with a reserved segment is
  // pre-#52 or hand-edited data, not something the current admin UI could
  // save today — treat it as unreachable rather than rendering it.
  const pageReserved =
    page && page.systemPage !== true && isReservedPathSegment(firstPathSegment(page.path));

  // Called ahead of the early return below, unconditionally, as the rules
  // of hooks require. A page that does not resolve names nothing, which
  // leaves the event name standing alone.
  useDocumentTitle(!page || page.systemPage || pageReserved ? null : page.label);

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

  const totalBlocks = baseSections.reduce((sum, { blocks }) => sum + blocks.length, 0);
  const hasFaqItem = baseSections.some(({ blocks }) =>
    blocks.some((block) => block.blockType === 'faq_item'),
  );

  // This is the ONLY thing that gates the feature, and it reads baseSections
  // (never the filtered list), so typing a query that thins the result list
  // can never make the filter box that produced it disappear.
  const isLongPage =
    hasFaqItem ||
    baseSections.length >= SECTION_INDEX_MIN_SECTIONS ||
    (baseSections.length >= SECTION_INDEX_MIN_SECTIONS_WITH_BLOCKS &&
      totalBlocks >= SECTION_INDEX_MIN_BLOCKS);

  // An empty query matches every block (blockMatchesQuery), so both of these
  // are safe to always compute — they equal baseSections when the field is
  // idle, filtered or not.
  const filteredSections = isLongPage ? filterSections(baseSections, query) : baseSections;
  const settledFilteredSections = isLongPage
    ? filterSections(baseSections, settledQuery)
    : baseSections;

  const trimmedQuery = query.trim();
  const settledTrimmedQuery = settledQuery.trim();
  const settledMatchedBlocks = settledFilteredSections.reduce(
    (sum, { blocks }) => sum + blocks.length,
    0,
  );
  const resultsSummary = !settledTrimmedQuery
    ? ''
    : settledMatchedBlocks === 0
      ? `No items match “${settledTrimmedQuery}”.`
      : `${settledMatchedBlocks} of ${totalBlocks} items match “${settledTrimmedQuery}”.`;

  // The page's own first section, independent of what the filter currently
  // shows. Its heading renders screen-reader only below (it usually repeats
  // the page title), so this id is the one thing that decides that — never
  // "whichever section a filter happens to put first" (see the render loop).
  const firstSectionId = baseSections[0]?.section.id ?? null;

  // The invisible heading's own section is left out of the index: a sighted
  // keyboard user who activates it would land on a heading with nothing to
  // see, which reads as a bug, not a jump.
  const indexSections = filteredSections
    .filter(({ section }) => section.id !== firstSectionId)
    .map(({ section }) => ({ id: `section-${section.id}`, label: section.label }));

  const clearFilter = () => {
    setQuery('');
    // Clear the settled status at once, the same way the pathname-change
    // effect above does — otherwise the debounce (STATUS_SETTLE_MS) leaves
    // the live region announcing the old, now-wrong count for 300ms after
    // the list itself has already gone back to showing everything.
    setSettledQuery('');
    filterInputRef.current?.focus();
  };

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
            ref={filterInputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter this page"
            className={inputClass}
          />
          {/* Always mounted — even idle and empty — so the region itself
              never appears or disappears as a change to announce; only its
              text does, and only once typing settles (STATUS_SETTLE_MS). */}
          <p role="status" className="mt-2xs text-caption text-text-secondary">
            {resultsSummary}
          </p>
          {/* Filtering to nothing already gets its own Clear filter action
              inside the empty state below — a second one beside the input
              would just be the same control said twice. */}
          {trimmedQuery && filteredSections.length > 0 ? (
            <button
              type="button"
              className={`${quietActionClass} mt-2xs`}
              onClick={clearFilter}
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
            <button type="button" className={primaryActionClass} onClick={clearFilter}>
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
                there is no section boundary to draw either. Anchored to the
                PAGE's own first section id (firstSectionId), never to render
                position: a filter can put a different section at index 0,
                and that section still needs its real, visible heading.
                tabIndex={-1} on both heading forms lets the section index
                (above) move focus here without pulling either into the tab
                order (interface guidelines: Accessibility — only tabindex 0
                and -1). */}
            {section.id === firstSectionId ? (
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
