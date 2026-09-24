// Update editor (issue #190): write, save, publish and delete one post on
// the site's Updates page.
//
// Save writes the DRAFT only (cmsSaveUpdate). "Save and publish" saves and
// then calls cmsPublish for this one update, the publish action every other
// editor takes. The date is display scheduling: a date in the future never
// disables or delays either action, and the update goes live when it is
// published (functions/src/cms/updates.cjs).
//
// ONE ID PER FORM. A new update's id is minted in the browser when the form
// opens and sent with every attempt, so a retry after a failed publish
// rewrites the same draft rather than making a second update.
//
// The picture and the content blocks an update may carry are not edited
// here. They go back to the server unchanged on every save
// (admin/updatesDoc.js toUpdatePayload), and a panel says so.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { UPDATE_CATEGORY_MAX, validUpdateCategory } from 'shared/update';
import { useNavigate, useParams } from 'react-router-dom';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { focusFirstError } from '../../lib/focusFirstError.js';
import { NewTabNote } from '../../components/ExternalLink.jsx';
import { useAdminApi } from '../adminApi.js';
import { summarizePublish } from '../publishResult.js';
import { useAdminUpdates } from '../useAdminUpdates.js';
import {
  UPDATES_OFF_MESSAGE,
  UPDATES_ROOT,
  blankUpdateForm,
  categoriesIn,
  extrasOf,
  toUpdateForm,
  toUpdatePayload,
} from '../updatesDoc.js';
import {
  CheckboxField,
  DestructiveConfirm,
  Notice,
  Panel,
  SaveStatus,
  ServerErrorSummary,
  TextAreaField,
  TextField,
  linkButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import AdminPageHeader, {
  AdminEmptyState,
  AdminLoadingState,
  RecordState,
} from '../components/adminChrome.jsx';

/** A server field name → the form field it marks. */
const SERVER_FIELD = Object.freeze({ title: 'title', body: 'body', publishAt: 'date', category: 'category' });

/**
 * A new update's id: one per form, resent unchanged on every attempt. The
 * server takes `^[A-Za-z0-9_-]{1,64}$`; a UUID fits it, and the fallback
 * for a page outside a secure context does too (FeedbackModal.jsx).
 */
export function mintUpdateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

/** The checks the editor makes before it sends anything. */
export function validateUpdateForm(form) {
  const errors = new Map();
  if (!String(form.title ?? '').trim()) errors.set('title', 'Enter a title.');
  if (!String(form.body ?? '').trim()) errors.set('body', 'Enter the text of the update.');
  // The rule the server and the public page read (shared/update).
  const category = String(form.category ?? '');
  if (category.trim() && !validUpdateCategory(category)) {
    errors.set(
      'category',
      category.trim().length > UPDATE_CATEGORY_MAX
        ? `Use ${UPDATE_CATEGORY_MAX} characters or fewer.`
        : 'Use one line of plain text.',
    );
  }
  return errors;
}

/** "This update also has a picture and 3 content blocks. …" or null. */
export function extrasSentence({ picture, blocks }) {
  if (!picture && blocks === 0) return null;
  const parts = [];
  if (picture) parts.push('a picture');
  if (blocks > 0) parts.push(`${blocks} content block${blocks === 1 ? '' : 's'}`);
  const one = (picture ? 1 : 0) + blocks === 1;
  return `This update also has ${parts.join(' and ')}. Saving here keeps ${one ? 'it as it is' : 'them as they are'}.`;
}

export default function AdminUpdateEditor({ mode }) {
  const { updateId } = useParams();
  const navigate = useNavigate();
  const call = useAdminApi();
  const { showToast } = useToast();
  const { features, eventConfig } = useEventConfig();
  const timeZone = eventConfig?.timezone;
  const { rows, ready, error: listenerError, findRow } = useAdminUpdates();
  const categoryListId = useId();
  const row = mode === 'edit' ? findRow(updateId) : null;

  const [form, setForm] = useState(blankUpdateForm);
  const [attempted, setAttempted] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const [error, setError] = useState(null);
  const [errorTitle, setErrorTitle] = useState(undefined);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  // The id this form created, once its first save lands. The route then
  // moves to the update's own address. The router keeps this component
  // (the two routes render the same element), and the draft listener may
  // not have reported the new draft yet, so the form stays up rather than
  // saying there is no such update.
  const [createdId, setCreatedId] = useState(null);
  const newIdRef = useRef(null);
  if (newIdRef.current === null) newIdRef.current = mintUpdateId();
  // The record the form was filled from. It is filled once, and only after
  // BOTH listeners have reported: they report in no fixed order, and a row
  // built before the drafts arrive is the live doc alone, so a form filled
  // from it and saved would replace the unpublished draft with the live
  // values.
  const [adoptedId, setAdoptedId] = useState(null);
  const errorRef = useRef(null);
  const formRef = useRef(null);

  useEffect(() => {
    if (mode !== 'edit' || !ready || !row) return;
    if (adoptedId === updateId || createdId === updateId) return;
    setAdoptedId(updateId);
    setForm(toUpdateForm(row, timeZone));
  }, [mode, ready, row, updateId, adoptedId, createdId, timeZone]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  // After a refused save the marks render first, then focus moves to the
  // first one.
  useEffect(() => {
    if (focusRequest > 0) focusFirstError(formRef.current);
  }, [focusRequest]);

  const localErrors = useMemo(() => validateUpdateForm(form), [form]);
  const serverErrors = useMemo(() => {
    const map = new Map();
    for (const segment of error?.fieldErrors ?? []) {
      const field = SERVER_FIELD[segment.field];
      if (field && !map.has(field)) map.set(field, segment.message);
    }
    return map;
  }, [error]);
  const errorFor = (field) => (attempted ? localErrors.get(field) : undefined) ?? serverErrors.get(field);
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  const id = mode === 'create' ? newIdRef.current : updateId;

  async function save({ publish = false } = {}) {
    if (saving) return;
    setAttempted(true);
    // The save controls stay enabled while a field is invalid: pressing one
    // moves the keyboard to the field that stopped it and sends nothing.
    if (localErrors.size > 0) {
      setFocusRequest((count) => count + 1);
      return;
    }
    setSaving(true);
    setError(null);
    setErrorTitle(undefined);
    setStatus('');
    let stage = 'save';
    try {
      await call('cmsSaveUpdate', {
        id,
        update: toUpdatePayload(form, row, timeZone),
        visible: form.visible,
      });
      if (mode === 'create') setCreatedId(id);
      let message = 'Draft saved. It is not live until you publish it.';
      if (publish) {
        stage = 'publish';
        const response = await call('cmsPublish', { collection: 'cmsUpdates', docIds: [id] });
        const verdict = summarizePublish(response, 'cmsUpdates', [id], 'updates');
        if (!verdict.ok) throw new Error(verdict.message);
        message = verdict.message;
      }
      setStatus(message);
      // The status line is the record and it announces; the toast repeats
      // it where the operator is looking and says nothing.
      showToast(message, { announce: false });
      if (mode === 'create') {
        navigate(`${UPDATES_ROOT}/${encodeURIComponent(id)}`, { replace: true });
      }
    } catch (err) {
      if (stage === 'publish') {
        setErrorTitle('The draft is saved, and it is not published');
        if (mode === 'create') {
          navigate(`${UPDATES_ROOT}/${encodeURIComponent(id)}`, { replace: true });
        }
      }
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    setError(null);
    setErrorTitle(undefined);
    try {
      await call('cmsDeleteUpdate', { id: updateId });
      showToast('Update deleted.');
      navigate(UPDATES_ROOT);
    } catch (err) {
      setErrorTitle('The server refused the delete');
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  if (mode === 'edit' && adoptedId !== updateId && createdId !== updateId) {
    if (ready && !row) {
      return (
        <AdminEmptyState
          title="No such update"
          description="That update does not exist. It may have been deleted."
        />
      );
    }
    // A listener failed before both had reported. The form stays closed
    // rather than opening on one revision; the listener retries, and the
    // form opens when both are in.
    if (!ready && listenerError) {
      return (
        <Notice
          tone="caution"
          message="We could not load this update and its saved draft. The editor opens when both have loaded, so a save cannot replace a draft it has not read. We are trying again."
        />
      );
    }
    return <AdminLoadingState label="Loading update…" />;
  }

  const extras = extrasSentence(extrasOf(row));

  return (
    <form
      ref={formRef}
      noValidate
      className="flex flex-col gap-md"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <AdminPageHeader
        title={mode === 'create' ? 'New update' : form.title.trim() || updateId}
        state={mode === 'edit' ? <RecordState state={row?.state} /> : null}
        identifiers={mode === 'edit' ? updateId : null}
        description="Save builds a draft. Preview reads that draft, and publish sends it to the Updates page."
        actions={
          <>
            {mode === 'edit' && features?.updates ? (
              <a
                href={`/updates/${encodeURIComponent(updateId)}?preview=1`}
                target="_blank"
                rel="noreferrer"
                className={linkButtonClass}
              >
                Preview draft
                <NewTabNote />
              </a>
            ) : null}
            <button
              type="submit"
              className={secondaryButtonClass}
              disabled={saving}
              aria-busy={saving || undefined}
            >
              {saving ? 'Saving…' : 'Save draft'}
            </button>
            <button
              type="button"
              className={primaryButtonClass}
              disabled={saving}
              aria-busy={saving || undefined}
              onClick={() => save({ publish: true })}
            >
              {saving ? 'Working…' : 'Save and publish'}
            </button>
          </>
        }
      />

      {features?.updates ? null : <Notice tone="caution" message={UPDATES_OFF_MESSAGE} />}

      <ServerErrorSummary error={error} errorRef={errorRef} title={errorTitle} />
      {status ? <SaveStatus message={status} /> : null}

      <Panel title="Post">
        <div className="flex flex-col gap-sm">
          <TextField
            label="Title"
            value={form.title}
            onChange={(value) => set({ title: value })}
            error={errorFor('title')}
            required
          />
          <TextAreaField
            label="Text"
            rows={8}
            hint="Plain text. The update's own page keeps line breaks. The Updates page shows the opening lines."
            value={form.body}
            onChange={(value) => set({ body: value })}
            error={errorFor('body')}
            required
          />
          <TextField
            label="Date"
            type="date"
            hint="The date readers see, on the event's clock. Leave it empty for an undated update. It does not delay publishing: the update goes live when you publish it."
            value={form.date}
            onChange={(value) => set({ date: value })}
            error={errorFor('date')}
            className="sm:max-w-[16rem]"
          />
          <TextField
            label="Category"
            hint="One or two words shown as a tag beside the title. Leave it empty for none."
            value={form.category}
            onChange={(value) => set({ category: value })}
            error={errorFor('category')}
            maxLength={UPDATE_CATEGORY_MAX}
            list={categoryListId}
            className="sm:max-w-[20rem]"
          />
          {/* The categories other updates use, offered as suggestions so
              one topic is spelt one way. */}
          <datalist id={categoryListId}>
            {categoriesIn(rows).map((category) => (
              <option key={category} value={category} />
            ))}
          </datalist>
        </div>
      </Panel>

      <Panel title="Placement">
        <div className="flex flex-col gap-sm">
          <CheckboxField
            label="Pin this update to the top of the list"
            checked={form.pinned}
            onChange={(value) => set({ pinned: value })}
          />
          <CheckboxField
            label="Feature this update at the head of the list"
            hint="If more than one update is featured, the one that comes first leads and the others stay in place."
            checked={form.featured}
            onChange={(value) => set({ featured: value })}
          />
          <CheckboxField
            label="Show this update when it is published"
            checked={form.visible}
            onChange={(value) => set({ visible: value })}
          />
        </div>
      </Panel>

      {extras ? (
        <Panel title="Picture and blocks">
          <p className="max-w-[65ch] text-admin-sm text-admin-ink-secondary">{extras}</p>
        </Panel>
      ) : null}

      <div className="flex flex-wrap items-center gap-xs">
        <button type="button" className={secondaryButtonClass} onClick={() => navigate(UPDATES_ROOT)}>
          Cancel
        </button>
        {mode === 'edit' ? (
          <DestructiveConfirm
            className="ms-auto"
            trigger="Delete this update"
            title={`Delete ${form.title.trim() || updateId}`}
            confirmLabel="Delete this update"
            busyLabel="Deleting…"
            busy={saving}
            consequence="The live update and its draft are removed together. Its version history stays."
            permanence="This cannot be undone."
            onConfirm={remove}
          />
        ) : null}
      </div>
    </form>
  );
}
