// Where a route change puts the reader (M7 issue 6).
//
// A single-page app keeps the window's scroll position across a navigation,
// so opening a session from the middle of a long schedule used to drop the
// reader into the middle of the session — or, on a shorter page, below its
// end. The browser does this correctly for a document load; the router has
// to do it for a route change.
//
// AND THE ROUTER DOES NOT DO FRAGMENTS EITHER. React Router 6 performs a
// client navigation, not a document load, so the browser never resolves the
// fragment in /travel#section-rooms: nothing in the stack scrolls to it, and
// before this component that link left the reader at whatever offset the
// previous page had.
//
// THE TARGET IS USUALLY NOT THERE YET, WHICH IS THE WHOLE DIFFICULTY. Every
// content route in this app is React.lazy (App.jsx), and ContentPage's
// `#section-<id>` anchors exist only once the chunk has loaded AND the
// Firestore content has rendered. Looking the id up once, in the effect that
// runs on the pathname change, finds nothing on a cold load of
// /travel#section-rooms and on the first visit to any unfetched chunk — and
// then "the fragment names nothing" is the wrong conclusion, drawn a few
// hundred milliseconds too early.
//
// So a fragment that misses is HELD and retried over a bounded window: a
// MutationObserver re-checks whenever the document changes, and the window
// closes after FRAGMENT_WINDOW_MS or on the next navigation, whichever comes
// first. Only when it closes is the fragment treated as naming nothing, and
// the reader is taken to the top instead — a page that opens mid-document
// for a reason that no longer exists is worse than one that opens at its
// beginning. Nothing scrolls in the meantime, so the reader is not moved
// twice for one navigation.
//
// FOCUS MOVES ONLY WHERE IT IS INVITED. A fragment target that carries a
// tabindex, or that is a heading, is a place a reader is meant to land, and
// focus follows the scroll so a keyboard reader continues from there.
// (ContentPage's section headings carry tabIndex={-1} for exactly this
// reason.) A fragment naming an ordinary wrapper is not: taking focus off
// whatever the reader was using — a link they just followed, a control they
// came from — to park it on a <div> is worse than leaving it alone.
//
// A BACK BUTTON IS NOT A NAVIGATION TO THE TOP. On POP the browser restores
// the scroll position the reader left, which is the behaviour they asked
// for; scrolling to the top on top of that would throw it away. So the top
// reset is skipped for POP. A fragment is still resolved on POP, because a
// URL that names a place still names it whichever way the reader arrived.
//
// IT LIVES BESIDE THE ROUTER, NOT INSIDE A PAGE. Every route is affected,
// including the ones that are code-split and mount a frame later, so one
// component under the router answers for all of them. ContentPage clears
// its own keyword filter on the same `pathname` change and is deliberately
// left alone: that is a page's own state, not the shell's scroll position.
//
// EVERY NAVIGATION IS ONE, INCLUDING A MOVE WITHIN ONE PAGE. This used to
// react to `pathname` alone, on the reasoning that a hash-only or
// query-only move is not a page change. It is not, but it IS a navigation
// the router performs and the browser does not resolve, and skipping it
// went wrong twice. A link from /travel#gone to /travel#rooms resolved
// nothing, so the reader stayed put; and worse, the abandoned #gone window
// was still open, so three seconds later its timer took a reader who was
// reading Rooms to the top of the page. So the effect is keyed on the
// location's own key: every navigation cancels the one before it and
// resolves its own fragment.
//
// WHAT A MOVE WITHIN ONE PAGE MUST STILL NOT DO is reset to the top. The
// top reset belongs to arriving somewhere new; on the page the reader is
// already reading there is nothing to reset, and doing it anyway would
// throw away their place on a filter change or an in-page anchor. So the
// reset is gated on the pathname having actually changed, which is the
// half of the old rule that was right.
//
// NOTHING ANIMATES, IN ANY MOTION SETTING — lib/scrollToTop.js states why,
// and both this and the back-to-top control go through it so there is one
// answer rather than two.
import { useEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { scrollToElement, scrollToTop } from '../lib/scrollToTop.js';

/**
 * How long a fragment is given to appear before it is treated as naming
 * nothing. Long enough for a code-split chunk plus a Firestore snapshot on
 * a slow connection, short enough that a reader is not left looking at an
 * unmoved page wondering whether the link worked.
 */
export const FRAGMENT_WINDOW_MS = 3000;

/**
 * The element id a location's hash names, or '' for no usable fragment.
 *
 * A hash is percent-encoded in the URL and raw in the DOM, so it is decoded
 * before the lookup — and decoding is guarded, because a hand-typed or
 * hand-edited URL can carry a lone '%' that decodeURIComponent throws on.
 *
 * @param {string} hash a location hash, with or without its leading '#'
 * @returns {string}
 */
function fragmentId(hash) {
  const raw = typeof hash === 'string' ? hash.replace(/^#/, '') : '';
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Move focus onto a fragment target, if it is the sort of element a reader
 * is meant to land on.
 *
 * A heading is exactly that, and it is also the shape SectionIndexNav
 * already focuses; it simply cannot ACCEPT focus without a tabindex, so one
 * is set here. `-1` keeps it out of the tab order, which is why leaving it
 * in place afterwards changes nothing a reader can observe.
 *
 * This does NOT go through focusAsDestination: that draws the ring for a
 * control's own "I moved you" case. A fragment target is where the reader
 * is now reading, and the site's ordinary :focus-visible rule is the right
 * indicator for it.
 *
 * @param {HTMLElement} element
 */
function focusFragmentTarget(element) {
  const isHeading = /^H[1-6]$/.test(element.tagName);
  if (!element.hasAttribute('tabindex') && !isHeading) return;
  if (!element.hasAttribute('tabindex')) element.setAttribute('tabindex', '-1');
  // preventScroll: the jump above already put the element where it belongs,
  // and letting focus scroll again would undo the scroll-margin allowance.
  element.focus({ preventScroll: true });
}

export default function ScrollReset() {
  const { pathname, hash, key } = useLocation();
  const navigationType = useNavigationType();
  // The navigation this effect last ran for, and whether it was a move
  // within one page. Keyed on the location key rather than recomputed every
  // run, so an effect that re-runs for the SAME navigation — which is what
  // React does under StrictMode — does not mistake the repeat for a
  // same-page move and swallow the top reset.
  const lastRun = useRef({ key: null, pathname: null, samePage: false });

  useEffect(() => {
    if (lastRun.current.key !== key) {
      lastRun.current = { key, pathname, samePage: lastRun.current.pathname === pathname };
    }
    const { samePage } = lastRun.current;
    const id = fragmentId(hash);

    /**
     * Open the page at its beginning — but only when it IS another page,
     * and only when the reader was not restored to a place of their own.
     * POP is a back, a forward, or a reload: the browser restores the
     * position the reader left, and this must not throw that away.
     */
    const openAtTop = () => {
      if (samePage || navigationType === 'POP') return;
      scrollToTop();
    };

    if (!id) {
      openAtTop();
      return undefined;
    }

    /** @returns {boolean} whether the fragment was resolved */
    const settle = () => {
      const target = typeof document === 'undefined' ? null : document.getElementById(id);
      if (!target) return false;
      scrollToElement(target);
      focusFragmentTarget(target);
      return true;
    };

    if (settle()) return undefined;

    const ObserverType = globalThis.MutationObserver;
    // No observer, no waiting — the same rule the rest of the shell applies
    // to an absent API: the refinement does not happen, and the reader gets
    // the answer that is available now.
    if (typeof ObserverType !== 'function' || typeof document === 'undefined') {
      openAtTop();
      return undefined;
    }

    let closed = false;
    const close = () => {
      closed = true;
      observer.disconnect();
      clearTimeout(timer);
    };
    const observer = new ObserverType(() => {
      if (closed) return;
      if (settle()) close();
    });
    const timer = setTimeout(() => {
      if (closed) return;
      close();
      // The window shut with nothing to show for it: the fragment names
      // nothing that is going to exist, so open the page at its beginning.
      openAtTop();
    }, FRAGMENT_WINDOW_MS);
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // The next navigation cancels this one. A reader who has moved on is not
    // waiting for the previous page's fragment — and the key changes on
    // every navigation, so "the next one" includes a move within one page.
    return close;
  }, [key, pathname, hash, navigationType]);

  return null;
}
