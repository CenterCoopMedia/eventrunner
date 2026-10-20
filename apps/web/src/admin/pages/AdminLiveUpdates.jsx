// Live updates admin form (issue #28, spec §9 "Live updates card") — compose,
// edit, and delete entries in the `live_updates` feed. Wired to
// saveLiveUpdate/deleteLiveUpdate; no draft/publish step, unlike the CMS
// tabs — a save here is live immediately (spec: admin-form authored, no
// Slack ingestion, no two-revision model).
//
// Issue #200: each entry has a category (optional, one short line) and an
// audience. The audience is enforced by firestore.rules, not by the card,
// so the field says who can read the entry, not who sees it first. A row
// saved before the audience field existed has none, and the rules show it
// to admins only: the list names it, and saving it again gives it one.
import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { useAdminApi } from '../adminApi.js';
import { subscribeAdminCollection } from '../adminSource.js';
import {
  Notice,
  Panel,
  CheckboxField,
  ServerErrorSummary,
  SelectField,
  TextAreaField,
  TextField,
  DestructiveConfirm,
  linkButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import AdminPageHeader, {
  AdminEmptyState,
  AdminLoadingState,
  StatusBadge,
} from '../components/adminChrome.jsx';
import { UPDATE_CATEGORY_MAX } from 'shared/update';

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

const EMPTY_FORM = { message: '', pinned: false, category: '', audience: 'everyone' };

/** The audience choices, widest first, and the badge word each row shows. */
const AUDIENCE_OPTIONS = [
  { value: 'everyone', label: 'Everyone, signed in or not' },
  { value: 'attendees', label: 'Approved attendees and speakers' },
  { value: 'speakers', label: 'Speakers only' },
];
const AUDIENCE_BADGE = { everyone: 'For everyone', attendees: 'For attendees', speakers: 'For speakers' };

function audienceBadge(audience) {
  return Object.hasOwn(AUDIENCE_BADGE, audience ?? '') ? AUDIENCE_BADGE[audience] : null;
}

export default function AdminLiveUpdates() {
  const { features } = useEventConfig();
  const call = useAdminApi();
  const { showToast } = useToast();

  const [rows, setRows] = useState(null);
  const [listError, setListError] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    return subscribeAdminCollection(
      'live_updates',
      (docs) => { setRows(docs); setListError(null); },
      setListError,
    );
  }, []);

  const ordered = useMemo(() => {
    if (!rows) return [];
    return [...rows].sort((a, b) => {
      const at = toDate(a.postedAt)?.getTime() ?? 0;
      const bt = toDate(b.postedAt)?.getTime() ?? 0;
      return bt - at;
    });
  }, [rows]);

  const withoutAudience = ordered.filter((row) => !audienceBadge(row.audience)).length;

  function startEdit(row) {
    setEditingId(row.id);
    setForm({
      message: row.message ?? '',
      pinned: row.pinned === true,
      category: typeof row.category === 'string' ? row.category : '',
      // A row with no audience (saved before #200) opens on Everyone, what
      // it meant when it was written; the save stores that choice.
      audience: audienceBadge(row.audience) ? row.audience : 'everyone',
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
      await call('saveLiveUpdate', {
        ...(editingId ? { id: editingId } : {}),
        update: {
          message: form.message,
          pinned: form.pinned,
          category: form.category.trim() ? form.category.trim() : null,
          audience: form.audience,
        },
      });
      showToast(editingId ? 'Live update saved.' : 'Live update posted.');
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
      await call('deleteLiveUpdate', { id });
      showToast('Live update removed.');
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
        title="Live updates"
        description="Short posts shown on the live updates card. No approval step — posting here is live immediately."
        identifiers={rows ? `${ordered.length} update${ordered.length === 1 ? '' : 's'}` : null}
      />

      {features?.liveUpdates ? null : (
        <Notice
          tone="caution"
          message="The live updates feature is currently off, so this feed is not shown to visitors. Turn it on under Features."
        />
      )}

      {withoutAudience > 0 ? (
        <Notice
          tone="caution"
          message={`${withoutAudience === 1 ? '1 update has' : `${withoutAudience} updates have`} no audience, so only admins can read ${withoutAudience === 1 ? 'it' : 'them'}. Edit and save each one to choose who can read it.`}
        />
      ) : null}

      <Panel title={editingId ? 'Edit update' : 'Post an update'}>
        <form className="flex flex-col gap-sm" onSubmit={submit}>
          <ServerErrorSummary error={error} />
          <TextAreaField
            label="Message"
            value={form.message}
            onChange={(value) => setForm((f) => ({ ...f, message: value }))}
            rows={3}
          />
          <TextField
            label="Category"
            hint="One or two words shown as a tag beside the update. Leave it empty for none."
            value={form.category}
            onChange={(value) => setForm((f) => ({ ...f, category: value }))}
            maxLength={UPDATE_CATEGORY_MAX}
          />
          <SelectField
            label="Who can read it"
            hint="The database enforces this. A reader outside the audience cannot load the update, not only cannot see it."
            value={form.audience}
            onChange={(value) => setForm((f) => ({ ...f, audience: value }))}
            options={AUDIENCE_OPTIONS}
          />
          <CheckboxField
            label="Pinned"
            hint="Pinned entries show first, above newer unpinned entries."
            checked={form.pinned}
            onChange={(checked) => setForm((f) => ({ ...f, pinned: checked }))}
          />
          <div className="flex flex-wrap gap-xs">
            <button type="submit" className={primaryButtonClass} disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Post update'}
            </button>
            {editingId ? (
              <button type="button" className={secondaryButtonClass} onClick={cancelEdit}>
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      </Panel>

      {listError ? (
        <Notice
          tone="caution"
          message="We lost the connection to the live updates list; showing the last values we received and retrying."
        />
      ) : null}

      {rows === null ? (
        <AdminLoadingState label="Loading live updates…" />
      ) : ordered.length === 0 ? (
        <AdminEmptyState title="No live updates yet" description="Post one using the form above." />
      ) : (
        <Panel flush>
          {/* The galley: hairline rows, no zebra striping, no row cards. */}
          <ul>
            {ordered.map((row) => (
              <li
                key={row.id}
                className="border-admin-rule-hairline border-b-admin-hairline last:border-b-0"
              >
                {/* The galley rhythm, but aligned to the top rather than
                    centred: an update is a message of any length beside a
                    fixed column of controls. */}
                <div className="flex flex-wrap items-start justify-between gap-sm px-md py-sm">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-sm gap-y-2xs">
                      {row.pinned ? <StatusBadge tone="info">Pinned</StatusBadge> : null}
                      {audienceBadge(row.audience) ? (
                        <StatusBadge tone="neutral">{audienceBadge(row.audience)}</StatusBadge>
                      ) : (
                        <StatusBadge tone="caution">Admins only, no audience set</StatusBadge>
                      )}
                      {typeof row.category === 'string' && row.category ? (
                        <StatusBadge tone="neutral">{row.category}</StatusBadge>
                      ) : null}
                      <span className="font-admin-data text-admin-xs text-admin-ink-secondary">
                        {toDate(row.postedAt)?.toLocaleString() ?? ''}
                      </span>
                    </div>
                    <p className="mt-3xs text-admin-base text-admin-ink">{row.message}</p>
                  </div>
                  <div className="flex shrink-0 gap-xs">
                    <button type="button" className={linkButtonClass} onClick={() => startEdit(row)}>
                      Edit
                    </button>
                    <DestructiveConfirm
                      trigger="Remove"
                      title="Remove this update"
                      confirmLabel="Remove this update"
                      busyLabel="Removing…"
                      busy={deletingId === row.id}
                      disabled={deletingId === row.id}
                      consequence="The update disappears from the public updates feed and from its own page."
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
