// HistorySection — the home page's History section (issue #194): the
// operator's own words and pictures for the section, then the past editions
// from the Timeline list, oldest first.
//
// It is drawn through the page's `renderSection`, so the section keeps its
// place in the operator's order and slot, and deleting the section from the
// page removes the list with it. The editions come from ContentContext's
// `timeline`: the committed snapshot on first paint, then the runtime
// listener's set, so an entry published from the admin appears without a
// rebuild.
//
// THE YEAR IS EACH ENTRY'S ONLY NUMBER. a3's Timeline is an ordered list
// that draws no counter; the year sits beside the title in a <time>.
import { useContent } from '../contexts/ContentContext.jsx';
import SectionBlocks from './blocks/SectionBlocks.jsx';
import SectionHead from './editorial/SectionHead.jsx';
import PublishedTimeline from './timeline/PublishedTimeline.jsx';

/**
 * @param {{
 *   id: string,                       // the heading id the section is labelled by
 *   title: string,                    // the section's own label
 *   blocks: object[],                 // the section's visible blocks, in order
 *   arrangement: 'grid' | 'list',     // the page's arrangement
 *   layout?: 'reading'|'wide'|'columns', // the section's layout (issue #1153)
 *   action?: import('react').ReactNode, // the section's edit link (issue #198)
 *   showTimeline?: boolean,
 * }} props
 */
export default function HistorySection({ id, title, blocks, arrangement, layout = 'reading', action = null, showTimeline = true }) {
  const { timeline } = useContent();
  if (blocks.length === 0 && (!showTimeline || !timeline?.length)) return null;
  return (
    <section aria-labelledby={id} className="page-section">
      <SectionHead level={2} id={id} title={title} action={action} />
      {/* The same wrapper the default section draws (SystemPage), so the
          operator's blocks keep the width the page's arrangement gives them.
          A Wide or Two columns layout is for the blocks only: the timeline
          keeps the width the arrangement gives it. */}
      {layout === 'reading' || blocks.length === 0 ? (
        <div className={arrangement === 'grid' ? 'mt-md' : 'measure mt-md'}>
          {blocks.length > 0 ? <SectionBlocks blocks={blocks} layout={layout} /> : null}
          {showTimeline ? <PublishedTimeline className={blocks.length > 0 ? 'mt-lg' : ''} /> : null}
        </div>
      ) : (
        <>
          <div className="mt-md">
            <SectionBlocks blocks={blocks} layout={layout} />
          </div>
          {showTimeline ? (
            <div className={arrangement === 'grid' ? 'mt-lg' : 'measure mt-lg'}>
              <PublishedTimeline />
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
