// stat: the editorial treatment of a data block (BLOCK_TYPES.stat).
//
// TWO SHAPES, ONE RENDERER (design brief §2.1.1, PR1 half).
//
//   Legacy   { value, label } — the shape the block schema carries today.
//            It renders cleanly: the figure in the heading face with tabular
//            figures, its label under it in the data face, opened by a
//            hairline instead of boxed in a card.
//
//   Full     the four-part contract: a takeaway title that states the
//            finding in words, a description saying what the number counts
//            and over what period, a source line naming where the number
//            came from, and alt text describing the finding for a screen
//            reader.
//
// PR1 RENDERS BOTH AND ENFORCES NEITHER. A legacy block keeps rendering, and
// nothing is dropped because a part is missing — the schema, the editor
// fields, the seed migration, and write-time enforcement all land in PR3
// beside the block-schema work (brief §2.1.1, §7). Until then the four extra
// fields are read opportunistically: a block that carries them gets the full
// treatment, and a block that does not gets the legacy one.
//
// The alt text is added as screen-reader-only copy rather than replacing the
// visible figure. "Describe the finding for a screen reader" is an addition
// to the number, not a substitute for it: hiding the figure behind
// aria-hidden would lose real content whenever the alt text is weaker than
// the block it describes.

/** A string field with something in it, or null. */
function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export default function StatBlock({ block }) {
  const value = text(block?.value);
  const label = text(block?.label);
  const takeaway = text(block?.takeaway);
  const description = text(block?.description);
  const source = text(block?.source);
  const alt = text(block?.alt);

  // The legacy shape's own guard: a block with neither half of the pair is
  // not a stat block at all.
  if (!value && !takeaway) return null;

  const full = Boolean(takeaway || description || source || alt);

  if (!full) {
    if (!value || !label) return null;
    return (
      <div className="flex flex-col border-t-hairline border-t-rule-hairline pt-sm">
        <dt className="order-last mt-2xs font-data text-caption text-text-secondary">
          {label}
        </dt>
        <dd data-numeric className="font-heading text-h2 font-semibold text-text-primary">
          {value}
        </dd>
      </div>
    );
  }

  return (
    <div className="border-t-hairline border-t-rule-hairline pt-sm">
      <dt className="font-heading text-h3 font-semibold text-text-primary">
        {takeaway ?? label}
      </dt>
      <dd className="mt-2xs">
        {value ? (
          <p data-numeric className="font-mono text-h2 font-semibold text-text-primary">
            {value}
            {label ? (
              <span className="ms-xs font-data text-caption font-normal text-text-secondary">
                {label}
              </span>
            ) : null}
          </p>
        ) : null}
        {alt ? <span className="sr-only">{alt}</span> : null}
        {description ? (
          <p className="mt-2xs max-w-prose text-body text-text-secondary" style={{ textWrap: 'pretty' }}>
            {description}
          </p>
        ) : null}
        {source ? (
          <p className="mt-xs font-data text-caption text-text-secondary">{source}</p>
        ) : null}
      </dd>
    </div>
  );
}
