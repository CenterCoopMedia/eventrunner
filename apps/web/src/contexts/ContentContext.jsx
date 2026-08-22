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
//   - cmsContent / cmsPages / cmsSchedule / cmsOrganizations: any successful
//     live result — including an empty array — replaces the snapshot
//     wholesale. The published set is the truth: once a listener has
//     actually reported in, an empty result means staff unpublished
//     everything and the public view must go empty too, not keep showing
//     stale demo content. Only the *absence* of a result yet (overlay still
//     null — no snapshot has arrived, e.g. a fresh unseeded project or a
//     still-connecting listener) or a listener error (fail soft:
//     rules-denied/offline reads must not blank the page) keeps the
//     snapshot / last-known live values.
//   - cmsUpdates: live-only; there is no snapshot module, so the default is
//     an empty list.
//   - speakers_public: same wholesale-replace semantics, from its own
//     subscription (spec §4.3). It is not under the publish model — no
//     `_drafts` sibling, no `visible` field — so it needs neither the
//     readSource switch nor the visibility clause; an unapproved speaker
//     simply has no document. Without this overlay the directory would sit
//     on the deploy-time snapshot forever, so a speaker added, edited, or
//     removed after the last build would never appear or disappear.
//   - cmsTimeline: snapshot-only for now — its runtime overlay belongs to a
//     later timeline tranche.
//
// `loading` is always false: the snapshot renders synchronously on first
// paint, and the overlay above is applied fire-and-forget as onSnapshot
// results arrive — there is never a moment where content is *unknown*, only
// "snapshot" vs "live" (spec §2.4 fail-soft: no spinner-trap on a
// rules-denied or slow listener). The field is kept for interface
// stability with loading-aware consumers (e.g. Schedule's LoadingState
// branch), which stays defensive dead code by design rather than a bug.
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import snapshotSiteContent from '@generated/siteContent.js';
import snapshotScheduleData, { speakers as snapshotSpeakers } from '@generated/scheduleData.js';
import snapshotOrganizationsData from '@generated/organizationsData.js';
import snapshotPages from '@generated/pagesData.js';
import { subscribeContentCollection, subscribeSpeakersPublic } from '../lib/contentSource.js';

const ContentContext = createContext(null);

const RUNTIME_COLLECTIONS = [
  'cmsContent',
  'cmsPages',
  'cmsUpdates',
  'cmsSchedule',
  'cmsOrganizations',
];

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);

// cmsOrganizations is written through the generic content endpoint
// (functions/src/cms/content.cjs), which only rejects reserved field
// *names* — it never checks field *types*. Sponsors.jsx renders
// name/tier/description straight through as JSX children, so a published
// doc with e.g. `name: { unexpected: true }` would make React throw and
// blank the route the instant the listener fires. Guard at this overlay
// boundary instead: drop (not partially render) any doc whose renderable
// fields aren't one of the primitive types React can safely render as a
// child. This keeps the wholesale-replace semantics for every doc that
// *is* safe — one malformed doc doesn't fall back to the snapshot.
const ORG_RENDERABLE_FIELDS = ['name', 'tier', 'description'];

// The same guard for speakers_public. buildPublicSpeaker already coerces
// every one of these to a string on the way in (packages/shared/src/
// speaker.cjs), so this is defence in depth rather than the primary
// control — but the projection trigger fires on Admin SDK writes too, and
// the directory blanking for every visitor is too cheap a failure to leave
// to one layer.
const SPEAKER_RENDERABLE_FIELDS = ['displayName', 'jobTitle', 'organization', 'bio'];

function isSafeRenderableValue(value) {
  return (
    value == null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function sanitizeOrganizationDocs(docs) {
  return docs.filter((doc) =>
    ORG_RENDERABLE_FIELDS.every((field) => isSafeRenderableValue(doc?.[field])),
  );
}

/** Renderable-safe speakers, ordered the way the directory reads them. */
function prepareSpeakerDocs(docs) {
  return docs
    .filter((doc) =>
      SPEAKER_RENDERABLE_FIELDS.every((field) => isSafeRenderableValue(doc?.[field])),
    )
    .slice()
    .sort(
      (a, b) =>
        String(a.displayName ?? '').localeCompare(String(b.displayName ?? '')) ||
        String(a.id).localeCompare(String(b.id)),
    );
}

export function ContentProvider({ readSource = 'published', children }) {
  // One overlay slot per collection; null = no runtime result yet, so the
  // committed snapshot stands (spec §2.4 fail-soft first paint).
  const [overlay, setOverlay] = useState({
    cmsContent: null,
    cmsPages: null,
    cmsUpdates: null,
    cmsSchedule: null,
    cmsOrganizations: null,
    speakers: null,
  });

  useEffect(() => {
    // Switching between published and draft re-subscribes from scratch;
    // stale overlay from the other source must not linger.
    setOverlay({
      cmsContent: null,
      cmsPages: null,
      cmsUpdates: null,
      cmsSchedule: null,
      cmsOrganizations: null,
      speakers: null,
    });
    const unsubscribers = [
      ...RUNTIME_COLLECTIONS.map((name) =>
        subscribeContentCollection(name, readSource, (docs) => {
          setOverlay((prev) => ({ ...prev, [name]: docs }));
        }),
      ),
      // Speakers have no draft revision, so this subscription is the same
      // in preview as in published mode.
      subscribeSpeakersPublic((docs) => {
        setOverlay((prev) => ({ ...prev, speakers: docs }));
      }),
    ];
    return () => {
      for (const unsubscribe of unsubscribers) {
        if (typeof unsubscribe === 'function') unsubscribe();
      }
    };
  }, [readSource]);

  const value = useMemo(() => {
    // cmsContent docs are keyed `<section>__<field>` — same shape as the
    // snapshot map, so the live set drops straight in.
    // != null, not `.length` — a live result has *arrived* the moment the
    // overlay slot is no longer null, and that includes an empty array
    // (staff unpublished the last doc). Only "no result yet" (still null)
    // falls back to the snapshot.
    const siteContent =
      overlay.cmsContent != null
        ? Object.fromEntries(overlay.cmsContent.map((doc) => [doc.id, doc]))
        : snapshotSiteContent;
    const pages = (overlay.cmsPages != null ? overlay.cmsPages : snapshotPages)
      .slice()
      .sort(byOrder);
    const updates = (overlay.cmsUpdates ?? []).slice().sort(byOrder);
    const scheduleData = overlay.cmsSchedule != null ? overlay.cmsSchedule : snapshotScheduleData;
    const organizationsData =
      overlay.cmsOrganizations != null
        ? sanitizeOrganizationDocs(overlay.cmsOrganizations)
        : snapshotOrganizationsData;
    // Same != null rule as every other overlay: an empty live result is a
    // real answer (every speaker was removed or unapproved) and must empty
    // the directory; only "no result yet" or a listener error keeps the
    // committed snapshot.
    const speakers = prepareSpeakerDocs(
      overlay.speakers != null ? overlay.speakers : snapshotSpeakers,
    );
    const live = Boolean(
      overlay.cmsContent != null ||
        overlay.cmsPages != null ||
        overlay.cmsSchedule != null ||
        overlay.cmsOrganizations != null ||
        overlay.speakers != null,
    );

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
