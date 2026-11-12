import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ANNOUNCEMENT_LEVELS, announcementTimeMs } from 'shared/announcement';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAdminApi } from '../adminApi.js';
import { communicationsError } from '../components/communicationsErrors.js';
import AdminIconControl from '../components/AdminIconControl.jsx';
import { subscribeAdminCollection } from '../adminSource.js';
import {
  DestructiveConfirm,
  Notice,
  Panel,
  SelectField,
  ServerErrorSummary,
  TextAreaField,
  TextField,
  ghostButtonClass,
  linkButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import AdminPageHeader, {
  AdminEmptyState,
  AdminLoadingState,
  StatusBadge,
} from '../components/adminChrome.jsx';
import AnnouncementEmailComposer from '../components/AnnouncementEmailComposer.jsx';
import '../communicationsWorkspace.css';

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

function formatAnnouncementWhen(value) {
  const millis = announcementTimeMs(value);
  return millis === null ? 'Date not set' : new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(millis));
}

function stateOf(row, nowMs = Date.now()) {
  const startsAt = announcementTimeMs(row.startsAt);
  const endsAt = announcementTimeMs(row.endsAt);
  if (startsAt === null || endsAt === null) return 'Check dates';
  if (nowMs < startsAt) return 'Scheduled';
  if (nowMs >= endsAt) return 'Ended';
  return 'Active';
}

export default function AdminAnnouncements() {
  const call = useAdminApi();
  const { showToast } = useToast();
  const [rows, setRows] = useState(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [listError, setListError] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [channel, setChannel] = useState('banners');
  const channelRefs = useRef({});
  const formRef = useRef(null);

  function focusMessage() { formRef.current?.querySelector('textarea')?.focus(); }

  function changeChannelWithKeyboard(event) {
    const channels = ['banners', 'email'];
    const current = channels.indexOf(channel);
    let next;
    if (event.key === 'ArrowRight') next = channels[(current + 1) % channels.length];
    if (event.key === 'ArrowLeft') next = channels[(current + channels.length - 1) % channels.length];
    if (event.key === 'Home') next = channels[0];
    if (event.key === 'End') next = channels[channels.length - 1];
    if (!next) return;
    event.preventDefault();
    setChannel(next);
    channelRefs.current[next]?.focus();
  }

  useEffect(() => subscribeAdminCollection(
    'announcements',
    (docs) => { setRows(docs); setListError(null); },
    setListError,
  ), []);

  useEffect(() => {
    const nextBoundary = (rows ?? [])
      .flatMap((row) => [announcementTimeMs(row.startsAt), announcementTimeMs(row.endsAt)])
      .filter((value) => value !== null && value > nowMs)
      .sort((a, b) => a - b)[0];
    if (nextBoundary === undefined) return undefined;
    const timeout = setTimeout(
      () => setNowMs(Date.now()),
      Math.min(Math.max(nextBoundary - Date.now(), 1), 2_147_483_647),
    );
    return () => clearTimeout(timeout);
  }, [nowMs, rows]);

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
    requestAnimationFrame(focusMessage);
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
      showToast(communicationsError(err, 'The announcement could not be removed. Try again.'), { tone: 'error' });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="admin-communications flex flex-col gap-md">
      <AdminPageHeader help="Choose a site banner or an email to your attendees."
        title="Announcements"
        description="Choose a site banner or an email to your attendees."
        actions={<Link to="/admin/email-log" className={linkButtonClass}>Open email log</Link>}
      />

      <div className="admin-communications__channels" role="tablist" aria-label="Announcement type" onKeyDown={changeChannelWithKeyboard}>
        {[['banners', 'Site banners'], ['email', 'Email']].map(([value, label]) => (
          <button
            key={value}
            ref={(node) => { channelRefs.current[value] = node; }}
            type="button"
            role="tab"
            id={`announcement-channel-${value}`}
            aria-controls={`announcement-panel-${value}`}
            aria-selected={channel === value}
            tabIndex={channel === value ? 0 : -1}
            className="admin-communications__channel"
            onClick={() => setChannel(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Keep both panels mounted so changing channels preserves drafts and email review state. */}
      <div
        id="announcement-panel-banners"
        role="tabpanel"
        aria-labelledby="announcement-channel-banners"
        className="admin-communications__panel flex flex-col gap-md"
        hidden={channel !== 'banners'}
      >
        <Panel help="Banners appear on your site between the start and end times. A banner that starts now appears as soon as you save."
          title={editingId ? 'Edit announcement' : 'Create an announcement'}
          description="Banners appear on your site between the start and end times. A banner that starts now appears as soon as you save."
        >
          <form ref={formRef} className="flex flex-col gap-sm" onSubmit={submit}>
            <ServerErrorSummary error={error ? { message: communicationsError(error, "The announcement could not be saved. Check the message and dates, then try again.") } : null} />
            <TextAreaField help="Write the short announcement attendees should see in the site banner."
              label="Message"
              value={form.message}
              maxLength={500}
              required
              onChange={(message) => setForm((current) => ({ ...current, message }))}
            />
            <SelectField help="Choose how prominently this banner should appear on the site."
              label="Priority"
              value={form.level}
              options={[{ value: 'info', label: 'Notice' }, { value: 'urgent', label: 'Urgent' }]}
              onChange={(level) => setForm((current) => ({ ...current, level }))}
            />
            <div className="grid gap-sm md:grid-cols-2">
              <TextField help="Choose when this banner starts appearing on the event’s local clock."
                label="Starts"
                type="datetime-local"
                value={form.startsAt}
                required
                onChange={(startsAt) => setForm((current) => ({ ...current, startsAt }))}
              />
              <TextField help="Choose when this banner stops appearing on the event’s local clock."
                label="Ends"
                type="datetime-local"
                value={form.endsAt}
                required
                onChange={(endsAt) => setForm((current) => ({ ...current, endsAt }))}
              />
            </div>
            <div className="grid gap-sm md:grid-cols-2">
              <TextField help="Add the page attendees should visit from this banner. Leave empty for no link."
                label="Link (optional)"
                type="url"
                value={form.linkUrl}
                placeholder="https://example.org/details"
                onChange={(linkUrl) => setForm((current) => ({ ...current, linkUrl }))}
              />
              <TextField help="Use a short phrase that tells attendees where the banner link goes."
                label="Link text (optional)"
                value={form.linkLabel}
                maxLength={80}
                onChange={(linkLabel) => setForm((current) => ({ ...current, linkLabel }))}
              />
            </div>
            <div className="flex flex-wrap gap-xs">
              <button type="submit" className={primaryButtonClass} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              {editingId ? (
                <button type="button" className={secondaryButtonClass} onClick={cancelEdit}>Cancel</button>
              ) : null}
            </div>
          </form>
        </Panel>

        {listError ? <Notice tone="caution" message="Announcements could not be updated. Check your connection; the list will retry." /> : null}
        {rows === null ? (
          <AdminLoadingState label="Loading announcements…" />
        ) : ordered.length === 0 ? (
          <AdminEmptyState title="No announcements yet" description="Add a banner to share news with attendees." action={<button type="button" className={secondaryButtonClass} onClick={focusMessage}>Add banner</button>} />
        ) : (
          <Panel flush>
            <ul>
              {ordered.map((row) => (
                <li key={row.id} className="border-admin-rule-hairline border-b-admin-hairline last:border-b-0">
                  <div className="flex flex-wrap items-start justify-between gap-sm px-md py-sm">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-sm gap-y-2xs">
                        <StatusBadge tone={stateOf(row, nowMs) === 'Active' ? 'ok' : 'info'}>{stateOf(row, nowMs)}</StatusBadge>
                        <span className="font-admin-data text-admin-xs text-admin-ink-secondary">
                          {formatAnnouncementWhen(row.startsAt)} – {formatAnnouncementWhen(row.endsAt)}
                        </span>
                      </div>
                      <p className="mt-3xs text-admin-base text-admin-ink">{row.message}</p>
                    </div>
                    <div className="flex shrink-0 gap-xs">
                      <AdminIconControl className={ghostButtonClass} onClick={() => startEdit(row)} label="Edit" icon="edit" />
                      <DestructiveConfirm
                        trigger="Remove"
                        triggerIcon="remove"
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

      <div
        id="announcement-panel-email"
        role="tabpanel"
        aria-labelledby="announcement-channel-email"
        className="admin-communications__panel"
        hidden={channel !== 'email'}
      >
        <AnnouncementEmailComposer />
      </div>
    </div>
  );
}
