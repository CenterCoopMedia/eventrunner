// SectionBlocks — renders one page section's ordered block list (spec §5.2).
//
// Blocks arrive pre-sorted (ContentProvider.getSectionBlocks). Runs of
// collection-shaped types are batched into the semantic parent element they
// need: stats into a <dl> grid, list items into a <ul>, FAQ items into a
// stack, link groups into titled lists grouped by their `group` field.
// Everything else renders one-by-one through the registry, so an unknown
// type still hits the UnknownBlock fallback.
import BlockRenderer from './registry.jsx';
import StatBlock from './StatBlock.jsx';
import ListItemBlock from './ListItemBlock.jsx';
import FaqItemBlock from './FaqItemBlock.jsx';
import LinkGroupBlock from './LinkGroupBlock.jsx';

const blockKey = (block, index) =>
  block.id ?? `${block.section}__${block.field ?? index}`;

function LinkGroups({ blocks }) {
  const groups = new Map();
  for (const block of blocks) {
    const name = block.group ?? '';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(block);
  }
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      {[...groups.entries()].map(([name, links]) => (
        <div key={name || 'ungrouped'}>
          {name ? (
            <h3 className="text-sm font-semibold uppercase tracking-wide text-brand-ink-muted">
              {name}
            </h3>
          ) : null}
          <ul className="mt-2 space-y-1">
            {links.map((block, i) => (
              <LinkGroupBlock key={blockKey(block, i)} block={block} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// How each batched run renders. Ids outside this map render individually.
const RUN_RENDERERS = {
  stat: (run) => (
    <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {run.map((block, i) => (
        <StatBlock key={blockKey(block, i)} block={block} />
      ))}
    </dl>
  ),
  list_item: (run) => (
    <ul className="list-disc space-y-2 ps-5">
      {run.map((block, i) => (
        <ListItemBlock key={blockKey(block, i)} block={block} />
      ))}
    </ul>
  ),
  faq_item: (run) => (
    <div className="space-y-3">
      {run.map((block, i) => (
        <FaqItemBlock key={blockKey(block, i)} block={block} />
      ))}
    </div>
  ),
  link_group: (run) => <LinkGroups blocks={run} />,
};

export default function SectionBlocks({ blocks }) {
  if (!blocks?.length) return null;

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

  return <div className="space-y-6">{rendered}</div>;
}
