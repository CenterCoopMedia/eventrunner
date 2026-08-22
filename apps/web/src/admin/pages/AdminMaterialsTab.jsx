// Session materials review (issue #23, spec §4.4). `session_materials` is
// fully server-only — even an admin has no direct Firestore read — so every
// operation here goes through Cloud Functions (functions/src/materials/*),
// the same "reuse adminApi, reuse formControls" convention as the rest of
// the admin area.
//
// MaterialsTab is trimmed to the two-collection model: there is no upload
// review queue with file-byte handling here — an admin adds a link
// directly, or registers a Storage path a file was already uploaded to via
// the media library (issue #24, in flight, not built here). Approve/reject
// drives `session_materials_public` through the projection trigger; delete
// removes the material and its `cmsSchedule.materialCount` slot in one
// server transaction.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useContent } from '../../contexts/ContentContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAdminApi } from '../adminApi.js';
import {
  Panel,
  SaveStatus,
  ServerErrorSummary,
  SelectField,
  TextField,
  dangerButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';

const REVIEW_LABEL = { pending: 'Pending review', approved: 'Approved', rejected: 'Rejected' };

function AddLinkForm({ sessionId, onAdded }) {
  const call = useAdminApi();
  const { showToast } = useToast();
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await call('addSessionMaterialLink', { sessionId, url, label });
      setUrl('');
      setLabel('');
      showToast('Material added.');
      onAdded();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={submit}>
      <ServerErrorSummary error={error} />
      <TextField label="Link URL" value={url} onChange={setUrl} type="url" required />
      <TextField
        label="Display label"
        value={label}
        onChange={setLabel}
        hint="Leave blank to use the default label. A blank or URL-shaped label is stored as “External link” — it is never shown as the raw URL."
      />
      <div>
        <button type="submit" className={primaryButtonClass} disabled={saving || !url}>
          {saving ? 'Adding…' : 'Add link'}
        </button>
      </div>
    </form>
  );
}

function MaterialRow({ material, onChanged }) {
  const call = useAdminApi();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  async function review(reviewStatus) {
    setBusy(true);
    try {
      await call('setMaterialReviewStatus', { materialId: material.id, reviewStatus });
      showToast(`Marked ${REVIEW_LABEL[reviewStatus].toLowerCase()}.`);
      onChanged();
    } catch (err) {
      showToast(err.message || 'Could not update the review status.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await call('deleteSessionMaterial', { materialId: material.id });
      showToast('Material deleted.');
      onChanged();
    } catch (err) {
      showToast(err.message || 'Could not delete the material.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-brand border border-brand-ink/10 bg-brand-surface-alt p-3">
      <div>
        <p className="font-medium text-brand-ink">{material.filename}</p>
        <p className="text-sm text-brand-ink-muted">
          <span>{material.type === 'link' ? material.url : material.storagePath}</span> ·{' '}
          <span>{REVIEW_LABEL[material.reviewStatus] ?? material.reviewStatus}</span>
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {material.reviewStatus !== 'approved' ? (
          <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => review('approved')}>
            Approve
          </button>
        ) : null}
        {material.reviewStatus !== 'rejected' ? (
          <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => review('rejected')}>
            Reject
          </button>
        ) : null}
        <button type="button" className={dangerButtonClass} disabled={busy} onClick={remove}>
          Delete
        </button>
      </div>
    </li>
  );
}

export default function AdminMaterialsTab() {
  const { scheduleData } = useContent();
  const call = useAdminApi();
  const [sessionId, setSessionId] = useState('');
  const [materials, setMaterials] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // Guards against an out-of-order response: switching sessions (or
  // clicking Approve/Reject/Delete, which each call load() again) fires a
  // new listSessionMaterials request while a previous one may still be in
  // flight. Without this, a slow response for session A that resolves
  // AFTER a fast response for session B would overwrite B's freshly-loaded
  // list with A's stale one. Every call to load() bumps this ref and
  // captures its own value; a response only applies if it is still the
  // most recent request when it resolves.
  const requestIdRef = useRef(0);

  const options = (scheduleData ?? []).map((s) => ({ value: s.id, label: s.title }));

  const load = useCallback(async () => {
    const requestId = (requestIdRef.current += 1);
    if (!sessionId) {
      setMaterials([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await call('listSessionMaterials', { sessionId });
      if (requestIdRef.current !== requestId) return; // superseded by a newer request
      setMaterials(result.materials ?? []);
    } catch (err) {
      if (requestIdRef.current !== requestId) return;
      setError(err);
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  }, [sessionId, call]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-brand-ink">Materials</h1>
        <p className="text-sm text-brand-ink-muted">
          Manage a session's slide decks and links. Materials are visible to attendees only once
          approved, and the underlying URL stays embargoed until the session ends unless you or
          the session's speaker are viewing it.
        </p>
      </div>

      <Panel title="Choose a session">
        <SelectField
          label="Session"
          value={sessionId}
          onChange={setSessionId}
          options={[{ value: '', label: 'Select a session…' }, ...options]}
        />
      </Panel>

      {sessionId ? (
        <>
          <Panel title="Add a link">
            <AddLinkForm sessionId={sessionId} onAdded={load} />
          </Panel>

          <Panel title="Materials for this session">
            <ServerErrorSummary error={error} />
            {loading ? (
              <SaveStatus message="Loading…" />
            ) : materials.length === 0 ? (
              <p className="text-sm text-brand-ink-muted">No materials yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {materials.map((material) => (
                  <MaterialRow key={material.id} material={material} onChanged={load} />
                ))}
              </ul>
            )}
          </Panel>
        </>
      ) : null}
    </div>
  );
}
