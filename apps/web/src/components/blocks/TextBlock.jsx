// text: a single plain-text value (BLOCK_TYPES.text).
export default function TextBlock({ block }) {
  if (!block?.value) return null;
  return <p className="max-w-prose text-brand-ink">{block.value}</p>;
}
