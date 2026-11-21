// Content editor, step 4 (issue #61): create or edit one cmsContent block's
// VALUE. Maps onto the same two-revision contract AdminPageEditor uses
// (functions/src/cms/content.cjs, spec §8.4):
//   • Save draft      → cmsCreateContent (new field) or cmsUpdateContent
//                       (existing field). Never writes the live doc.
//   • Save & publish   → the same call, then cmsPublish
//                       { collection: 'cmsContent', docIds: [docId] }.
//   • Delete          → cmsDeleteContent, removing live + draft together.
//
// The value fields rendered are whatever the chosen block type's registry
// entry (blockTypes.js) declares — switching block types swaps the field set
// and resets their values, since a stat's `label` and a cta's `label` are
// not the same content. allowedBlocks/maxBlocks are the section's own
// guardrails (set in Pages): the type picker offers only what the section
// allows (widening to show a mismatched existing type, same pattern
// AdminPageEditor's block-type picker uses), and a section already at its
// cap has no "Add block" link pointing here in the first place.
import { sectionBlockTypes } from 'shared/page';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useHref, useParams, useSearchParams } from 'react-router';
import { isStarterContent } from 'shared/seed';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import MapBlock from '../../components/blocks/MapBlock.jsx';
import { leadsToNoPublicPage, switchedOffSectionFor } from '../../lib/linkTargets.js';
import { featureLabel } from '../featureChoices.js';
import { useAdminApi } from '../adminApi.js';
import { useDeletedRecord } from '../deletionUndo.jsx';
import RecordRecovery from '../components/RecordRecovery.jsx';
import ContentTranslations from '../components/ContentTranslations.jsx';
import { contentError } from '../contentError.js';
import { useAdminPages } from '../useAdminPages.js';
import { useAdminContent } from '../useAdminContent.js';
import {
  BLOCK_TYPE_IDS,
  blockTypeFor,
} from '../blockTypes.js';
import { contentFieldHelp } from '../contentFieldHelp.js';
import { mapEmbedInput } from '../mapEmbedInput.js';
import {
  blankContent,
  contentBlockTitle,
  contentIdSource,
  editorialFieldLabel,
  staleFieldDeletions,
  toContentFields,
  toEditableContent,
  validateRequiredContent,
  valueFieldsOf,
} from '../contentDoc.js';
import { uniqueEditorialId } from '../editorialId.js';
import { nextStoredOrder } from '../reorder.js';
import { contentEditIsDirty, contentEditSnapshot, createFormBaseline } from '../contentEditState.js';
import { useUnsavedNavigation } from '../useUnsavedNavigation.js';
import { UnsavedChangesDialog, UnsavedEditBadge } from '../components/UnsavedChanges.jsx';
import { summarizePublish } from '../publishResult.js';
import ImagePicker from '../components/media/ImagePicker.jsx';
import GalleryFields from '../components/GalleryFields.jsx';
import BlockTypePicker from '../components/BlockTypePicker.jsx';
import { ImagePlacementFields, ImagePlacementPreview } from '../components/media/ImagePlacementEditor.jsx';
import {
  CheckboxField,
  DestructiveConfirm,
  Notice,
  Panel,
  SelectField,
  ServerErrorSummary,
  TextField,
  TextAreaField,
  linkButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import AdminIconControl from '../components/AdminIconControl.jsx';
import { EditorActionFeedback } from '../components/ActionFeedback.jsx';
import AdminPageHeader, {
  AdminEmptyState,
  AdminLoadingState,
  RecordState,
} from '../components/adminChrome.jsx';
import BusyLabel from '../../components/BusyLabel.jsx';

// Quill stays outside both the public entry and the general content-editor
// route. It loads only when the registry says this particular field is rich
// text, which keeps the existing public and lazy-chunk budgets intact.
const RichTextEditor = lazy(() => import('../components/RichTextEditor.jsx'));

const IMAGE_LAYOUT_CHOICES = {
  full: 'Full width', small: 'Small (320 px)', medium: 'Medium (640 px)', large: 'Large (1280 px)',
  left: 'Left', center: 'Centre', right: 'Right',
};

/**
 * What the public site does with a link that leads nowhere a reader can
 * use: it does not draw it (lib/linkTargets.js). The launch rehearsal saved
 * "Explore the program → /schedule" with the schedule off and the editor
 * said nothing. A link to a hidden page (a fresh site seeds Recap,
 * Guidelines and City guide hidden), or to an address no page has, opens
 * the 404 page, so it is the same case. The save still goes through: the
 * operator may be about to switch the section on or show the page, and the
 * link then appears with no further edit.
 *
 * Returns undefined for a field that is never a link a reader follows, and
 * a string, empty when there is nothing to say, for one that is: the field
 * then keeps its live region (formControls.jsx TextField).
 *
 * @param {string} blockTypeId
 * @param {string} fieldId
 * @param {unknown} value
 * @param {Record<string, boolean>|null|undefined} features
 * @param {Array<object>|null} pageRows useAdminPages rows, null while loading
 * @returns {string|undefined}
 */
function linkTargetWarning(blockTypeId, fieldId, value, features, pageRows) {
  if (fieldId !== 'url' || (blockTypeId !== 'cta' && blockTypeId !== 'link_group')) return undefined;
  const url = typeof value === 'string' ? value.trim() : value;
  const gate = switchedOffSectionFor(url, features);
  if (gate) {
    return `${featureLabel(gate)} is off. This link is hidden until it is turned on.`;
  }
  // The public site reads the published pages, so this does too.
  const published = pageRows ? pageRows.map((row) => row.live).filter(Boolean) : null;
  if (!leadsToNoPublicPage(url, published, features)) return '';
  const path = url.split(/[?#]/, 1)[0].replace(/\/+$/, '');
  const row = pageRows.find((entry) => (entry.live ?? entry.current)?.path === path);
  const label = (row?.live ?? row?.current)?.label;
  if (row && typeof label === 'string' && label.trim()) {
    return row.live
      ? `The ${label.trim()} page is hidden. The public site does not show this link until you make the page visible in Pages.`
      : `The ${label.trim()} page is not published. The public site does not show this link until you publish the page.`;
  }
  return 'No page has this address. The public site does not show this link until a visible page does.';
}

/** One control per registry field, chosen by the field's declared type. */
function BlockValueFields({ blockTypeId, values, onChange, errorFor, features, pageRows, fixedHero, newMapBlockHref }) {
  const fields = valueFieldsOf(blockTypeId);
  if (!blockTypeFor(blockTypeId)) {
    return (
      <p className="text-admin-sm text-admin-ink-secondary">
        Choose a content type to start writing.
      </p>
    );
  }
  // A gallery's pictures are a list, not one value per field.
  if (blockTypeId === 'gallery') {
    return (
      <div className="admin-content-fields grid gap-sm">
        <GalleryFields values={values} onChange={onChange} errorFor={errorFor} />
      </div>
    );
  }
  return (
    <div className="admin-content-fields grid items-end gap-sm sm:grid-cols-2">
      {fields.filter((field) => field.id !== 'captionMode' && field.id !== 'captionAlign').map((field) => {
        const name = editorialFieldLabel(blockTypeId, field.id);
        const label = field.required || field.id === 'useEventVenue' ? name : `${name} (optional)`;
        const value = values[field.id];
        const error = errorFor(field.id);
        const hint = contentFieldHelp(blockTypeId, field.id);
        if (field.choices) {
          if (fixedHero) return null;
          return (
            <SelectField key={field.id} label={name} help={hint} error={error}
              value={value || field.choices[0]}
              options={field.choices.map((choice) => ({ value: choice, label: IMAGE_LAYOUT_CHOICES[choice] }))}
              onChange={(next) => onChange(field.id, next)} />
          );
        }
        if (field.type === 'boolean') {
          return (
            <div key={field.id} className="flex items-center">
              <CheckboxField help={hint}
                label={label}
                checked={Boolean(value)}
                onChange={(checked) => onChange(field.id, checked)}
              />
            </div>
          );
        }
        if (field.type === 'richtext') {
          return (
            <div key={field.id} className="sm:col-span-2">
              <Suspense
                fallback={(
                  <p role="status" className="text-admin-sm text-admin-ink-secondary">
                    Loading formatted text editor…
                  </p>
                )}
              >
                <RichTextEditor help={hint}
                  label={label}
                  value={value}
                  onChange={(next) => onChange(field.id, next)}
                  error={error}
                  required={field.required}
                  newMapBlockHref={newMapBlockHref}
                />
              </Suspense>
            </div>
          );
        }
        if (field.type === 'number') {
          return (
            <TextField help={hint}
              key={field.id}
              label={label}
              type="number"
              value={value}
              onChange={(next) => onChange(field.id, next)}
              error={error}
            />
          );
        }
        if (field.type === 'url') {
          if (blockTypeId === 'map') {
            if (values.useEventVenue) return null;
            return (
              <div key={field.id} className="sm:col-span-2">
                <TextAreaField
                  label={label}
                  hint={hint}
                  help={hint}
                  value={value}
                  required
                  onChange={(next) => onChange(field.id, mapEmbedInput(next) || next)}
                  error={error}
                  rows={2}
                />
              </div>
            );
          }
          // Only the image block's `url` names a Storage object path (spec
          // §5.2) — route it through the media library picker, exactly as
          // AdminBranding's logo slots do. cta and link_group's `url` are
          // real external links and stay plain text inputs.
          if (blockTypeId === 'image' && field.id === 'url') {
            return (
              <div key={field.id} className="sm:col-span-2">
                <ImagePicker help={hint}
                  label={label}
                  folder="cms-images"
                  value={value}
                  onChange={(next) => onChange(field.id, next)}
                  error={error}
                />
              </div>
            );
          }
          return (
            <TextField help={hint}
              key={field.id}
              label={label}
              type="url"
              value={value}
              onChange={(next) => onChange(field.id, next)}
              error={error}
              warning={linkTargetWarning(blockTypeId, field.id, value, features, pageRows)}
            />
          );
        }
        return (
          <TextField help={hint}
            key={field.id}
            label={label}
            value={value}
            required={blockTypeId === 'map' && field.required}
            onChange={(next) => onChange(field.id, next)}
            error={error}
          />
        );
      })}
      {blockTypeId === 'image' ? <ImagePlacementFields values={values} onChange={onChange} errorFor={errorFor} /> : null}
    </div>
  );
}

/** Plain text as one escaped paragraph of rich text. */
function plainTextAsParagraph(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<p>${escaped}</p>`;
}

function shortTextAsRichText(shortText) {
  const spanish = shortText.translations?.es?.value;
  return {
    ...shortText,
    blockType: 'richtext',
    values: { ...shortText.values, value: plainTextAsParagraph(shortText.values?.value) },
    ...(typeof spanish === 'string' && spanish
      ? { translations: { ...shortText.translations, es: { ...shortText.translations.es, value: plainTextAsParagraph(spanish) } } }
      : {}),
  };
}

function textDraftKey(form) {
  if (!form) return null;
  const { values, translations } = contentEditSnapshot('', form);
  return JSON.stringify({ values, translations });
}

export default function AdminContentBlockEditor({ mode }) {
  const { pageId, sectionId, field: fieldParam } = useParams();
  const newBlockHref = useHref('../_new', { relative: 'path' });
  const [searchParams] = useSearchParams();
  const call = useAdminApi();
  const reportDeleted = useDeletedRecord();
  const { eventConfig, features } = useEventConfig();
  const { rows: pageRows, findRow: findPage, loading: pagesLoading } = useAdminPages();
  const {
    rows: contentRows,
    ready: contentReady,
    error: contentListenerError,
  } = useAdminContent();

  const page = findPage(pageId);
  const section = (page?.current?.sections ?? []).find((candidate) => candidate.id === sectionId);
  // Stable reference across renders (unless the section's own list changes)
  // so the create-defaults effect below does not re-run every render.
  const allowed = useMemo(() => sectionBlockTypes(page?.current, section, BLOCK_TYPE_IDS), [page, section]);
  const canAddMap = section && allowed.includes('map') && contentReady && (
    !Number.isFinite(section.maxBlocks) || contentRows.filter((row) => row.current?.section === sectionId).length < section.maxBlocks
  );
  const existingRow =
    mode === 'edit'
      ? contentRows.find(
          (row) => row.current?.section === sectionId && row.current?.field === fieldParam,
        )
      : null;

  const [fieldId, setFieldId] = useState(mode === 'edit' ? fieldParam ?? '' : '');
  const [content, setContent] = useState(() => blankContent());
  const [error, setError] = useState(null);
  const [errorTitle, setErrorTitle] = useState(undefined);
  const [busy, setBusy] = useState(null); // null | 'draft' | 'publish' | 'delete'
  const [status, setStatus] = useState('');
  const [savedDocId, setSavedDocId] = useState(null);
  const [resumeQueueId, setResumeQueueId] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(mode !== 'edit');
  const [savedEdit, setSavedEdit] = useState(null);
  const errorRef = useRef(null);
  const unsaved = contentEditIsDirty(savedEdit, fieldId, content);
  const leaveGuard = useUnsavedNavigation(unsaved, { blocked: busy !== null });
  const formRef = useRef(null);
  const mountedRef = useRef(true);
  // Load the stored revision (or pick a default block type for a fresh
  // create form) once; later listener updates must not clobber an
  // in-progress edit.
  const loadedKeyRef = useRef(null);
  // The block type actually persisted server-side (from the loaded doc, or
  // the last successful save) — the reference point for clearing a PRIOR
  // type's stale fields when the operator switches types and saves again.
  const savedBlockTypeRef = useRef(null);
  // Keep the words and translations from each text type while trying another type.
  const textDraftsRef = useRef({ text: null, richtext: null });
  // The type the editor adopted or last saved, for the picker: a live
  // update from another session does not move it (issue #1184).
  const [baseType, setBaseType] = useState(null);

  useEffect(() => {
    if (mode !== 'edit') return;
    // Wait for BOTH cmsContent revision listeners, not just whichever
    // arrives first: if the live listener reports before the drafts one,
    // existingRow is already truthy (live-only) while the actual dirty
    // draft is still in flight. Adopting from the live doc here would then
    // never be revisited once the draft lands (the key guard below is a
    // one-shot), so a later "Save draft" would overwrite the operator's
    // real unpublished changes with the stale published content.
    if (!contentReady) return;
    const key = `${sectionId}__${fieldParam}`;
    if (loadedKeyRef.current === key) return;
    if (!existingRow) return;
    loadedKeyRef.current = key;
    const doc = existingRow.draft ?? existingRow.live;
    const nextField = doc?.field ?? fieldParam ?? '';
    const editable = toEditableContent(doc, doc?.blockType);
    setFieldId(nextField);
    setContent(editable);
    setSavedEdit(contentEditSnapshot(nextField, editable));
    savedBlockTypeRef.current = doc?.blockType ?? null;
    setBaseType(doc?.blockType ?? null);
    textDraftsRef.current = { text: null, richtext: null };
  }, [mode, sectionId, fieldParam, existingRow, contentReady]);

  useEffect(() => {
    // A brand-new block starts with no type chosen; once the section's
    // allowed list is actually known (waiting out pagesLoading — otherwise
    // this would lock in the bare registry fallback before the section's
    // own allowedBlocks has ever arrived), default to its first allowed
    // type, or the whole registry for a custom section. Only once,
    // and only if the operator has not already picked one.
    if (mode !== 'create') return;
    if (loadedKeyRef.current === 'create-defaults') return;
    if (pagesLoading || !contentReady) return;
    // A section's own type (an FAQ item in the FAQ list) still leads: its
    // listed types on older sites, else the type of its starter block.
    const own = [...(section?.allowedBlocks ?? []), ...(section?.defaultBlocks ?? []).map((entry) => entry.blockType)];
    const mapUrl = canAddMap ? mapEmbedInput(searchParams.get('mapEmbed') ?? '') : '';
    const first = own.find((type) => allowed.includes(type)) ?? allowed[0] ?? BLOCK_TYPE_IDS[0];
    // New blocks are Text where the section takes it (issue #1184).
    const fallback = mapUrl
      ? 'map'
      : (first === 'text' && (allowed.length === 0 || allowed.includes('richtext')) ? 'richtext' : first);
    const baseline = createFormBaseline({ fieldId, content, fallbackType: fallback });
    loadedKeyRef.current = 'create-defaults';
    setSavedEdit(baseline.snapshot);
    if (baseline.nextContent) {
      const next = baseline.nextContent;
      setContent(mapUrl ? { ...next, values: { ...next.values, embedUrl: mapUrl } } : next);
    }
  }, [mode, allowed, section, pagesLoading, contentReady, canAddMap, searchParams, content, fieldId]);

  useEffect(() => {
    // Strict mode runs this cleanup once during development, then the setup
    // again. The flag has to come back, or a later save skips its result.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const form = formRef.current;
    if (!form) return undefined;
    if (leaveGuard.pending) form.setAttribute('inert', '');
    else form.removeAttribute('inert');
    return () => form.removeAttribute('inert');
  }, [leaveGuard.pending]);

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
  const errorFor = (name) => fieldErrors.get(name);

  useEffect(() => {
    if (['field', 'blockType', 'order', 'visible', 'section'].some((field) => fieldErrors.has(field))) {
      setSettingsOpen(true);
    }
  }, [fieldErrors]);

  // Show the loading state until BOTH revisions have reported AND this
  // doc's adoption effect has actually run — not just until `existingRow`
  // is truthy, which the live listener alone can satisfy while the dirty
  // draft is still in flight (see the adoption effect above).
  const adopted = loadedKeyRef.current === `${sectionId}__${fieldParam}`;
  if (mode === 'edit' && !adopted) {
    if (!contentReady && contentListenerError) {
      return (
        <Notice
          tone="caution"
          message="This block could not load. Check your connection and try again."
        />
      );
    }
    if (pagesLoading || !contentReady || existingRow) {
      return <AdminLoadingState label="Loading block…" />;
    }
  }
  if (mode === 'create' && !contentReady) {
    if (contentListenerError) {
      return (
        <Notice
          tone="caution"
          message="Content could not load. Check your connection and try again."
        />
      );
    }
    return <AdminLoadingState label="Loading block…" />;
  }
  if (!pagesLoading && (!page || !section)) {
    return (
      <AdminEmptyState
        title="No such section"
        description="This section is no longer available. Choose another section."
        action={
          <Link to="../../.." relative="path" className={primaryButtonClass}>
            Back to content
          </Link>
        }
      />
    );
  }
  if (mode === 'edit' && !pagesLoading && contentReady && !existingRow) {
    return (
      <AdminEmptyState
        title="No such block"
        description="This block is no longer available. Choose another block."
        action={
          <Link to=".." relative="path" className={primaryButtonClass}>
            Back to section
          </Link>
        }
      />
    );
  }

  const isExisting = mode === 'edit' || savedDocId !== null;
  const currentFieldId = isExisting ? fieldParam ?? fieldId : fieldId;

  function changeBlockType(nextType) {
    if (content.blockType === nextType) return;
    const drafts = textDraftsRef.current;
    if (content.blockType === 'text') {
      const richText = drafts.richtext;
      if (richText) {
        // A save can clear the Short text snapshot while a newer Text draft survives.
        const previousShort = drafts.text ?? (savedEdit?.blockType === 'text' ? savedEdit : null);
        // Only the language edited in Short text supersedes its Text draft.
        const englishChanged = content.values.value !== (previousShort?.values.value ?? '');
        const spanishChanged = content.translations?.es?.value !== previousShort?.translations?.es?.value;
        const converted = shortTextAsRichText(content);
        drafts.richtext = {
          ...richText,
          values: englishChanged ? converted.values : richText.values,
          ...(spanishChanged ? { translations: converted.translations } : {}),
        };
      }
      drafts.text = content;
    } else if (content.blockType === 'richtext') {
      drafts.richtext = content;
    }
    const restored = nextType === 'richtext' ? drafts.richtext ?? (drafts.text && shortTextAsRichText(drafts.text))
      : nextType === 'text' ? drafts.text : null;
    setContent((current) => {
      const placement = { order: current.order, visible: current.visible };
      if (restored) return { ...restored, ...placement };
      return {
        ...blankContent(nextType),
        ...placement,
        ...(Object.hasOwn(current, 'translations') ? { translations: {} } : {}),
      };
    });
  }

  function changeValue(name, value) {
    setContent((current) => {
      const values = { ...current.values, [name]: value };
      if (name === 'useEventVenue' && value && !values.label.trim()) {
        const venueName = eventConfig?.venue?.name;
        if (typeof venueName === 'string' && venueName.trim()) values.label = `Map of ${venueName.trim()}`;
      }
      return { ...current, values };
    });
  }

  async function save({ publish }) {
    const textDraftsAtSave = { ...textDraftsRef.current };
    setError(null);
    setErrorTitle(undefined);
    setStatus('');
    setResumeQueueId(null);
    // Give immediate field feedback before the server repeats the same
    // required-field contract at the write boundary.
    const validationErrors = validateRequiredContent(content).map((item) => ({
      ...item,
      message: item.field === 'blockType' ? 'Choose a content type.'
        : item.field === 'limit' ? 'Enter a whole number of 1 or more, or clear the field.'
          : item.message,
    }));
    if (validationErrors.length > 0) {
      setError({
        message: 'Fill in the required fields before saving.',
        fieldErrors: validationErrors,
        clientValidation: true,
      });
      return;
    }
    let nextFieldId = String(fieldId ?? '').trim();
    if (!isExisting && !nextFieldId) {
      const taken = new Set();
      for (const row of contentRows) {
        if (row.current?.section === sectionId && row.current?.field) taken.add(row.current.field);
      }
      nextFieldId = uniqueEditorialId(contentIdSource(content), taken, content.blockType || 'block');
      setFieldId(nextFieldId);
    }
    if (!isExisting && !contentReady) {
      setError({ message: 'Wait until content has loaded before saving a new block.' });
      return;
    }
    let savedContent = content;
    if (!isExisting && savedContent.order === '') {
      const siblings = contentRows.filter((row) => row.current?.section === sectionId);
      savedContent = { ...savedContent, order: nextStoredOrder(siblings) };
      setContent(savedContent);
    }
    setBusy(publish ? 'publish' : 'draft');
    const endpoint = isExisting ? 'cmsUpdateContent' : 'cmsCreateContent';
    // cmsUpdateContent merges submitted fields onto the prior draft/live
    // doc's fields (functions/src/cms/content.cjs), so switching block
    // types here would otherwise leave the OLD type's now-stale fields
    // (an faq_item's `answer`, a cta's `url`, …) stranded on the doc
    // forever — explicitly mark them for deletion instead.
    const fields = {
      ...toContentFields(savedContent),
      ...staleFieldDeletions(savedBlockTypeRef.current, savedContent.blockType),
    };
    const request = {
      section: sectionId,
      fields,
      field: nextFieldId,
      visible: savedContent.visible,
    };
    if (!isExisting) request.pageId = pageId;
    let stage = 'save';
    try {
      const response = await call(endpoint, request);
      if (!mountedRef.current) return;
      const docId = response.docId ?? `${sectionId}__${nextFieldId}`;
      // Mark the document existing the moment the DRAFT is written, before
      // any publish attempt — the same reasoning AdminPageEditor applies:
      // a failed publish must not leave the field id editable, or a retry
      // under a different id would create a second document and orphan the
      // draft that just landed.
      setSavedDocId(docId);
      loadedKeyRef.current = `${sectionId}__${nextFieldId}`;
      savedBlockTypeRef.current = savedContent.blockType;
      setBaseType(savedContent.blockType);
      // A successful save clears cached drafts, preserving words entered while it ran.
      const drafts = textDraftsRef.current;
      for (const [type, draftAtSave] of Object.entries(textDraftsAtSave)) {
        if (textDraftKey(drafts[type]) === textDraftKey(draftAtSave)) drafts[type] = null;
      }
      setSavedEdit(contentEditSnapshot(nextFieldId, savedContent));
      if (!publish) {
        setStatus('Draft saved. It is not public until you publish.');
        return;
      }
      stage = 'publish';
      const publishResponse = await call('cmsPublish', {
        collection: 'cmsContent',
        docIds: [docId],
      });
      if (!mountedRef.current) return;
      reportPublish(publishResponse, [docId]);
    } catch (err) {
      if (!mountedRef.current) return;
      if (stage === 'publish') setErrorTitle('The draft is saved, and it is not published');
      setError(contentError(err, { fallback: stage === 'publish' ? 'Publishing did not finish. Your draft is saved. Try again.' : undefined, labels: Object.fromEntries(valueFieldsOf(content.blockType).map((field) => [field.id, editorialFieldLabel(content.blockType, field.id)])) }));
      if (err?.queueId) setResumeQueueId(err.queueId);
    } finally {
      if (mountedRef.current) setBusy(null);
    }
  }

  /** cmsPublish answers 200 even when it skipped what you asked for. */
  function reportPublish(response, requestedIds) {
    const verdict = summarizePublish(response, 'cmsContent', requestedIds, 'content blocks');
    if (!verdict.ok) throw Object.assign(new Error(verdict.message), { contentPublishResult: true });
    setStatus('Published.');
  }

  async function resumePublish() {
    setBusy('publish');
    setError(null);
    setErrorTitle('The draft is saved, and it is not published');
    setStatus('');
    try {
      const response = await call('cmsPublish', { queueId: resumeQueueId });
      setResumeQueueId(null);
      reportPublish(response, [savedDocId]);
    } catch (err) {
      setError(contentError(err, { labels: Object.fromEntries(valueFieldsOf(content.blockType).map((field) => [field.id, editorialFieldLabel(content.blockType, field.id)])) }));
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
      const deleted = await call('cmsDeleteContent', { section: sectionId, field: currentFieldId });
      const listPath = `/admin/content/${encodeURIComponent(pageId)}/${encodeURIComponent(sectionId)}`;
      reportDeleted({ ...deleted, collection: 'cmsContent', docId: `${sectionId}__${currentFieldId}`, pageId, editorPath: `${listPath}/${encodeURIComponent(currentFieldId)}` }, listPath);
    } catch (err) {
      setErrorTitle('Could not delete. Try again.');
      setError(contentError(err, { fallback: 'This item could not be deleted. Try again.', labels: Object.fromEntries(valueFieldsOf(content.blockType).map((field) => [field.id, editorialFieldLabel(content.blockType, field.id)])) }));
      setBusy(null);
    }
  }

  const settingsPanel = (
    <Panel help="Choose this block’s content type and whether it appears after publishing."
      key="settings"
      title={isExisting ? 'Block settings' : 'Content type'}
      className="admin-content-settings"
    >
      {isExisting ? (
        <div className="admin-content-settings-summary">
          <p className="text-admin-sm text-admin-ink-secondary">
            {blockTypeFor(content.blockType)?.label ?? 'Content block'} · {content.visible ? 'Visible' : 'Hidden'}
          </p>
          <AdminIconControl
            label={settingsOpen ? 'Hide block settings' : 'Edit block settings'}
            icon={settingsOpen ? 'close' : 'edit'}
            aria-expanded={settingsOpen}
            aria-controls="admin-content-block-settings"
            onClick={() => setSettingsOpen((open) => !open)}
          />
        </div>
      ) : null}
      <div id="admin-content-block-settings" hidden={isExisting && !settingsOpen}>
        <div className="mt-sm grid gap-sm">
          {/* Mounted only when shown: its examples draw eleven public blocks. */}
          {!isExisting || settingsOpen ? (
            <BlockTypePicker
              value={content.blockType}
              allowed={allowed}
              // Unsaved short text kept for a switch back keeps the option
              // too, even after a save of another type lands.
              savedType={textDraftsRef.current.text ? 'text' : baseType ?? undefined}
              sectionName={section?.label}
              onChange={changeBlockType}
              error={errorFor('blockType')}
            />
          ) : null}
          <div className="flex items-center">
            <CheckboxField help="Include this content on the public site after publishing."
              label="Visible"
              checked={content.visible}
              onChange={(checked) => setContent((current) => ({ ...current, visible: checked }))}
            />
          </div>
        </div>
      </div>
    </Panel>
  );
  const valuePanel = (
    <Panel help="Write the content attendees should see in this block." key="value" title="Content" className="admin-content-value">
      {content.blockType === 'timeline' ? (
        <p className="text-admin-sm text-admin-ink-secondary">
          This block shows published entries from <Link to="/admin/timeline" className="underline">Timeline</Link>.
        </p>
      ) : null}
      <BlockValueFields
        blockTypeId={content.blockType}
        values={content.values}
        onChange={changeValue}
        errorFor={errorFor}
        features={features}
        pageRows={pagesLoading ? null : pageRows}
        fixedHero={sectionId === 'hero' && page?.current?.path === '/'}
        newMapBlockHref={canAddMap ? newBlockHref : undefined}
      />
      {content.blockType === 'map' ? (
        <MapBlock block={content.values} preview />
      ) : null}
      {content.blockType === 'image' ? (
        <ImagePlacementPreview
          image={{ ...toContentFields(content), descriptionOverride: existingRow?.current?.descriptionOverride }}
          hero={sectionId === 'hero' && ['home', 'schedule'].includes(pageId) ? pageId : undefined}
          eventName={eventConfig.name}
        />
      ) : null}
      <ContentTranslations kind="block" record={{ ...content.values, blockType: content.blockType, translations: content.translations }}
        onChange={(translations) => setContent((current) => ({ ...current, translations }))}
        labels={Object.fromEntries(valueFieldsOf(content.blockType).map((field) => [field.id, editorialFieldLabel(content.blockType, field.id)]))}
        errorFor={errorFor} />
    </Panel>
  );

  return (
    <form
      ref={formRef}
      noValidate
      className="flex flex-col gap-md"
      onSubmit={(event) => {
        event.preventDefault();
        save({ publish: false });
      }}
    >
      <AdminPageHeader help="Edit one block of page content. Save a draft to keep working or publish to update the site."
        title={mode === 'create'
          ? 'New content block'
          : contentBlockTitle({ ...content.values, blockType: content.blockType })}
        recentTitle={existingRow ? contentBlockTitle(existingRow.current) : null}
        state={(
          <>
            {existingRow ? <RecordState state={existingRow.state} /> : null}
            {unsaved ? <UnsavedEditBadge /> : null}
          </>
        )}
        identifiers={`${page?.current?.label || 'Untitled page'} · ${section?.label || 'Untitled section'}`}
        feedback={status || error ? <EditorActionFeedback unsaved={unsaved} status={status} error={error} errorTitle={errorTitle} /> : null}
        actions={
          <>
            <Link to=".." relative="path" className={linkButtonClass}>
              Back to section
            </Link>
            <button type="submit" className={secondaryButtonClass} disabled={busy !== null} aria-busy={busy === 'draft' || undefined}>
              <BusyLabel busy={busy === 'draft'} pending="Saving the draft…">Save draft</BusyLabel>
            </button>
            <button
              type="button"
              className={primaryButtonClass}
              disabled={busy !== null}
              aria-busy={busy === 'publish' || undefined}
              onClick={() => save({ publish: true })}
            >
              <BusyLabel busy={busy === 'publish'} pending="Publishing the block…">Save and publish</BusyLabel>
            </button>
          </>
        }
      />

      <ServerErrorSummary
        error={error}
        errorRef={errorRef}
        title={error?.clientValidation ? 'Fill in the required fields' : errorTitle}
      />
      {leaveGuard.pending ? createPortal(
        <UnsavedChangesDialog
          onStay={leaveGuard.stay}
          onDiscard={leaveGuard.discard}
          canDiscard={leaveGuard.canDiscard}
        />,
        document.body,
      ) : null}

      {isExisting && isStarterContent({ ...content.values, blockType: content.blockType, seeded: existingRow?.current?.seeded }) ? (
        <Notice
          tone="caution"
          message="Replace the starter text, then publish to show this block on the site."
        />
      ) : null}
      <div className="admin-content-editor-layout" data-creating={!isExisting}>
        {isExisting ? <>{valuePanel}{settingsPanel}</> : <>{settingsPanel}{valuePanel}</>}
      </div>

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
          <DestructiveConfirm
            trigger="Delete this block"
            triggerIcon="delete"
            title={`Delete ${contentBlockTitle({ ...content.values, blockType: content.blockType })}`}
            confirmLabel="Delete this block"
            busyLabel="Deleting…"
            busy={busy === 'delete'}
            disabled={busy !== null}
            consequence="This block and its saved draft will be deleted."
            permanence={<RecordRecovery collection="cmsContent" docId={`${sectionId}__${currentFieldId}`} />}
            onConfirm={remove}
          />
        ) : null}
      </div>
    </form>
  );
}
