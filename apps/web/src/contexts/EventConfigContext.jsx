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
      eventConfig: overlay.event
        ? { ...snapshotEventConfig, ...overlay.event }
        : snapshotEventConfig,
      features: overlay.features
        ? { ...snapshotFeatures, ...overlay.features }
        : snapshotFeatures,
      theme: overlay.theme
        ? { ...snapshotTheme, ...overlay.theme }
        : snapshotTheme,
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
