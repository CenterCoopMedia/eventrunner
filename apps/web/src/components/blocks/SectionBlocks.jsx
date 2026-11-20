// SectionBlocks — renders one page section's ordered block list (spec §5.2).
//
// Blocks arrive pre-sorted (ContentProvider.getSectionBlocks). Runs of
// collection-shaped types are batched into the semantic parent element they
// need: stats into a <dl> grid, list items into a <ul>, FAQ items into a
// stack, link groups into titled lists grouped by their `group` field.
// Everything else renders one-by-one through the registry, so an unknown
// type still hits the UnknownBlock fallback.
import './SectionBlocks.css';
import BlockRenderer from './registry.jsx';
import StatBlock from './StatBlock.jsx';
import FactBlock from './FactBlock.jsx';
import ListItemBlock from './ListItemBlock.jsx';

const blockKey = (block, index) =>
  block.id ?? `${block.section}__${block.field ?? index}`;

const groupedRun = (run) => <BlockRenderer block={run[0]} run={run} />;

// How each batched run renders. Ids outside this map render individually.
const RUN_RENDERERS = {
  stat: (run) => (
    <dl className="grid gap-lg sm:grid-cols-2 lg:grid-cols-3">
      {run.map((block, i) => (
        <StatBlock key={blockKey(block, i)} block={block} />
      ))}
    </dl>
  ),
  // A run of facts is one definition list (expansion record §3.1): term and
  // description pairs, ruled between pairs, at the measure. FactBlock
  // renders one pair, so the <dl> is drawn here.
  fact: (run) => (
    <dl className="definition-list max-w-prose">
      {run.map((block, i) => (
        <FactBlock key={blockKey(block, i)} block={block} />
      ))}
    </dl>
  ),
  list_item: (run) => (
    <ul className="list-disc space-y-xs ps-5">
      {run.map((block, i) => (
        <ListItemBlock key={blockKey(block, i)} block={block} />
      ))}
    </ul>
  ),
  faq_item: (run) => (
    <div className="space-y-sm">
      {run.map((block, i) => (
        <BlockRenderer key={blockKey(block, i)} block={block} />
      ))}
    </div>
  ),
  link_group: groupedRun,
  sponsor_package: groupedRun,
};

/**
 * The blocks in order, with consecutive blocks of a run type (stats, facts,
 * list items, questions, link groups, sponsor packages) drawn as one run.
 */
function renderBlocks(blocks) {
  const rendered = [];
  let i = 0;
  while (i < blocks.length) {
    const type = blocks[i].blockType;
    if (Object.prototype.hasOwnProperty.call(RUN_RENDERERS, type)) {
      const run = [];
      while (i < blocks.length && blocks[i].blockType === type) {
        run.push(blocks[i]);
        i += 1;
      }
      rendered.push(
        <div key={`run-${type}-${blockKey(run[0], i)}`}>
          {RUN_RENDERERS[type](run)}
        </div>,
      );
    } else {
      rendered.push(
        <BlockRenderer key={blockKey(blocks[i], i)} block={blocks[i]} />,
      );
      i += 1;
    }
  }
  return rendered;
}

/**
 * @param {{ blocks: object[], layout?: 'reading'|'wide'|'columns' }} props
 *   `layout` is the section's stored choice (lib/pageLayout.js
 *   sectionLayoutOf). `columns` puts the first half of the blocks in the
 *   left column and the rest in the right, once the section is wide enough;
 *   blocks are counted one by one, so four questions split two and two. The
 *   frame is a size container, so a narrow section stacks as a phone does.
 */
export default function SectionBlocks({ blocks, layout = 'reading' }) {
  if (!blocks?.length) return null;

  if (layout === 'columns') {
    // The first half of the blocks fills the left column and the rest the
    // right, so reading order is the same in two columns as in one: text
    // then its picture, or a list of places split down the middle. The
    // right column is marked so a page's opening (the long read drop cap)
    // stays on the first block only.
    const half = Math.ceil(blocks.length / 2);
    return (
      <div className="section-blocks-frame">
        <div className="section-blocks section-blocks--columns">
          <div className="space-y-lg">{renderBlocks(blocks.slice(0, half))}</div>
          {blocks.length > 1 ? (
            <div className="section-blocks__rest space-y-lg">{renderBlocks(blocks.slice(half))}</div>
          ) : null}
        </div>
      </div>
    );
  }
  return (
    <div className={layout === 'wide' ? 'section-blocks section-blocks--wide space-y-lg' : 'space-y-lg'}>
      {renderBlocks(blocks)}
    </div>
  );
}
