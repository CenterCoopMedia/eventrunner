// ContentProvider — runtime content overlay (spec §2.4 path 3).
//
// First paint serves the committed snapshot (via the @generated alias);
// onSnapshot subscriptions to the published cms collections overlay it at
// runtime, so publishes take effect without a rebuild. readSource 'draft'
// points the subscriptions at the *_drafts sibling collections for admin
// preview; firestore.rules — not this prop — enforce who may read drafts
// (?preview=1 is convenience only, wired in App.jsx).
//
// Overlay semantics, per collection:
//   - cmsContent / cmsPages: a live result with at least one doc replaces
//     the snapshot wholesale — the published set is the truth, and merging
//     would resurrect deleted demo blocks. An empty result or a listener
//     error keeps the snapshot (fail soft: a fresh, unseeded project should
//     still show the demo site, and rules-denied reads must not blank it).
//   - cmsUpdates: live-only; there is no snapshot module, so the default is
//     an empty list.
//   - cmsSchedule / cmsOrganizations / cmsTimeline: snapshot-only for now —
//     their runtime overlay belongs to the schedule/orgs tranche.
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import snapshotSiteContent from '@generated/siteContent.js';
import scheduleData, { speakers } from '@generated/scheduleData.js';
import organizationsData from '@generated/organizationsData.js';
import snapshotPages from '@generated/pagesData.js';
import { subscribeContentCollection } from '../lib/contentSource.js';

const ContentContext = createContext(null);

const RUNTIME_COLLECTIONS = ['cmsContent', 'cmsPages', 'cmsUpdates'];

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);

export function ContentProvider({ readSource = 'published', children }) {
  // One overlay slot per collection; null = no runtime result yet, so the
  // committed snapshot stands (spec §2.4 fail-soft first paint).
  const [overlay, setOverlay] = useState({
    cmsContent: null,
    cmsPages: null,
    cmsUpdates: null,
  });

  useEffect(() => {
    // Switching between published and draft re-subscribes from scratch;
    // stale overlay from the other source must not linger.
    setOverlay({ cmsContent: null, cmsPages: null, cmsUpdates: null });
    const unsubscribers = RUNTIME_COLLECTIONS.map((name) =>
      subscribeContentCollection(name, readSource, (docs) => {
        setOverlay((prev) => ({ ...prev, [name]: docs }));
      }),
    );
    return () => {
      for (const unsubscribe of unsubscribers) {
        if (typeof unsubscribe === 'function') unsubscribe();
      }
    };
  }, [readSource]);

  const value = useMemo(() => {
    // cmsContent docs are keyed `<section>__<field>` — same shape as the
    // snapshot map, so the live set drops straight in.
    const siteContent = overlay.cmsContent?.length
      ? Object.fromEntries(overlay.cmsContent.map((doc) => [doc.id, doc]))
      : snapshotSiteContent;
    const pages = (overlay.cmsPages?.length ? overlay.cmsPages : snapshotPages)
      .slice()
      .sort(byOrder);
    const updates = (overlay.cmsUpdates ?? []).slice().sort(byOrder);
    const live = Boolean(overlay.cmsContent?.length || overlay.cmsPages?.length);

    const getBlock = (section, field) => {
      const block = siteContent[`${section}__${field}`] ?? null;
      // Draft preview reads unfiltered collections; hide what a publish
      // would hide. No hardcoded fallback text — event-neutrality (§5.3).
      return block && block.visible !== false ? block : null;
    };

    const getSectionBlocks = (section) =>
      Object.values(siteContent)
        .filter((block) => block.section === section && block.visible !== false)
        .sort(byOrder);

    const getPage = (idOrPath) =>
      pages.find(
        (page) =>
          (page.id === idOrPath || page.path === idOrPath) &&
          page.visible !== false,
      ) ?? null;

    return {
      readSource,
      source: live ? 'live' : 'snapshot',
      siteContent,
      pages,
      updates,
      scheduleData,
      speakers,
      organizationsData,
      // The snapshot renders synchronously, so consumers never wait on the
      // network; kept for interface stability with loading-aware pages.
      loading: false,
      getBlock,
      getSectionBlocks,
      getPage,
    };
  }, [readSource, overlay]);

  return <ContentContext.Provider value={value}>{children}</ContentContext.Provider>;
}

/**
 * useContent() — the whole content context.
 * useContent(section, field) — shorthand for getBlock(section, field).
 */
export function useContent(section, field) {
  const ctx = useContext(ContentContext);
  if (!ctx) {
    throw new Error('useContent must be used inside <ContentProvider>.');
  }
  if (section !== undefined) return ctx.getBlock(section, field);
  return ctx;
}

/** The cmsPages surface: ordered visible-aware pages plus lookups. */
export function usePages() {
  const { pages, getPage, loading } = useContent();
  return { pages, getPage, loading };
}

export default ContentContext;
