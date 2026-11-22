// The timeline entry editor (issue #194): create or edit one entry, a past
// edition of the event, through the generic content endpoints, and publish it
// through cmsPublish like every other editor.
//
//   Save draft        → cmsCreateContent (the first save) or cmsUpdateContent
//   Save and publish  → the same save, then cmsPublish for this entry
//   Delete            → cmsDeleteContent, removing live and draft together
//
// The id is minted in the browser once per form. A form creates at most
// once: after the create succeeds, every later save from it is an update on
// the same id, so a publish that fails after a create is retried as an
// update rather than as a second entry or a refusal.
//
import AdminPendingSave, { useAdminSaveState } from '../components/AdminPendingSave.jsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAdminApi } from '../adminApi.js';
import { useDeletedRecord } from '../deletionUndo.jsx';
import RecordRecovery from '../components/RecordRecovery.jsx';
import { contentError } from '../contentError.js';
import { summarizePublish } from '../publishResult.js';
import { timelineFields, validateTimelineForm } from '../timelineDoc.js';
import { useAdminTimeline } from '../useAdminTimeline.js';
import { focusFirstError } from '../../lib/focusFirstError.js';
import {
  CheckboxField,
  DestructiveConfirm,
  Notice,
  Panel,
  ServerErrorSummary,
  TextAreaField,
  TextField,
  primaryButtonClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import { EditorActionFeedback } from '../components/ActionFeedback.jsx';
import AdminPageHeader, {
  AdminEmptyState,
  AdminLoadingState,
  RecordState,
} from '../components/adminChrome.jsx';
import BusyLabel from '../../components/BusyLabel.jsx';
import ImagePicker from '../components/media/ImagePicker.jsx';

const COLLECTION = 'cmsTimeline';
const TIMELINE_LIST = '/admin/timeline';

const EMPTY = Object.freeze({ year: '', title: '', description: '', url: '', image: '', alt: '', visible: true });
const FIELD_LABELS = { year: 'Year', title: 'Title', description: 'Description', url: 'Link', image: 'Image', alt: 'Alt text' };

const textOf = (value) => (typeof value === 'string' ? value : '');

function changedTimelineFields(next, previous) {
  const changed = new Set(Object.keys(next).filter((field) => next[field] !== previous[field]));
  if (changed.has('image') || changed.has('alt')) {
    changed.add('image');
    changed.add('alt');
  }
  return changed;
}

function toForm(row) {
  const entry = row?.current ?? {};
  return {
    year: Number.isInteger(entry.year) ? String(entry.year) : textOf(entry.year),
    title: textOf(entry.title),
    description: textOf(entry.description),
    url: textOf(entry.url),
    image: textOf(entry.image),
    alt: textOf(entry.alt),
    visible: entry.visible !== false,
  };
}

/** A new id for a new entry: the browser's own UUID. */
function mintId() {
  return globalThis.crypto.randomUUID();
}

export default function AdminTimelineEditor({ mode }) {
  const { entryId } = useParams();
  const navigate = useNavigate();
  const call = useAdminApi();
  const reportDeleted = useDeletedRecord();
  const { showToast } = useToast();
  const { ready, error: listenerError, findRow } = useAdminTimeline();
  const [{ form, savedForm }, setEditor] = useState({ form: EMPTY, savedForm: EMPTY });
  // Minted once per form, on the first render in create mode.
  const [newId] = useState(() => (mode === 'create' ? mintId() : null));
  // The id this form created, once it has. From then on it only updates.
  const [createdId, setCreatedId] = useState(null);
  const [touched, setTouched] = useState(() => new Set());
  const [attempted, setAttempted] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const [error, setError] = useState(null);
  const [errorTitle, setErrorTitle] = useState(undefined);
  const [status, setStatus] = useState('');
  const errorRef = useRef(null);
  const formRef = useRef(null);
  const adoptedRef = useRef(null);
  const observedRef = useRef(null);

  const creating = mode === 'create' && !createdId;
  const docId = mode === 'edit' ? entryId : (createdId ?? newId);
  const row = mode === 'edit' || createdId ? findRow(docId) : null;
  const { action, set: setAction, begin: beginSave, capture: captureUnconfirmed, unconfirmed: unconfirmedSave, offline, isCurrentRecord } = useAdminSaveState(null, docId);
  const saving = action !== null || unconfirmedSave;

  // Start from the merged row and keep untouched fields current as the
  // listeners report newer values.
  useEffect(() => {
    if (mode !== 'edit' || !ready || !row || (adoptedRef.current === docId && saving)) return;
    const incoming = toForm(row);
    const observed = observedRef.current;
    observedRef.current = incoming;
    if (adoptedRef.current === docId) {
      // An unrelated snapshot can precede the echo of our latest save.
      const changed = changedTimelineFields(incoming, observed);
      if (!changed.size) return;
      setEditor((current) => {
        const edited = changedTimelineFields(current.form, current.savedForm);
        const nextForm = { ...current.form };
        const nextSaved = { ...current.savedForm };
        for (const field of changed) {
          if (!edited.has(field)) nextForm[field] = incoming[field];
          nextSaved[field] = incoming[field];
        }
        return { form: nextForm, savedForm: nextSaved };
      });
      return;
    }
    adoptedRef.current = docId;
    setEditor({ form: incoming, savedForm: incoming });
    setTouched(new Set());
    setAttempted(false);
    setError(null);
    setErrorTitle(undefined);
    setStatus('');
  }, [mode, docId, ready, row, saving]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  useEffect(() => {
    if (focusRequest > 0) focusFirstError(formRef.current);
  }, [focusRequest]);

  const localErrors = useMemo(() => validateTimelineForm(form), [form]);
  const serverErrors = useMemo(() => {
    const map = new Map();
    for (const segment of error?.fieldErrors ?? []) {
      if (segment.field && !map.has(segment.field)) map.set(segment.field, segment.message);
    }
    return map;
  }, [error]);
  // A field's own check shows once the operator has typed in it or pressed
  // save, so a blank new form does not open on a column of errors.
  const errorFor = (field) =>
    ((attempted || touched.has(field)) ? localErrors.get(field) : undefined) ?? serverErrors.get(field);
  const editedFields = changedTimelineFields(form, savedForm);
  const setForm = (update) => setEditor((current) => ({ ...current, form: update(current.form) }));
  const set = (field, value) => {
    setTouched((current) => (current.has(field) ? current : new Set(current).add(field)));
    setForm((current) => ({ ...current, [field]: value }));
  };

  async function save({ publish = false } = {}) {
    if (saving) return;
    // The submit control stays enabled while a field is invalid (#219): a
    // press moves the operator to the field that stopped the save, and
    // sends nothing.
    if (localErrors.size > 0) {
      setAttempted(true);
      setFocusRequest((count) => count + 1);
      return;
    }
    if (!beginSave(publish ? 'publish' : 'draft')) return;
    setError(null);
    setErrorTitle(undefined);
    setStatus('');
    const values = timelineFields(form);
    const fields = creating ? values : Object.fromEntries(
      Object.entries(values).filter(([field]) => editedFields.has(field)),
    );
    const body = { collection: COLLECTION, docId, fields };
    if (creating || editedFields.has('visible')) body.visible = form.visible;
    let stage = 'save';
    try {
      if (creating) {
        await call('cmsCreateContent', body);
        // Created: this form never creates again.
        if (isCurrentRecord()) {
          adoptedRef.current = docId;
          observedRef.current = form;
          setCreatedId(docId);
        }
      } else {
        await call('cmsUpdateContent', body);
      }
      if (isCurrentRecord()) setEditor((current) => ({ ...current, savedForm: form }));
      let message = 'Draft saved. It is not live until you publish it.';
      if (publish) {
        stage = 'publish';
        const response = await call('cmsPublish', { collection: COLLECTION, docIds: [docId] });
        const verdict = summarizePublish(response, COLLECTION, [docId], 'timeline entries');
        if (!verdict.ok) throw Object.assign(new Error(verdict.message), { contentPublishResult: true });
        message = 'Published.';
      }
      if (!isCurrentRecord()) return;
      setStatus(message);
      if (mode === 'create') {
        showToast(message, { announce: false });
        navigate(`${TIMELINE_LIST}/${encodeURIComponent(docId)}`, { replace: true });
      }
    } catch (err) {
      if (captureUnconfirmed(err)) return;
      if (!isCurrentRecord()) return;
      if (stage === 'publish') setErrorTitle('The draft is saved, and it is not published');
      setError(contentError(err, { fallback: stage === 'publish' ? 'Publishing did not finish. Your draft is saved. Try again.' : undefined, labels: FIELD_LABELS }));
    } finally {
      setAction(null);
    }
  }

  async function remove() {
    setAction('delete');
    setError(null);
    setErrorTitle(undefined);
    try {
      const deleted = await call('cmsDeleteContent', { collection: COLLECTION, docId });
      if (!isCurrentRecord()) return;
      reportDeleted({ ...deleted, collection: COLLECTION, docId, editorPath: `${TIMELINE_LIST}/${encodeURIComponent(docId)}` }, TIMELINE_LIST);
    } catch (err) {
      if (!isCurrentRecord()) return;
      setErrorTitle('Could not delete. Try again.');
      setError(contentError(err, { fallback: 'This item could not be deleted. Try again.', labels: FIELD_LABELS }));
    } finally {
      setAction(null);
    }
  }

  if (mode === 'edit' && createdId !== docId && !ready) {
    // A listener failed before both had reported. The form stays closed
    // rather than opening on one revision; the listener retries, and the
    // form opens when both are in.
    if (listenerError) {
      return (
        <Notice
          tone="caution"
          message="This entry could not load. Check your connection and try again."
        />
      );
    }
    return <AdminLoadingState recover label="Loading entry…" />;
  }
  if (mode === 'edit' && createdId !== docId && !row) {
    return (
      <AdminEmptyState
        title="No such entry"
        description="That entry does not exist. It may have been deleted."
        action={
          <Link to={TIMELINE_LIST} className={primaryButtonClass}>
            Open the timeline list
          </Link>
        }
      />
    );
  }

  if (mode === 'edit' && adoptedRef.current !== docId) {
    return <AdminLoadingState recover label="Loading entry…" />;
  }

  return (
    <form
      ref={formRef}
      className="flex flex-col gap-md"
      noValidate
      onSubmit={(event) => { event.preventDefault(); save(); }}
    >
      <AdminPageHeader
        description={mode === 'create' ? 'An entry describes one past edition. Published entries appear in Timeline blocks and in the History section on Home when that section is present.' : undefined}
        title={creating ? 'New entry' : form.title.trim() || 'Untitled entry'}
        recentTitle={row?.current?.title}
        state={!creating && row ? <RecordState state={row.state} /> : null}
        feedback={status || error ? <EditorActionFeedback unsaved={editedFields.size > 0} status={status} error={error} errorTitle={errorTitle} /> : null}
        actions={
          <>
            <button
              type="submit"
              className={secondaryButtonClass}
              disabled={saving}
              aria-busy={action === 'draft' || undefined}
            >
              <BusyLabel busy={action === 'draft'} pending="Saving the timeline…">Save</BusyLabel>
            </button>
            <button
              type="button"
              className={primaryButtonClass}
              disabled={saving}
              aria-busy={action === 'publish' || undefined}
              onClick={() => save({ publish: true })}
            >
              <BusyLabel busy={action === 'publish'} pending="Publishing the timeline…">Publish</BusyLabel>
            </button>
          </>
        }
      />

      <AdminPendingSave busy={action === 'draft' || action === 'publish'} to={mode === 'create' ? '/admin/timeline' : '.'} unconfirmed={unconfirmedSave} offline={offline} />
      <ServerErrorSummary error={error} errorRef={errorRef} title={errorTitle} />

      <Panel help="Use the year and title to tell readers which past edition this was." title="Entry">
        <div className="flex flex-col gap-sm">
          <TextField help="Enter the year of this past event."
            label="Year"
            inputMode="numeric"
            autoComplete="off"
            value={form.year}
            onChange={(value) => set('year', value)}
            error={errorFor('year')}
            className="font-admin-data"
            required
          />
          <TextField help="What made this event memorable?"
            label="Title"
            
            value={form.title}
            onChange={(value) => set('title', value)}
            error={errorFor('title')}
            required
          />
          <TextAreaField help="One or two sentences about this event."
            label="Description"
            
            rows={3}
            value={form.description}
            onChange={(value) => set('description', value)}
            error={errorFor('description')}
          />
          <TextField
            label="Link"
            help="Make the title a link. Enter a full HTTPS address or an internal path like /schedule."
            inputMode="url"
            value={form.url}
            onChange={(value) => set('url', value)}
            error={errorFor('url')}
          />
          <ImagePicker
            label="Image"
            help="Choose a photo or illustration for this edition from the media library."
            value={form.image}
            onChange={(value) => set('image', value)}
            onSelectionChange={(value) => {
              set('image', value);
              if (value !== form.image) setForm((current) => ({ ...current, alt: '' }));
            }}
            error={errorFor('image')}
          />
          {form.image ? (
            <TextField
              label="Alt text"
              help="Describe the image for someone who cannot see it."
              value={form.alt}
              onChange={(value) => set('alt', value)}
              error={errorFor('alt')}
              required
            />
          ) : null}
          <CheckboxField help="Include this past event in the public timeline after publishing."
            label="Show this entry when it is published"
            checked={form.visible}
            onChange={(value) => set('visible', value)}
          />
        </div>
      </Panel>

      <div className="flex flex-wrap items-center gap-xs">
        <button type="button" className={secondaryButtonClass} onClick={() => navigate(TIMELINE_LIST)}>
          Cancel
        </button>
        {!creating ? (
          <DestructiveConfirm
            className="ms-auto"
            trigger="Delete this entry"
            triggerIcon="delete"
            title={`Delete ${form.title.trim() || 'Untitled entry'}`}
            confirmLabel="Delete this entry"
            busyLabel="Deleting…"
            busy={action === 'delete'}
            disabled={saving}
            consequence="The live entry and its draft are removed together. Its version history stays."
            permanence={<RecordRecovery collection="cmsTimeline" docId={docId} />}
            onConfirm={remove}
          />
        ) : null}
      </div>
    </form>
  );
}
