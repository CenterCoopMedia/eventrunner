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
// the BLOCK_TYPES registry, and `defaultBlocks` are the blocks the section
// seeds — each one a (field, blockType) pair whose per-type fields the
// registry describes.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router';
import { DEFAULT_NAV_PLACEMENT, resolveNavPlacement } from 'shared/theme';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAdminApi } from '../adminApi.js';
import RecordRecovery from '../components/RecordRecovery.jsx';
import { useAdminContent } from '../useAdminContent.js';
import { useAdminPages } from '../useAdminPages.js';
import {
  BLOCK_TYPE_IDS,
  blockTypeLabel,
} from '../blockTypes.js';
import { assignPageIds, blankPage, blankSection, pageSnapshot, toEditablePage, toPagePayload } from '../pageDoc.js';
import { moveItem, nextStoredOrder } from '../reorder.js';
import { useUnsavedNavigation } from '../useUnsavedNavigation.js';
import { UnsavedChangesDialog, UnsavedEditBadge } from '../components/UnsavedChanges.jsx';
import {
  PAGE_LAYOUT_DEFAULTS,
  PAGE_LAYOUT_VALUES,
} from '../../lib/pageLayout.js';
import { NAV_PLACEMENT_LABELS } from '../../lib/themeRuntime.js';
import {
  PAGE_TEMPLATES,
  PAGE_TEMPLATE_IDS,
  templateLayout,
} from '../../lib/pageTemplates.js';
import { summarizePublish } from '../publishResult.js';
import {
  ActionLabel,
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
import { OrderAnnouncement, ReorderControls, bindReorderDrop } from '../components/ReorderControls.jsx';
import { EditorActionFeedback } from '../components/ActionFeedback.jsx';
import AdminPageHeader, {
  AdminEmptyState,
  AdminLoadingState,
  RecordState,
} from '../components/adminChrome.jsx';

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

export default function AdminPageEditor({ mode }) {
  const { pageId } = useParams();
  const navigate = useNavigate();
  const call = useAdminApi();
  const { showToast } = useToast();
  const { rows, ready, error: listenerError, findRow } = useAdminPages();
  const { rows: contentRows, ready: contentReady, error: contentError } = useAdminContent();
  // What the site is set to, so the "follow the site" option can say what
  // following it means instead of sending the operator to another tab to
  // find out.
  const { theme } = useEventConfig();
  const siteNavPlacement = resolveNavPlacement(theme) ?? DEFAULT_NAV_PLACEMENT;

  const [page, setPage] = useState(() => blankPage());
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

  useEffect(() => {
    if (mode !== 'edit') return;
    if (!ready) return;
    if (loadedIdRef.current === pageId) return;
    const found = rows.find((candidate) => candidate.id === pageId);
    if (!found) return;
    loadedIdRef.current = pageId;
    const editable = toEditablePage(found.draft ?? found.live);
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
      : request.kind === 'block'
        ? section?.querySelector(`[data-editor-block="${request.blockIndex}"] input:not([readonly]), [data-editor-block="${request.blockIndex}"] select`)
          ?? section?.querySelector('[data-add-block]')
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

  function addBlock(sectionIndex) {
    const section = page.sections[sectionIndex];
    pendingItemFocus.current = { kind: 'block', sectionKey: section[EDITOR_SECTION_KEY], blockIndex: section.defaultBlocks.length };
    updateSection(sectionIndex, { defaultBlocks: [...section.defaultBlocks, {
      field: '', blockType: section.allowedBlocks[0] ?? BLOCK_TYPE_IDS[0], description: '',
    }] });
  }

  function removeBlock(sectionIndex, blockIndex) {
    const section = page.sections[sectionIndex];
    const next = section.defaultBlocks.filter((_, at) => at !== blockIndex);
    pendingItemFocus.current = { kind: 'block', sectionKey: section[EDITOR_SECTION_KEY], blockIndex: Math.min(blockIndex, next.length - 1) };
    updateSection(sectionIndex, { defaultBlocks: next });
  }

  function moveSections(from, to) {
    const next = moveItem(page.sections, from, to);
    if (next === page.sections) return false;
    const label = page.sections[from]?.label || `Section ${from + 1}`;
    update({ sections: next });
    setSpoken(`${label} moved to position ${to + 1} of ${page.sections.length}`);
    return true;
  }

  function moveBlocks(sectionIndex, from, to) {
    const blocks = page.sections[sectionIndex]?.defaultBlocks ?? [];
    const next = moveItem(blocks, from, to);
    if (next === blocks) return false;
    updateSection(sectionIndex, { defaultBlocks: next });
    setSpoken(`Block ${from + 1} in section ${sectionIndex + 1} moved to position ${to + 1} of ${blocks.length}`);
    return true;
  }

  const updateBlock = (sectionIndex, blockIndex, patch) =>
    setPage((current) => ({
      ...current,
      sections: current.sections.map((section, i) =>
        i === sectionIndex
          ? {
              ...section,
              defaultBlocks: section.defaultBlocks.map((block, j) =>
                j === blockIndex ? { ...block, ...patch } : block,
              ),
            }
          : section,
      ),
    }));

  async function save({ publish }) {
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
    let assigned = assignPageIds(page, { pageIds, sectionIds });
    if (creating) assigned = { ...assigned, order: nextStoredOrder(rows) };
    if (pageSnapshot(assigned) !== pageSnapshot(page)) setPage(assigned);
    const payload = toPagePayload(assigned);
    setBusy(publish ? 'publish' : 'draft');
    let stage = 'save';
    try {
      await call('cmsSavePage', creating ? { page: payload, create: true } : { page: payload });
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
      await call('cmsDeletePage', { id: page.id });
      showToast('Page deleted.');
      navigate('..', { relative: 'path' });
    } catch (err) {
      setErrorTitle('The server refused the delete');
      setError(err);
      setBusy(null);
    }
  }

  const isSystemPage = page.systemPage === true;
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
      <AdminPageHeader
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
            <button type="submit" className={secondaryButtonClass} disabled={busy !== null} aria-busy={busy === 'draft' || undefined}>
              <ActionLabel busy={busy === 'draft'} pending="Saving…">Save draft</ActionLabel>
            </button>
            <button
              type="button"
              className={primaryButtonClass}
              disabled={busy !== null}
              aria-busy={busy === 'publish' || undefined}
              onClick={() => save({ publish: true })}
            >
              <ActionLabel busy={busy === 'publish'} pending="Publishing…">Save and publish</ActionLabel>
            </button>
          </>
        }
      />

      <ServerErrorSummary error={error} errorRef={errorRef} title={errorTitle} />
      {leaveGuard.pending ? createPortal(
        <UnsavedChangesDialog
          onStay={leaveGuard.stay}
          onDiscard={leaveGuard.discard}
          canDiscard={leaveGuard.canDiscard}
        />,
        document.body,
      ) : null}

      <div className="admin-page-basics">
      <Panel title="Page" description="How the page is identified and linked." className="admin-page-identity">
        <div className="admin-page-fields">
          <TextField
            label="Navigation label"
            value={page.label}
            onChange={(value) => update({ label: value })}
            error={errorFor('label')}
            hint="Shown in the header navigation and the footer page list. Keep it short — every page shares one row."
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
            <TextField
              label="Page heading"
              value={page.title}
              onChange={(value) => update({ title: value })}
              error={errorFor('title')}
              hint="Optional. The heading at the top of the page, when it differs from the navigation label. Leave blank to use the label."
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
            hint={
              isSystemPage
                ? 'This built-in page has a fixed web address.'
                : 'The page’s web address, such as /scholarships.'
            }
          />
          <div className="flex flex-col justify-center gap-xs">
            <CheckboxField
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

      <Panel
        title="Page template"
        className="admin-page-template"
        description={
          isSystemPage
            ? 'What kind of page this is. The page keeps its built-in feature; the template shapes everything around it.'
            : 'What kind of page this is.'
        }
      >
        <SelectField
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
                <SelectField
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
              <SelectField
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
                hint="The site sets this once for every page, on the Branding tab. Change it here only for a page that genuinely needs to differ — the template above is unaffected either way."
              />
            </div>
          </div>
        </div>
      </Panel>

      </div>

      <Panel
        title="Sections"
        description="Open a section to change its name and blocks."
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
                  <EditorDisclosure
                    title={section.label || `Section ${sectionIndex + 1}`}
                    description={`${section.defaultBlocks.length} ${section.defaultBlocks.length === 1 ? 'block' : 'blocks'}`}
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
                    <TextField
                      label={`Section ${sectionIndex + 1} label`}
                      value={section.label}
                      onChange={(value) => updateSection(sectionIndex, { label: value })}
                      error={errorFor(`${at}.label`)}
                    />
                    <TextField
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
                      <CheckboxField
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
                      <SelectField
                        label={`Section ${sectionIndex + 1} position`}
                        value={slotValue(section.slot)}
                        options={SLOT_CHOICES}
                        onChange={(value) => updateSection(sectionIndex, { slot: value })}
                        error={errorFor(`${at}.slot`)}
                        hint="Show this section before or after the main content."
                      />
                    ) : null}
                    <div className="sm:col-span-2">
                      <TextAreaField
                        label={`Section ${sectionIndex + 1} description`}
                        value={section.description}
                        onChange={(value) =>
                          updateSection(sectionIndex, { description: value })
                        }
                        error={errorFor(`${at}.description`)}
                        hint="Guidance for whoever fills this section in."
                      />
                    </div>
                  </div>

                  <div className="mt-sm border-admin-rule-hairline border-t-admin-hairline pt-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2xs">
                      <h4 className="text-admin-base font-bold text-admin-ink">Blocks</h4>
                      <button
                        type="button"
                        className={secondaryButtonClass}
                        data-add-block=""
                        onClick={() => addBlock(sectionIndex)}
                      >
                        Add block to section {sectionIndex + 1}
                      </button>
                    </div>
                    {section.defaultBlocks.length === 0 ? (
                      <p className="mt-2xs text-admin-sm text-admin-ink-secondary">
                        No blocks yet.
                      </p>
                    ) : (
                      <ol className="admin-page-block-list mt-sm">
                        {section.defaultBlocks.map((block, blockIndex) => {
                          const bat = `${at}.defaultBlocks[${blockIndex}]`;
                          const allowed = section.allowedBlocks.length
                            ? section.allowedBlocks
                            : BLOCK_TYPE_IDS;
                          const options = (
                            allowed.includes(block.blockType) || !block.blockType
                              ? allowed
                              : [block.blockType, ...allowed]
                          ).map((id) => ({ value: id, label: blockTypeLabel(id) }));
                          return (
                            <li
                              data-editor-block={blockIndex}
                              key={blockIndex}
                              className="rounded-admin border-admin-hairline border-admin-rule-hairline bg-admin-ground-raised p-sm"
                              {...bindReorderDrop(`block:${sectionIndex}:`, blockIndex, (from, to) => moveBlocks(sectionIndex, from, to))}
                            >
                              {/* The block's field key is the page's internal name for it and
                                  never changes, so it is not shown. Type and description sit
                                  on one row with no hints, so their boxes line up. */}
                              <div className="grid items-start gap-xs sm:grid-cols-[minmax(10rem,14rem)_1fr]">
                                <SelectField
                                  label={`Block ${blockIndex + 1} type — section ${sectionIndex + 1}`}
                                  value={block.blockType}
                                  options={options}
                                  onChange={(value) =>
                                    updateBlock(sectionIndex, blockIndex, { blockType: value })
                                  }
                                  error={errorFor(`${bat}.blockType`) || errorFor(`${bat}.field`)}
                                />
                                <TextField
                                  label={`Block ${blockIndex + 1} description — section ${sectionIndex + 1}`}
                                  value={block.description}
                                  onChange={(value) =>
                                    updateBlock(sectionIndex, blockIndex, { description: value })
                                  }
                                  error={errorFor(`${bat}.description`)}
                                />
                              </div>
                              <div className="mt-xs flex flex-wrap gap-2xs">
                                <ReorderControls
                                  label={`block ${blockIndex + 1} in section ${sectionIndex + 1}`}
                                  index={blockIndex}
                                  count={section.defaultBlocks.length}
                                  dragToken={`block:${sectionIndex}:${blockIndex}`}
                                  upLabel={`Move block ${blockIndex + 1} up in section ${sectionIndex + 1}`}
                                  downLabel={`Move block ${blockIndex + 1} down in section ${sectionIndex + 1}`}
                                  dragLabel={`Drag block ${blockIndex + 1} in section ${sectionIndex + 1}`}
                                  onMove={(from, to) => moveBlocks(sectionIndex, from, to)}
                                />
                                <button
                                  type="button"
                                  className={dangerButtonClass}
                                  aria-label={`Remove block ${blockIndex + 1} from section ${sectionIndex + 1}`}
                                  onClick={() => removeBlock(sectionIndex, blockIndex)}
                                >
                                  Remove
                                </button>
                              </div>
                            </li>
                          );
                        })}
                      </ol>
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
    </form>
  );
}
