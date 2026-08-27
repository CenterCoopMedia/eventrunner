// list_item: one entry in an ordered content list (BLOCK_TYPES.list_item).
// SectionBlocks batches consecutive items into one <ul>; each item is an <li>.
// Body copy, so it states the body step of the type scale rather than
// inheriting the browser default (design brief §3.7).
export default function ListItemBlock({ block }) {
  if (!block?.text) return null;
  return <li className="max-w-prose text-body text-text-primary">{block.text}</li>;
}
