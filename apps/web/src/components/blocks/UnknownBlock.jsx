// Fallback for a blockType with no registered renderer. In production it
// renders nothing — attendee pages fail soft when data outruns the deployed
// registry. In dev it renders a labeled box so the gap is visible while
// building (spec §5.2: a block type is a contract with a renderer).
export default function UnknownBlock({ block }) {
  if (!import.meta.env.DEV) return null;
  return (
    <div
      role="note"
      className="rounded-brand border border-warning/50 bg-warning/10 p-3 text-sm text-brand-ink"
    >
      Unknown block type “{String(block?.blockType)}” — no renderer is
      registered for it. Register one in components/blocks/registry.jsx.
    </div>
  );
}
