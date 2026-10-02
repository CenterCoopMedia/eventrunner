import { useEffect, useMemo, useState } from 'react';
import { ANNOUNCEMENT_LEVELS, announcementTimeMs } from 'shared/announcement';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAdminApi } from '../adminApi.js';
import { subscribeAdminCollection } from '../adminSource.js';
import {
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
import AdminPageHeader, {
  AdminEmptyState,
  AdminLoadingState,
  StatusBadge,
} from '../components/adminChrome.jsx';

const EMPTY_FORM = {
  message: '', level: 'info', startsAt: '', endsAt: '', linkUrl: '', linkLabel: '',
};

function localInputValue(value) {
  const millis = announcementTimeMs(value);
  if (millis === null) return '';
  const date = new Date(millis);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function isoValue(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : value;
}

function stateOf(row, nowMs = Date.now()) {
  const startsAt = announcementTimeMs(row.startsAt);
  const endsAt = announcementTimeMs(row.endsAt);
  if (startsAt === null || endsAt === null) return 'Invalid window';
  if (nowMs < startsAt) return 'Scheduled';
  if (nowMs >= endsAt) return 'Ended';
  return 'Active';
}

export default function AdminAnnouncements() {
  const call = useAdminApi();
  const { showToast } = useToast();
  const [rows, setRows] = useState(null);
  const [listError, setListError] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => subscribeAdminCollection(
    'announcements',
    (docs) => { setRows(docs); setListError(null); },
    setListError,
  ), []);

  const ordered = useMemo(() => [...(rows ?? [])].sort(
    (a, b) => (announcementTimeMs(b.startsAt) ?? 0) - (announcementTimeMs(a.startsAt) ?? 0),
  ), [rows]);

  function startEdit(row) {
    setEditingId(row.id);
    setForm({
      message: row.message ?? '',
      level: ANNOUNCEMENT_LEVELS.includes(row.level) ? row.level : 'info',
      startsAt: localInputValue(row.startsAt),
      endsAt: localInputValue(row.endsAt),
      linkUrl: row.link?.url ?? '',
      linkLabel: row.link?.label ?? '',
    });
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError(null);
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const hasLink = form.linkUrl.trim() !== '' || form.linkLabel.trim() !== '';
      await call('saveAnnouncement', {
        ...(editingId ? { id: editingId } : {}),
        announcement: {
          message: form.message,
          level: form.level,
          startsAt: isoValue(form.startsAt),
          endsAt: isoValue(form.endsAt),
          link: hasLink ? { url: form.linkUrl, label: form.linkLabel } : null,
        },
      });
      showToast(editingId ? 'Announcement saved.' : 'Announcement created.');
      cancelEdit();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    setDeletingId(id);
    try {
      await call('deleteAnnouncement', { id });
      showToast('Announcement removed.');
      if (editingId === id) cancelEdit();
    } catch (err) {
      showToast(err.message, { tone: 'error' });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-md">
      <AdminPageHeader
        title="Announcements"
        description="Site-wide messages shown during their active window. Saving here is live immediately."
        identifiers={rows ? `${ordered.length} announcement${ordered.length === 1 ? '' : 's'}` : null}
      />

      <Panel title={editingId ? 'Edit announcement' : 'Create an announcement'}>
        <form className="flex flex-col gap-sm" onSubmit={submit}>
          <ServerErrorSummary error={error} />
          <TextAreaField
            label="Message"
            value={form.message}
            maxLength={500}
            required
            onChange={(message) => setForm((current) => ({ ...current, message }))}
          />
          <SelectField
            label="Level"
            value={form.level}
            options={[{ value: 'info', label: 'Notice' }, { value: 'urgent', label: 'Urgent' }]}
            onChange={(level) => setForm((current) => ({ ...current, level }))}
          />
          <div className="grid gap-sm md:grid-cols-2">
            <TextField
              label="Starts"
              type="datetime-local"
              value={form.startsAt}
              required
              onChange={(startsAt) => setForm((current) => ({ ...current, startsAt }))}
            />
            <TextField
              label="Ends"
              type="datetime-local"
              value={form.endsAt}
              required
              onChange={(endsAt) => setForm((current) => ({ ...current, endsAt }))}
            />
          </div>
          <div className="grid gap-sm md:grid-cols-2">
            <TextField
              label="Link URL (optional)"
              type="url"
              value={form.linkUrl}
              placeholder="https://example.org/details"
              onChange={(linkUrl) => setForm((current) => ({ ...current, linkUrl }))}
            />
            <TextField
              label="Link label (optional)"
              value={form.linkLabel}
              maxLength={80}
              onChange={(linkLabel) => setForm((current) => ({ ...current, linkLabel }))}
            />
          </div>
          <div className="flex flex-wrap gap-xs">
            <button type="submit" className={primaryButtonClass} disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create announcement'}
            </button>
            {editingId ? (
              <button type="button" className={secondaryButtonClass} onClick={cancelEdit}>Cancel</button>
            ) : null}
          </div>
        </form>
      </Panel>

      {listError ? <Notice tone="caution" message="We lost the announcement list connection. We will retry." /> : null}
      {rows === null ? (
        <AdminLoadingState label="Loading announcements…" />
      ) : ordered.length === 0 ? (
        <AdminEmptyState title="No announcements yet" description="Create one using the form above." />
      ) : (
        <Panel flush>
          <ul>
            {ordered.map((row) => (
              <li key={row.id} className="border-admin-rule-hairline border-b-admin-hairline last:border-b-0">
                <div className="flex flex-wrap items-start justify-between gap-sm px-md py-sm">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-sm gap-y-2xs">
                      <StatusBadge tone={stateOf(row) === 'Active' ? 'ok' : 'info'}>{stateOf(row)}</StatusBadge>
                      <span className="font-admin-data text-admin-xs text-admin-ink-secondary">
                        {localInputValue(row.startsAt).replace('T', ' ')}–{localInputValue(row.endsAt).replace('T', ' ')}
                      </span>
                    </div>
                    <p className="mt-3xs text-admin-base text-admin-ink">{row.message}</p>
                  </div>
                  <div className="flex shrink-0 gap-xs">
                    <button type="button" className={linkButtonClass} onClick={() => startEdit(row)}>Edit</button>
                    <DestructiveConfirm
                      trigger="Remove"
                      title="Remove this announcement"
                      confirmLabel="Remove this announcement"
                      busyLabel="Removing…"
                      busy={deletingId === row.id}
                      disabled={deletingId === row.id}
                      consequence="The announcement disappears from the public site."
                      permanence="This cannot be undone."
                      onConfirm={() => remove(row.id)}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
