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
  DestructiveConfirm,
  primaryButtonClass,
  rowMetaClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import AdminPageHeader, { StatusBadge } from '../components/adminChrome.jsx';
import { focusFirstError } from '../../lib/focusFirstError.js';

const REVIEW_LABEL = { pending: 'Pending review', approved: 'Approved', rejected: 'Rejected' };

// The verdict's tone. The word is always rendered beside the filename and is
// the first signal; the tint is the second one, never the only one (§8.1).
const REVIEW_TONE = { pending: 'caution', approved: 'ok', rejected: 'error' };

function AddLinkForm({ sessionId, onAdded }) {
  const call = useAdminApi();
  const { showToast } = useToast();
  const formRef = useRef(null);
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    // The control stays enabled while the URL is missing (#219): a disabled
    // control says nothing, so pressing Add with an empty field now moves
    // the operator to that field instead of doing nothing.
    if (!url) {
      focusFirstError(formRef.current);
      return;
    }
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
    <form ref={formRef} className="flex flex-col gap-sm" onSubmit={submit}>
      <ServerErrorSummary error={error} />
      <TextField label="Link URL" value={url} onChange={setUrl} type="url" required />
      <TextField
        label="Display label"
        value={label}
        onChange={setLabel}
        hint="Leave blank to use the default label. A blank or URL-shaped label is stored as “External link” — it is never shown as the raw URL."
      />
      <div>
        <button
          type="submit"
          className={primaryButtonClass}
          disabled={saving}
          aria-busy={saving || undefined}
        >
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
    <li className="flex flex-wrap items-center justify-between gap-sm border-admin-rule-hairline border-b-admin-hairline py-sm last:border-b-0">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-sm gap-y-2xs">
          <p className="text-admin-base font-bold text-admin-ink">{material.filename}</p>
          <StatusBadge tone={REVIEW_TONE[material.reviewStatus] ?? 'neutral'}>
            {REVIEW_LABEL[material.reviewStatus] ?? material.reviewStatus}
          </StatusBadge>
        </div>
        <p className={`mt-3xs truncate ${rowMetaClass}`}>
          {material.type === 'link' ? material.url : material.storagePath}
        </p>
      </div>
      <div className="flex flex-wrap gap-xs">
        {material.reviewStatus !== 'approved' ? (
          <button
            type="button"
            className={secondaryButtonClass}
            disabled={busy}
            onClick={() => review('approved')}
          >
            Approve
          </button>
        ) : null}
        {material.reviewStatus !== 'rejected' ? (
          <button
            type="button"
            className={secondaryButtonClass}
            disabled={busy}
            onClick={() => review('rejected')}
          >
            Reject
          </button>
        ) : null}
        <DestructiveConfirm
          trigger="Delete"
          title={`Delete ${material.filename}`}
          confirmLabel="Delete this material"
          busy={busy}
          disabled={busy}
          consequence="The file is removed from the session’s materials list, and anyone holding its link gets nothing."
          permanence="This cannot be undone."
          onConfirm={remove}
        />
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
    <div className="flex flex-col gap-md">
      <AdminPageHeader
        title="Materials"
        description="Manage a session’s slide decks and links. Materials are visible to attendees only once approved, and the underlying URL stays embargoed until the session ends unless you or the session’s speaker are viewing it."
      />

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
              <SaveStatus message="Loading materials…" />
            ) : materials.length === 0 ? (
              <p className="text-admin-sm text-admin-ink-secondary">No materials yet.</p>
            ) : (
              <ul className="flex flex-col">
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
