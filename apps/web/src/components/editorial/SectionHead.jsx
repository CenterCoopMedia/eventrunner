// SectionHead — the section boundary of the editorial base (design brief
// §2.1): one strong rule, then the section's heading with a hairline running
// out to the trailing edge and the folio sitting on that rule.
//
// This is the shape that keeps the eyebrow ban (brief §2.4) impossible to
// break by accident. The folio is BESIDE the heading, on the rule, never
// stacked above it — so reach for SectionHead instead of composing a Folio
// and a heading by hand. At narrow viewports the folio wraps BELOW the
// heading, which is also allowed; it can never wrap above it.
//
// Two variants:
//   'title'  the heading is the section title in the heading face at
//            --text-h2. Use it for a content section.
//   'folio'  the heading IS the folio — small caps, on the rule, in the data
//            face. Use it where the section head is a standing head rather
//            than a title: a schedule day head, an archive label.
//
// Heading level is a prop and never a size choice: pick the level the
// document outline needs (§8.1) and let the variant carry the size.
import Rule from './Rule.jsx';

/**
 * @param {{
 *   title: import('react').ReactNode,
 *   folio?: import('react').ReactNode,  // the label beside the rule
 *   level?: 2 | 3 | 4,
 *   id?: string,                        // for aria-labelledby on the section
 *   variant?: 'title' | 'folio',
 *   rule?: 'strong' | 'hairline' | 'none',
 *   className?: string,
 * }} props
 */
export default function SectionHead({
  title,
  folio = null,
  level = 2,
  id,
  variant = 'title',
  rule = 'strong',
  className = '',
}) {
  const Tag = `h${level >= 2 && level <= 6 ? level : 2}`;
  const isFolioHead = variant === 'folio';
  return (
    <div className={className}>
      {rule === 'none' ? null : <Rule weight={rule} />}
      {/* The distance between the rule and the head is the section-rule
          contract, and it takes the density step with it, so a client who
          asks for a tighter or a more open page gets one at every section
          boundary (brief §4, §6.1). */}
      <div
        className={[
          'section-head flex flex-wrap gap-x-md gap-y-3xs',
          isFolioHead ? 'items-center' : 'items-baseline',
        ].join(' ')}
      >
        <Tag
          id={id}
          className={
            isFolioHead
              ? 'folio whitespace-nowrap font-medium'
              : 'font-heading text-h2 font-semibold text-text-primary'
          }
        >
          {title}
        </Tag>
        <span aria-hidden="true" className="folio__rule flex-1 self-center" />
        {folio ? <p className="folio font-medium">{folio}</p> : null}
      </div>
    </div>
  );
}
