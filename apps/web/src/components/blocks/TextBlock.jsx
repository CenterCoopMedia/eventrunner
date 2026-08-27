// text: a single plain-text value (BLOCK_TYPES.text). Body copy on the body
// step of the type scale, in the tier 2 text role (design brief §3.1, §3.7).
export default function TextBlock({ block }) {
  if (!block?.value) return null;
  return <p className="max-w-prose text-body text-text-primary">{block.value}</p>;
}
