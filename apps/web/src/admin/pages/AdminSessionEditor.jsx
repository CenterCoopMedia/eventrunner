import { plannerError } from '../plannerErrors.js';
import '../plannerFields.css';
import PlannerSwitch from '../components/PlannerSwitch.jsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router';
import { isSafeUrl } from 'shared/urlSafety';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAdminApi } from '../adminApi.js';
import { useDeletedRecord } from '../deletionUndo.jsx';
import RecordRecovery from '../components/RecordRecovery.jsx';
import { summarizePublish } from '../publishResult.js';
import {
  lockSessionId,
  publishSetForSession,
  resolveDayLabel,
  sessionFields,
} from '../sessionDoc.js';
import { useUnsavedNavigation } from '../useUnsavedNavigation.js';
import { UnsavedChangesDialog, UnsavedEditBadge } from '../components/UnsavedChanges.jsx';
import { useAdminSessions } from '../useAdminSessions.js';
import { focusFirstError } from '../../lib/focusFirstError.js';
import { NewTabNote } from '../../components/ExternalLink.jsx';
import {
  ActionLabel,
  DestructiveConfirm,
  Notice,
  Panel,
  SelectField,
  ServerErrorSummary,
  TextAreaField,
  TextField,
  linkButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import { EditorActionFeedback } from '../components/ActionFeedback.jsx';
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
  recordingUrl: '',
  materialsNotNeeded: false,
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
    recordingUrl: session.recordingUrl ?? '',
    materialsNotNeeded: session.materialsNotNeeded === true,
    visible: session.visible !== false,
  };
}

function editorSnapshot(form) {
  return JSON.stringify(form);
}

function validateForm(form) {
  const errors = new Map();
  if (!form.title.trim()) errors.set('title', 'Enter a public title.');
  if (!form.description.trim()) errors.set('description', 'Enter a public description.');
  if (!form.dayId) errors.set('dayId', 'Select an event day.');
  if (!form.startTime) errors.set('startTime', 'Enter a start time.');
  if (!form.endTime) errors.set('endTime', 'Enter an end time.');
  if (form.startTime && form.endTime && form.startTime >= form.endTime) {
    errors.set('endTime', 'End time must be after start time.');
  }
  // The recording link is optional, so an empty box is valid. A filled one
  // goes through the same protocol allowlist the server applies
  // (functions/src/schedule/sessions.cjs), so the editor names the problem
  // while the operator is still looking at the field rather than after a
  // failed save.
  const recordingUrl = String(form.recordingUrl ?? '').trim();
  if (recordingUrl && !isSafeUrl(recordingUrl)) {
    errors.set('recordingUrl', 'Enter a link that starts with http:// or https://.');
  }
  return errors;
}

// Where every exit from the editor goes. The editor's route is a sibling of
// the list under the admin layout, so a relative '..' is the admin index,
// not the list.
const SESSIONS_LIST = '/admin/sessions';

export default function AdminSessionEditor({ mode }) {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const call = useAdminApi();
  const reportDeleted = useDeletedRecord();
  const { showToast } = useToast();
  const { eventConfig } = useEventConfig();
  const { rows, ready, error: listenerError, findRow } = useAdminSessions();
  const [createdId, setCreatedId] = useState(null);
  const creating = mode === 'create' && !createdId;
  const currentId = mode === 'edit' ? sessionId : createdId;
  const row = !creating ? findRow(currentId) : null;
  const [form, setForm] = useState(EMPTY);
  const [savedSnapshot, setSavedSnapshot] = useState(() => (
    mode === 'create' ? editorSnapshot(EMPTY) : null
  ));
  const [error, setError] = useState(null);
  const [errorTitle, setErrorTitle] = useState(undefined);
  const [action, setAction] = useState(null);
  const saving = action !== null;
  const [status, setStatus] = useState('');
  const errorRef = useRef(null);
  const formRef = useRef(null);
  const adoptedRef = useRef(null);
  const unsaved = savedSnapshot !== null && editorSnapshot(form) !== savedSnapshot;
  const leaveGuard = useUnsavedNavigation(unsaved, { blocked: saving });

  useEffect(() => {
    if (mode !== 'edit' || adoptedRef.current === currentId || !ready || !row) return;
    adoptedRef.current = currentId;
    const next = toForm(row);
    setForm(next);
    setSavedSnapshot(editorSnapshot(next));
    setError(null);
    setErrorTitle(undefined);
    setStatus('');
  }, [mode, currentId, ready, row]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  useEffect(() => {
    const node = formRef.current;
    if (!node) return undefined;
    if (leaveGuard.pending) node.setAttribute('inert', '');
    else node.removeAttribute('inert');
    return () => node.removeAttribute('inert');
  }, [leaveGuard.pending]);

  const localErrors = useMemo(() => validateForm(form), [form]);
  const serverErrors = useMemo(() => {
    const map = new Map();
    for (const segment of error?.fieldErrors ?? []) {
      if (segment.field && !map.has(segment.field)) map.set(segment.field, segment.message);
    }
    return map;
  }, [error]);
  const errorFor = (field) => localErrors.get(field) ?? serverErrors.get(field);
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  const configuredDays = eventConfig.days ?? [];
  const dayOptions = [
    { value: '', label: 'Select a day' },
    ...configuredDays.map((day, index) => ({
      value: day.id,
      label: resolveDayLabel(day, index, eventConfig.timezone),
    })),
    // A saved session can point at a day the event no longer configures (an
    // operator removed it, or an environment's demo sessions outran its own
    // config/event — #248 review follow-up). A <select> whose value matches
    // none of its <option>s silently shows the first option instead, which
    // reads as "no day chosen" even though the stored value is something
    // else. Naming the actual stored value here — never a bare id standing
    // alone as if it were a real day's name — keeps the control honest and
    // gives the operator the one thing they need to fix it.
    ...(form.dayId && !configuredDays.some((day) => day.id === form.dayId)
      ? [{ value: form.dayId, label: 'Choose a different event day' }]
      : []),
  ];
  const trackOptions = [
    { value: '', label: 'No track' },
    ...(eventConfig.tracks ?? []).map((track) => ({
      value: track.letter,
      label: track.name || `Track ${track.letter}`,
    })),
  ];
  const placeOptions = [
    { value: '', label: 'No recorded place' },
    ...(eventConfig.venue?.places ?? []).map((place) => ({
      value: place.id,
      label: place.name,
    })),
  ];
  const parentOptions = [
    { value: '', label: 'No parent session' },
    ...rows
      .filter((candidate) =>
        candidate.id !== currentId
        && candidate.current.dayId === form.dayId
        && !candidate.current.parentId,
      )
      .map((candidate) => ({ value: candidate.id, label: candidate.current.title || 'Untitled session' })),
  ];

  async function save({ publish = false } = {}) {
    if (saving) return;
    // The submit control stays enabled while a field is invalid (#219). A
    // disabled control announces nothing, so an operator who pastes a bad
    // value and presses Save would get silence. Pressing it now moves the
    // operator to the field that stopped the save, and sends nothing.
    if (localErrors.size > 0) {
      focusFirstError(formRef.current);
      return;
    }
    const nextForm = creating
      ? lockSessionId(form, rows.map((candidate) => candidate.id))
      : form;
    if (nextForm !== form) setForm(nextForm);
    const docId = creating ? nextForm.id : currentId;
    const endpoint = creating ? 'cmsCreateContent' : 'cmsUpdateContent';
    setAction(publish ? 'publish' : 'draft');
    setError(null);
    setErrorTitle(undefined);
    setStatus('');
    let stage = 'save';
    try {
      await call(endpoint, {
        collection: 'cmsSchedule',
        docId,
        fields: sessionFields(nextForm),
        visible: nextForm.visible,
      });
      if (creating) {
        adoptedRef.current = docId;
        setCreatedId(docId);
      }
      setSavedSnapshot(editorSnapshot(nextForm));
      if (publish) {
        stage = 'publish';
        // Use the fields just saved. `row` still has the parent from before
        // this edit, so publishing from it can include an unrelated draft.
        const publishRow = { id: docId, current: sessionFields(nextForm) };
        const ids = publishSetForSession(publishRow, rows);
        const response = await call('cmsPublish', { collection: 'cmsSchedule', docIds: ids });
        const verdict = summarizePublish(response, 'cmsSchedule', ids, 'sessions');
        if (!verdict.ok) throw new Error(verdict.message);
        setStatus(verdict.message);
        if (mode === 'create') showToast(verdict.message, { announce: false });
      } else {
        setStatus('Draft saved. It is not live until you publish it.');
        if (mode === 'create') showToast('Session draft saved.', { announce: false });
      }
      if (mode === 'create') {
        navigate(`/admin/sessions/${encodeURIComponent(docId)}`, { replace: true });
      }
    } catch (err) {
      if (stage === 'publish') setErrorTitle('The draft is saved, and it is not published');
      setError(plannerError(err));
    } finally {
      setAction(null);
    }
  }

  async function remove() {
    setAction('delete');
    setError(null);
    setErrorTitle(undefined);
    try {
      const deleted = await call('cmsDeleteContent', { collection: 'cmsSchedule', docId: currentId });
      reportDeleted({ ...deleted, collection: 'cmsSchedule', docId: currentId, editorPath: `${SESSIONS_LIST}/${encodeURIComponent(currentId)}` }, SESSIONS_LIST);
    } catch (err) {
      setErrorTitle('The session was not deleted');
      setError(plannerError(err));
    } finally {
      setAction(null);
    }
  }

  if (mode === 'edit' && createdId !== currentId && ready && !row) {
    return (
      <AdminEmptyState
        title="No such session"
        description="That session may have been deleted. Open the list to choose another."
        action={<Link to={SESSIONS_LIST} className={secondaryButtonClass}>Back to sessions</Link>}
      />
    );
  }

  if (mode === 'edit' && adoptedRef.current !== currentId) {
    if (!ready && listenerError) {
      return (
        <Notice
          tone="caution"
          message="The session did not load. Reconnecting…"
        />
      );
    }
    return <AdminLoadingState label="Loading session…" />;
  }

  return (
    <form
      ref={formRef}
      className="flex flex-col gap-md"
      onSubmit={(event) => { event.preventDefault(); save(); }}
    >
      <AdminPageHeader help="Edit session details for the public schedule."
        title={creating ? 'New session' : form.title || 'Session'}
        recentTitle={row?.current?.title}
        state={(
          <>
            {mode === 'edit' ? <RecordState state={row?.state} /> : null}
            {unsaved ? <UnsavedEditBadge /> : null}
          </>
        )}
        identifiers={null}
        description="Edit session details for the public schedule."
        feedback={status || error ? <EditorActionFeedback unsaved={unsaved} status={status} error={error} errorTitle={errorTitle} /> : null}
        actions={
          <>
            {mode === 'edit' ? (
              <a
                href={`/schedule/${encodeURIComponent(sessionId)}?preview=1`}
                target="_blank"
                rel="noreferrer"
                className={linkButtonClass}
              >
                Preview draft
                {/* The preview opens a tab, so it says so inside its own
                    name (issue 236). The note is beside the words rather
                    than through ExternalLink because this link is internal
                    and takes the admin's own control shape. */}
                <NewTabNote />
              </a>
            ) : null}
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
      {leaveGuard.pending ? createPortal(
        <UnsavedChangesDialog
          onStay={leaveGuard.stay}
          onDiscard={leaveGuard.discard}
          canDiscard={leaveGuard.canDiscard}
        />,
        document.body,
      ) : null}

      <div className="admin-editor-layout admin-editor-layout--session">
        <Panel help="The title, description, and recording attendees see."
          title="Public session"
          description="The title, description, and recording attendees see."
          className="admin-editor-card--primary"
        >
          <div className="flex flex-col gap-sm">
            <TextField help="Use the session name attendees should see in the schedule."
              label="Public title"
              value={form.title}
              onChange={(value) => set({ title: value })}
              error={errorFor('title')}
              required
            />
            <TextAreaField help="Explain what attendees will learn or do in this session."
              label="Public description"
              rows={5}
              value={form.description}
              onChange={(value) => set({ description: value })}
              error={errorFor('description')}
              required
            />
            <TextField help="Add the public recording when it is ready to watch."
              label="Recording link"
              type="url"
              
              value={form.recordingUrl}
              onChange={(value) => set({ recordingUrl: value })}
              error={errorFor('recordingUrl')}
            />
          </div>
        </Panel>

        <div className="admin-editor-stack">
          <Panel help="Place this session in the event day and programme."
            title="Time and structure"
            description="Place this session in the event day and programme."
          >
            <div className="admin-editor-fields planner-fields grid gap-sm sm:grid-cols-2">
              <SelectField help="Place this session on one of the days set up in Event settings."
                label="Event day"
                value={form.dayId}
                onChange={(value) => set({ dayId: value, parentId: '' })}
                options={dayOptions}
                error={errorFor('dayId')}
              />
              <SelectField help="Choose the session this belongs to."
                label="Parent session"
                
                value={form.parentId}
                onChange={(value) => set({ parentId: value })}
                options={parentOptions}
                error={errorFor('parentId')}
              />
              <TextField help="Enter when the session begins on the event’s local clock."
                label="Start time"
                type="time"
                value={form.startTime}
                onChange={(value) => set({ startTime: value })}
                error={errorFor('startTime')}
              />
              <TextField help="Enter when the session ends on the event’s local clock."
                label="End time"
                type="time"
                value={form.endTime}
                onChange={(value) => set({ endTime: value })}
                error={errorFor('endTime')}
              />
                <SelectField help="Choose the parallel schedule line for this session."
                label="Track"
                hint="Leave empty to use the parent session’s track."
                value={form.track}
                onChange={(value) => set({ track: value })}
                options={trackOptions}
                error={errorFor('track')}
              />
            </div>
          </Panel>

          <Panel help="Choose a room and the location attendees see." title="Location" description="Choose a room and the location attendees see.">
            <div className="flex flex-col gap-sm">
              <SelectField help="Choose a place set up in Event settings so attendees can find this session."
                label="Room"
                value={form.placeId}
                onChange={(value) => set({ placeId: value })}
                options={placeOptions}
                error={errorFor('placeId')}
              />
              <div>
                <TextField help="For example: Main hall, second floor."
                  label="Location label"
                  
                  value={form.location}
                  onChange={(value) => set({ location: value })}
                  error={errorFor('location')}
                />
              </div>
            </div>
          </Panel>

          <Panel help="Most sessions need slides or other materials from their speakers."
            title="Speaker materials"
            description="Most sessions need slides or other materials from their speakers."
          >
            <PlannerSwitch help="Turn off for sessions that do not need slides or other files."
              label="Request speaker materials"
              
              checked={!form.materialsNotNeeded}
              onChange={(value) => set({ materialsNotNeeded: !value })}
            />
          </Panel>

          <Panel help="Visibility takes effect when this draft is published." title="Publishing" description="Visibility takes effect when this draft is published.">
            <PlannerSwitch help="Include this session on the public schedule after publishing."
              label="Show on the schedule"
              checked={form.visible}
              onChange={(value) => set({ visible: value })}
            />
          </Panel>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-xs">
        <button type="button" className={secondaryButtonClass} onClick={() => navigate(SESSIONS_LIST)}>
          Cancel
        </button>
        {mode === 'edit' ? (
          <DestructiveConfirm
            className="ms-auto"
            trigger="Delete this session"
            triggerIcon="delete"
            title={`Delete ${form.title || 'this session'}`}
            confirmLabel="Delete this session"
            busyLabel="Deleting…"
            busy={action === 'delete'}
            disabled={saving}
            consequence="The live session and its draft are removed. A parent session cannot be deleted while it has children."
            permanence={<RecordRecovery collection="cmsSchedule" docId={currentId} />}
            onConfirm={remove}
          />
        ) : null}
      </div>
    </form>
  );
}
