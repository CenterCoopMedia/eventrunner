// Live updates admin form (issue #28, spec §9 "Live updates card") — compose,
// edit, and delete entries in the `live_updates` feed. Wired to
// saveLiveUpdate/deleteLiveUpdate; no draft/publish step, unlike the CMS
// tabs — a save here is live immediately (spec: admin-form authored, no
// Slack ingestion, no two-revision model).
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
  TextAreaField,
  DestructiveConfirm,
  primaryButtonClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import AdminPageHeader, {
  AdminEmptyState,
  AdminLoadingState,
} from '../components/adminChrome.jsx';

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

const EMPTY_FORM = { message: '', pinned: false };

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

  function startEdit(row) {
    setEditingId(row.id);
    setForm({ message: row.message ?? '', pinned: row.pinned === true });
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
        update: { message: form.message, pinned: form.pinned },
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

      <Panel title={editingId ? 'Edit update' : 'Post an update'}>
        <form className="flex flex-col gap-sm" onSubmit={submit}>
          <ServerErrorSummary error={error} />
          <TextAreaField
            label="Message"
            value={form.message}
            onChange={(value) => setForm((f) => ({ ...f, message: value }))}
            rows={3}
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
                <div className="flex flex-wrap items-start justify-between gap-sm px-md py-xs">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-sm gap-y-3xs">
                      {row.pinned ? (
                        <span className="font-admin-data text-folio text-admin-ink-data">
                          Pinned
                        </span>
                      ) : null}
                      <span className="font-admin-data text-folio text-admin-ink-secondary">
                        {toDate(row.postedAt)?.toLocaleString() ?? ''}
                      </span>
                    </div>
                    <p className="mt-3xs text-caption text-admin-ink">{row.message}</p>
                  </div>
                  <div className="flex shrink-0 gap-xs">
                    <button type="button" className={secondaryButtonClass} onClick={() => startEdit(row)}>
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
