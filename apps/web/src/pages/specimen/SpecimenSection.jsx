// A section of the book: the boundary, the heading, and one line that says
// what the section is for.
//
// The line sits under the heading. Nothing sits above a heading anywhere in
// this system, and a book of devices is the last place to break that rule.
import SectionHead from '../../components/editorial/SectionHead.jsx';

/**
 * @param {{
 *   id: string,
 *   title: string,
 *   folio?: string | null,
 *   standfirst: string,
 *   children: import('react').ReactNode,
 * }} props
 */
export default function SpecimenSection({ id, title, folio = null, standfirst, children }) {
  return (
    <section aria-labelledby={id} className="mt-2xl">
      <SectionHead id={id} title={title} folio={folio} level={2} tabIndex={-1} />
      <p className="mt-sm max-w-prose text-lead text-text-secondary">{standfirst}</p>
      {children}
    </section>
  );
}
