import { useLayoutEffect, useSyncExternalStore } from 'react';

// A page shows one held-up figure (brief §2.3, #1090). Every wait that
// reaches one second joins this queue: a loading status's figure, or a busy
// public control. A wait inside an open dialog goes first, a loading status
// outranks a busy control, the earliest goes next, and the next takes over the
// moment the owner ends.
//
// A status outranking a control also covers a page that Suspense hides while
// one of its controls is busy: the hidden control stays connected and in this
// queue, and the route fallback that replaces it is a status, so the fallback
// draws the figure. Invariant: a hidden page always has a visible fallback
// status, so a hidden control never holds the figure over nothing.
const waiting = [];
const listeners = new Set();
let owner = null;

/** The element that holds the page's figure, or null. */
export const figureOwner = () => owner;

const isStatus = (element) => element.classList.contains('held-figure');

function settleOwner() {
  const dialog = document.querySelector('dialog[open]');
  const inDialog = dialog ? waiting.filter((element) => dialog.contains(element)) : [];
  const pool = inDialog.length > 0 ? inDialog : waiting;
  owner = pool.find(isStatus) || pool[0] || null;
  listeners.forEach((listener) => listener());
}

export function join(element) {
  if (waiting.includes(element)) return;
  waiting.push(element);
  settleOwner();
}

export function leave(element) {
  const index = waiting.indexOf(element);
  if (index < 0) return;
  waiting.splice(index, 1);
  settleOwner();
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Whether the figure `ref` holds is the page's one figure. A `still` figure,
 * as in the specimen book, always shows and never takes the page's turn.
 */
export function useFigureTurn(ref, still) {
  useLayoutEffect(() => {
    if (still) return undefined;
    const element = ref.current;
    join(element);
    return () => leave(element);
  }, [ref, still]);
  return useSyncExternalStore(subscribe, () => still || owner === ref.current, () => true);
}
