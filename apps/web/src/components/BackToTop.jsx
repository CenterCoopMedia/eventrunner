// Back to top (M7 issue 6).
//
// The schedule, a long travel page, and the printed programme all run past
// several screens. A reader at the bottom of one has the browser's own
// keyboard shortcut and nothing else; this is the same move as a control,
// for a reader on a phone and for a reader tabbing through the page.
//
// IT IS A BUTTON, WITH ITS ERRAND IN WORDS. Not an icon, not a chevron: an
// icon-only control here would need an aria-label saying exactly what the
// visible text says instead (docs/interface-guidelines.md, Accessibility).
// It is the last thing in the document, so a keyboard reader reaches it
// after the content it offers to leave rather than in front of it.
//
// IT IS FIXED, SO IT SITS OVER SOMETHING. Over the middle of a long page
// that is the point — the reader is passing through. Over the FOOTER it is
// not: the footer's last row runs to the trailing edge, and on a narrow
// viewport the control lands on top of it, covering a link. So the control
// withdraws while the footer is on screen. By then the reader has arrived
// at the bottom of the page and the footer's own content is what they came
// for; the browser's Home key still works, and scrolling up by any amount
// brings the control back.
//
// A HOST WITH NO IntersectionObserver KEEPS THE CONTROL. Same rule as
// SectionIndexNav: the observer is a refinement, and its absence means the
// refinement does not happen — never that the feature disappears.
//
// APPEARING IS NOT MOTION. The control is absent below the threshold and
// present above it — no fade, no slide, and nothing that a scroll position
// animates (Animation: never trigger motion from scroll position, and no
// reveal-on-scroll). The jump it performs does not animate either, in any
// motion setting — see lib/scrollToTop.js.
//
// AND IT MOVES FOCUS, because scrolling alone moves only the picture. A
// reader who is not looking at the screen would otherwise land back at the
// top of the page with the keyboard still at the bottom of it — and worse,
// this control unmounts the moment it is used, so focus left where it was
// would fall to <body> and the next Tab would start the whole document
// again. Focus goes to the banner at the top of the shell (Layout.jsx gives
// it the id), or, if the shell that owns that id is not the one around this
// control, to the main landmark and then to the first thing a reader could
// tab to — never nowhere.
//
// focusAsDestination marks whatever it lands on so index.css can draw the
// ring for a pointer press as well as a keypress; see lib/scrollToTop.js
// for why :focus-visible and bare :focus are both wrong here.
import { useEffect, useState } from 'react';
import { focusAsDestination, scrollToTop } from '../lib/scrollToTop.js';
import { quietActionClass } from './controlClasses.js';

/**
 * What a reader could tab to. Used only as the last fallback below, so it
 * lists the shapes the public shell actually contains rather than trying to
 * be a complete focusability oracle.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * How far down the reader has to be before the control is worth offering:
 * one full screen, so it never appears on a page that does not scroll and
 * never covers the content of a page the reader has barely entered. Read
 * from the viewport rather than fixed in pixels, because "one screen" is
 * 600px on a phone and 1200px on a desktop.
 */
function threshold() {
  return typeof window === 'undefined' ? Infinity : window.innerHeight || 0;
}

/**
 * Where focus goes when the reader is sent to the top: the named banner, or
 * the main landmark, or the first focusable thing in the document.
 *
 * There is always an answer, because the alternative is focus on <body>
 * after this control unmounts — which reads to a screen reader as having
 * been dropped at the start of nothing.
 *
 * @param {string} targetId
 * @returns {HTMLElement|null}
 */
function topFocusTarget(targetId) {
  if (typeof document === 'undefined') return null;
  return (
    document.getElementById(targetId) ||
    document.querySelector('main') ||
    document.querySelector(FOCUSABLE)
  );
}

/**
 * @param {{ targetId: string, footerId: string }} props the id of the
 *   element focus lands on, and of the region the control withdraws for
 */
export default function BackToTop({ targetId, footerId }) {
  const [past, setPast] = useState(false);
  const [footerInView, setFooterInView] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const read = () => setPast((window.scrollY || 0) > threshold());
    // A reader can arrive already scrolled: a reload, or a back button that
    // restored the position. Read once before waiting for a scroll event.
    read();
    window.addEventListener('scroll', read, { passive: true });
    window.addEventListener('resize', read);
    return () => {
      window.removeEventListener('scroll', read);
      window.removeEventListener('resize', read);
    };
  }, []);

  useEffect(() => {
    const ObserverType = globalThis.IntersectionObserver;
    // No observer, no refinement — the control stays as it is (see above).
    if (typeof ObserverType !== 'function') return undefined;
    const target = typeof document === 'undefined' ? null : document.getElementById(footerId);
    if (!target) return undefined;
    const observer = new ObserverType((entries) => {
      // One target, so the last entry is the current answer for it.
      const entry = entries[entries.length - 1];
      if (entry) setFooterInView(entry.isIntersecting);
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [footerId]);

  if (!past || footerInView) return null;

  return (
    <button
      type="button"
      // Fixed at the trailing edge so it does not take a column away from
      // the content, on its own ground so the text under it never shows
      // through, and gone on paper.
      className={`${quietActionClass} fixed bottom-md end-md z-40 bg-surface print:hidden`}
      onClick={() => {
        scrollToTop();
        focusAsDestination(topFocusTarget(targetId));
      }}
    >
      Back to top
    </button>
  );
}
