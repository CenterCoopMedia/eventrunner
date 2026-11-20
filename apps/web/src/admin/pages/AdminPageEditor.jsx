// Page editor (issue #13 — "creating a Scholarships page via the admin CMS").
//
// Maps onto the cmsPages contract exactly (spec §5.2, functions/src/cms/
// pages.cjs):
//   • Save draft      → cmsSavePage. NEVER writes the live doc — the draft
//                       revision goes to cmsPages_drafts with status 'dirty'.
//   • Save & publish   → cmsSavePage, then cmsPublish { collection:
//                       'cmsPages', docIds: [id] } — the revision copy that
//                       makes it public. Two calls because that is what the
//                       two-revision model is: editing and publishing are
//                       separate acts.
//   • Delete          → cmsDeletePage, refused server-side for system pages;
//                       the UI reflects the same rule rather than letting an
//                       operator hit a wall.
//
// `path` is a plain text input validated SERVER-side: root-level paths are
// canonical (issue #52 — `/scholarships`, not `/p/scholarships`), resolved by
// App.jsx's catch-all route, and cmsSavePage owns the rules — segment shape,
// the reserved first segments in shared/routing, '/' being the home page's,
// and uniqueness across both revisions. So this file hardcodes no shape and
// surfaces the server's rejection verbatim; the reserved list below is shown
// as a hint only, read from that same registry so it cannot drift.
//
// Sections carry the block contract: `allowedBlocks` is a palette drawn from
// the BLOCK_TYPES registry, and `defaultBlocks` are the placeholders a new
// site is seeded with. Neither is edited here; both pass through a save.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router';
import { DEFAULT_NAV_PLACEMENT, resolveNavPlacement } from 'shared/theme';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { isReadOnlyDemo } from '../../lib/readOnlyDemo.js';
import { useAdminApi } from '../adminApi.js';
import { useDeletedRecord } from '../deletionUndo.jsx';
import RecordRecovery from '../components/RecordRecovery.jsx';
import { useAdminContent } from '../useAdminContent.js';
import { useAdminPages } from '../useAdminPages.js';
import { contentSectionPath } from '../contentBrowser.js';
import SectionLayoutChoice from '../components/SectionLayoutChoice.jsx';
import { withoutSwitchedOffLinks } from '../../lib/linkTargets.js';
import { contentLanguages, resolveContentVariant } from 'shared/contentLanguages';
import { buildNavItems } from '../../lib/siteNavigation.js';
import { VENUE_MAP_PAGE_ID, VENUE_MAP_SECTION_ID, resolveVenueMap } from 'shared/venue';
import { useVenueMapImage } from '../../components/VenueMap.jsx';
import { openStreetMapCoordinates } from '../../components/AreaMap.jsx';
import { builtInSectionBlockTypes, pageHeading } from 'shared/page';
import { isStarterContent, publicContentDoc } from 'shared/seed';
import { assignPageIds, blankPage, blankSection, pageSnapshot, toEditablePage, toPagePayload } from '../pageDoc.js';
import { moveItem, nextStoredOrder } from '../reorder.js';
import { useUnsavedNavigation } from '../useUnsavedNavigation.js';
import { useLocalDraft } from '../useLocalDraft.js';
import { UnsavedChangesDialog, UnsavedEditBadge } from '../components/UnsavedChanges.jsx';
import {
  PAGE_LAYOUT_DEFAULTS,
  PAGE_LAYOUT_VALUES,
  resolvePageLayout,
  sectionsBySlot,
} from '../../lib/pageLayout.js';
import { NAV_PLACEMENT_LABELS } from '../../lib/themeRuntime.js';
import {
  PAGE_TEMPLATES,
  PAGE_TEMPLATE_IDS,
  templateLayout,
} from '../../lib/pageTemplates.js';
import { summarizePublish } from '../publishResult.js';
import {
  CheckboxField,
  DestructiveConfirm,
  Notice,
  Panel,
  SelectField,
  ServerErrorSummary,
  TextAreaField,
  TextField,
  dangerButtonClass,
  fieldHintClass,
  fieldLabelClass,
  linkButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import EditorDisclosure from '../components/EditorDisclosure.jsx';
import ContentTranslations from '../components/ContentTranslations.jsx';
import { OrderAnnouncement, ReorderControls, bindReorderDrop } from '../components/ReorderControls.jsx';
import { EditorActionFeedback } from '../components/ActionFeedback.jsx';
import AdminPageHeader, {
  AdminEmptyState,
  AdminLoadingState,
  RecordState,
} from '../components/adminChrome.jsx';
import BusyLabel from '../../components/BusyLabel.jsx';

// THE OPERATOR PICKS A TASK, NOT A LAYOUT (this review).
//
// This panel used to be four selects — Header, Arrangement, Density,
// Navigation — one per variant in the internal layout system. That asks an
// operator to assemble a page out of design-system parts, in the design
// system's words, with no way of knowing which of the twelve combinations
// the house has an opinion about. It is the difference between "what shape
// is this page" (a question with an answer) and "what value should
// `arrangement` take" (a question about our code).
//
// So the main editor offers one control: which of six named tasks this page
// is. Picking one sets the whole bundle at once (lib/pageTemplates.js). The
// individual variants moved behind the Advanced disclosure below, where a
// page that genuinely needs to differ from its template can still say so —
// the same place AdminBranding.jsx keeps its raw token overrides. Nothing
// was taken away: every value the system has is still settable here, one at
// a time, by an operator who knows which one they want.
//
// NAVIGATION IS THE SITE'S ANSWER, WITH A PAGE-LEVEL EXCEPTION. Where the
// nav sits is set once for the whole site on the Branding tab
// (config/theme.navPlacement), because a shell that moves between pages
// stops being a shell. That is the default this control shows, by name, so
// an operator can see what the site says without leaving the page.
//
// A page may still overrule it, and it sits in Advanced because that is
// what it is: a deliberate exception for the one page that needs it, not a
// question every page has to answer. Setting it does NOT clear the
// template — nav is not one of the three values a template bundles, so a
// Long read with a rail beside it is still a Long read.

/** The value the template select shows for a page that named no task. */
const CUSTOM_TEMPLATE = 'custom';
// Survives edits and reordering without becoming part of the persisted payload.
const EDITOR_SECTION_KEY = Symbol('editor section');

/** Plain words for the layout variants (design brief §6.1, §8.5). */
const LAYOUT_LABELS = Object.freeze({
  header: 'Header',
  arrangement: 'Arrangement',
  density: 'Density',
});

const LAYOUT_HINTS = Object.freeze({
  header: 'Every page carries a nameplate. Compact makes it smaller; it never turns off.',
  arrangement: 'How this page lays its items out.',
  density: 'How much space sits between things on this page.',
});

/** The three variants a template bundles, in editor order. */
const EDITABLE_LAYOUT_KEYS = Object.freeze(['header', 'arrangement', 'density']);

/**
 * The value the navigation control shows for a page that states none: it
 * takes whatever the site is set to. Empty string rather than a word,
 * because "follow the site" is the ABSENCE of a page-level value, and the
 * change handler deletes the key rather than writing a fourth enum member
 * the validator would have to learn.
 */
const SITE_NAV_PLACEMENT = '';


/** One word per enum value, so a select never reads like a field name. */
const LAYOUT_VALUE_LABELS = Object.freeze({
  nameplate: 'Full nameplate',
  'nameplate-compact': 'Compact nameplate',
  grid: 'Grid',
  list: 'List',
  tight: 'Tight',
  comfortable: 'Comfortable',
  loose: 'Loose',
});

// WHERE A SECTION GOES, SAID IN TERMS OF THE PAGE (this review).
//
// A hybrid page has a built-in feature — the schedule, the speaker
// directory — and a section is inserted before it or after it. That is two
// choices, and the operator is choosing an INSERTION POINT, so the words
// name the feature they are relative to.
//
// "Above", "main", and "below" were never the operator's words. They are
// the storage keys, and they stay the storage keys: `main` and `below` both
// render after the feature (`below` after every `main`), and a section
// stored as `below` before this change keeps that value and that position
// unless the operator moves the control. Which is why the value shown for a
// section is derived rather than passed straight through — see slotValue.
const SLOT_CHOICES = Object.freeze([
  { value: 'above', label: 'Before the main feature' },
  { value: 'main', label: 'After the main feature' },
]);

/**
 * Which of the two insertion points a stored slot reads as. `below` is a
 * third stored position with no third name: it renders after the feature,
 * so that is what the control says about it.
 */
function slotValue(slot) {
  return slot === 'above' ? 'above' : 'main';
}

// The section the area map draws in on the travel page (ContentPage).
const AREA_MAP_SECTION_ID = 'travel_local';

export default function AdminPageEditor({ mode }) {
  const { user } = useAuth();
  const { pageId } = useParams();
  return <PageEditor key={JSON.stringify([user?.uid, mode, pageId])} mode={mode} />;
}

function PageEditor({ mode }) {
  const { pageId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const call = useAdminApi();
  const reportDeleted = useDeletedRecord();
  const { rows, ready, error: listenerError, findRow } = useAdminPages({ includeNavigationLinks: mode === 'create' });
  const { rows: contentRows, ready: contentReady, error: contentError } = useAdminContent();
  const { theme, eventConfig, features } = useEventConfig();
  // The count staff see is the content the section holds (both revisions of
  // one block are one block), not its seed list.
  // What the public page draws for a section once this page is published:
  // its published blocks (publishing the page does not publish content
  // drafts), in order, without hidden blocks or starter text the public
  // site leaves out.
  // A cta or link_group that leads to a section that is off, or to a page
  // that is not public, is dropped first, as the public page does
  // (lib/linkTargets.js), so the columns split the blocks the reader gets.
  // Targets are the published pages: publishing this page does not publish
  // the page a link leads to.
  // The language a reader meets first: a site that opens in Spanish draws
  // its approved Spanish copy (PublicLanguageRuntime), so the preview does.
  const opensInSpanish = contentLanguages(eventConfig).default === 'es';
  const inPublicLanguage = (record, kind) => (opensInSpanish && record
    ? resolveContentVariant(record, kind, 'es', eventConfig).value
    : record);
  // The pages a link can lead to once this page is published: the
  // published pages, with this page as it is being edited in place of its
  // published record (a new path or visibility counts).
  const linkTargetPages = () => {
    if (!ready) return null;
    const own = rows.find((row) => row.live?.id === page.id)?.live ?? {};
    return [
      ...rows.map((row) => row.live).filter((live) => live && live.id !== page.id),
      { ...own, id: page.id, path: page.path, visible: page.visible },
    ];
  };
  const sectionPreviewBlocks = (section) => withoutSwitchedOffLinks(
    contentRows
      // The public shape first (shared/seed publicContentDoc), as the site's
      // content provider does, so starter text is judged the same way.
      .map((row) => (row.live ? inPublicLanguage(publicContentDoc(row.live), 'block') : null))
      .filter((block) => block?.section === section.id && block.visible !== false && !isStarterContent(block))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    features,
    linkTargetPages(),
  );
  // The section that takes the Long read opening on the public page
  // (ContentPage): the first section with something in it, on a custom page
  // that states the Long read template. A map section counts only when its
  // map draws, as it does there.
  // The editor loads the venue map picture out of sight, so a picture that
  // fails takes its section out of the count, as it does on the page.
  const venueMapImage = useVenueMapImage(resolveVenueMap(eventConfig));
  const venueMapShown = Boolean(venueMapImage);
  const areaMapShown = Boolean(openStreetMapCoordinates(eventConfig?.venue?.mapUrl));
  // Whether the public page draws a map in this section (ContentPage, for
  // custom pages only).
  const sectionHasMap = (current, section) => !current.systemPage && (
    (section.id === VENUE_MAP_SECTION_ID && venueMapShown)
    || (section.id === AREA_MAP_SECTION_ID && current.id === VENUE_MAP_PAGE_ID && areaMapShown));
  const sectionHasContent = (current, section) => sectionPreviewBlocks(section).length > 0
    || sectionHasMap(current, section);
  const longReadSection = (current) => (current.systemPage || current.template !== 'long-read'
    ? null
    : (current.sections ?? []).find((section) => sectionHasContent(current, section))?.id ?? null);
  const sectionBlockCount = (section) => {
    if (!contentReady) return contentError ? '' : 'Counting blocks…';
    const count = contentRows.filter((row) => row.current?.section === section.id).length;
    return `${count} ${count === 1 ? 'block' : 'blocks'}`;
  };
  // What the site is set to, so the "follow the site" option can say what
  // following it means instead of sending the operator to another tab to
  // find out.
  const siteNavPlacement = resolveNavPlacement(theme) ?? DEFAULT_NAV_PLACEMENT;

  const [page, setPage] = useState(() => blankPage());
  // The page's sections in the order the public page reads them, with their
  // blocks, for the one pull quote a page may draw (blocks/pullQuoteBudget):
  // a system page reads its slots above, main, below (SystemPage); a custom
  // page reads its stored order (ContentPage).
  const slots = sectionsBySlot(page.sections ?? []);
  const quoteBudget = {
    sections: page.systemPage ? [...slots.above, ...slots.main, ...slots.below] : (page.sections ?? []),
    getSectionBlocks: (id) => sectionPreviewBlocks({ id }),
  };
  const longReadSectionId = longReadSection(page);
  // Layout draws the side navigation rail only when the site has public
  // pages to list, so the preview reserves it only then too.
  const publicNavShown = buildNavItems(
    ready ? rows.map((row) => (row.live ? publicContentDoc(row.live) : null)).filter(Boolean) : [],
    features,
  ).length > 0;
  const [savedSnapshot, setSavedSnapshot] = useState(() => (
    mode === 'create' ? pageSnapshot(blankPage()) : null
  ));
  const [error, setError] = useState(null);
  const [errorTitle, setErrorTitle] = useState(undefined);
  const [busy, setBusy] = useState(null); // null | 'draft' | 'publish' | 'delete'
  const [status, setStatus] = useState('');
  // Set once a create has landed, so the form switches to editing that
  // document instead of trying to create it again.
  const [savedId, setSavedId] = useState(null);
  const [loadedVersion, setLoadedVersion] = useState('new');
  // The individual layout variants, behind their own disclosure. Closed by
  // default: the template above is the answer for almost every page.
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [spoken, setSpoken] = useState('');
  // Set when a publish fails part-way: the queue row the retry must resume.
  const [resumeQueueId, setResumeQueueId] = useState(null);
  const errorRef = useRef(null);
  const formRef = useRef(null);
  const unsaved = savedSnapshot !== null && pageSnapshot(page) !== savedSnapshot;
  const leaveGuard = useUnsavedNavigation(unsaved, { blocked: busy !== null });
  // Load the stored revision once; later listener updates (e.g. the echo of
  // our own save) must not clobber whatever is being typed.
  const loadedIdRef = useRef(null);
  const nextSectionKey = useRef(0);
  const pendingItemFocus = useRef(null);
  // Ids the server refused on create. The listener may not have them yet.
  const rejectedPageIds = useRef(new Set());

  const row = mode === 'edit' ? findRow(pageId) : null;
  // A section's content screen exists only once a save has stored it. Ids
  // are assigned before the server answers, so a refused save leaves ids
  // here that no stored revision has; those sections get no link.
  const storedRow = findRow(savedId ?? pageId);
  const savedSectionIds = new Set((storedRow?.current?.sections ?? []).map((section) => section.id));
  const localDraft = useLocalDraft({
    accountId: user?.uid,
    docPath: `cmsPages/${savedId ?? pageId ?? 'new'}`,
    version: loadedVersion,
    baseline: savedSnapshot,
    value: pageSnapshot(page),
    dirty: unsaved,
    enabled: !isReadOnlyDemo(eventConfig) && (mode === 'create' || loadedIdRef.current === pageId),
  });

  useEffect(() => {
    if (mode !== 'edit') return;
    if (!ready) return;
    if (loadedIdRef.current === pageId) return;
    const found = rows.find((candidate) => candidate.id === pageId);
    if (!found) return;
    loadedIdRef.current = pageId;
    const editable = toEditablePage(found.draft ?? found.live);
    const source = found.draft ?? found.live;
    setLoadedVersion(JSON.stringify([source.updatedAt ?? null, source.basedOnRevision ?? source.revision ?? null]));
    editable.sections = editable.sections.map((section) => ({ ...section, [EDITOR_SECTION_KEY]: nextSectionKey.current++ }));
    setPage(editable);
    setSavedSnapshot(pageSnapshot(editable));
  }, [mode, pageId, ready, rows]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  useEffect(() => {
    const form = formRef.current;
    if (!form) return undefined;
    if (leaveGuard.pending) form.setAttribute('inert', '');
    else form.removeAttribute('inert');
    return () => form.removeAttribute('inert');
  }, [leaveGuard.pending]);

  const fieldErrors = useMemo(() => {
    const map = new Map();
    for (const segment of error?.fieldErrors ?? []) {
      if (segment.field && !map.has(segment.field)) map.set(segment.field, segment.message);
    }
    return map;
  }, [error]);
  const errorFor = (field) => fieldErrors.get(field);

  useEffect(() => {
    if ([...fieldErrors.keys()].some((field) => field.startsWith('layout.'))) setLayoutOpen(true);
  }, [fieldErrors]);

  useEffect(() => {
    const request = pendingItemFocus.current;
    if (!request) return;
    pendingItemFocus.current = null;
    const section = formRef.current?.querySelector(`[data-editor-section="${request.sectionKey}"]`);
    const target = request.kind === 'section-toggle'
      ? section?.querySelector('.admin-editor-disclosure__toggle')
      : section?.querySelector('input:not([readonly]), select');
    (target ?? formRef.current?.querySelector('[data-add-section]'))?.focus();
  }, [page.sections]);

  if (mode === 'edit' && ready && !row) {
    return (
      <AdminEmptyState
        title="No such page"
        description="That page id has neither a published nor a draft revision."
        action={
          <Link to=".." relative="path" className={primaryButtonClass}>
            Back to pages
          </Link>
        }
      />
    );
  }

  if (mode === 'create' && (!ready || !contentReady)) {
    if (listenerError || contentError) {
      return (
        <Notice
          tone="caution"
          message="We could not load pages and content. A new page waits until both have loaded, so its id cannot replace an existing page or reuse a section that still has content."
        />
      );
    }
    return <AdminLoadingState label="Loading page…" />;
  }

  if (mode === 'edit' && loadedIdRef.current !== pageId) {
    if (!ready && listenerError) {
      return (
        <Notice
          tone="caution"
          message="We could not load this page and its saved draft. The editor opens when both have loaded, so a save cannot replace a draft it has not read. We are trying again."
        />
      );
    }
    return <AdminLoadingState label="Loading page…" />;
  }

  const update = (patch) => setPage((current) => ({ ...current, ...patch }));
  const updateSection = (index, patch) =>
    setPage((current) => ({
      ...current,
      sections: current.sections.map((section, i) =>
        i === index ? { ...section, ...patch } : section,
      ),
    }));
  function addSection() {
    const key = nextSectionKey.current++;
    pendingItemFocus.current = { kind: 'section', sectionKey: key };
    update({ sections: [...page.sections, { ...blankSection(), [EDITOR_SECTION_KEY]: key }] });
  }

  function removeSection(index) {
    const next = page.sections.filter((_, at) => at !== index);
    pendingItemFocus.current = { kind: 'section-toggle', sectionKey: next[Math.min(index, next.length - 1)]?.[EDITOR_SECTION_KEY] };
    update({ sections: next });
  }

  function moveSections(from, to) {
    const next = moveItem(page.sections, from, to);
    if (next === page.sections) return false;
    const label = page.sections[from]?.label || `Section ${from + 1}`;
    update({ sections: next });
    setSpoken(`${label} moved to position ${to + 1} of ${page.sections.length}`);
    return true;
  }

  async function save({ publish }) {
    if (localDraft.recovery) return;
    setError(null);
    setErrorTitle(undefined);
    setStatus('');
    setResumeQueueId(null);
    if (!String(page.label ?? '').trim()) {
      setErrorTitle('Enter a navigation label');
      setError({
        message: 'Enter a navigation label.',
        fieldErrors: [{ field: 'label', message: 'Enter a navigation label.' }],
      });
      return;
    }
    const creating = mode === 'create' && savedId === null;
    if (creating && (!ready || !contentReady)) {
      setError({
        message: 'Wait until pages and content have loaded before saving a new page.',
      });
      return;
    }
    const pageIds = new Set(rejectedPageIds.current);
    const sectionIds = new Set();
    for (const candidate of rows ?? []) {
      if (candidate?.id) pageIds.add(candidate.id);
      for (const section of candidate.current?.sections ?? []) {
        if (section?.id) sectionIds.add(section.id);
      }
    }
    for (const content of contentRows ?? []) {
      for (const revision of [content?.current, content?.live, content?.draft]) {
        if (typeof revision?.section === 'string' && revision.section) sectionIds.add(revision.section);
      }
    }
    const beforeAssignment = pageSnapshot(page);
    let assigned = assignPageIds(page, { pageIds, sectionIds });
    if (creating) assigned = { ...assigned, order: nextStoredOrder(rows) };
    if (pageSnapshot(assigned) !== pageSnapshot(page)) setPage(assigned);
    const payload = toPagePayload(assigned);
    setBusy(publish ? 'publish' : 'draft');
    let stage = 'save';
    try {
      await call('cmsSavePage', creating ? { page: payload, create: true } : { page: payload });
      // The next session keeps newer typing under the assigned document id.
      // Stop the old new-page session before its cleanup can write it back.
      if (creating) localDraft.discard();
      else localDraft.saved(pageSnapshot(assigned), beforeAssignment);
      // Mark the document existing the moment the DRAFT is written, before
      // any publish attempt: a failed publish must not leave the id editable,
      // because retrying under a different id would create a second document
      // and orphan the draft that just landed.
      setSavedId(payload.id);
      loadedIdRef.current = payload.id;
      setSavedSnapshot(pageSnapshot(assigned));
      if (!publish) {
        setStatus('Draft saved. It is not public until you publish.');
        return;
      }
      // Separate call by design: cmsSavePage only ever writes the draft
      // revision; the live doc is cmsPublish's to write (spec §8.4).
      stage = 'publish';
      const response = await call('cmsPublish', {
        collection: 'cmsPages',
        docIds: [payload.id],
      });
      reportPublish(response, [payload.id]);
    } catch (err) {
      if (stage === 'publish') setErrorTitle('The draft is saved, and it is not published');
      if (creating && stage === 'save' && err?.status === 409) {
        rejectedPageIds.current.add(payload.id);
        setPage((current) => ({ ...current, id: '' }));
        setError({
          message: 'That page id was already taken. Save again to use a new one.',
        });
        return;
      }
      setError(err);
      if (err?.code === 'unauthenticated') localDraft.flush();
      // A part-way publish failure carries the queue row to resume from.
      if (err?.queueId) setResumeQueueId(err.queueId);
    } finally {
      setBusy(null);
    }
  }

  /** cmsPublish answers 200 even when it skipped what you asked for. */
  function reportPublish(response, requestedIds) {
    const verdict = summarizePublish(response, 'cmsPages', requestedIds);
    if (!verdict.ok) throw new Error(verdict.message);
    setStatus(verdict.message);
  }

  /**
   * Resume a publish that failed part-way. Passing { queueId } is what makes
   * the re-run skip the chunks that already committed instead of publishing
   * them a second time (functions/src/cms/publish.cjs).
   */
  async function resumePublish() {
    setBusy('publish');
    setError(null);
    setErrorTitle('The draft is saved, and it is not published');
    setStatus('');
    try {
      const response = await call('cmsPublish', { queueId: resumeQueueId });
      setResumeQueueId(null);
      reportPublish(response, [savedId ?? page.id]);
    } catch (err) {
      setError(err);
      if (err?.queueId) setResumeQueueId(err.queueId);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy('delete');
    setError(null);
    setErrorTitle(undefined);
    try {
      const deleted = await call('cmsDeletePage', { id: page.id });
      localDraft.discard();
      reportDeleted({ ...deleted, collection: 'cmsPages', docId: page.id, editorPath: `/admin/pages/${encodeURIComponent(page.id)}` }, '/admin/pages');
    } catch (err) {
      setErrorTitle('The server refused the delete');
      setError(err);
      setBusy(null);
    }
  }

  const isSystemPage = page.systemPage === true;
  const pathHelp = isSystemPage
    ? 'This built-in page has a fixed web address.'
    : 'The page’s web address, such as /scholarships.';
  // "Existing" = a document the server has already written: an edited page,
  // or one this form just created.
  const isExisting = mode === 'edit' || savedId !== null;

  return (
    <form
      ref={formRef}
      className="admin-page-editor flex flex-col gap-md"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        save({ publish: false });
      }}
    >
      {venueMapImage && !page.systemPage && (page.sections ?? []).some((section) => section.id === VENUE_MAP_SECTION_ID) ? (
        <img src={venueMapImage.src} onError={venueMapImage.onError} alt="" hidden />
      ) : null}
      <AdminPageHeader help="Save a draft to keep your changes. Publish to show them on the site."
        title={mode === 'create' ? 'New page' : page.label || 'Page'}
        recentTitle={row?.current?.label}
        state={(
          <>
            {row ? <RecordState state={row.state} /> : null}
            {unsaved ? <UnsavedEditBadge /> : null}
          </>
        )}
        identifiers={page.path || null}
        description="Save a draft to keep your changes. Publish to show them on the site."
        feedback={status || error ? <EditorActionFeedback unsaved={unsaved} status={status} error={error} errorTitle={errorTitle} /> : null}
        actions={
          <>
            <Link to=".." relative="path" className={linkButtonClass}>
              Back to pages
            </Link>
            <button type="submit" className={secondaryButtonClass} disabled={busy !== null || Boolean(localDraft.recovery)} aria-busy={busy === 'draft' || undefined}>
              <BusyLabel busy={busy === 'draft'} pending="Saving the page draft…">Save draft</BusyLabel>
            </button>
            <button
              type="button"
              className={primaryButtonClass}
              disabled={busy !== null || Boolean(localDraft.recovery)}
              aria-busy={busy === 'publish' || undefined}
              onClick={() => save({ publish: true })}
            >
              <BusyLabel busy={busy === 'publish'} pending="Publishing the page…">Save and publish</BusyLabel>
            </button>
          </>
        }
      />

      <ServerErrorSummary error={error} errorRef={errorRef} title={errorTitle} />
      {error?.code === 'unauthenticated' && unsaved ? (
        <Notice tone="caution" message={localDraft.kept
          ? 'Your text is kept on this browser. Sign in again, return to this page, and choose Restore.'
          : 'A local copy could not be confirmed. Copy your text before signing in again.'}>
          <button type="button" className={linkButtonClass} onClick={() => {
            localDraft.flush();
            navigate('/signin', { state: { from: `/admin/pages/${savedId ?? pageId ?? 'new'}` } });
          }}>Sign in again</button>
        </Notice>
      ) : null}
      {localDraft.recovery ? (
        <Panel title="Unsaved text found on this browser">
          <p>{localDraft.recovery.baseline !== savedSnapshot
            ? 'This page changed since this copy was kept. Restoring replaces the editor with the older copy; review it before saving.'
            : 'Restore your unsaved text, or discard this local copy and use the saved page.'}</p>
          <div className="flex flex-wrap gap-sm">
            <button type="button" className={primaryButtonClass} onClick={() => {
              try {
                const value = localDraft.restore();
                if (value === null) return;
                const restored = toEditablePage(JSON.parse(value));
                restored.sections = restored.sections.map((section) => ({ ...section, [EDITOR_SECTION_KEY]: nextSectionKey.current++ }));
                setPage(restored);
              } catch {
                localDraft.discard();
                setError({ message: 'This local copy could not be read. The saved page has not changed.' });
              }
            }}>Restore</button>
            <button type="button" className={secondaryButtonClass} onClick={localDraft.discard}>Discard local copy</button>
          </div>
        </Panel>
      ) : null}
      {leaveGuard.pending ? createPortal(
        <UnsavedChangesDialog
          onStay={leaveGuard.stay}
          onDiscard={() => { localDraft.discard(); leaveGuard.discard(); }}
          canDiscard={leaveGuard.canDiscard}
        />,
        document.body,
      ) : null}

      <fieldset disabled={Boolean(localDraft.recovery)} className="min-w-0 border-0 p-0 flex flex-col gap-md">
      <div className="admin-page-basics">
      <Panel help="How the page is identified and linked." title="Page" description="How the page is identified and linked." className="admin-page-identity">
        <div className="admin-page-fields">
          <TextField help="Shown in the header navigation and the footer page list. Keep it short — every page shares one row."
            label="Navigation label"
            value={page.label}
            onChange={(value) => update({ label: value })}
            error={errorFor('label')}
            
          />
          {/* Optional, and empty is the normal answer: a page with no
              heading of its own is headed by its navigation label. The
              field exists for the pages whose short label reads oddly as a
              heading — a nav that says FAQ over a page headed "Frequently
              asked questions".

              A SYSTEM PAGE IS NOT ONE OF THEM, so it is not offered the
              field. A content page's heading is drawn from this document
              (ContentPage.jsx renders shared/page pageHeading), but a
              system page writes its own: Schedule.jsx puts "Schedule" in
              its <h1> and the home page draws its hero title. A heading
              typed here would move that page's browser tab and its link
              card and leave the heading on the page where it was — a
              control that does not do what its label says. pageHeading
              ignores a stored title on a system page for the same reason,
              so the tab and the card keep agreeing with the <h1>. */}
          {isSystemPage ? (
            <div className="admin-field flex flex-col gap-3xs">
              <p className={`${fieldLabelClass} admin-field__label`}>Page heading</p>
              <p className={`${fieldHintClass} admin-field__hint`}>This built-in page sets its own heading.</p>
            </div>
          ) : (
            <TextField help="Set the heading at the top of this page when it differs from the navigation label. Leave blank to use the navigation label."
              label="Page heading"
              value={page.title}
              onChange={(value) => update({ title: value })}
              error={errorFor('title')}
              
            />
          )}
          {/* A system page's path names a route that is declared in the
              app's code, not in this document — the document only
              describes it. Editing it here would not move the page, it
              would strand the document, so the field states the address
              and does not offer to change it. The server refuses the
              change too (functions/src/cms/pages.cjs). */}
          <TextField
            label="Path"
            value={page.path}
            onChange={(value) => update({ path: value })}
            error={errorFor('path')}
            readOnly={isSystemPage}
            help={pathHelp}
            hint={pathHelp}
          />
          <ContentTranslations kind="page" record={page} onChange={(translations) => update({ translations })}
            labels={{ label: 'navigation label', title: 'page heading' }} errorFor={errorFor} />
          <div className="flex flex-col justify-center gap-xs">
            <CheckboxField help="Include this content on the public site after publishing."
              label="Visible"
              checked={page.visible}
              onChange={(checked) => update({ visible: checked })}
              hint="Hidden pages stay out of the public site even once published."
            />
            {isSystemPage ? (
              <p className="text-admin-sm text-admin-ink-secondary">
                This is a built-in page. You can edit its content, but you cannot delete it.
              </p>
            ) : null}
          </div>
        </div>
      </Panel>

      <Panel help="Choose the page’s starting layout and adjust its presentation."
        title="Page template"
        className="admin-page-template"
        description={
          isSystemPage
            ? 'What kind of page this is. The page keeps its built-in feature; the template shapes everything around it.'
            : 'What kind of page this is.'
        }
      >
        <SelectField help="Choose a prepared page layout. Review how it changes the page before saving."
          label="Template"
          value={page.template ?? CUSTOM_TEMPLATE}
          options={[
            ...PAGE_TEMPLATE_IDS.map((id) => ({ value: id, label: PAGE_TEMPLATES[id].label })),
            { value: CUSTOM_TEMPLATE, label: 'Custom — set by hand below' },
          ]}
          onChange={(value) => {
            // Picking a task sets every value that task has an opinion
            // about, in one move. Picking "Custom" changes no value at
            // all — it only records that no task is claimed, so the page
            // stops being described by a template it no longer matches.
            const bundle = templateLayout(value);
            update(
              bundle
                ? { template: value, layout: { ...page.layout, ...bundle } }
                : { template: null },
            );
          }}
          error={errorFor('template')}
          hint={
            page.template
              ? PAGE_TEMPLATES[page.template].description
              : 'This page sets its shape by hand. Pick a template to take the house’s answers instead.'
          }
        />
        <div className="mt-sm border-admin-rule-hairline border-t-admin-hairline pt-sm">
          <button
            type="button"
            className={secondaryButtonClass}
            aria-expanded={layoutOpen}
            aria-controls="admin-page-layout-advanced"
            onClick={() => setLayoutOpen((open) => !open)}
          >
            {layoutOpen ? 'Hide the individual settings' : 'Change the individual settings'}
          </button>
          <div id="admin-page-layout-advanced" hidden={!layoutOpen} className="mt-sm">
            <p className="mb-sm text-admin-sm text-admin-ink-secondary">
              The parts a template sets. Change one and the page stops following
              its template — the template above reads “Custom” from then on, and
              picking a template again sets all three back.
            </p>
            <div className="grid gap-sm sm:grid-cols-2">
              {EDITABLE_LAYOUT_KEYS.map((key) => (
                <SelectField help="Choose how this part of the page is arranged. Leave the default to follow the page template."
                  key={key}
                  label={LAYOUT_LABELS[key]}
                  value={page.layout?.[key] ?? PAGE_LAYOUT_DEFAULTS[key]}
                  options={PAGE_LAYOUT_VALUES[key].map((value) => ({
                    value,
                    label: LAYOUT_VALUE_LABELS[value] ?? value,
                  }))}
                  onChange={(value) =>
                    update({ template: null, layout: { ...page.layout, [key]: value } })
                  }
                  error={errorFor(`layout.${key}`)}
                  hint={LAYOUT_HINTS[key]}
                />
              ))}
            </div>
            <div className="mt-sm border-admin-rule-hairline border-t-admin-hairline pt-sm">
              <SelectField help="The site sets this once for every page, on the Branding tab. Change it here only for a page that genuinely needs to differ — the template above is unaffected either way."
                label="Navigation on this page"
                value={page.layout?.navPlacement ?? SITE_NAV_PLACEMENT}
                options={[
                  {
                    value: SITE_NAV_PLACEMENT,
                    label: `Follow the site setting — ${NAV_PLACEMENT_LABELS[siteNavPlacement]}`,
                  },
                  ...PAGE_LAYOUT_VALUES.navPlacement.map((value) => ({
                    value,
                    label: `Only this page: ${NAV_PLACEMENT_LABELS[value]}`,
                  })),
                ]}
                onChange={(value) => {
                  // "Follow the site" is the absence of a page-level value,
                  // so it DELETES the key rather than storing a word
                  // meaning "nothing". A page that says nothing and a page
                  // that says "top" are different facts, and only the
                  // second survives a later change to the site setting.
                  const { navPlacement: _dropped, ...rest } = page.layout ?? {};
                  update({
                    layout: value === SITE_NAV_PLACEMENT ? rest : { ...rest, navPlacement: value },
                  });
                }}
                error={errorFor('layout.navPlacement')}
                
              />
            </div>
          </div>
        </div>
      </Panel>

      </div>

      <Panel help="Open a section to change its name or where it sits on the page."
        title="Sections"
        description="Open a section to change its name or where it sits on the page."
        actions={
          <button
            type="button"
            className={secondaryButtonClass}
            data-add-section=""
            onClick={addSection}
          >
            Add section
          </button>
        }
      >
        <OrderAnnouncement message={spoken} />
        {page.sections.length === 0 ? (
          <p className="text-admin-sm text-admin-ink-secondary">
            No sections yet. A page with no sections renders nothing.
          </p>
        ) : (
          <ol className="admin-page-section-list">
            {page.sections.map((section, sectionIndex) => {
              const at = `sections[${sectionIndex}]`;
              return (
                <li
                  key={section[EDITOR_SECTION_KEY]}
                  data-editor-section={section[EDITOR_SECTION_KEY]}
                  className="min-w-0"
                  {...bindReorderDrop('section:', sectionIndex, moveSections)}
                >
                  <EditorDisclosure help="Open this section to change its name, its place on the page and its guidance for staff."
                    title={section.label || `Section ${sectionIndex + 1}`}
                    description={sectionBlockCount(section)}
                    defaultOpen={!section.id}
                    reveal={[...fieldErrors.keys()].some((field) => field.startsWith(`${at}.`))}
                  >
                  <div className="mb-md flex flex-wrap items-center justify-between gap-xs">
                    <p className="text-admin-sm text-admin-ink-secondary">Section {sectionIndex + 1} settings</p>
                    <div className="flex flex-wrap gap-2xs">
                      <ReorderControls
                        label={`section ${sectionIndex + 1}`}
                        index={sectionIndex}
                        count={page.sections.length}
                        dragToken={`section:${sectionIndex}`}
                        onMove={moveSections}
                      />
                      <button
                        type="button"
                        className={dangerButtonClass}
                        aria-label={`Remove section ${sectionIndex + 1}`}
                        onClick={() => removeSection(sectionIndex)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  <div className="admin-section-fields">
                    <TextField help="Name this section so staff can find it when editing page content."
                      label={`Section ${sectionIndex + 1} label`}
                      value={section.label}
                      onChange={(value) => updateSection(sectionIndex, { label: value })}
                      error={errorFor(`${at}.label`)}
                    />
                    <ContentTranslations kind="section" record={section}
                      onChange={(translations) => updateSection(sectionIndex, { translations })}
                      labels={{ label: `section ${sectionIndex + 1} label` }}
                      errorFor={(field) => errorFor(`${at}.${field}`)} />
                    <TextField help="Limit how many content blocks staff can add to this section."
                      label={`Section ${sectionIndex + 1} max blocks`}
                      type="number"
                      min="1"
                      value={section.maxBlocks}
                      onChange={(value) =>
                        updateSection(sectionIndex, {
                          maxBlocks: value === '' ? '' : Number(value),
                        })
                      }
                      error={errorFor(`${at}.maxBlocks`)}
                    />
                    <div className="flex items-center">
                      <CheckboxField help="Allow staff to change the order of content blocks in this section."
                        label={`Section ${sectionIndex + 1} is reorderable`}
                        checked={section.reorderable}
                        onChange={(checked) =>
                          updateSection(sectionIndex, { reorderable: checked })
                        }
                      />
                    </div>
                    {/* A custom page has no built-in feature component, so
                        there is nothing for a section to sit above or below
                        — the control only exists on a system page. */}
                    {isSystemPage ? (
                      <SelectField help="Show this section before or after the main content."
                        label={`Section ${sectionIndex + 1} position`}
                        value={slotValue(section.slot)}
                        options={SLOT_CHOICES}
                        onChange={(value) => updateSection(sectionIndex, { slot: value })}
                        error={errorFor(`${at}.slot`)}
                        
                      />
                    ) : null}
                    <div className="sm:col-span-2">
                      <TextAreaField help="Guidance for whoever fills this section in."
                        label={`Section ${sectionIndex + 1} description`}
                        value={section.description}
                        onChange={(value) =>
                          updateSection(sectionIndex, { description: value })
                        }
                        error={errorFor(`${at}.description`)}
                        
                      />
                    </div>
                  </div>

                  {/* Home's built-in sections draw their own arrangement, so a
                      layout choice would change nothing there. */}
                  {builtInSectionBlockTypes(page, section) ? null : (
                    <div className="mt-sm border-admin-rule-hairline border-t-admin-hairline pt-sm">
                      <SectionLayoutChoice
                        value={section.layout}
                        onChange={(layout) => updateSection(sectionIndex, { layout })}
                        label={section.label}
                        blocks={sectionPreviewBlocks(section)}
                        blocksReady={contentReady}
                        previewId={`admin-section-preview-${sectionIndex}`}
                        budget={quoteBudget}
                        readingMeasure={page.systemPage && resolvePageLayout(page).arrangement !== 'grid'}
                        longReadOpening={section.id === longReadSectionId}
                        map={sectionHasMap(page, section)}
                        previewLabel={inPublicLanguage(section, 'section')?.label}
                        hideHeading={!page.systemPage && (section.label === page.label
                          || section.label === pageHeading(page)
                          || /_intro$/.test(section.id) || /_header$/.test(section.id))}
                        sideNav={(page.layout?.navPlacement ?? siteNavPlacement) === 'side' && publicNavShown}
                        blocksError={Boolean(contentError) && !contentReady}
                      />
                    </div>
                  )}

                  {/* What this section SAYS is written under Content. The page
                      document's starter list only seeds a brand-new site
                      (scripts/init-event.cjs), so it is not offered here: an
                      "Add block" in this form changed nothing on a running
                      site (issue #1153). Stored starter entries pass through
                      a save unchanged. */}
                  <div className="mt-sm border-admin-rule-hairline border-t-admin-hairline pt-sm">
                    {savedSectionIds.has(section.id) ? (
                      <Link to={contentSectionPath(page.id, section.id)} className={linkButtonClass}>
                        Add or edit the content in {section.label || `section ${sectionIndex + 1}`}
                      </Link>
                    ) : (
                      <p className="text-admin-sm text-admin-ink-secondary">
                        Save the page, then add its content.
                      </p>
                    )}
                  </div>
                  </EditorDisclosure>
                </li>
              );
            })}
          </ol>
        )}
      </Panel>

      <div className="flex flex-wrap items-center gap-xs">
        {resumeQueueId ? (
          <button
            type="button"
            className={secondaryButtonClass}
            disabled={busy !== null}
            onClick={resumePublish}
          >
            {busy === 'publish' ? 'Resuming…' : 'Resume publish'}
          </button>
        ) : null}
        {isExisting ? (
          // A system page has no delete at all: the server refuses it, and
          // the Page panel already states why in words. Offering a control
          // the server will reject is worse than offering none.
          isSystemPage ? null : (
            <DestructiveConfirm
              trigger="Delete this page"
              title={`Delete ${page.label || 'this page'}`}
              confirmLabel="Delete this page"
              busyLabel="Deleting…"
              busy={busy === 'delete'}
              disabled={busy !== null}
              consequence={`The live page and its draft both go, and ${
                page.path || 'its path'
              } stops resolving on the public site. The content blocks inside it are not deleted.`}
              permanence={<RecordRecovery collection="cmsPages" docId={page.id} />}
              onConfirm={remove}
            />
          )
        ) : null}
      </div>
      </fieldset>
    </form>
  );
}
