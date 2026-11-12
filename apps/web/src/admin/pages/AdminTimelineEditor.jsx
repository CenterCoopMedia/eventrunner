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
// THERE IS NO DRAFT PREVIEW. The entries appear only on the home page, and
// the home page is a landing path: ProfileSetupRedirect sends an account
// with no display name from it to /profile, so a preview link could land an
// admin somewhere else.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAdminApi } from '../adminApi.js';
import RecordRecovery from '../components/RecordRecovery.jsx';
import { contentError } from '../contentError.js';
import { summarizePublish } from '../publishResult.js';
import { timelineFields, validateTimelineForm } from '../timelineDoc.js';
import { useAdminTimeline } from '../useAdminTimeline.js';
import { focusFirstError } from '../../lib/focusFirstError.js';
import {
  ActionLabel,
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

const COLLECTION = 'cmsTimeline';
const TIMELINE_LIST = '/admin/timeline';

const EMPTY = Object.freeze({ year: '', title: '', description: '', visible: true });

const textOf = (value) => (typeof value === 'string' ? value : '');

function toForm(row) {
  const entry = row?.current ?? {};
  return {
    year: Number.isInteger(entry.year) ? String(entry.year) : textOf(entry.year),
    title: textOf(entry.title),
    description: textOf(entry.description),
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
  const { showToast } = useToast();
  const { ready, error: listenerError, findRow } = useAdminTimeline();
  const [form, setForm] = useState(EMPTY);
  // Minted once per form, on the first render in create mode.
  const [newId] = useState(() => (mode === 'create' ? mintId() : null));
  // The id this form created, once it has. From then on it only updates.
  const [createdId, setCreatedId] = useState(null);
  const [touched, setTouched] = useState(() => new Set());
  const [attempted, setAttempted] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const [error, setError] = useState(null);
  const [errorTitle, setErrorTitle] = useState(undefined);
  const [action, setAction] = useState(null);
  const saving = action !== null;
  const [status, setStatus] = useState('');
  const [feedbackSnapshot, setFeedbackSnapshot] = useState(null);
  const errorRef = useRef(null);
  const formRef = useRef(null);
  const adoptedRef = useRef(false);

  const creating = mode === 'create' && !createdId;
  const docId = mode === 'edit' ? entryId : (createdId ?? newId);
  const row = mode === 'edit' || createdId ? findRow(docId) : null;

  // The form is filled once, from the merged row, and only after both the
  // live and the draft listener have reported: filled from the live
  // revision alone, a save would replace the unpublished draft.
  useEffect(() => {
    if (mode !== 'edit' || adoptedRef.current || !ready || !row) return;
    adoptedRef.current = true;
    setForm(toForm(row));
  }, [mode, ready, row]);

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
    setAction(publish ? 'publish' : 'draft');
    setError(null);
    setErrorTitle(undefined);
    setStatus('');
    const body = { collection: COLLECTION, docId, fields: timelineFields(form), visible: form.visible };
    let stage = 'save';
    try {
      if (creating) {
        await call('cmsCreateContent', body);
        // Created: this form never creates again.
        adoptedRef.current = true;
        setCreatedId(docId);
      } else {
        await call('cmsUpdateContent', body);
      }
      setFeedbackSnapshot(JSON.stringify(form));
      if (publish) {
        stage = 'publish';
        const response = await call('cmsPublish', { collection: COLLECTION, docIds: [docId] });
        const verdict = summarizePublish(response, COLLECTION, [docId], 'timeline entries');
        if (!verdict.ok) throw Object.assign(new Error(verdict.message), { contentPublishResult: true });
        setStatus('Published.');
        if (mode === 'create') showToast('Published.', { announce: false });
      } else {
        setStatus('Draft saved. It is not live until you publish it.');
        if (mode === 'create') showToast('Draft saved. It is not live until you publish it.', { announce: false });
      }
      if (mode === 'create') {
        navigate(`${TIMELINE_LIST}/${encodeURIComponent(docId)}`, { replace: true });
      }
    } catch (err) {
      if (stage === 'publish') setErrorTitle('The draft is saved, and it is not published');
      setError(contentError(err, { fallback: stage === 'publish' ? 'Publishing did not finish. Your draft is saved. Try again.' : undefined, labels: { year: 'Year', title: 'Title', description: 'Description' } }));
    } finally {
      setAction(null);
    }
  }

  async function remove() {
    setAction('delete');
    setError(null);
    setErrorTitle(undefined);
    try {
      await call('cmsDeleteContent', { collection: COLLECTION, docId });
      showToast('Timeline entry deleted.');
      navigate(TIMELINE_LIST);
    } catch (err) {
      setErrorTitle('Could not delete. Try again.');
      setError(contentError(err, { fallback: 'This item could not be deleted. Try again.', labels: { year: 'Year', title: 'Title', description: 'Description' } }));
    } finally {
      setAction(null);
    }
  }

  if (mode === 'edit' && !createdId && !ready) {
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
    return <AdminLoadingState label="Loading entry…" />;
  }
  if (mode === 'edit' && !createdId && !row) {
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

  return (
    <form
      ref={formRef}
      className="flex flex-col gap-md"
      noValidate
      onSubmit={(event) => { event.preventDefault(); save(); }}
    >
      <AdminPageHeader
        title={creating ? 'New entry' : form.title.trim() || 'Untitled entry'}
        state={!creating && row ? <RecordState state={row.state} /> : null}
        feedback={status || error ? <EditorActionFeedback unsaved={feedbackSnapshot !== null && JSON.stringify(form) !== feedbackSnapshot} status={status} error={error} errorTitle={errorTitle} /> : null}
        actions={
          <>
            <button
              type="submit"
              className={secondaryButtonClass}
              disabled={saving}
              aria-busy={action === 'draft' || undefined}
            >
              <ActionLabel busy={action === 'draft'} pending="Saving…">Save</ActionLabel>
            </button>
            <button
              type="button"
              className={primaryButtonClass}
              disabled={saving}
              aria-busy={action === 'publish' || undefined}
              onClick={() => save({ publish: true })}
            >
              <ActionLabel busy={action === 'publish'} pending="Publishing…">Publish</ActionLabel>
            </button>
          </>
        }
      />

      <ServerErrorSummary error={error} errorRef={errorRef} title={errorTitle} />

      <Panel title="Entry">
        <div className="flex flex-col gap-sm">
          <TextField
            label="Year"
            inputMode="numeric"
            autoComplete="off"
            value={form.year}
            onChange={(value) => set('year', value)}
            error={errorFor('year')}
            className="font-admin-data"
            required
          />
          <TextField
            label="Title"
            hint="What made this event memorable?"
            value={form.title}
            onChange={(value) => set('title', value)}
            error={errorFor('title')}
            required
          />
          <TextAreaField
            label="Description"
            hint="One or two sentences about this event."
            rows={3}
            value={form.description}
            onChange={(value) => set('description', value)}
            error={errorFor('description')}
          />
          <CheckboxField
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
