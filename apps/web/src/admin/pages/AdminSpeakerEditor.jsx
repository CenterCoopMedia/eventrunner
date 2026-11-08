import { plannerError } from '../plannerErrors.js';
import '../plannerFields.css';
// Speaker create/edit form (issue #20), wired to createSpeaker /
// updateSpeaker / deleteSpeaker.
//
// The fields here are exactly EDITABLE_SPEAKER_FIELDS from
// packages/shared/src/speaker.cjs, minus the two the invite pipeline owns:
// `uid` and `inviteToken` are never in a payload, because both halves of the
// users.speakerId ↔ speakers.uid pair move in one server-side transaction
// (spec §4.3 seam #3). The server rejects them by name if one ever leaked
// in, and this form is why that rejection should never fire.
//
// Delete is the interesting control. `deleteSpeaker` is one transaction that
// removes the id from every session, clears the linked account, and deletes
// the record and its projection. When a speaker is on more sessions than a
// transaction can carry, the server refuses (409, nothing changed) and names
// the soft delete as the way through — so this form surfaces that second
// button only after the refusal, rather than offering two delete buttons
// nobody can tell apart.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router';
import { ADMIN_SETTABLE_STATUSES } from 'shared/speaker';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { toMillis } from '../versionHistory.js';
import { useToast } from '../../contexts/ToastContext.jsx';
import SpeakerPhotoField from '../../components/media/SpeakerPhotoField.jsx';
import SpeakerLogisticsPanel from '../components/SpeakerLogisticsPanel.jsx';
import { useAdminApi } from '../adminApi.js';
import { useAdminSpeakers } from '../useAdminSpeakers.js';
import {
  ActionLabel,
  DestructiveConfirm,
  Panel,
  SelectField,
  FieldError,
  ServerErrorSummary,
  TextAreaField,
  TextField,
  fieldLabelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import { EditorActionFeedback } from '../components/ActionFeedback.jsx';
import AdminPageHeader, {
  AdminEmptyState,
  AdminLoadingState,
  RecordState,
} from '../components/adminChrome.jsx';
import { speakerRecordState, speakerStatusOptions } from '../speakerRecord.js';
import { useUnsavedNavigation } from '../useUnsavedNavigation.js';
import { UnsavedChangesDialog, UnsavedEditBadge } from '../components/UnsavedChanges.jsx';

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'approved', label: 'Published' },
  { value: 'removed', label: 'Removed' },
];

const PIPELINE_STATUS_LABELS = {
  invited: 'Invitation sent',
  accepted: 'Accepted, awaiting approval',
};



const EMPTY = {
  firstName: '',
  lastName: '',
  pronouns: '',
  slug: '',
  email: '',
  bio: '',
  headshotPath: '',
  organization: '',
  jobTitle: '',
  status: 'draft',
};

function editorSnapshot(form) {
  return JSON.stringify(form);
}

function toForm(speaker) {
  if (!speaker) return { ...EMPTY };
  return {
    firstName: speaker.firstName ?? '',
    lastName: speaker.lastName ?? '',
    pronouns: speaker.pronouns ?? '',
    slug: speaker.slug ?? '',
    email: speaker.email ?? '',
    bio: speaker.bio ?? '',
    headshotPath: speaker.headshotPath ?? '',
    organization: speaker.organization ?? '',
    jobTitle: speaker.jobTitle ?? '',
    // The STORED status, verbatim — never coerced to a value this form can
    // set. Coercing `invited` to `draft` and then sending it on every save
    // meant an unrelated bio edit silently reset the invite pipeline: the
    // speaker still held a token, but the record no longer said so.
    status: speaker.status ?? 'draft',
  };
}

/**
 * Empty string clears the optional scalars; the server stores null.
 *
 * `status` is included only when the admin actually picked a new one. A
 * speaker mid-invite has a status this form may not set (the server rejects
 * `invited`/`accepted` by name — they are meaningful only alongside a token
 * it issues), and an editor that echoed a status back on every save would
 * either be rejected or, worse, quietly rewrite the pipeline.
 */
function toPayload(form, { includeStatus, includeHeadshot = true }) {
  const payload = {
    firstName: form.firstName,
    lastName: form.lastName,
    pronouns: form.pronouns,
    slug: form.slug,
    email: form.email.trim() === '' ? null : form.email.trim(),
    bio: form.bio,
    organization: form.organization,
    jobTitle: form.jobTitle,
  };
  // Create does not know the document id yet, so it cannot name a
  // speaker-photos path. The photo is set on the edit screen.
  payload.headshotPath = includeHeadshot && form.headshotPath.trim() !== ''
    ? form.headshotPath.trim()
    : null;
  if (includeStatus) payload.status = form.status;
  return payload;
}

/** A Firestore time as an ISO string, or null. */
function toIsoOrNull(value) {
  const ms = toMillis(value);
  return ms == null ? null : new Date(ms).toISOString();
}

// Where every exit from the editor goes. The editor's route is a sibling of
// the list under the admin layout, so a relative '..' is the admin index,
// not the list.
const SPEAKERS_LIST = '/admin/speakers';

export default function AdminSpeakerEditor({ mode }) {
  const { speakerId } = useParams();
  const navigate = useNavigate();
  const call = useAdminApi();
  const { user } = useAuth();
  const { showToast } = useToast();
  const { speakers, loading, findSpeaker } = useAdminSpeakers();
  const { eventConfig } = useEventConfig();
  const eventTimeZone = eventConfig?.timezone;

  const speaker = mode === 'edit' ? findSpeaker(speakerId) : null;
  const [form, setForm] = useState(() => toForm(null));
  const [savedSnapshot, setSavedSnapshot] = useState(() => (
    mode === 'create' ? editorSnapshot(EMPTY) : null
  ));
  const [error, setError] = useState(null);
  const [errorTitle, setErrorTitle] = useState(undefined);
  const [action, setAction] = useState(null);
  const saving = action !== null;
  const [status, setStatus] = useState('');
  const [deleteBlocked, setDeleteBlocked] = useState(false);
  // Only a deliberate pick sends a status (see toPayload). Creating always
  // sends one — a new record needs a starting state, and the form's default
  // is the one the server would apply anyway.
  const [statusPicked, setStatusPicked] = useState(mode === 'create');
  const [photoBusy, setPhotoBusy] = useState(false);
  const errorRef = useRef(null);
  const formRef = useRef(null);
  // Adopt the live record exactly once, so a listener update does not
  // overwrite what the admin is typing.
  const adoptedRef = useRef(false);
  const unsaved = savedSnapshot !== null && (editorSnapshot(form) !== savedSnapshot || photoBusy);
  const leaveGuard = useUnsavedNavigation(unsaved, { blocked: saving || photoBusy });

  useEffect(() => {
    if (mode !== 'edit' || adoptedRef.current || !speaker) return;
    adoptedRef.current = true;
    const next = toForm(speaker);
    setForm(next);
    setSavedSnapshot(editorSnapshot(next));
  }, [mode, speaker]);

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

  const fieldErrors = useMemo(() => {
    const map = new Map();
    for (const segment of error?.fieldErrors ?? []) {
      if (segment.field && !map.has(segment.field)) map.set(segment.field, segment.message);
    }
    return map;
  }, [error]);
  const errorFor = (field) => fieldErrors.get(field);

  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  async function submit(event) {
    event.preventDefault();
    setAction('draft');
    setError(null);
    setErrorTitle(undefined);
    setStatus('');
    try {
      if (mode === 'create') {
        const response = await call('createSpeaker', {
          speaker: toPayload(form, { includeStatus: true, includeHeadshot: false }),
        });
        showToast('Speaker created.');
        navigate(`/admin/speakers/${encodeURIComponent(response.speakerId)}`, { replace: true });
      } else {
        await call('updateSpeaker', {
          speakerId,
          speaker: toPayload(form, { includeStatus: statusPicked }),
        });
        setSavedSnapshot(editorSnapshot(form));
        setStatus('Saved. The public directory updates within moments.');
      }
    } catch (err) {
      setError(plannerError(err));
    } finally {
      setAction(null);
    }
  }

  async function remove(soft) {
    setAction('delete');
    setError(null);
    setErrorTitle(undefined);
    setStatus('');
    try {
      const response = await call('deleteSpeaker', { speakerId, soft });
      showToast(
        soft
          ? 'Speaker marked removed and hidden everywhere.'
          : `Speaker deleted and unlinked from ${
            response.unlinkedSessions.length + response.unlinkedDrafts.length
          } sessions.`,
      );
      navigate(SPEAKERS_LIST);
    } catch (err) {
      setError(plannerError(err));
      setErrorTitle('The speaker was not deleted');
      // The server refused a full unlink and named the soft delete as the
      // way through; nothing was changed.
      if (err?.code === 'too-many-references') setDeleteBlocked(true);
    } finally {
      setAction(null);
    }
  }

  if (mode === 'edit' && loading) return <AdminLoadingState label="Loading speaker…" />;
  if (mode === 'edit' && !speaker && speakers.length >= 0 && !loading) {
    return (
      <AdminEmptyState
        title="No such speaker"
        description="That speaker may have been deleted. Open the list to choose another."
        action={<Link to={SPEAKERS_LIST} className={secondaryButtonClass}>Back to speakers</Link>}
      />
    );
  }

  return (
    <form ref={formRef} className="flex flex-col gap-md" onSubmit={submit}>
      <AdminPageHeader
        title={
          mode === 'create' ? 'New speaker' : form.firstName || form.lastName
            ? `${form.firstName} ${form.lastName}`.trim()
            : 'Speaker'
        }
        state={(
          <>
            {mode === 'edit' ? <RecordState state={speakerRecordState(speaker)} /> : null}
            {unsaved ? <UnsavedEditBadge /> : null}
          </>
        )}
        identifiers={null}
        description="Manage this speaker’s profile and contact details."
        feedback={status || error ? <EditorActionFeedback unsaved={unsaved} status={status} error={error} errorTitle={errorTitle} /> : null}
        actions={
          <>
            <button type="submit" className={primaryButtonClass} disabled={saving || photoBusy} aria-busy={action === 'draft' || undefined}>
              <ActionLabel busy={action === 'draft'} pending="Saving…">{mode === 'create' ? 'Create' : 'Save'}</ActionLabel>
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

      <div className="admin-editor-layout admin-editor-layout--speaker">
        <Panel
          title="Name"
          description="Identify this speaker and their directory address."
          className="admin-editor-card--identity"
        >
          <div className="flex flex-col gap-sm">
            <TextField
              label="First name"
              value={form.firstName}
              onChange={(value) => set({ firstName: value })}
              error={errorFor('firstName')}
              required
            />
            <TextField
              label="Last name"
              value={form.lastName}
              onChange={(value) => set({ lastName: value })}
              error={errorFor('lastName')}
              required
            />
          </div>
          {mode === 'create' ? <div className="mt-sm">
            <TextField
              label="Page link"
              hint={
                mode === 'edit'
                  ? 'This address stays the same when the name changes.'
                  : 'Leave this blank and the address follows the name. Enter one when that address is already used.'
              }
              value={form.slug}
              onChange={mode === 'edit' ? () => {} : (value) => set({ slug: value })}
              error={errorFor('slug')}
            />
          </div> : null}
        </Panel>

        <Panel
          title="Profile"
          description="Everything here appears on the public speaker directory."
          className="admin-editor-card--primary"
        >
          <div className="mb-sm">
            <TextField
              label="Pronouns"
              hint="Optional. Shown with the name, for example she/her."
              value={form.pronouns}
              onChange={(value) => set({ pronouns: value })}
              maxLength={80}
              error={errorFor('pronouns')}
            />
          </div>
          <div className="planner-fields grid gap-sm sm:grid-cols-2">
            <TextField
              label="Job title"
              value={form.jobTitle}
              onChange={(value) => set({ jobTitle: value })}
              error={errorFor('jobTitle')}
            />
            <TextField
              label="Organization"
              value={form.organization}
              onChange={(value) => set({ organization: value })}
              error={errorFor('organization')}
            />
          </div>
          <div className="mt-sm flex flex-col gap-sm">
            <TextAreaField
              label="Bio"
              rows={5}
              value={form.bio}
              onChange={(value) => set({ bio: value })}
              error={errorFor('bio')}
            />
            {mode === 'edit' ? (
              <div className="flex flex-col gap-3xs">
                <SpeakerPhotoField
                  user={user}
                  speakerId={speakerId}
                  value={form.headshotPath}
                  onChange={(path) => set({ headshotPath: path })}
                  label="Headshot"
                  saveNote="Save to use this photo."
                  appearance="admin"
                  onBusyChange={setPhotoBusy}
                />
                <FieldError message={errorFor('headshotPath')} />
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel
          title="Contact and status"
          description="The email address is used for invitations and is never published."
          className="admin-editor-card--contact"
        >
          <div className="flex flex-col gap-sm">
            <TextField
              label="Email"
              type="email"
              value={form.email}
              onChange={(value) => set({ email: value })}
              error={errorFor('email')}
            />
            {ADMIN_SETTABLE_STATUSES.includes(form.status) ? (
              <SelectField
                label="Status"
                value={form.status}
                onChange={(value) => {
                  setStatusPicked(true);
                  set({ status: value });
                }}
                options={mode === 'edit' && speaker ? speakerStatusOptions(STATUS_OPTIONS, speaker.status ?? null) : STATUS_OPTIONS}
                error={errorFor('status')}
              />
            ) : (
              // A speaker mid-invite is shown, not offered. The pipeline
              // states belong to the invitation flow — they mean nothing
              // without the token it issues — so the editor reports where
              // this speaker stands and leaves the state alone. Editing any
              // other field on this page no longer disturbs it.
              <div className="flex flex-col gap-3xs">
                <span className={fieldLabelClass}>Status</span>
                <p className="text-admin-sm text-admin-ink-secondary">
                  {PIPELINE_STATUS_LABELS[form.status] ?? form.status}
                </p>
              </div>
            )}
          </div>
          {speaker?.uid ? (
            <div className="admin-object-row mt-sm">
              <span className="admin-object-row__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="12" cy="8" r="3" />
                  <path d="M5 20v-2a7 7 0 0 1 14 0v2" />
                </svg>
              </span>
              <div className="admin-object-row__body">
                <h3 className="admin-object-row__title">Linked attendee account</h3>
                <p className="admin-object-row__description">
                  This speaker has an attendee account.
                </p>
              </div>
            </div>
          ) : null}
        </Panel>
        {mode === 'edit' && speaker ? (
          <SpeakerLogisticsPanel speakerId={speaker.id} submittedAt={toIsoOrNull(speaker.profileSubmittedAt)} timeZone={eventTimeZone} />
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-xs">
        <Link to={SPEAKERS_LIST} className={secondaryButtonClass}>
          Cancel
        </Link>
        {mode === 'edit' ? (
          <DestructiveConfirm
            className="ms-auto"
            trigger="Delete this speaker"
            triggerIcon="delete"
            title={`Delete ${form.firstName} ${form.lastName}`.trim()}
            confirmLabel="Delete this speaker"
            busyLabel="Deleting…"
            busy={action === 'delete'}
            disabled={saving}
            consequence="The speaker record goes, and every session that references them is unlinked. Their profile disappears from the public directory."
            permanence="This cannot be undone. To keep the record and only hide it, mark the speaker removed instead."
            onConfirm={() => remove(false)}
          />
        ) : null}
      </div>

      {deleteBlocked ? (
        <Panel title="This speaker could not be deleted">
          <p className="text-admin-base text-admin-ink">
            Nothing was changed. Marking the speaker removed hides them from the
            public directory and every public surface, and leaves the sessions
            that reference them untouched.
          </p>
          <DestructiveConfirm
            className="mt-sm"
            trigger="Mark this speaker removed"
            confirmLabel="Mark this speaker removed"
            busyLabel="Marking…"
            busy={action === 'delete'}
            disabled={saving}
            consequence="The record stays and keeps every field. The speaker disappears from the public directory and from every public surface, and the sessions that reference them are left alone."
            onConfirm={() => remove(true)}
          />
        </Panel>
      ) : null}
    </form>
  );
}
