// SystemPage — the hybrid page shell (design brief §6.1, §6.2).
//
// A system page keeps its core feature component and gains two things
// around it: composable sections, and a layout it states in its own data.
// This component owns both, so every system page renders them the same way
// and no page invents its own order.
//
// THE ORDER DOWN THE PAGE IS FIXED (brief §6.2):
//
//   nameplate (the shell)  →  `above` sections  →  core  →  `main` sections
//   →  `below` sections
//
// `main` is the default slot, and that is what keeps stored data working: a
// section written before this schema existed carries no `slot`, reads as
// `main`, and renders immediately after the core — exactly where it always
// did. No migration runs.
//
// DENSITY IS STATED, NEVER ASSUMED. The active preset states its own
// density (brief §4), so the attribute below is written from
// `statedPageLayout` and not from `resolvePageLayout`: a page that never
// chose a density must not silently override the preset's. A page that DID
// choose one sets `data-density` on its own subtree, and the custom
// properties under that attribute win for everything inside it.
//
// A custom page has no core component, so it ignores `slot` entirely and
// keeps full block composition (ContentPage.jsx). Nothing here reaches it.
import { Fragment } from 'react';
import { useContent } from '../contexts/ContentContext.jsx';
import SectionBlocks from './blocks/SectionBlocks.jsx';
import SectionHead from './editorial/SectionHead.jsx';
import { resolvePageLayout, sectionsBySlot, statedPageLayout } from '../lib/pageLayout.js';

/**
 * One slot's sections, each opened by a section boundary and rendered
 * through the block registry.
 *
 * A section with no visible blocks renders nothing at all — a heading over
 * an empty section is a boundary the reader cannot cross, and the page
 * already reads without it.
 *
 * A PAGE MAY DRAW ONE OF ITS OWN SECTIONS ITSELF, and it stays in the
 * operator's order when it does. Some sections are not a list of blocks the
 * registry can draw — the home page's key facts group is an arrangement of
 * its blocks, and its sponsor strip reads a different collection entirely —
 * and the way that used to be done was to exclude the section here and
 * render it at a fixed point in the core. That silently took the section
 * out of the ordering: an operator could drag it anywhere in the admin, or
 * move it to another slot, and nothing on the page moved. `renderSection`
 * keeps the section in this list and only replaces what is drawn inside its
 * place. Exactly three answers, and the third is the only one that draws:
 *
 *   undefined     this page has nothing to say about the section, so the
 *                 default above applies, including the empty-section skip.
 *                 It is the ONE value that means "not mine" — a renderer
 *                 that falls off its own end returns it by accident and
 *                 gets the default, which is the safe accident to have.
 *   any other
 *   falsy value   draw nothing at all for it (null, false, '', 0). React
 *                 renders all of them as nothing anyway, so treating them
 *                 differently from each other would only be a trap for a
 *                 renderer that ended a `&&` chain on a falsy left side.
 *   a node        draw that instead; the node owns its own <section>.
 *
 * A custom renderer also decides for itself what "empty" means, because the
 * blocks are not where its content comes from.
 *
 * @param {{
 *   sections: object[],
 *   getSectionBlocks: (id: string) => object[],
 *   renderSection?: (section: object, blocks: object[]) => import('react').ReactNode | undefined,
 *   arrangement: 'grid' | 'list',
 * }} props
 */
function SlotSections({ sections, getSectionBlocks, renderSection, arrangement }) {
  const drawn = sections
    .map((section) => {
      const blocks = getSectionBlocks(section.id);
      const custom = renderSection ? renderSection(section, blocks) : undefined;
      if (custom !== undefined) return { section, node: custom };
      if (blocks.length === 0) return { section, node: null };
      return {
        section,
        node: (
          <section aria-labelledby={`section-${section.id}`} className="page-section">
            {/* The head runs to the stage whatever the arrangement: a
                section boundary is the width of the page it opens. */}
            <SectionHead level={2} id={`section-${section.id}`} title={section.label} />
            {/* THE ARRANGEMENT ON THE STAGE (2026-09-10 vocabulary
                expansion): `grid` gives the section the stage's own
                columns, `list` sets it on the text measure — which is what
                a page read straight through wants, and what keeps an
                introduction paragraph from running the width of a schedule
                grid. */}
            <div className={arrangement === 'grid' ? 'mt-md' : 'measure mt-md'}>
              <SectionBlocks blocks={blocks} />
            </div>
          </section>
        ),
      };
    })
    // Every falsy answer means the same thing: draw nothing here.
    .filter(({ node }) => Boolean(node));
  if (drawn.length === 0) return null;
  return drawn.map(({ section, node }) => <Fragment key={section.id}>{node}</Fragment>);
}

/**
 * @param {{
 *   pageId: string | string[],         // the cmsPages id, e.g. 'schedule',
 *                                      // or ids/paths to try in order
 *   exclude?: string[],                // section ids the core renders itself
 *   renderSection?: (section: object, blocks: object[]) => import('react').ReactNode | undefined,
 *                                      // draw one section differently, in
 *                                      // its own place in the order
 *   children: import('react').ReactNode
 *     | ((layout: ReturnType<typeof resolvePageLayout>) => import('react').ReactNode),
 * }} props the remaining props land on the <article>.
 */
export default function SystemPage({
  pageId,
  exclude = [],
  renderSection,
  children,
  ...articleProps
}) {
  const { getPage, getSectionBlocks } = useContent();
  // Every system route now seeds a cmsPages document (scripts/lib/seed.cjs,
  // held by a test that reads every <SystemPage pageId="…"> in this app).
  // A route can still find nothing — an operator deleted the page, or the
  // content has not loaded yet — and `null` reads as the default layout and
  // no sections, which is what the route rendered before layouts existed.
  const page = [pageId].flat().map((key) => getPage(key)).find(Boolean) ?? null;
  const layout = resolvePageLayout(page);
  const stated = statedPageLayout(page);
  const slots = sectionsBySlot(
    (page?.sections ?? []).filter((section) => !exclude.includes(section.id)),
  );
  // The core may need the layout it renders under — `arrangement` on a
  // directory, most of all — so it may arrive as a function of it.
  const core = typeof children === 'function' ? children(layout) : children;

  return (
    <article {...(stated.density ? { 'data-density': stated.density } : null)} {...articleProps}>
      <SlotSections
        sections={slots.above}
        getSectionBlocks={getSectionBlocks}
        renderSection={renderSection}
        arrangement={layout.arrangement}
      />
      {core}
      <SlotSections
        sections={slots.main}
        getSectionBlocks={getSectionBlocks}
        renderSection={renderSection}
        arrangement={layout.arrangement}
      />
      <SlotSections
        sections={slots.below}
        getSectionBlocks={getSectionBlocks}
        renderSection={renderSection}
        arrangement={layout.arrangement}
      />
    </article>
  );
}
