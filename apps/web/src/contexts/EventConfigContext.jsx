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
import { IS_DEMO } from '../lib/demoMode.js';
import { buildRuntimeThemeCss, resolveRootAttributes } from '../lib/themeRuntime.js';
import { startModeSync } from '../lib/modeRuntime.js';
import { resolveShape } from 'shared/theme';

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

export function EventConfigProvider({ children, demoMode = IS_DEMO }) {
  // One overlay slot per config doc; null = no runtime doc received yet, so
  // the committed snapshot value stands (spec §2.4 fail-soft first paint).
  const [overlay, setOverlay] = useState({
    event: null,
    features: null,
    theme: null,
    badges: null,
  });

  // The static demo can replace only the presentation fields. It still uses
  // the committed synthetic event data, feature flags, logos, and header.
  // A client build never enables this state or exposes its setter.
  const [demoTheme, setDemoTheme] = useState(null);

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

  const effectiveDemoTheme = useMemo(
    () =>
      demoMode && demoTheme
        ? { ...snapshotTheme, ...demoTheme }
        : null,
    [demoMode, demoTheme],
  );

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
      theme: effectiveDemoTheme
        ? effectiveDemoTheme
        : overlay.theme
          ? { ...snapshotTheme, ...overlay.theme }
          : snapshotTheme,
      // config/badges has no synthetic snapshot counterpart (badges are a
      // live-only feature, gated off by features.badges in M2) — overlay-only
      // by design, so this is null until a runtime doc lands; consumers must
      // handle null rather than assuming snapshot-first parity with the
      // other three docs.
      badges: overlay.badges,
      source: live ? 'live' : 'snapshot',
      // Per-document readiness. `source` above is an aggregate — it flips to
      // 'live' as soon as ANY of the four docs reports — which is fine for
      // "are we showing runtime values at all" but wrong for any consumer
      // that must know whether ITS doc has arrived (e.g. an admin form that
      // seeds itself once and then saves the doc whole: seeding from the
      // snapshot because a sibling doc reported first would silently revert
      // production values on save).
      sources: {
        event: overlay.event ? 'live' : 'snapshot',
        features: overlay.features ? 'live' : 'snapshot',
        theme: overlay.theme ? 'live' : 'snapshot',
        badges: overlay.badges ? 'live' : 'snapshot',
      },
      // DemoBanner uses this setter to compare the shipped presets without a
      // Firestore write. It is null in every client build.
      setDemoTheme: demoMode ? setDemoTheme : null,
    };
  }, [demoMode, effectiveDemoTheme, overlay]);

  // THE document the rendering of the theme resolves from.
  //
  // Not `value.theme`. That one is the shallow overlay, and the shallow
  // overlay is right for the CONSUMERS of the context — a live doc that
  // omits `logos` should keep showing the snapshot's logos. It is wrong for
  // the four DOM writes below, because they have to agree with each other:
  // the runtime stylesheet has always been built from the live doc alone,
  // and resolving the attributes from a doc that still carries snapshot keys
  // makes the attribute and the custom property disagree. A live document
  // naming a preset and nothing else would then get `--texture: paper` from
  // the preset and `data-texture="flat"` left over from the build.
  //
  // The demo is different on purpose: it changes only the style and mode, so
  // it keeps the snapshot's header and logo fields while it compares presets.
  const themeDoc = effectiveDemoTheme || overlay.theme || snapshotTheme;
  const runtimeThemeDoc = effectiveDemoTheme || overlay.theme;

  // Runtime theme override (spec §7.2). The element exists from mount so the
  // ownership contract holds even before config/theme arrives; its content is
  // only the properties the runtime doc validly overrides — everything else
  // keeps the build-time value from generated/theme.css.
  useEffect(() => {
    const styleEl = ensureRuntimeStyleElement();
    styleEl.textContent = runtimeThemeDoc
      ? buildRuntimeThemeCss(runtimeThemeDoc)
      : '';
  }, [runtimeThemeDoc]);

  // Event-neutral shell title: snapshot name first, runtime name when it lands.
  useEffect(() => {
    document.title = value.eventConfig.name;
  }, [value.eventConfig.name]);

  // Mirror the RESOLVED texture onto the document element so the
  // .page-surface rule in index.css can gate on it — CSS custom properties
  // can't be tested for equality in a selector (spec §7.2).
  //
  // Resolved, not raw: a preset states its own texture (brief §4), and
  // config/theme.texture only overrides it. A document that names a preset
  // and omits the field has no `texture` to read, so the raw value left the
  // attribute holding whatever the build shipped — Field Guide's paper
  // rendered flat. resolveShape is the path the generator writes --texture
  // through, the path buildRuntimeThemeCss writes it through, and the path
  // the admin preview writes the attribute through, so all four agree by
  // construction.
  const texture = resolveShape(themeDoc).texture;
  useEffect(() => {
    if (texture) document.documentElement.dataset.texture = texture;
    else delete document.documentElement.dataset.texture;
  }, [texture]);

  // The preset's density, mirrored the same way and for the same reason
  // (brief §4, §6.1). This is the density every page renders at unless a
  // page states its own; a page that does writes `data-density` on its own
  // <article> (components/SystemPage.jsx), and the [data-density] block
  // nearest an element is the one that wins for it.
  const density = resolveShape(themeDoc).density;
  useEffect(() => {
    if (density) document.documentElement.dataset.density = density;
    else delete document.documentElement.dataset.density;
  }, [density]);

  // Which preset, and which motif set (design brief §3.4, §3.8).
  //
  // Both are attributes for the same reason: a theme remaps custom
  // properties, and a custom property cannot rewrite the asset a second
  // custom property points at. The generated stylesheet carries one block
  // per (data-theme, data-mode) pair and one per data-motif-set value, and
  // these two attributes pick which block wins.
  //
  // A document that names no preset gets no data-theme attribute at all, so
  // it keeps rendering the attribute-free baseline — which is exactly what
  // it rendered before presets existed.
  useEffect(() => {
    const root = document.documentElement;
    const { theme, motifSet } = resolveRootAttributes(themeDoc);
    if (theme) root.dataset.theme = theme;
    else delete root.dataset.theme;
    root.dataset.motifSet = motifSet;
  }, [themeDoc]);

  // Light or dark (design brief §3.3). config/theme.mode states the policy;
  // this writes data-mode on <html>, which is what picks between the two
  // color blocks in the generated stylesheet. Under the 'system' policy the
  // subscription stays open, so the page follows the reader's setting when
  // it changes. A document with no `mode` renders light.
  useEffect(() => startModeSync(themeDoc.mode), [themeDoc.mode]);

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
