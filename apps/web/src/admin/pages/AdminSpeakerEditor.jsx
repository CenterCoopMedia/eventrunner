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
import { useNavigate, useParams } from 'react-router-dom';
import { ADMIN_SETTABLE_STATUSES } from 'shared/speaker';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAdminApi } from '../adminApi.js';
import { useAdminSpeakers } from '../useAdminSpeakers.js';
import {
  DestructiveConfirm,
  Panel,
  SaveStatus,
  SelectField,
  ServerErrorSummary,
  TextAreaField,
  TextField,
  fieldLabelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import AdminPageHeader, {
  AdminEmptyState,
  AdminLoadingState,
  RecordState,
} from '../components/adminChrome.jsx';
import { deadMatter, state as recordStateWord } from '../recordState.js';

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft — hidden from the public site' },
  { value: 'approved', label: 'Live — visible in the public directory' },
  { value: 'removed', label: 'Removed — hidden everywhere, record kept' },
];

const PIPELINE_STATUS_LABELS = {
  invited: 'Invite sent — waiting for this speaker to accept',
  accepted: 'Accepted — waiting for approval',
};

/**
 * Field names queued in `speaker.pendingEdits` (spec §4.3, issue #22 review
 * finding P1-1) — an approved speaker's self-service edit that
 * onSpeakerWritten deliberately did NOT publish, awaiting an admin's
 * apply/discard decision. Mirrors AdminSpeakersList's helper of the same
 * name; that list owns the apply/discard controls, this editor only needs
 * to know whether any are queued for the job-line state word.
 */
function pendingFieldsOf(speaker) {
  const pending = speaker?.pendingEdits;
  return pending && typeof pending === 'object' ? Object.keys(pending) : [];
}

/**
 * The speaker's record state, in the admin's three words (brief §5.2,
 * moment 1). A speaker is on the public site only once approved, and an
 * approved speaker with self-service edits waiting for review is exactly
 * the third state. A removed speaker is dead matter: it keeps its word.
 */
function speakerRecordState(speaker) {
  if (!speaker) return null;
  if (speaker.status === 'removed') return deadMatter('Removed');
  if (speaker.status !== 'approved') return recordStateWord('draft');
  return pendingFieldsOf(speaker).length > 0 ? recordStateWord('dirty') : recordStateWord('live');
}

const EMPTY = {
  firstName: '',
  lastName: '',
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
function toPayload(form, { includeStatus }) {
  const payload = {
    firstName: form.firstName,
    lastName: form.lastName,
    slug: form.slug,
    email: form.email.trim() === '' ? null : form.email.trim(),
    bio: form.bio,
    headshotPath: form.headshotPath.trim() === '' ? null : form.headshotPath.trim(),
    organization: form.organization,
    jobTitle: form.jobTitle,
  };
  if (includeStatus) payload.status = form.status;
  return payload;
}

export default function AdminSpeakerEditor({ mode }) {
  const { speakerId } = useParams();
  const navigate = useNavigate();
  const call = useAdminApi();
  const { showToast } = useToast();
  const { speakers, loading, findSpeaker } = useAdminSpeakers();

  const speaker = mode === 'edit' ? findSpeaker(speakerId) : null;
  const [form, setForm] = useState(() => toForm(null));
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [deleteBlocked, setDeleteBlocked] = useState(false);
  // Only a deliberate pick sends a status (see toPayload). Creating always
  // sends one — a new record needs a starting state, and the form's default
  // is the one the server would apply anyway.
  const [statusPicked, setStatusPicked] = useState(mode === 'create');
  const errorRef = useRef(null);
  // Adopt the live record exactly once, so a listener update does not
  // overwrite what the admin is typing.
  const adoptedRef = useRef(false);

  useEffect(() => {
    if (mode !== 'edit' || adoptedRef.current || !speaker) return;
    adoptedRef.current = true;
    setForm(toForm(speaker));
  }, [mode, speaker]);

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
  const errorFor = (field) => fieldErrors.get(field);

  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setStatus('');
    try {
      if (mode === 'create') {
        const response = await call('createSpeaker', {
          speaker: toPayload(form, { includeStatus: true }),
        });
        showToast('Speaker created.');
        navigate(`../${response.speakerId}`, { replace: true });
      } else {
        await call('updateSpeaker', {
          speakerId,
          speaker: toPayload(form, { includeStatus: statusPicked }),
        });
        setStatus('Saved. The public directory updates within moments.');
        showToast('Speaker saved.');
      }
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  async function remove(soft) {
    setSaving(true);
    setError(null);
    setStatus('');
    try {
      const response = await call('deleteSpeaker', { speakerId, soft });
      showToast(
        soft
          ? 'Speaker marked removed and hidden everywhere.'
          : `Speaker deleted and unlinked from ${
            response.unlinkedSessions.length + response.unlinkedDrafts.length
          } session document(s).`,
      );
      navigate('..');
    } catch (err) {
      setError(err);
      // The server refused a full unlink and named the soft delete as the
      // way through; nothing was changed.
      if (err?.code === 'too-many-references') setDeleteBlocked(true);
    } finally {
      setSaving(false);
    }
  }

  if (mode === 'edit' && loading) return <AdminLoadingState label="Loading speaker…" />;
  if (mode === 'edit' && !speaker && speakers.length >= 0 && !loading) {
    return (
      <AdminEmptyState
        title="No such speaker"
        description="That speaker record does not exist. It may have been deleted."
      />
    );
  }

  return (
    <form className="flex flex-col gap-md" onSubmit={submit}>
      <AdminPageHeader
        title={
          mode === 'create' ? 'New speaker' : form.firstName || form.lastName
            ? `${form.firstName} ${form.lastName}`.trim()
            : speakerId
        }
        state={mode === 'edit' ? <RecordState state={speakerRecordState(speaker)} /> : null}
        identifiers={mode === 'edit' ? speakerId : null}
        description="This is the one record for this person. Sessions point at it by id, and the public directory shows a published copy of the safe fields."
      />

      <ServerErrorSummary error={error} errorRef={errorRef} />
      {status ? <SaveStatus message={status} /> : null}

      <Panel title="Name">
        <div className="grid gap-sm sm:grid-cols-2">
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
        <div className="mt-sm">
          <TextField
            label="URL slug"
            hint="Leave blank to derive it from the name. Lowercase letters, digits, and hyphens."
            value={form.slug}
            onChange={(value) => set({ slug: value })}
            error={errorFor('slug')}
          />
        </div>
      </Panel>

      <Panel title="Profile" description="Everything here appears on the public speaker directory.">
        <div className="grid gap-sm sm:grid-cols-2">
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
          <TextField
            label="Headshot path"
            hint="A path in this deployment's Storage bucket, e.g. speakers/name.jpg."
            value={form.headshotPath}
            onChange={(value) => set({ headshotPath: value })}
            error={errorFor('headshotPath')}
          />
        </div>
      </Panel>

      <Panel
        title="Contact and status"
        description="The email address is used for invitations and is never published."
      >
        <div className="grid gap-sm sm:grid-cols-2">
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
              options={STATUS_OPTIONS}
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
              <p className="text-caption text-admin-ink-secondary">
                {PIPELINE_STATUS_LABELS[form.status] ?? form.status}
              </p>
              <p className="text-caption text-admin-ink-secondary">
                Managed by the invitation flow. Saving this form leaves it unchanged.
              </p>
            </div>
          )}
        </div>
        {speaker?.uid ? (
          <p className="mt-sm text-caption text-admin-ink-secondary">
            This speaker is linked to an attendee account. The link is managed
            by the invitation flow and cannot be edited here.
          </p>
        ) : null}
      </Panel>

      <div className="flex flex-wrap items-center gap-xs">
        <button type="submit" className={primaryButtonClass} disabled={saving}>
          {saving ? 'Saving…' : mode === 'create' ? 'Create speaker' : 'Save speaker'}
        </button>
        <button type="button" className={secondaryButtonClass} onClick={() => navigate('..')}>
          Cancel
        </button>
        {mode === 'edit' ? (
          <DestructiveConfirm
            className="ms-auto"
            trigger="Delete this speaker"
            title={`Delete ${form.firstName} ${form.lastName}`.trim()}
            confirmLabel="Delete this speaker"
            busyLabel="Deleting…"
            busy={saving}
            consequence="The speaker record goes, and every session that references them is unlinked. Their profile disappears from the public directory."
            permanence="This cannot be undone. To keep the record and only hide it, mark the speaker removed instead."
            onConfirm={() => remove(false)}
          />
        ) : null}
      </div>

      {deleteBlocked ? (
        <Panel title="Delete could not remove every reference">
          <p className="max-w-[65ch] text-caption text-admin-ink">
            Nothing was changed. Marking the speaker removed hides them from the
            public directory and every public surface, and leaves the sessions
            that reference them untouched.
          </p>
          <DestructiveConfirm
            className="mt-sm"
            trigger="Mark this speaker removed"
            confirmLabel="Mark this speaker removed"
            busyLabel="Marking…"
            busy={saving}
            consequence="The record stays and keeps every field. The speaker disappears from the public directory and from every public surface, and the sessions that reference them are left alone."
            onConfirm={() => remove(true)}
          />
        </Panel>
      ) : null}
    </form>
  );
}
