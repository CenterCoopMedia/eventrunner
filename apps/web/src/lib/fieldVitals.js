import { resolveFunctionsOrigin } from './errorReporting.js';
import { routePage } from './routePage.jsx';

const HELD_UP_EVENT = 'eventrunner:held-up';
const MAX_SAMPLES = 100;
let collector;

// Keep this import beside its build constants so the demo emits no chunk.
// The existing speculative loader also keeps a missing optional chunk from
// spending the navigation reload budget or interrupting the reader's page.
const loadReporter = import.meta.env.PROD
  && import.meta.env.VITE_DEMO_MODE !== '1'
  && import.meta.env.VITE_DEMO_MODE !== 'true'
  ? routePage(() => import('./fieldVitalsReporter.js')).prefetch : null;

export function fieldVitalsEnabled(env = import.meta.env) {
  return env.PROD === true && env.DEV !== true
    && env.VITE_DEMO_MODE !== '1' && env.VITE_DEMO_MODE !== 'true';
}

/** One sampled document; config is unknown until a live answer arrives. */
export function createFieldVitalsCollector({
  load, routePattern, endpoint, window: win = globalThis, random = Math.random,
}) {
  let enabled = null;
  let stopped = false;
  let attempted = false;
  let frame;
  let reporter;
  let sent = 0;
  const pending = [];
  const sampled = random() < 0.1;
  const initialURL = win.location.href;

  function send(sample) {
    if (stopped || enabled !== true || sent >= MAX_SAMPLES) return;
    sent += 1;
    try {
      win.navigator.sendBeacon(endpoint, JSON.stringify(sample));
    } catch { /* Performance reporting must not become an application error. */ }
  }

  function heldUp() {
    if (!sampled || stopped || enabled === false || pending.length + sent >= MAX_SAMPLES) return;
    const sample = { route: routePattern(win.location.href),
      device: win.innerWidth < 768 ? 'mobile' : 'desktop', name: 'held_up', value: 1 };
    if (reporter && enabled === true) send(sample);
    else pending.push(sample);
  }

  function flushPending() {
    while (pending.length) send(pending.shift());
  }

  function afterPaint() {
    frame = win.requestAnimationFrame(() => {
      frame = win.requestAnimationFrame(async () => {
        frame = undefined;
        if (stopped || enabled !== true) return;
        attempted = true;
        try {
          const module = await load();
          if (stopped) return;
          reporter = module;
          module.startVitalsReporter({ send, routePattern, initialURL, window: win });
          if (enabled === true) flushPending();
        } catch {
          pending.length = 0;
          // A failed chunk is dropped for this document. There is no retry.
        }
      });
    });
  }

  if (sampled) {
    win.addEventListener(HELD_UP_EVENT, heldUp);
    if (win.__eventHeldUpBoot) heldUp();
  }
  return {
    setEnabled(value) {
      // Unconfirmed config suspends sends; only a confirmed opt-out drops
      // observations already waiting for the server's feature decision.
      enabled = value === true ? true : value === false ? false : null;
      if (enabled !== true) {
        if (enabled === false) pending.length = 0;
        if (frame !== undefined) win.cancelAnimationFrame(frame);
        frame = undefined;
      } else if (reporter) {
        flushPending();
      } else if (sampled && !attempted && frame === undefined && !stopped) {
        afterPaint();
      }
    },
    stop() {
      stopped = true;
      pending.length = 0;
      if (frame !== undefined) win.cancelAnimationFrame(frame);
      win.removeEventListener(HELD_UP_EVENT, heldUp);
    },
  };
}

/** Called before React mounts; the HTML marker remains in memory only. */
export function initFieldVitals(routePattern) {
  if (collector || !loadReporter || !fieldVitalsEnabled()) return;
  const origin = resolveFunctionsOrigin();
  if (origin) collector = createFieldVitalsCollector({ load: loadReporter,
    routePattern, endpoint: `${origin}/logWebVitals` });
}

export function setFieldVitalsEnabled(enabled) {
  collector?.setEnabled(enabled);
}

/** A real wait crossed its visible held-up threshold. Previews do not call it. */
export function reportHeldUp(boot = false) {
  if (boot) {
    if (globalThis.__eventHeldUpBoot) return;
    globalThis.__eventHeldUpBoot = true;
  }
  globalThis.dispatchEvent(new Event(HELD_UP_EVENT));
}
