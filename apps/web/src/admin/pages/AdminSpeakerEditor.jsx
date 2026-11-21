import HelpTooltip from '../components/HelpTooltip.jsx';
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
import SpeakerSessionConfirmations from '../components/SpeakerSessionConfirmations.jsx';
import { useAdminApi } from '../adminApi.js';
import { useAdminSpeakers } from '../useAdminSpeakers.js';
import {
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
import BusyLabel from '../../components/BusyLabel.jsx';

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

/** The profile fields as the server stores them. Empty string clears the optional scalars. */
function profileFields(form, { includeHeadshot = true } = {}) {
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
  return payload;
}

/**
 * An edit sends only the fields this form changed, so a save from an old
 * tab cannot write back a teammate's newer values. The server re-derives
 * the slug on a name change, and the slug stays fixed after create, so a
 * name change carries the stored slug. A status change is its own move: it
 * names the status this form last saw, and the server refuses it when a
 * teammate has changed the status since (issue #1359).
 */
function editPayload(form, savedForm) {
  const fields = profileFields(form);
  const saved = profileFields(savedForm);
  const speaker = Object.fromEntries(Object.entries(fields).filter(([field, value]) => value !== saved[field]));
  delete speaker.slug;
  if ('firstName' in speaker || 'lastName' in speaker) speaker.slug = saved.slug;
  const body = { speaker };
  if (form.status !== savedForm.status) {
    speaker.status = form.status;
    body.expectedStatus = savedForm.status;
  }
  return body;
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
  // `savedForm` is the record as this form last saw it. Fields that differ
  // from it are this form's own edits, and only those are saved.
  const [{ form, savedForm }, setEditor] = useState(() => ({
    form: toForm(null),
    savedForm: mode === 'create' ? toForm(null) : null,
  }));
  const [error, setError] = useState(null);
  const [errorTitle, setErrorTitle] = useState(undefined);
  const [action, setAction] = useState(null);
  const saving = action !== null;
  const [status, setStatus] = useState('');
  const [deleteBlocked, setDeleteBlocked] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const errorRef = useRef(null);
  const formRef = useRef(null);
  // The listener's last values. After the first adoption, a field that
  // changed there moves the baseline, and the form too unless the admin
  // has edited that field.
  const observedRef = useRef(null);
  const unsaved = savedForm !== null && (
    Object.keys(EMPTY).some((field) => form[field] !== savedForm[field]) || photoBusy
  );
  const leaveGuard = useUnsavedNavigation(unsaved, { blocked: saving || photoBusy });

  useEffect(() => {
    if (mode !== 'edit' || !speaker || saving) return;
    const incoming = toForm(speaker);
    const observed = observedRef.current;
    observedRef.current = incoming;
    if (!observed) {
      setEditor({ form: incoming, savedForm: incoming });
      return;
    }
    const changed = Object.keys(incoming).filter((field) => incoming[field] !== observed[field]);
    if (changed.length === 0) return;
    setEditor((current) => {
      const next = { ...current.form };
      const baseline = { ...current.savedForm };
      for (const field of changed) {
        if (next[field] === baseline[field]) next[field] = incoming[field];
        baseline[field] = incoming[field];
      }
      return { form: next, savedForm: baseline };
    });
  }, [mode, speaker, saving]);

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

  const set = (patch) => setEditor((current) => ({ ...current, form: { ...current.form, ...patch } }));

  async function submit(event) {
    event.preventDefault();
    setAction('draft');
    setError(null);
    setErrorTitle(undefined);
    setStatus('');
    try {
      if (mode === 'create') {
        const response = await call('createSpeaker', {
          speaker: { ...profileFields(form, { includeHeadshot: false }), status: form.status },
        });
        showToast('Speaker created.');
        navigate(`/admin/speakers/${encodeURIComponent(response.speakerId)}`, { replace: true });
      } else {
        const body = editPayload(form, savedForm);
        if (Object.keys(body.speaker).length > 0) {
          await call('updateSpeaker', { speakerId, ...body });
        }
        // Only what was sent becomes the baseline. A listener value that
        // arrived during the save stays visible as the stored one.
        const sent = Object.keys(EMPTY).filter((field) => form[field] !== savedForm[field]);
        setEditor((current) => {
          const baseline = { ...current.savedForm };
          for (const field of sent) baseline[field] = form[field];
          return { ...current, savedForm: baseline };
        });
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
      <AdminPageHeader help="Manage this speaker’s profile and contact details."
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
              <BusyLabel busy={action === 'draft'} pending="Saving the speaker…">{mode === 'create' ? 'Create' : 'Save'}</BusyLabel>
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
        <div className="admin-editor-stack">
          <Panel help="Identify this speaker and their directory address."
            title="Name"
            description="Identify this speaker and their directory address."
            className="admin-editor-card--identity"
          >
            <div className="flex flex-col gap-sm">
              <TextField data-help-skip="The label directly names the requested detail; no further explanation needed."
                label="First name"
                value={form.firstName}
                onChange={(value) => set({ firstName: value })}
                error={errorFor('firstName')}
                required
              />
              <TextField data-help-skip="The label directly names the requested detail; no further explanation needed."
                label="Last name"
                value={form.lastName}
                onChange={(value) => set({ lastName: value })}
                error={errorFor('lastName')}
                required
              />
            </div>
            {mode === 'create' ? <div className="mt-sm">
              <TextField help="Set this speaker’s public page address when creating the profile. The address stays fixed after it is saved."
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

          <Panel help="The email address is used for invitations and is never published."
            title="Contact and status"
            description="The email address is used for invitations and is never published."
            className="admin-editor-card--contact"
          >
            <div className="flex flex-col gap-sm">
              <TextField data-help-skip="The label directly names the requested detail; no further explanation needed."
                label="Email"
                type="email"
                value={form.email}
                onChange={(value) => set({ email: value })}
                error={errorFor('email')}
              />
              {ADMIN_SETTABLE_STATUSES.includes(form.status) ? (
                <SelectField help="Set the speaker’s invitation and approval stage. Publishing is a separate step."
                  label="Status"
                  value={form.status}
                  onChange={(value) => {
                    set({ status: value });
                  }}
                  options={mode === 'edit' && speaker ? speakerStatusOptions(STATUS_OPTIONS, savedForm?.status ?? null) : STATUS_OPTIONS}
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
                  <div className="flex items-center gap-2xs"><h3 className="admin-object-row__title">Linked attendee account</h3><HelpTooltip label="Linked attendee account">Check which signed-in attendee account is connected to this speaker.</HelpTooltip></div>
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
        <div className="admin-editor-stack">
          <Panel help="Everything here appears on the public speaker directory."
            title="Profile"
            description="Everything here appears on the public speaker directory."
            className="admin-editor-card--primary"
          >
            <div className="mb-sm">
              <TextField help="Optional. Shown with the name, for example she/her."
                label="Pronouns"

                value={form.pronouns}
                onChange={(value) => set({ pronouns: value })}
                maxLength={80}
                error={errorFor('pronouns')}
              />
            </div>
            <div className="planner-fields grid gap-sm sm:grid-cols-2">
              <TextField data-help-skip="The label directly names the requested detail; no further explanation needed."
                label="Job title"
                value={form.jobTitle}
                onChange={(value) => set({ jobTitle: value })}
                error={errorFor('jobTitle')}
              />
              <TextField data-help-skip="The label directly names the requested detail; no further explanation needed."
                label="Organization"
                value={form.organization}
                onChange={(value) => set({ organization: value })}
                error={errorFor('organization')}
              />
            </div>
            <div className="mt-sm flex flex-col gap-sm">
              <TextAreaField help="Write the introduction attendees see in the speaker directory."
                label="Bio"
                rows={5}
                value={form.bio}
                onChange={(value) => set({ bio: value })}
                error={errorFor('bio')}
              />
              {mode === 'edit' ? (
                <div className="flex flex-col gap-3xs">
                  <SpeakerPhotoField data-help-skip="Headshot names the expected picture; existing format, size and save guidance remains."
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

          {mode === 'edit' && speaker ? (
            <SpeakerSessionConfirmations speakerId={speaker.id} call={call} disabled={saving} />
          ) : null}
        </div>
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
            consequence="The speaker record goes, and every session that references them is unlinked. Their profile disappears from the public directory. Their invitation records are also deleted."
            permanence="This cannot be undone. To keep the record and only hide it, mark the speaker removed instead."
            onConfirm={() => remove(false)}
          />
        ) : null}
      </div>

      {deleteBlocked ? (
        <Panel help="Review why the deletion failed before trying again." title="This speaker could not be deleted">
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
