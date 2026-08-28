import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAdminApi } from '../adminApi.js';
import { summarizePublish } from '../publishResult.js';
import {
  publishSetForSession,
  sessionFields,
  sessionIdFromTitle,
} from '../sessionDoc.js';
import { useAdminSessions } from '../useAdminSessions.js';
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

const EMPTY = {
  id: '',
  title: '',
  description: '',
  dayId: '',
  startTime: '',
  endTime: '',
  track: '',
  placeId: '',
  location: '',
  parentId: '',
  visible: true,
};

function toForm(row) {
  const session = row?.current ?? {};
  return {
    id: row?.id ?? '',
    title: session.title ?? '',
    description: session.description ?? '',
    dayId: session.dayId ?? '',
    startTime: session.startTime ?? '',
    endTime: session.endTime ?? '',
    track: session.track ?? '',
    placeId: session.placeId ?? '',
    location: session.location ?? '',
    parentId: session.parentId ?? '',
    visible: session.visible !== false,
  };
}

function validateForm(form, mode) {
  const errors = new Map();
  if (mode === 'create' && (!form.id || form.id.includes('/') || form.id === '.' || form.id === '..')) {
    errors.set('id', 'Enter a session id without a slash.');
  }
  if (!form.title.trim()) errors.set('title', 'Enter a public title.');
  if (!form.description.trim()) errors.set('description', 'Enter a public description.');
  if (!form.dayId) errors.set('dayId', 'Select an event day.');
  if (!form.startTime) errors.set('startTime', 'Enter a start time.');
  if (!form.endTime) errors.set('endTime', 'Enter an end time.');
  if (form.startTime && form.endTime && form.startTime >= form.endTime) {
    errors.set('endTime', 'End time must be after start time.');
  }
  return errors;
}

export default function AdminSessionEditor({ mode }) {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const call = useAdminApi();
  const { showToast } = useToast();
  const { eventConfig } = useEventConfig();
  const { rows, loading, findRow } = useAdminSessions();
  const row = mode === 'edit' ? findRow(sessionId) : null;
  const [form, setForm] = useState(EMPTY);
  const [idTouched, setIdTouched] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const errorRef = useRef(null);
  const adoptedRef = useRef(false);

  useEffect(() => {
    if (mode !== 'edit' || adoptedRef.current || !row) return;
    adoptedRef.current = true;
    setForm(toForm(row));
  }, [mode, row]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const localErrors = useMemo(() => validateForm(form, mode), [form, mode]);
  const serverErrors = useMemo(() => {
    const map = new Map();
    for (const segment of error?.fieldErrors ?? []) {
      if (segment.field && !map.has(segment.field)) map.set(segment.field, segment.message);
    }
    return map;
  }, [error]);
  const errorFor = (field) => localErrors.get(field) ?? serverErrors.get(field);
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  const dayOptions = [
    { value: '', label: 'Select a day' },
    ...(eventConfig.days ?? []).map((day) => ({ value: day.id, label: day.label || day.id })),
  ];
  const trackOptions = [
    { value: '', label: 'No track' },
    ...(eventConfig.tracks ?? []).map((track) => ({
      value: track.letter,
      label: `${track.letter} — ${track.name}`,
    })),
  ];
  const placeOptions = [
    { value: '', label: 'No recorded place' },
    ...(eventConfig.venue?.places ?? []).map((place) => ({
      value: place.id,
      label: `${place.name} (${place.id})`,
    })),
  ];
  const parentOptions = [
    { value: '', label: 'No parent session' },
    ...rows
      .filter((candidate) =>
        candidate.id !== sessionId
        && candidate.current.dayId === form.dayId
        && !candidate.current.parentId,
      )
      .map((candidate) => ({ value: candidate.id, label: candidate.current.title || candidate.id })),
  ];

  async function saveDraft() {
    const docId = mode === 'create' ? form.id : sessionId;
    const endpoint = mode === 'create' ? 'cmsCreateContent' : 'cmsUpdateContent';
    await call(endpoint, {
      collection: 'cmsSchedule',
      docId,
      fields: sessionFields(form),
      visible: form.visible,
    });
    return docId;
  }

  async function save({ publish = false } = {}) {
    if (localErrors.size > 0 || saving) return;
    setSaving(true);
    setError(null);
    setStatus('');
    try {
      const docId = await saveDraft();
      if (publish) {
        const publishRow = row ?? { id: docId, current: sessionFields(form), draft: {} };
        const ids = publishSetForSession(publishRow, rows);
        const response = await call('cmsPublish', { collection: 'cmsSchedule', docIds: ids });
        const verdict = summarizePublish(response, 'cmsSchedule', ids, 'sessions');
        if (!verdict.ok) throw new Error(verdict.message);
        setStatus(verdict.message);
        showToast(verdict.message);
      } else {
        setStatus('Draft saved. It is not live until you publish it.');
        showToast('Session draft saved.');
      }
      if (mode === 'create') {
        navigate(`/admin/sessions/${encodeURIComponent(docId)}`, { replace: true });
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
      await call('cmsDeleteContent', { collection: 'cmsSchedule', docId: sessionId });
      showToast('Session deleted.');
      navigate('..');
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  if (mode === 'edit' && loading) return <AdminLoadingState label="Loading session…" />;
  if (mode === 'edit' && !row && !loading) {
    return (
      <AdminEmptyState
        title="No such session"
        description="That session does not exist. It may have been deleted."
      />
    );
  }

  return (
    <form className="flex flex-col gap-md" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <AdminPageHeader
        title={mode === 'create' ? 'New session' : form.title || sessionId}
        state={mode === 'edit' ? <RecordState state={row?.state} /> : null}
        identifiers={mode === 'edit' ? sessionId : null}
        description="Save builds a draft. Preview reads that draft, and publish sends it to the public schedule."
        actions={
          mode === 'edit' ? (
            <a
              href={`/schedule/${encodeURIComponent(sessionId)}?preview=1`}
              target="_blank"
              rel="noreferrer"
              className={secondaryButtonClass}
            >
              Preview draft
            </a>
          ) : null
        }
      />

      <ServerErrorSummary error={error} errorRef={errorRef} />
      {status ? <SaveStatus message={status} /> : null}

      <Panel title="Public session">
        <div className="flex flex-col gap-sm">
          {mode === 'create' ? (
            <TextField
              label="Session id"
              hint="A stable identifier. Use lowercase words and hyphens."
              value={form.id}
              onChange={(value) => {
                setIdTouched(true);
                set({ id: value });
              }}
              error={errorFor('id')}
              required
            />
          ) : null}
          <TextField
            label="Public title"
            value={form.title}
            onChange={(value) => {
              setForm((current) => ({
                ...current,
                title: value,
                id: mode === 'create' && !idTouched ? sessionIdFromTitle(value) : current.id,
              }));
            }}
            error={errorFor('title')}
            required
          />
          <TextAreaField
            label="Public description"
            rows={5}
            value={form.description}
            onChange={(value) => set({ description: value })}
            error={errorFor('description')}
            required
          />
        </div>
      </Panel>

      <Panel title="Time and structure">
        <div className="grid gap-sm sm:grid-cols-2">
          <SelectField
            label="Event day"
            value={form.dayId}
            onChange={(value) => set({ dayId: value, parentId: '' })}
            options={dayOptions}
            error={errorFor('dayId')}
          />
          <SelectField
            label="Parent session"
            hint="Only same-day top-level sessions can be parents."
            value={form.parentId}
            onChange={(value) => set({ parentId: value })}
            options={parentOptions}
            error={errorFor('parentId')}
          />
          <TextField
            label="Start time"
            type="time"
            value={form.startTime}
            onChange={(value) => set({ startTime: value })}
            error={errorFor('startTime')}
          />
          <TextField
            label="End time"
            type="time"
            value={form.endTime}
            onChange={(value) => set({ endTime: value })}
            error={errorFor('endTime')}
          />
          <SelectField
            label="Track"
            hint="A child can leave this unset to inherit its parent’s track."
            value={form.track}
            onChange={(value) => set({ track: value })}
            options={trackOptions}
            error={errorFor('track')}
          />
          <SelectField
            label="Recorded place"
            value={form.placeId}
            onChange={(value) => set({ placeId: value })}
            options={placeOptions}
            error={errorFor('placeId')}
          />
          <div className="sm:col-span-2">
            <TextField
              label="Public location text"
              hint="This is the wording attendees read. It does not change the recorded place."
              value={form.location}
              onChange={(value) => set({ location: value })}
              error={errorFor('location')}
            />
          </div>
          <CheckboxField
            label="Show this session when it is published"
            checked={form.visible}
            onChange={(value) => set({ visible: value })}
          />
        </div>
      </Panel>

      <div className="flex flex-wrap items-center gap-xs">
        <button type="submit" className={primaryButtonClass} disabled={saving || localErrors.size > 0}>
          {saving ? 'Saving…' : 'Save draft'}
        </button>
        <button
          type="button"
          className={secondaryButtonClass}
          disabled={saving || localErrors.size > 0}
          onClick={() => save({ publish: true })}
        >
          {saving ? 'Working…' : 'Save and publish'}
        </button>
        <button type="button" className={secondaryButtonClass} onClick={() => navigate('..')}>
          Cancel
        </button>
        {mode === 'edit' ? (
          <DestructiveConfirm
            className="ms-auto"
            trigger="Delete this session"
            title={`Delete ${form.title || sessionId}`}
            confirmLabel="Delete this session"
            busyLabel="Deleting…"
            busy={saving}
            consequence="The live session and its draft are removed. A parent session cannot be deleted while it has children."
            permanence="This cannot be undone."
            onConfirm={remove}
          />
        ) : null}
      </div>
    </form>
  );
}
