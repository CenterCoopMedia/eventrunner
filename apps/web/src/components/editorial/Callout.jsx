// Callout — the one tilted handwritten line a Zine page may carry (design
// brief §4.3; visual story, Zine, moment 3).
//
// "One tilted handwritten callout may appear per page, at a single fixed
// angle, set in the callout font, carrying real copy a visitor needs."
//
// It is TEXT, not a drawing. The two drawn marks are Marginalia; this one
// is a sentence, so it is a real element in the document, it is read aloud
// like any other sentence, and it is never `aria-hidden`.
//
// It runs on `--callout-font`, a component token rather than a fifth
// semantic role (brief §3.1, §3.2): Zine points it at the bundled script
// face and every other preset holds the heading face at a zero angle. A
// client who wants no script face points the token at `--font-heading`.
//
// ONE PER PAGE. That is a wiring rule, not something this component can
// enforce, and it is why it is not composed into any shared block.
//
// NOT WIRED YET. The callout needs real copy a visitor needs — "doors at
// nine, bring a pen" — and the CMS has no field that means that. The
// closest existing slot is the event tagline, which is the event's
// standing line rather than a note to a visitor, and routing it through
// here would change the tagline's face in the five presets whose story has
// no handwriting in it. So the device ships with its contract, its
// stylesheet, and its tests, and it is wired when a content slot for it
// exists (see the PR3 handoff).

/**
 * @param {{ children: import('react').ReactNode, className?: string }} props
 */
export default function Callout({ children, className = '' }) {
  if (children === null || children === undefined || children === '') return null;
  return <p className={['callout', className].filter(Boolean).join(' ')}>{children}</p>;
}
