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
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAdminApi } from '../adminApi.js';
import { useAdminPages } from '../useAdminPages.js';
import { useAdminContent } from '../useAdminContent.js';
import {
  BLOCK_TYPE_IDS,
  STAT_CONTRACT_HINTS,
  blockTypeFor,
  blockTypeLabel,
} from '../blockTypes.js';
import {
  blankContent,
  staleFieldDeletions,
  toContentFields,
  toEditableContent,
  validateRequiredContent,
  valueFieldsOf,
} from '../contentDoc.js';
import { summarizePublish } from '../publishResult.js';
import ImagePicker from '../components/media/ImagePicker.jsx';
import {
  CheckboxField,
  DestructiveConfirm,
  Panel,
  SaveStatus,
  SelectField,
  ServerErrorSummary,
  TextAreaField,
  TextField,
  primaryButtonClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import AdminPageHeader, {
  AdminEmptyState,
  AdminLoadingState,
  RecordState,
} from '../components/adminChrome.jsx';

/**
 * What to write in this field, where the system has something to say. Only
 * the stat contract does today (design brief §2.1.1): its four parts are
 * required on write, so the editor states what each one is for rather than
 * leaving an operator to guess from the field name.
 */
function hintFor(blockTypeId, fieldId) {
  return blockTypeId === 'stat' ? STAT_CONTRACT_HINTS[fieldId] : undefined;
}

/** One control per registry field, chosen by the field's declared type. */
function BlockValueFields({ blockTypeId, values, onChange, errorFor }) {
  const fields = valueFieldsOf(blockTypeId);
  if (!blockTypeFor(blockTypeId)) {
    return (
      <p className="text-caption text-admin-ink-secondary">
        Choose a block type above to fill in its value.
      </p>
    );
  }
  return (
    <div className="grid gap-sm sm:grid-cols-2">
      {fields.map((field) => {
        const label = `${field.id}${field.required ? '' : ' (optional)'}`;
        const value = values[field.id];
        const error = errorFor(field.id);
        const hint = hintFor(blockTypeId, field.id);
        if (field.type === 'boolean') {
          return (
            <div key={field.id} className="flex items-center">
              <CheckboxField
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
              <TextAreaField
                label={label}
                value={value}
                onChange={(next) => onChange(field.id, next)}
                error={error}
                rows={6}
                hint="Formatted HTML rendered through the rich-text allowlist (headings, links, lists, emphasis)."
              />
            </div>
          );
        }
        if (field.type === 'number') {
          return (
            <TextField
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
          // Only the image block's `url` names a Storage object path (spec
          // §5.2) — route it through the media library picker, exactly as
          // AdminBranding's logo slots do. cta and link_group's `url` are
          // real external links and stay plain text inputs.
          if (blockTypeId === 'image' && field.id === 'url') {
            return (
              <div key={field.id} className="sm:col-span-2">
                <ImagePicker
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
            <TextField
              key={field.id}
              label={label}
              type="url"
              value={value}
              onChange={(next) => onChange(field.id, next)}
              error={error}
            />
          );
        }
        return (
          <TextField
            key={field.id}
            label={label}
            value={value}
            onChange={(next) => onChange(field.id, next)}
            error={error}
            hint={hint}
          />
        );
      })}
    </div>
  );
}

export default function AdminContentBlockEditor({ mode }) {
  const { pageId, sectionId, field: fieldParam } = useParams();
  const navigate = useNavigate();
  const call = useAdminApi();
  const { showToast } = useToast();
  const { findRow: findPage, loading: pagesLoading } = useAdminPages();
  const { rows: contentRows, loading: contentLoading } = useAdminContent();

  const page = findPage(pageId);
  const section = (page?.current?.sections ?? []).find((candidate) => candidate.id === sectionId);
  // Stable reference across renders (unless the section's own list changes)
  // so the create-defaults effect below does not re-run every render.
  const allowed = useMemo(() => section?.allowedBlocks ?? [], [section?.allowedBlocks]);
  const existingRow =
    mode === 'edit'
      ? contentRows.find(
          (row) => row.current?.section === sectionId && row.current?.field === fieldParam,
        )
      : null;

  const [fieldId, setFieldId] = useState(mode === 'edit' ? fieldParam ?? '' : '');
  const [content, setContent] = useState(() => blankContent());
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null); // null | 'draft' | 'publish' | 'delete'
  const [status, setStatus] = useState('');
  const [savedDocId, setSavedDocId] = useState(null);
  const [resumeQueueId, setResumeQueueId] = useState(null);
  const errorRef = useRef(null);
  // Load the stored revision (or pick a default block type for a fresh
  // create form) once; later listener updates must not clobber an
  // in-progress edit.
  const loadedKeyRef = useRef(null);
  // The block type actually persisted server-side (from the loaded doc, or
  // the last successful save) — the reference point for clearing a PRIOR
  // type's stale fields when the operator switches types and saves again.
  const savedBlockTypeRef = useRef(null);

  useEffect(() => {
    if (mode !== 'edit') return;
    // Wait for BOTH cmsContent revision listeners, not just whichever
    // arrives first: if the live listener reports before the drafts one,
    // existingRow is already truthy (live-only) while the actual dirty
    // draft is still in flight. Adopting from the live doc here would then
    // never be revisited once the draft lands (the key guard below is a
    // one-shot), so a later "Save draft" would overwrite the operator's
    // real unpublished changes with the stale published content.
    if (contentLoading) return;
    const key = `${sectionId}__${fieldParam}`;
    if (loadedKeyRef.current === key) return;
    if (!existingRow) return;
    loadedKeyRef.current = key;
    const doc = existingRow.draft ?? existingRow.live;
    setFieldId(doc?.field ?? fieldParam ?? '');
    setContent(toEditableContent(doc, doc?.blockType));
    savedBlockTypeRef.current = doc?.blockType ?? null;
  }, [mode, sectionId, fieldParam, existingRow, contentLoading]);

  useEffect(() => {
    // A brand-new block starts with no type chosen; once the section's
    // allowed list is actually known (waiting out pagesLoading — otherwise
    // this would lock in the bare registry fallback before the section's
    // own allowedBlocks has ever arrived), default to its first allowed
    // type, or the whole registry if the section allows none. Only once,
    // and only if the operator has not already picked one.
    if (mode !== 'create') return;
    if (loadedKeyRef.current === 'create-defaults') return;
    if (pagesLoading) return;
    if (content.blockType) {
      loadedKeyRef.current = 'create-defaults';
      return;
    }
    const fallback = allowed[0] ?? BLOCK_TYPE_IDS[0];
    loadedKeyRef.current = 'create-defaults';
    setContent(blankContent(fallback));
  }, [mode, allowed, content.blockType, pagesLoading]);

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

  // Show the loading state until BOTH revisions have reported AND this
  // doc's adoption effect has actually run — not just until `existingRow`
  // is truthy, which the live listener alone can satisfy while the dirty
  // draft is still in flight (see the adoption effect above).
  const adopted = loadedKeyRef.current === `${sectionId}__${fieldParam}`;
  if (mode === 'edit' && (pagesLoading || contentLoading) && !adopted) {
    return <AdminLoadingState label="Loading block…" />;
  }
  if (!pagesLoading && (!page || !section)) {
    return (
      <AdminEmptyState
        title="No such section"
        description="That section doesn’t exist on this page (any more)."
        action={
          <Link to="../../.." relative="path" className={primaryButtonClass}>
            Back to content
          </Link>
        }
      />
    );
  }
  if (mode === 'edit' && !pagesLoading && !contentLoading && !existingRow) {
    return (
      <AdminEmptyState
        title="No such block"
        description="That content block has neither a published nor a draft revision."
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
    setContent((current) => ({
      ...blankContent(nextType),
      order: current.order,
      visible: current.visible,
    }));
  }

  function changeValue(name, value) {
    setContent((current) => ({ ...current, values: { ...current.values, [name]: value } }));
  }

  async function save({ publish }) {
    setError(null);
    setStatus('');
    setResumeQueueId(null);
    // The generic content endpoints validate only reserved keys, never
    // block shape (unlike cmsSavePage's BLOCK_TYPES-aware validator for
    // cmsPages) — so a required registry field (an image's alt text, a
    // cta's url) would otherwise save and publish empty. Check it here,
    // before EITHER a draft-only save or a publish, and report it the same
    // way a server rejection would (ServerErrorSummary + per-field errors).
    const validationErrors = validateRequiredContent(content);
    if (validationErrors.length > 0) {
      setError({
        message: 'Fill in the required fields for this block type before saving.',
        fieldErrors: validationErrors,
        clientValidation: true,
      });
      return;
    }
    setBusy(publish ? 'publish' : 'draft');
    const endpoint = isExisting ? 'cmsUpdateContent' : 'cmsCreateContent';
    // cmsUpdateContent merges submitted fields onto the prior draft/live
    // doc's fields (functions/src/cms/content.cjs), so switching block
    // types here would otherwise leave the OLD type's now-stale fields
    // (an faq_item's `answer`, a cta's `url`, …) stranded on the doc
    // forever — explicitly mark them for deletion instead.
    const fields = {
      ...toContentFields(content),
      ...staleFieldDeletions(savedBlockTypeRef.current, content.blockType),
    };
    try {
      const response = await call(endpoint, {
        section: sectionId,
        field: currentFieldId,
        fields,
        visible: content.visible,
      });
      const docId = response.docId ?? `${sectionId}__${currentFieldId}`;
      // Mark the document existing the moment the DRAFT is written, before
      // any publish attempt — the same reasoning AdminPageEditor applies:
      // a failed publish must not leave the field id editable, or a retry
      // under a different id would create a second document and orphan the
      // draft that just landed.
      setSavedDocId(docId);
      loadedKeyRef.current = `${sectionId}__${currentFieldId}`;
      savedBlockTypeRef.current = content.blockType;
      if (!publish) {
        setStatus('Draft saved. It is not public until you publish.');
        showToast('Draft saved.');
        return;
      }
      const publishResponse = await call('cmsPublish', {
        collection: 'cmsContent',
        docIds: [docId],
      });
      reportPublish(publishResponse, [docId]);
    } catch (err) {
      setError(err);
      if (err?.queueId) setResumeQueueId(err.queueId);
    } finally {
      setBusy(null);
    }
  }

  /** cmsPublish answers 200 even when it skipped what you asked for. */
  function reportPublish(response, requestedIds) {
    const verdict = summarizePublish(response, 'cmsContent', requestedIds, 'content blocks');
    setStatus(verdict.message);
    showToast(verdict.message, verdict.ok ? undefined : { tone: 'error' });
  }

  async function resumePublish() {
    setBusy('publish');
    setError(null);
    try {
      const response = await call('cmsPublish', { queueId: resumeQueueId });
      setResumeQueueId(null);
      reportPublish(response, [savedDocId]);
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
      await call('cmsDeleteContent', { section: sectionId, field: currentFieldId });
      showToast('Block deleted.');
      navigate('..', { relative: 'path' });
    } catch (err) {
      setError(err);
      setBusy(null);
    }
  }

  const registryOptions = allowed.length ? allowed : BLOCK_TYPE_IDS;
  const options = (
    content.blockType && !registryOptions.includes(content.blockType)
      ? [content.blockType, ...registryOptions]
      : registryOptions
  ).map((id) => ({ value: id, label: blockTypeLabel(id) }));

  return (
    <form
      className="flex flex-col gap-md"
      onSubmit={(event) => {
        event.preventDefault();
        save({ publish: false });
      }}
    >
      <AdminPageHeader
        title={mode === 'create' ? 'New content block' : currentFieldId || 'Content block'}
        state={existingRow ? <RecordState state={existingRow.state} /> : null}
        identifiers={`${pageId} · ${sectionId}`}
        description={
          // JSX children, not a template literal: while the page listener is
          // still loading, `page` is null and a template literal would print
          // the literal word "undefined" — JSX quietly renders nothing for
          // an undefined child instead, same as before the restyle.
          <>
            {section?.label || sectionId} · {page?.current?.label}. Saving writes a draft;
            publishing copies it to the live revision the public site reads.
          </>
        }
        actions={
          <Link to=".." relative="path" className={secondaryButtonClass}>
            Back to section
          </Link>
        }
      />

      <ServerErrorSummary
        error={error}
        errorRef={errorRef}
        title={error?.clientValidation ? 'Fill in the required fields' : undefined}
      />
      {status ? <SaveStatus message={status} /> : null}

      <Panel
        title="Block"
        description="The field id ties this block to the public page's block slot."
      >
        <div className="grid gap-sm sm:grid-cols-2">
          <TextField
            label="Field id"
            value={currentFieldId}
            onChange={setFieldId}
            error={errorFor('field')}
            readOnly={isExisting}
            hint={
              isExisting
                ? 'The field id cannot change after creation.'
                : 'Letters, digits, hyphen, underscore. Ties this block to the section’s default block.'
            }
          />
          <SelectField
            label="Block type"
            value={content.blockType}
            options={options}
            onChange={changeBlockType}
            error={errorFor('blockType')}
            hint={
              allowed.length
                ? `This section allows: ${allowed.map(blockTypeLabel).join(', ')}.`
                : 'This section does not allow any block types yet — add one in Pages.'
            }
          />
          <TextField
            label="Order"
            type="number"
            value={content.order}
            onChange={(value) =>
              setContent((current) => ({ ...current, order: value === '' ? '' : Number(value) }))
            }
            error={errorFor('order')}
            hint="Lower numbers sort first within the section."
          />
          <div className="flex items-center">
            <CheckboxField
              label="Visible"
              checked={content.visible}
              onChange={(checked) => setContent((current) => ({ ...current, visible: checked }))}
              hint="Hidden blocks stay out of the public site even once published."
            />
          </div>
        </div>
      </Panel>

      <Panel title="Value" description={blockTypeFor(content.blockType)?.description}>
        <BlockValueFields
          blockTypeId={content.blockType}
          values={content.values}
          onChange={changeValue}
          errorFor={errorFor}
        />
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
          <DestructiveConfirm
            trigger="Delete this block"
            title={`Delete ${currentFieldId}`}
            confirmLabel="Delete this block"
            busyLabel="Deleting…"
            busy={busy === 'delete'}
            disabled={busy !== null}
            consequence={`The live revision of ${currentFieldId} and its draft both go, and the section renders without it.`}
            permanence="This cannot be undone."
            onConfirm={remove}
          />
        ) : null}
      </div>
    </form>
  );
}
