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
import EmptyState from '../../components/EmptyState.jsx';
import LoadingState from '../../components/LoadingState.jsx';
import { useAdminApi } from '../adminApi.js';
import { useAdminSpeakers } from '../useAdminSpeakers.js';
import {
  Panel,
  SaveStatus,
  SelectField,
  ServerErrorSummary,
  TextAreaField,
  TextField,
  dangerButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Not invited — hidden from the public site' },
  { value: 'approved', label: 'Published — visible in the public directory' },
  { value: 'removed', label: 'Removed — hidden everywhere, record kept' },
];

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
    // A speaker mid-invite carries a status this form may not set; showing
    // it as-is and letting the select fall back keeps the form honest
    // rather than silently proposing to reset the pipeline.
    status: ADMIN_SETTABLE_STATUSES.includes(speaker.status) ? speaker.status : 'draft',
  };
}

/** Empty string clears the optional scalars; the server stores null. */
function toPayload(form) {
  return {
    firstName: form.firstName,
    lastName: form.lastName,
    slug: form.slug,
    email: form.email.trim() === '' ? null : form.email.trim(),
    bio: form.bio,
    headshotPath: form.headshotPath.trim() === '' ? null : form.headshotPath.trim(),
    organization: form.organization,
    jobTitle: form.jobTitle,
    status: form.status,
  };
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
        const response = await call('createSpeaker', { speaker: toPayload(form) });
        showToast('Speaker created.');
        navigate(`../${response.speakerId}`, { replace: true });
      } else {
        await call('updateSpeaker', { speakerId, speaker: toPayload(form) });
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

  if (mode === 'edit' && loading) return <LoadingState label="Loading speaker…" />;
  if (mode === 'edit' && !speaker && speakers.length >= 0 && !loading) {
    return (
      <EmptyState
        title="No such speaker"
        description="That speaker record does not exist. It may have been deleted."
      />
    );
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={submit}>
      <div>
        <h1 className="font-heading text-2xl font-semibold text-brand-ink">
          {mode === 'create' ? 'New speaker' : form.firstName || form.lastName
            ? `${form.firstName} ${form.lastName}`.trim()
            : speakerId}
        </h1>
        <p className="text-sm text-brand-ink-muted">
          This is the one record for this person. Sessions point at it by id,
          and the public directory shows a published copy of the safe fields.
        </p>
      </div>

      <ServerErrorSummary error={error} errorRef={errorRef} />
      {status ? <SaveStatus message={status} /> : null}

      <Panel title="Name">
        <div className="grid gap-3 sm:grid-cols-2">
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
        <div className="mt-3">
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
        <div className="grid gap-3 sm:grid-cols-2">
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
        <div className="mt-3 flex flex-col gap-3">
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
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Email"
            type="email"
            value={form.email}
            onChange={(value) => set({ email: value })}
            error={errorFor('email')}
          />
          <SelectField
            label="Status"
            value={form.status}
            onChange={(value) => set({ status: value })}
            options={STATUS_OPTIONS}
            error={errorFor('status')}
          />
        </div>
        {speaker?.uid ? (
          <p className="mt-3 text-sm text-brand-ink-muted">
            This speaker is linked to an attendee account. The link is managed
            by the invitation flow and cannot be edited here.
          </p>
        ) : null}
      </Panel>

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className={primaryButtonClass} disabled={saving}>
          {saving ? 'Saving…' : mode === 'create' ? 'Create speaker' : 'Save speaker'}
        </button>
        <button type="button" className={secondaryButtonClass} onClick={() => navigate('..')}>
          Cancel
        </button>
        {mode === 'edit' ? (
          <button
            type="button"
            className={`${dangerButtonClass} ms-auto`}
            disabled={saving}
            onClick={() => remove(false)}
          >
            Delete speaker
          </button>
        ) : null}
      </div>

      {deleteBlocked ? (
        <Panel title="Delete could not remove every reference">
          <p className="text-sm text-brand-ink-muted">
            Nothing was changed. Marking the speaker removed hides them from the
            public directory and every public surface, and leaves the sessions
            that reference them untouched.
          </p>
          <button
            type="button"
            className={`${dangerButtonClass} mt-3`}
            disabled={saving}
            onClick={() => remove(true)}
          >
            Mark removed instead
          </button>
        </Panel>
      ) : null}
    </form>
  );
}
