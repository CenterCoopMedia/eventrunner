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
 * @param {{ sections: object[], getSectionBlocks: (id: string) => object[] }} props
 */
function SlotSections({ sections, getSectionBlocks }) {
  const filled = sections
    .map((section) => ({ section, blocks: getSectionBlocks(section.id) }))
    .filter(({ blocks }) => blocks.length > 0);
  if (filled.length === 0) return null;
  return filled.map(({ section, blocks }) => (
    <section
      key={section.id}
      aria-labelledby={`section-${section.id}`}
      className="page-section"
    >
      <SectionHead level={2} id={`section-${section.id}`} title={section.label} />
      <div className="mt-md">
        <SectionBlocks blocks={blocks} />
      </div>
    </section>
  ));
}

/**
 * @param {{
 *   pageId: string | string[],         // the cmsPages id, e.g. 'schedule',
 *                                      // or ids/paths to try in order
 *   exclude?: string[],                // section ids the core renders itself
 *   children: import('react').ReactNode
 *     | ((layout: ReturnType<typeof resolvePageLayout>) => import('react').ReactNode),
 * }} props the remaining props land on the <article>.
 */
export default function SystemPage({ pageId, exclude = [], children, ...articleProps }) {
  const { getPage, getSectionBlocks } = useContent();
  // A system page normally has a cmsPages document; two of them (attendees,
  // updates) have no seeded page at all. `null` reads as the default layout
  // and no sections, which is the page those routes already rendered.
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
      <SlotSections sections={slots.above} getSectionBlocks={getSectionBlocks} />
      {core}
      <SlotSections sections={slots.main} getSectionBlocks={getSectionBlocks} />
      <SlotSections sections={slots.below} getSectionBlocks={getSectionBlocks} />
    </article>
  );
}
