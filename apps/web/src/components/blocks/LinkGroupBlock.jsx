// link_group: a titled link within a named group (BLOCK_TYPES.link_group).
// SectionBlocks groups items by `group` and renders the group heading; each
// item is one descriptive link (interface guidelines: links say where they
// go, hit areas stay comfortable).
export default function LinkGroupBlock({ block }) {
  if (!block?.url || !block?.label) return null;
  return (
    <li>
      <a
        href={block.url}
        className="touch-target inline-flex items-center text-brand-primary underline decoration-brand-primary/40 underline-offset-2 hover:text-brand-primary-dark"
      >
        {block.label}
      </a>
    </li>
  );
}
