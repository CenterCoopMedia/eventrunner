// SectionBlocks — renders one page section's ordered block list (spec §5.2).
//
// Blocks arrive pre-sorted (ContentProvider.getSectionBlocks). Runs of
// collection-shaped types are batched into the semantic parent element they
// need: stats into a <dl> grid, list items into a <ul>, FAQ items into a
// stack, link groups into titled lists grouped by their `group` field.
// Everything else renders one-by-one through the registry, so an unknown
// type still hits the UnknownBlock fallback.
import { lazy, Suspense } from 'react';
import BlockRenderer from './registry.jsx';
import StatBlock from './StatBlock.jsx';
import FactBlock from './FactBlock.jsx';
import ListItemBlock from './ListItemBlock.jsx';
import { sponsorPackageDraws } from './sponsorPackageData.js';

const LinkGroups = lazy(() => import('./LinkGroupBlock.jsx')
  .then(({ LinkGroups }) => ({ default: LinkGroups })));

const blockKey = (block, index) =>
  block.id ?? `${block.section}__${block.field ?? index}`;

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
  link_group: (run) => (
    <Suspense fallback={<div aria-hidden="true" className="min-h-16" />}>
      <LinkGroups blocks={run} />
    </Suspense>
  ),
  // A run of sponsor packages (#193) is one list of entries, each ruled on
  // top: no box, no card. A package with no name is left out rather than
  // drawn as an empty entry.
  sponsor_package: (run) => (
    <ul className="grid gap-lg sm:grid-cols-2 lg:grid-cols-3">
      {run.filter(sponsorPackageDraws).map((block, i) => (
        <li key={blockKey(block, i)} className="border-t-hairline border-t-rule-hairline pt-sm">
          <BlockRenderer block={block} />
        </li>
      ))}
    </ul>
  ),
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

  return <div className="space-y-lg">{rendered}</div>;
}
