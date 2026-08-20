// EventConfigProvider — outermost provider (spec §2.4).
//
// First paint serves the committed snapshot (via the @generated alias);
// onSnapshot subscriptions to config/{event,features,theme,badges} overlay it
// at runtime, so feature toggles, lifecycle dates, and theme changes take
// effect without a rebuild. The provider owns <style id="event-theme-runtime">
// (spec §7.2): when config/theme arrives, its hex colors — data, never
// literals in this source — are converted to RGB-triple custom-property
// overrides of the same :root properties generated/theme.css defined.
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  eventConfig as snapshotEventConfig,
  features as snapshotFeatures,
  theme as snapshotTheme,
} from '@generated/eventConfig.js';
import { subscribeConfigDoc } from '../lib/configSource.js';
import { buildRuntimeThemeCss } from '../lib/themeRuntime.js';

const EventConfigContext = createContext(null);

const RUNTIME_STYLE_ID = 'event-theme-runtime';
const CONFIG_DOC_IDS = ['event', 'features', 'theme', 'badges'];

// Every known config/features flag, defaulted false. A live config/features
// doc is authoritative (backend contract: an omitted flag means disabled), so
// this — not the snapshot — is the base a live doc is spread over.
const FEATURE_DEFAULTS = Object.fromEntries(
  Object.keys(snapshotFeatures).map((key) => [key, false]),
);

function ensureRuntimeStyleElement() {
  let styleEl = document.getElementById(RUNTIME_STYLE_ID);
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = RUNTIME_STYLE_ID;
    document.head.appendChild(styleEl);
  }
  return styleEl;
}

export function EventConfigProvider({ children }) {
  // One overlay slot per config doc; null = no runtime doc received yet, so
  // the committed snapshot value stands (spec §2.4 fail-soft first paint).
  const [overlay, setOverlay] = useState({
    event: null,
    features: null,
    theme: null,
    badges: null,
  });

  useEffect(() => {
    const unsubscribers = CONFIG_DOC_IDS.map((docId) =>
      subscribeConfigDoc(docId, (data) => {
        setOverlay((prev) => ({ ...prev, [docId]: data }));
      }),
    );
    return () => {
      for (const unsubscribe of unsubscribers) {
        if (typeof unsubscribe === 'function') unsubscribe();
      }
    };
  }, []);

  const value = useMemo(() => {
    const live =
      overlay.event || overlay.features || overlay.theme || overlay.badges;
    return {
      // Shallow (one-level) overlay by design: the CMS write path always
      // writes each config/{event,features,theme} doc in full (backend
      // invariant — see functions/src/cms for the admin write path), so a
      // runtime doc is expected to carry every top-level key it owns, not a
      // sparse patch. A doc that omits a nested object (e.g. config/theme
      // without `logos`) correctly keeps the snapshot's sibling value; a doc
      // that includes a nested object (e.g. `logos: {...}`) is expected to
      // include it in full, since this merge does not descend into it.
      eventConfig: overlay.event
        ? { ...snapshotEventConfig, ...overlay.event }
        : snapshotEventConfig,
      // config/features is the one doc where an omitted key is not "keep the
      // snapshot value" — the backend contract is that an omitted flag means
      // disabled. So once a live doc has arrived it is authoritative: every
      // known flag defaults to false and only what the live doc actually sets
      // wins. Only the absence of a live doc (no config/features write yet)
      // falls back to the snapshot.
      features: overlay.features
        ? { ...FEATURE_DEFAULTS, ...overlay.features }
        : snapshotFeatures,
      theme: overlay.theme
        ? { ...snapshotTheme, ...overlay.theme }
        : snapshotTheme,
      // config/badges has no synthetic snapshot counterpart (badges are a
      // live-only feature, gated off by features.badges in M2) — overlay-only
      // by design, so this is null until a runtime doc lands; consumers must
      // handle null rather than assuming snapshot-first parity with the
      // other three docs.
      badges: overlay.badges,
      source: live ? 'live' : 'snapshot',
    };
  }, [overlay]);

  // Runtime theme override (spec §7.2). The element exists from mount so the
  // ownership contract holds even before config/theme arrives; its content is
  // only the properties the runtime doc validly overrides — everything else
  // keeps the build-time value from generated/theme.css.
  useEffect(() => {
    const styleEl = ensureRuntimeStyleElement();
    styleEl.textContent = overlay.theme
      ? buildRuntimeThemeCss(overlay.theme)
      : '';
  }, [overlay.theme]);

  // Event-neutral shell title: snapshot name first, runtime name when it lands.
  useEffect(() => {
    document.title = value.eventConfig.name;
  }, [value.eventConfig.name]);

  // Mirror the resolved texture onto the document element so the .bg-paper
  // rule in index.css can gate on it — CSS custom properties can't be tested
  // for equality in a selector (spec §7.2 texture treatment).
  useEffect(() => {
    document.documentElement.dataset.texture = value.theme.texture;
  }, [value.theme.texture]);

  return (
    <EventConfigContext.Provider value={value}>
      {children}
    </EventConfigContext.Provider>
  );
}

export function useEventConfig() {
  const ctx = useContext(EventConfigContext);
  if (!ctx) {
    throw new Error('useEventConfig must be used inside <EventConfigProvider>.');
  }
  return ctx;
}

export function useFeatures() {
  return useEventConfig().features;
}

export default EventConfigContext;
