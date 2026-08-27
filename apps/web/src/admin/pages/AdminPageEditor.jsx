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
import { Link, useNavigate, useParams } from 'react-router-dom';
import { RESERVED_PATH_SEGMENTS } from 'shared/routing';
import { DEFAULT_NAV_PLACEMENT, resolveNavPlacement } from 'shared/theme';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAdminApi } from '../adminApi.js';
import { useAdminPages } from '../useAdminPages.js';
import {
  BLOCK_TYPES,
  BLOCK_TYPE_IDS,
  blockTypeFieldSummary,
  blockTypeLabel,
} from '../blockTypes.js';
import { blankPage, blankSection, toEditablePage, toPagePayload } from '../pageDoc.js';
import {
  PAGE_LAYOUT_DEFAULTS,
  PAGE_LAYOUT_VALUES,
} from '../../lib/pageLayout.js';
import {
  PAGE_TEMPLATES,
  PAGE_TEMPLATE_IDS,
  templateLayout,
} from '../../lib/pageTemplates.js';
import { summarizePublish } from '../publishResult.js';
import {
  CheckboxField,
  DestructiveConfirm,
  Panel,
  SaveStatus,
  SelectField,
  ServerErrorSummary,
  TextAreaField,
  TextField,
  dangerButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import AdminPageHeader, {
  AdminEmptyState,
  AdminLoadingState,
  RecordState,
} from '../components/adminChrome.jsx';

/** A field-level error, spelled like formControls.jsx's own FieldError: a
 * mark, a word, in the data-adjacent alarm ink. Used for the group-level
 * errors (allowed block types) that have no single input of their own. */
function InlineFieldError({ message }) {
  if (!message) return null;
  return (
    <p className="text-folio text-admin-state-error">
      <span aria-hidden="true" className="font-semibold">
        !{' '}
      </span>
      {message}
    </p>
  );
}

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

/** What each navigation placement is called, in an operator's words. */
const NAV_PLACEMENT_LABELS = Object.freeze({
  top: 'A row across the top',
  side: 'A rail down the leading edge',
});

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

/** Move item `from` → `to` in a copy of `list`. */
function moved(list, from, to) {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export default function AdminPageEditor({ mode }) {
  const { pageId } = useParams();
  const navigate = useNavigate();
  const call = useAdminApi();
  const { showToast } = useToast();
  const { rows, loading, findRow } = useAdminPages();
  // What the site is set to, so the "follow the site" option can say what
  // following it means instead of sending the operator to another tab to
  // find out.
  const { theme } = useEventConfig();
  const siteNavPlacement = resolveNavPlacement(theme) ?? DEFAULT_NAV_PLACEMENT;

  const [page, setPage] = useState(() => blankPage());
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null); // null | 'draft' | 'publish' | 'delete'
  const [status, setStatus] = useState('');
  // Set once a create has landed, so the form switches to editing that
  // document instead of trying to create it again.
  const [savedId, setSavedId] = useState(null);
  // The individual layout variants, behind their own disclosure. Closed by
  // default: the template above is the answer for almost every page.
  const [layoutOpen, setLayoutOpen] = useState(false);
  // Set when a publish fails part-way: the queue row the retry must resume.
  const [resumeQueueId, setResumeQueueId] = useState(null);
  const errorRef = useRef(null);
  // Load the stored revision once; later listener updates (e.g. the echo of
  // our own save) must not clobber whatever is being typed.
  const loadedIdRef = useRef(null);

  const row = mode === 'edit' ? findRow(pageId) : null;

  useEffect(() => {
    if (mode !== 'edit') return;
    if (loadedIdRef.current === pageId) return;
    const found = rows.find((candidate) => candidate.id === pageId);
    if (!found) return;
    loadedIdRef.current = pageId;
    setPage(toEditablePage(found.draft ?? found.live));
  }, [mode, pageId, rows]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const fieldErrors = useMemo(() => {
    const map = new Map();
    for (const segment of error?.fieldErrors ?? []) {
      if (segment.field && !map.has(segment.field)) map.set(segment.field, segment.message);
    }
    return map;
  }, [error]);
  const errorFor = (field) => fieldErrors.get(field);

  if (mode === 'edit' && loading && !row) {
    return <AdminLoadingState label="Loading page…" />;
  }
  if (mode === 'edit' && !loading && !row) {
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

  const update = (patch) => setPage((current) => ({ ...current, ...patch }));
  const updateSection = (index, patch) =>
    setPage((current) => ({
      ...current,
      sections: current.sections.map((section, i) =>
        i === index ? { ...section, ...patch } : section,
      ),
    }));
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
    setBusy(publish ? 'publish' : 'draft');
    setError(null);
    setStatus('');
    setResumeQueueId(null);
    const payload = toPagePayload(page);
    try {
      await call('cmsSavePage', { page: payload });
      // Mark the document existing the moment the DRAFT is written, before
      // any publish attempt: a failed publish must not leave the id editable,
      // because retrying under a different id would create a second document
      // and orphan the draft that just landed.
      setSavedId(payload.id);
      loadedIdRef.current = payload.id;
      if (!publish) {
        setStatus('Draft saved. It is not public until you publish.');
        showToast('Draft saved.');
        return;
      }
      // Separate call by design: cmsSavePage only ever writes the draft
      // revision; the live doc is cmsPublish's to write (spec §8.4).
      const response = await call('cmsPublish', {
        collection: 'cmsPages',
        docIds: [payload.id],
      });
      reportPublish(response, [payload.id]);
    } catch (err) {
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
    setStatus(verdict.message);
    showToast(verdict.message, verdict.ok ? undefined : { tone: 'error' });
  }

  /**
   * Resume a publish that failed part-way. Passing { queueId } is what makes
   * the re-run skip the chunks that already committed instead of publishing
   * them a second time (functions/src/cms/publish.cjs).
   */
  async function resumePublish() {
    setBusy('publish');
    setError(null);
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
    try {
      await call('cmsDeletePage', { id: page.id });
      showToast('Page deleted.');
      navigate('..', { relative: 'path' });
    } catch (err) {
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
      className="flex flex-col gap-md"
      onSubmit={(event) => {
        event.preventDefault();
        save({ publish: false });
      }}
    >
      <AdminPageHeader
        title={mode === 'create' ? 'New page' : page.label || page.id}
        state={row ? <RecordState state={row.state} /> : null}
        identifiers={isExisting ? page.id : null}
        description="Saving writes a draft. Publishing copies that draft to the live revision the public site reads."
        actions={
          <Link to=".." relative="path" className={secondaryButtonClass}>
            Back to pages
          </Link>
        }
      />

      <ServerErrorSummary error={error} errorRef={errorRef} />
      {status ? <SaveStatus message={status} /> : null}

      <Panel title="Page" description="How the page is identified, ordered, and linked.">
        <div className="grid gap-sm sm:grid-cols-2">
          <TextField
            label="Page id"
            value={page.id}
            onChange={(value) => update({ id: value })}
            error={errorFor('id')}
            readOnly={isExisting}
            hint={
              isExisting
                ? 'The document id cannot change after creation.'
                : 'Letters, digits, hyphen, underscore. Used as the document id.'
            }
          />
          <TextField
            label="Title"
            value={page.label}
            onChange={(value) => update({ label: value })}
            error={errorFor('label')}
            hint="Shown as the page heading and in navigation."
          />
          <TextField
            label="Path"
            value={page.path}
            onChange={(value) => update({ path: value })}
            error={errorFor('path')}
            hint={`The URL path this page is served at, e.g. /scholarships. These first segments belong to built-in routes and cannot be used: ${RESERVED_PATH_SEGMENTS.join(', ')}.`}
          />
          <TextField
            label="Icon"
            value={page.icon ?? ''}
            onChange={(value) => update({ icon: value || null })}
            error={errorFor('icon')}
            hint="Optional icon name. Leave blank for none."
          />
          <TextField
            label="Order"
            type="number"
            value={page.order}
            onChange={(value) => update({ order: value })}
            error={errorFor('order')}
            hint="Lower numbers sort first."
          />
          <div className="flex flex-col justify-center gap-xs">
            <CheckboxField
              label="Visible"
              checked={page.visible}
              onChange={(checked) => update({ visible: checked })}
              hint="Hidden pages stay out of the public site even once published."
            />
            {isSystemPage ? (
              <p className="text-caption text-admin-ink-secondary">
                This is a system page: it has a dedicated route in the app, so
                it cannot be deleted or turned into a regular page.
              </p>
            ) : null}
          </div>
        </div>
      </Panel>

      <Panel
        title="Page template"
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
            <p className="mb-sm max-w-[65ch] text-caption text-admin-ink-secondary">
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

      <Panel
        title="Sections"
        description="Each section is a named slot on the page. Its allowed block types come from the block registry; its default blocks are the blocks it seeds."
        actions={
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={() => update({ sections: [...page.sections, blankSection()] })}
          >
            Add section
          </button>
        }
      >
        {page.sections.length === 0 ? (
          <p className="text-caption text-admin-ink-secondary">
            No sections yet. A page with no sections renders nothing.
          </p>
        ) : (
          <ol className="flex flex-col gap-md">
            {page.sections.map((section, sectionIndex) => {
              const at = `sections[${sectionIndex}]`;
              return (
                <li
                  key={sectionIndex}
                  className="rounded-admin border-admin-hairline border-admin-rule-hairline bg-admin-ground p-sm"
                >
                  <div className="mb-xs flex flex-wrap items-center justify-between gap-2xs border-admin-rule-hairline border-b-admin-hairline pb-2xs">
                    <h3 className="font-admin-ui text-lead font-semibold text-admin-ink">
                      {section.label || section.id || `Section ${sectionIndex + 1}`}
                    </h3>
                    <div className="flex flex-wrap gap-2xs">
                      <button
                        type="button"
                        className={secondaryButtonClass}
                        aria-label={`Move section ${sectionIndex + 1} up`}
                        disabled={sectionIndex === 0}
                        onClick={() =>
                          update({ sections: moved(page.sections, sectionIndex, sectionIndex - 1) })
                        }
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        className={secondaryButtonClass}
                        aria-label={`Move section ${sectionIndex + 1} down`}
                        disabled={sectionIndex === page.sections.length - 1}
                        onClick={() =>
                          update({ sections: moved(page.sections, sectionIndex, sectionIndex + 1) })
                        }
                      >
                        Down
                      </button>
                      <button
                        type="button"
                        className={dangerButtonClass}
                        aria-label={`Remove section ${sectionIndex + 1}`}
                        onClick={() =>
                          update({
                            sections: page.sections.filter((_, i) => i !== sectionIndex),
                          })
                        }
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-sm sm:grid-cols-2">
                    <TextField
                      label={`Section ${sectionIndex + 1} id`}
                      value={section.id}
                      onChange={(value) => updateSection(sectionIndex, { id: value })}
                      error={errorFor(`${at}.id`)}
                      hint="Ties the section to its content blocks."
                    />
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
                        hint="Where this section is inserted, relative to the page's built-in feature."
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

                  <fieldset className="mt-sm">
                    <legend className="text-caption font-semibold text-admin-ink">
                      Allowed block types
                    </legend>
                    <p className="text-caption text-admin-ink-secondary">
                      Which of the registry’s block types this section accepts.
                    </p>
                    <InlineFieldError message={errorFor(`${at}.allowedBlocks`)} />
                    <div className="mt-2xs grid gap-2xs sm:grid-cols-2">
                      {BLOCK_TYPE_IDS.map((blockTypeId) => (
                        <CheckboxField
                          key={blockTypeId}
                          label={`${BLOCK_TYPES[blockTypeId].label} — section ${sectionIndex + 1}`}
                          checked={section.allowedBlocks.includes(blockTypeId)}
                          hint={blockTypeFieldSummary(blockTypeId)}
                          onChange={(checked) =>
                            updateSection(sectionIndex, {
                              allowedBlocks: checked
                                ? [...section.allowedBlocks, blockTypeId]
                                : section.allowedBlocks.filter((id) => id !== blockTypeId),
                            })
                          }
                        />
                      ))}
                    </div>
                  </fieldset>

                  <div className="mt-sm border-admin-rule-hairline border-t-admin-hairline pt-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2xs">
                      <h4 className="text-caption font-semibold text-admin-ink">Blocks</h4>
                      <button
                        type="button"
                        className={secondaryButtonClass}
                        onClick={() =>
                          updateSection(sectionIndex, {
                            defaultBlocks: [
                              ...section.defaultBlocks,
                              {
                                field: '',
                                blockType: section.allowedBlocks[0] ?? BLOCK_TYPE_IDS[0],
                                description: '',
                              },
                            ],
                          })
                        }
                      >
                        Add block to section {sectionIndex + 1}
                      </button>
                    </div>
                    {section.defaultBlocks.length === 0 ? (
                      <p className="mt-2xs text-caption text-admin-ink-secondary">
                        No blocks yet.
                      </p>
                    ) : (
                      <ol className="mt-2xs flex flex-col gap-sm">
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
                              key={blockIndex}
                              className="rounded-admin border-admin-hairline border-admin-rule-hairline bg-admin-ground-input p-xs"
                            >
                              <div className="grid gap-xs sm:grid-cols-2">
                                <TextField
                                  label={`Block ${blockIndex + 1} field — section ${sectionIndex + 1}`}
                                  value={block.field}
                                  onChange={(value) =>
                                    updateBlock(sectionIndex, blockIndex, { field: value })
                                  }
                                  error={errorFor(`${bat}.field`)}
                                />
                                <SelectField
                                  label={`Block ${blockIndex + 1} type — section ${sectionIndex + 1}`}
                                  value={block.blockType}
                                  options={options}
                                  onChange={(value) =>
                                    updateBlock(sectionIndex, blockIndex, { blockType: value })
                                  }
                                  error={errorFor(`${bat}.blockType`)}
                                  hint={blockTypeFieldSummary(block.blockType)}
                                />
                                <div className="sm:col-span-2">
                                  <TextField
                                    label={`Block ${blockIndex + 1} description — section ${sectionIndex + 1}`}
                                    value={block.description}
                                    onChange={(value) =>
                                      updateBlock(sectionIndex, blockIndex, { description: value })
                                    }
                                    error={errorFor(`${bat}.description`)}
                                  />
                                </div>
                              </div>
                              <div className="mt-xs flex flex-wrap gap-2xs">
                                <button
                                  type="button"
                                  className={secondaryButtonClass}
                                  aria-label={`Move block ${blockIndex + 1} up in section ${sectionIndex + 1}`}
                                  disabled={blockIndex === 0}
                                  onClick={() =>
                                    updateSection(sectionIndex, {
                                      defaultBlocks: moved(
                                        section.defaultBlocks,
                                        blockIndex,
                                        blockIndex - 1,
                                      ),
                                    })
                                  }
                                >
                                  Up
                                </button>
                                <button
                                  type="button"
                                  className={secondaryButtonClass}
                                  aria-label={`Move block ${blockIndex + 1} down in section ${sectionIndex + 1}`}
                                  disabled={blockIndex === section.defaultBlocks.length - 1}
                                  onClick={() =>
                                    updateSection(sectionIndex, {
                                      defaultBlocks: moved(
                                        section.defaultBlocks,
                                        blockIndex,
                                        blockIndex + 1,
                                      ),
                                    })
                                  }
                                >
                                  Down
                                </button>
                                <button
                                  type="button"
                                  className={dangerButtonClass}
                                  aria-label={`Remove block ${blockIndex + 1} from section ${sectionIndex + 1}`}
                                  onClick={() =>
                                    updateSection(sectionIndex, {
                                      defaultBlocks: section.defaultBlocks.filter(
                                        (_, j) => j !== blockIndex,
                                      ),
                                    })
                                  }
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
                </li>
              );
            })}
          </ol>
        )}
      </Panel>

      <div className="flex flex-wrap items-center gap-xs">
        <button type="submit" className={secondaryButtonClass} disabled={busy !== null}>
          {busy === 'draft' ? 'Saving…' : 'Save draft'}
        </button>
        <button
          type="button"
          className={primaryButtonClass}
          disabled={busy !== null}
          onClick={() => save({ publish: true })}
        >
          {busy === 'publish' ? 'Publishing…' : 'Save and publish'}
        </button>
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
              title={`Delete ${page.label || page.id}`}
              confirmLabel="Delete this page"
              busyLabel="Deleting…"
              busy={busy === 'delete'}
              disabled={busy !== null}
              consequence={`The live page and its draft both go, and ${
                page.path || 'its path'
              } stops resolving on the public site. The content blocks inside it are not deleted.`}
              permanence="This cannot be undone."
              onConfirm={remove}
            />
          )
        ) : null}
      </div>
    </form>
  );
}
