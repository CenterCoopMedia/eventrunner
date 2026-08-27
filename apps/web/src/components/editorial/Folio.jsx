// Folio — a small-caps plain-text label that sits ON a hairline rule at a
// section boundary (design brief §2.1).
//
// THE ONE RULE THAT MATTERS: a folio never sits directly above a heading.
// The eyebrow ban is absolute (brief §2.4), and a plain small-caps folio
// stacked above a headline is still an eyebrow. A folio lives beside a rule
// at a section boundary, in a margin, or in a running header. Where a label
// must sit near a title, put it below the title or beside it — which is what
// SectionHead does, and why section boundaries should go through SectionHead
// rather than composing a Folio above a heading by hand.
//
// A folio is text plus rule. Never a chip. Never a pill. Never a colored
// badge. The type comes from the tier-3 `--folio-*` contract and the rule
// from `--folio-rule-*`, so a preset retunes both without a code change.

/**
 * @param {{
 *   children: import('react').ReactNode,
 *   as?: string,          // element for the label row; 'p' by default, a
 *                         // heading tag where the folio IS the section head
 *   id?: string,          // so an aria-labelledby can point at it
 *   rule?: boolean,       // draw the rule that runs to the trailing edge
 *   className?: string,
 * }} props
 */
export default function Folio({
  children,
  as: Tag = 'p',
  id,
  rule = true,
  className = '',
}) {
  return (
    <Tag
      id={id}
      className={['flex items-center gap-xs', className].filter(Boolean).join(' ')}
    >
      <span className="folio whitespace-nowrap font-data font-medium">{children}</span>
      {rule ? <span aria-hidden="true" className="folio__rule flex-1 self-center" /> : null}
    </Tag>
  );
}
