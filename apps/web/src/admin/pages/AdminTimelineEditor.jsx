// The timeline entry editor (issue #194): create or edit one past edition
// of the event through the generic content endpoints, and publish it
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
import { useNavigate, useParams } from 'react-router-dom';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAdminApi } from '../adminApi.js';
import { summarizePublish } from '../publishResult.js';
import { timelineFields, validateTimelineForm } from '../timelineDoc.js';
import { useAdminTimeline } from '../useAdminTimeline.js';
import { focusFirstError } from '../../lib/focusFirstError.js';
import {
  CheckboxField,
  DestructiveConfirm,
  Panel,
  SaveStatus,
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
  const { loading, findRow } = useAdminTimeline();
  const [form, setForm] = useState(EMPTY);
  // Minted once per form, on the first render in create mode.
  const [newId] = useState(() => (mode === 'create' ? mintId() : null));
  // The id this form created, once it has. From then on it only updates.
  const [createdId, setCreatedId] = useState(null);
  const [touched, setTouched] = useState(() => new Set());
  const [attempted, setAttempted] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const errorRef = useRef(null);
  const formRef = useRef(null);
  const adoptedRef = useRef(false);

  const creating = mode === 'create' && !createdId;
  const docId = mode === 'edit' ? entryId : (createdId ?? newId);
  const row = mode === 'edit' || createdId ? findRow(docId) : null;

  useEffect(() => {
    if (mode !== 'edit' || adoptedRef.current || !row) return;
    adoptedRef.current = true;
    setForm(toForm(row));
  }, [mode, row]);

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
    setSaving(true);
    setError(null);
    setStatus('');
    const body = { collection: COLLECTION, docId, fields: timelineFields(form), visible: form.visible };
    try {
      if (creating) {
        await call('cmsCreateContent', body);
        // Created: this form never creates again.
        adoptedRef.current = true;
        setCreatedId(docId);
      } else {
        await call('cmsUpdateContent', body);
      }
      if (publish) {
        const response = await call('cmsPublish', { collection: COLLECTION, docIds: [docId] });
        const verdict = summarizePublish(response, COLLECTION, [docId], 'timeline entries');
        if (!verdict.ok) throw new Error(verdict.message);
        setStatus(verdict.message);
        // The line above is the record and it announces; the toast repeats
        // it where the operator is looking, and says nothing.
        showToast(verdict.message, { announce: false });
      } else {
        setStatus('Draft saved. It is not live until you publish it.');
        showToast('Draft saved. It is not live until you publish it.', { announce: false });
      }
      if (mode === 'create') {
        navigate(`${TIMELINE_LIST}/${encodeURIComponent(docId)}`, { replace: true });
      }
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    setError(null);
    try {
      await call('cmsDeleteContent', { collection: COLLECTION, docId });
      showToast('Timeline entry deleted.');
      navigate(TIMELINE_LIST);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  if (mode === 'edit' && !createdId && loading) return <AdminLoadingState label="Loading entry…" />;
  if (mode === 'edit' && !createdId && !row && !loading) {
    return (
      <AdminEmptyState
        title="No such entry"
        description="That entry does not exist. It may have been deleted."
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
        title={creating ? 'New entry' : form.title.trim() || docId}
        state={!creating && row ? <RecordState state={row.state} /> : null}
        identifiers={creating ? null : docId}
        description="Save builds a draft. Publish sends it to the home page's History section."
        actions={
          <>
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

      <ServerErrorSummary error={error} errorRef={errorRef} />
      {status ? <SaveStatus message={status} /> : null}

      <Panel title="Past edition">
        <div className="flex flex-col gap-sm">
          <TextField
            label="Year"
            hint="Four digits. The site shows the year beside the title and uses it to order the list."
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
            hint="What that edition is remembered for, in a few words. Leave the year out; the site shows it."
            value={form.title}
            onChange={(value) => set('title', value)}
            error={errorFor('title')}
            required
          />
          <TextAreaField
            label="Description"
            hint="One or two sentences of plain text. The page shows it as one paragraph."
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
            title={`Delete ${form.title.trim() || docId}`}
            confirmLabel="Delete this entry"
            busyLabel="Deleting…"
            busy={saving}
            consequence="The live entry and its draft are removed together. Its version history stays."
            permanence="This cannot be undone."
            onConfirm={remove}
          />
        ) : null}
      </div>
    </form>
  );
}
