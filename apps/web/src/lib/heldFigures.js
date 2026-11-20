import { useLayoutEffect, useSyncExternalStore } from 'react';
import { STAGES } from './useLoadingStage.js';
import '../components/heldFigure.css';

// A page shows one held-up figure (brief §2.3, #1090). Every wait that
// reaches one second joins this queue: a loading status's figure, or a busy
// public control. The earliest owns the figure, a wait inside an open dialog
// goes first, and the next takes over the moment the owner ends.
const waiting = [];
const listeners = new Set();
let owner = null;

function settleOwner() {
  const dialog = document.querySelector('dialog[open]');
  owner = (dialog && waiting.find((element) => dialog.contains(element))) || waiting[0] || null;
  listeners.forEach((listener) => listener());
}

function join(element) {
  if (waiting.includes(element)) return;
  waiting.push(element);
  settleOwner();
}

function leave(element) {
  const index = waiting.indexOf(element);
  if (index < 0) return;
  waiting.splice(index, 1);
  settleOwner();
}

function subscribe(listener) {
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

// Busy public controls mark themselves with aria-busy, so one observer serves
// every control instead of a copy in each component. It writes the control's
// waiting stage to `data-held-stage` while the control owns the figure, and
// heldFigure.css draws the ampersand from it. React never sets that
// attribute, so a render leaves it alone. `data-held-still` marks a control
// whose stage its author sets, as the specimen book does.
const BUSY = ':is(.public-action, .public-text-control)[aria-busy="true"]:not([data-held-still])';
const timers = new WeakMap();
const stages = new Map();

function showStages() {
  for (const [control, stage] of stages) {
    if (control === owner) control.setAttribute('data-held-stage', stage);
    else control.removeAttribute('data-held-stage');
  }
}

function hold(control) {
  if (timers.has(control)) return;
  timers.set(control, STAGES.map(([at, stage]) => setTimeout(() => {
    if (!control.isConnected) {
      settle(control);
      return;
    }
    stages.set(control, stage);
    if (control === owner) showStages();
    else join(control);
  }, at)));
}

function settle(control) {
  timers.get(control)?.forEach((timer) => clearTimeout(timer));
  timers.delete(control);
  stages.delete(control);
  control.removeAttribute('data-held-stage');
  leave(control);
}

/** Watches `root` for busy public controls; returns the cleanup. */
export function installBusyControlFigures(root = document) {
  const unsubscribe = subscribe(showStages);
  root.querySelectorAll(BUSY).forEach(hold);
  // Observer callbacks run before the next paint, so a control that settles
  // loses its figure in the same frame as its result.
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') {
        if (record.target.matches(BUSY)) hold(record.target);
        else if (timers.has(record.target)) settle(record.target);
      }
      for (const node of record.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.matches(BUSY)) hold(node);
        node.querySelectorAll(BUSY).forEach(hold);
      }
      for (const node of record.removedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        for (const control of stages.keys()) if (node === control || node.contains(control)) settle(control);
      }
    }
  });
  observer.observe(root, { subtree: true, childList: true, attributeFilter: ['aria-busy'] });
  return () => {
    observer.disconnect();
    unsubscribe();
  };
}
