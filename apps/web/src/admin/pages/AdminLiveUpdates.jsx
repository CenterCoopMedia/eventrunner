// Live updates admin form (issue #28, spec §9 "Live updates card") — compose,
// edit, and delete entries in the `live_updates` feed. Wired to
// saveLiveUpdate/deleteLiveUpdate; no draft/publish step, unlike the CMS
// tabs — a save here is live immediately (spec: admin-form authored, no
// Slack ingestion, no two-revision model).
import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import LoadingState from '../../components/LoadingState.jsx';
import { useAdminApi } from '../adminApi.js';
import { subscribeAdminCollection } from '../adminSource.js';
import {
  Panel,
  CheckboxField,
  ServerErrorSummary,
  TextAreaField,
  DestructiveConfirm,
  primaryButtonClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';

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
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-brand-ink">Live updates</h1>
        <p className="text-sm text-brand-ink-muted">
          Short posts shown on the live updates card. No approval step — posting here is
          live immediately.
        </p>
        {features?.liveUpdates ? null : (
          <p role="status" className="mt-2 rounded-brand border border-brand-ink/20 bg-brand-surface-alt px-3 py-2 text-sm text-brand-ink-muted">
            The live updates feature is currently off, so this feed is not shown to visitors.
            Turn it on under Features.
          </p>
        )}
      </div>

      <Panel title={editingId ? 'Edit update' : 'Post an update'}>
        <form className="flex flex-col gap-4" onSubmit={submit}>
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
          <div className="flex flex-wrap gap-2">
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
        <p role="status" className="rounded-brand border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          We lost the connection to the live updates list; showing the last values we received
          and retrying.
        </p>
      ) : null}

      {rows === null ? (
        <LoadingState label="Loading live updates…" />
      ) : ordered.length === 0 ? (
        <EmptyState title="No live updates yet" description="Post one using the form above." />
      ) : (
        <Panel title="Posted updates">
          <ul className="divide-y divide-brand-ink/10">
            {ordered.map((row) => (
              <li key={row.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {row.pinned ? (
                      <span className="rounded-brand border border-brand-accent/40 bg-brand-accent/10 px-2 py-0.5 text-xs font-semibold text-brand-accent">
                        Pinned
                      </span>
                    ) : null}
                    <span className="text-xs text-brand-ink-muted">
                      {toDate(row.postedAt)?.toLocaleString() ?? ''}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-brand-ink">{row.message}</p>
                </div>
                <div className="flex shrink-0 gap-2">
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
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
