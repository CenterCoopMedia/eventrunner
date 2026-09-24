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
import Timeline from './editorial/Timeline.jsx';

/**
 * @param {{
 *   id: string,                       // the heading id the section is labelled by
 *   title: string,                    // the section's own label
 *   blocks: object[],                 // the section's visible blocks, in order
 *   arrangement: 'grid' | 'list',     // the page's arrangement
 * }} props
 */
export default function HistorySection({ id, title, blocks, arrangement }) {
  const { timeline } = useContent();
  const entries = (timeline ?? []).map((entry) => ({
    id: entry.id,
    title: entry.title,
    date: String(entry.year),
    dateLabel: String(entry.year),
    body: entry.description || undefined,
  }));
  if (blocks.length === 0 && entries.length === 0) return null;
  return (
    <section aria-labelledby={id} className="page-section">
      <SectionHead level={2} id={id} title={title} />
      {/* The same wrapper the default section draws, so the operator's
          blocks keep the width the page's arrangement gives them. */}
      <div className={arrangement === 'grid' ? 'mt-md' : 'measure mt-md'}>
        {blocks.length > 0 ? <SectionBlocks blocks={blocks} /> : null}
        <Timeline entries={entries} level={3} className={blocks.length > 0 ? 'mt-lg' : ''} />
      </div>
    </section>
  );
}
