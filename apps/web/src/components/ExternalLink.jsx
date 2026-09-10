// A link that opens a new tab, and says so (issue 236).
//
// A new tab is a change of context. A reader who can see the page infers it
// from the tab strip; a reader using a screen reader gets no signal at all,
// presses Back, and finds that Back does nothing, because they are in a tab
// with no history. So every outbound link that opens a tab carries the same
// hidden sentence, and it is the same sentence everywhere — one term per
// concept.
//
// THE MARKER IS TEXT, NOT AN ICON. An icon needs a label of its own, and a
// label on an icon inside a link is read as part of the link's name anyway.
// Text in the link's name is the short path to the same result, and it
// survives a preset that turns the icon off.
//
// `rel="noreferrer"` is not optional and is set here rather than at the call
// site. It severs `window.opener`, so the page that opens cannot reach back
// into the event's own page, and it withholds the referrer.
//
// A link that does NOT open a new tab must not use this component. The
// sentence would be a lie, and a lie in a hidden string is the hardest kind
// to find.

/** The one sentence. Exported so a call site that must inline it agrees. */
export const NEW_TAB_NOTE = 'opens in a new tab';

/** The hidden half of the link's name, for a call site with its own <a>. */
export function NewTabNote() {
  return <span className="sr-only">{` (${NEW_TAB_NOTE})`}</span>;
}

/**
 * @param {object} props
 * @param {string} props.href
 * @param {string} [props.className]
 * @param {React.ReactNode} props.children the visible words
 */
export default function ExternalLink({ href, className, children, ...rest }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={className} {...rest}>
      {children}
      <NewTabNote />
    </a>
  );
}
