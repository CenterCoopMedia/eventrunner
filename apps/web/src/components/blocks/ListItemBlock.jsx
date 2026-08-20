// list_item: one entry in an ordered content list (BLOCK_TYPES.list_item).
// SectionBlocks batches consecutive items into one <ul>; each item is an <li>.
export default function ListItemBlock({ block }) {
  if (!block?.text) return null;
  return <li className="max-w-prose text-brand-ink">{block.text}</li>;
}
