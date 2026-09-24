// Standfirst — the one sentence under a heading that says what the page or
// session is (expansion record §3.1).
//
// BELOW THE HEADING, NEVER ABOVE IT. A standfirst sits under the title it
// explains, at the lead step, and the eyebrow ban (brief §2.4) is the reason
// it can sit nowhere else. Each style names its face and its rule through
// the `standfirst` contract: Broadsheet and Field Guide set it in italic,
// Newsroom in the heading face, Zine on a strong rule, Atlas in the heading
// face at regular weight.
//
// It is a paragraph at the measure. A page has one; a section may have one.

/**
 * @param {{
 *   children: import('react').ReactNode,
 *   className?: string,
 * }} props
 */
export default function Standfirst({ children, className = '' }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <p className={['standfirst max-w-prose', className].filter(Boolean).join(' ')}>{children}</p>
  );
}
