// LongReadOpening — the opening of a long read (expansion record §3.1;
// brief §2.1, "Drop cap").
//
// A drop cap, a standfirst, or plain, and the STYLE decides which: the Long
// read opening option in each preset remaps the `long-read` contract, so
// Broadsheet and Field Guide open on the cap, Newsroom on a standfirst-sized
// line, and Civic, Zine and Atlas on nothing. This wrapper only marks the
// place — the first block of a page on the Long read template — and the
// stylesheet does the rest on that block's first paragraph.
//
// ONE PER PAGE AT MOST, NEVER ON A SHORT INTRO, NEVER ON A CARD. The wrapper
// is inert unless `active`, and a page's renderer passes `active` for its
// first section only, and only when the page states the Long read template.
// A page whose values happen to match the template has not chosen it
// (lib/pageTemplates.js), so no cap appears by coincidence.

/**
 * @param {{
 *   active?: boolean,
 *   children: import('react').ReactNode,
 * }} props
 */
export default function LongReadOpening({ active = false, children }) {
  if (!active) return children;
  return <div className="long-read-opening">{children}</div>;
}
