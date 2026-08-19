// EventConfigProvider — outermost provider (spec §2.4).
//
// First paint serves the committed snapshot (via the @generated alias).
// TODO(m2-config-runtime): subscribe to config/{event,features,theme,badges}
// in Firestore and overlay the snapshot, and write theme overrides into the
// <style id="event-theme-runtime"> element this provider owns (spec §7.2).
// Feature toggles, lifecycle dates, and theme changes then take effect
// without a rebuild.
import { createContext, useContext, useEffect, useMemo } from 'react';
import { eventConfig, features, theme } from '@generated/eventConfig.js';

const EventConfigContext = createContext(null);

const RUNTIME_STYLE_ID = 'event-theme-runtime';

export function EventConfigProvider({ children }) {
  useEffect(() => {
    // Own the runtime theme style element (spec §7.2). The runtime overlay
    // (TODO above) rewrites its textContent with :root custom-property
    // overrides from config/theme.
    let styleEl = document.getElementById(RUNTIME_STYLE_ID);
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = RUNTIME_STYLE_ID;
      document.head.appendChild(styleEl);
    }
    // Event-neutral shell title gets the snapshot's event name before the
    // runtime overlay arrives.
    document.title = eventConfig.name;
  }, []);

  const value = useMemo(
    () => ({ eventConfig, features, theme, source: 'snapshot' }),
    [],
  );

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

export default EventConfigContext;
