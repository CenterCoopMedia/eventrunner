import { useEffect, useRef, useState } from 'react';
import LoadingState from '../LoadingState.jsx';
import { useAuth } from '../../contexts/AuthContext.jsx';
import {
  addSpeakerMaterialLink,
  listSpeakerSessionMaterials,
  updateSpeakerMaterial,
  uploadSpeakerMaterialFile,
} from '../../lib/speakerMaterialsApi.js';
import {
  inputClass,
  primaryActionClass,
  secondaryActionClass,
} from '../controlClasses.js';
import { TextField } from '../forms/publicForm.jsx';

const REVIEW_LABELS = Object.freeze({
  pending: 'Awaiting review',
  approved: 'Approved',
  rejected: 'Changes requested',
});

function errorMessage(error, fallback) {
  return typeof error?.message === 'string' && error.message ? error.message : fallback;
}

function ReviewStatus({ value }) {
  return (
    <span className="inline-flex rounded-brand border-hairline border-rule-hairline bg-surface-alt px-xs py-3xs font-data text-caption text-text-secondary">
      {REVIEW_LABELS[value] ?? 'Review status unavailable'}
    </span>
  );
}

function MaterialEditor({ material, user, onSaved, onCancel }) {
  const [filename, setFilename] = useState(material.filename ?? '');
  const [url, setUrl] = useState(material.url ?? '');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function save(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await updateSpeakerMaterial({
        user,
        materialId: material.id,
        filename: filename.trim(),
        url: material.type === 'link' ? url.trim() : null,
      });
      onSaved();
    } catch (nextError) {
      setError(errorMessage(nextError, 'The material could not be updated.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="mt-sm grid gap-sm rounded-brand border-hairline border-rule-hairline p-sm">
      <TextField label="Display name" value={filename} onChange={setFilename} required />
      {material.type === 'link' ? (
        <TextField label="Link URL" type="url" value={url} onChange={setUrl} required />
      ) : null}
      {error ? <p role="alert" className="text-caption text-danger">{error}</p> : null}
      <div className="flex flex-wrap gap-xs">
        <button
          type="submit"
          className={primaryActionClass}
          aria-disabled={saving ? 'true' : undefined}
          aria-busy={saving ? 'true' : undefined}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button type="button" className={secondaryActionClass} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function MaterialRow({ material, speakerId, user, onSaved }) {
  const [editing, setEditing] = useState(false);
  const ownMaterial = material.submittedBySpeakerId === speakerId;
  const editable = ownMaterial && material.reviewStatus === 'pending';

  return (
    <li className="py-sm first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-sm">
        <div className="min-w-0">
          <p className="break-words text-body font-semibold text-text-primary">
            {material.filename || (material.type === 'link' ? 'External link' : 'Untitled file')}
          </p>
          <p className="mt-3xs font-data text-caption text-text-secondary">
            {material.type === 'link' ? 'Link' : 'File'}{ownMaterial ? ' · Submitted by you' : ' · Submitted for this session'}
          </p>
        </div>
        <ReviewStatus value={material.reviewStatus} />
      </div>
      {editable ? (
        <button
          type="button"
          className={`${secondaryActionClass} mt-sm`}
          aria-expanded={editing}
          onClick={() => setEditing((current) => !current)}
        >
          {editing ? 'Close editor' : 'Edit'}
        </button>
      ) : null}
      {ownMaterial && material.reviewStatus !== 'pending' ? (
        <p className="mt-sm text-caption text-text-secondary">
          An organizer has reviewed this item. Ask an organizer if it must change.
        </p>
      ) : null}
      {editing ? (
        <MaterialEditor
          material={material}
          user={user}
          onSaved={onSaved}
          onCancel={() => setEditing(false)}
        />
      ) : null}
    </li>
  );
}

export default function SpeakerSessionMaterials({ sessionId, speakerId, onMaterialsChanged }) {
  const { user } = useAuth();
  const requestIdRef = useRef(0);
  const fileInputRef = useRef(null);
  const [attempt, setAttempt] = useState(0);
  const [load, setLoad] = useState(null);
  const [link, setLink] = useState({ url: '', label: '' });
  const [linkState, setLinkState] = useState({ busy: false, error: null });
  const [file, setFile] = useState(null);
  const [fileState, setFileState] = useState({ busy: false, error: null });
  const [notice, setNotice] = useState('');

  const userId = user?.uid ?? null;
  const scopeKey = `${userId ?? ''}:${speakerId ?? ''}:${sessionId ?? ''}`;
  const scopeKeyRef = useRef(scopeKey);
  scopeKeyRef.current = scopeKey;
  const canRead = Boolean(user && sessionId && speakerId);
  const current = load?.scope === scopeKey && load.user === user && load.attempt === attempt;
  const loading = !current || load.status === 'loading';
  const ready = !loading && load.status === 'ready';
  const retryRead = () => setAttempt((value) => value + 1);
  useEffect(() => {
    requestIdRef.current += 1;
    setLink({ url: '', label: '' });
    setLinkState({ busy: false, error: null });
    setFile(null);
    setFileState({ busy: false, error: null });
    setNotice('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [userId, sessionId, speakerId]);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    const request = { scope: scopeKey, user, attempt };
    setLoad({ ...request, status: 'loading' });
    if (!canRead) return undefined;

    listSpeakerSessionMaterials({ user, sessionId }).then(
      (materials) => {
        if (requestIdRef.current === requestId) {
          setLoad({ ...request, status: 'ready', materials });
        }
      },
      (error) => {
        if (requestIdRef.current === requestId) {
          setLoad({
            ...request,
            status: 'error',
            error: errorMessage(error, 'Your materials could not be loaded.'),
          });
        }
      },
    );
    return () => {
      if (requestIdRef.current === requestId) requestIdRef.current += 1;
    };
  }, [user, sessionId, scopeKey, canRead, attempt]);

  function refresh(message = '', expectedScope = scopeKey) {
    if (scopeKeyRef.current !== expectedScope) return;
    onMaterialsChanged?.();
    setNotice(message);
    setAttempt((value) => value + 1);
  }

  async function submitLink(event) {
    event.preventDefault();
    if (!ready || linkState.busy) return;
    const operationScope = scopeKey;
    setLinkState({ busy: true, error: null });
    try {
      await addSpeakerMaterialLink({
        user,
        sessionId,
        url: link.url.trim(),
        label: link.label.trim(),
      });
      if (scopeKeyRef.current !== operationScope) return;
      setLink({ url: '', label: '' });
      setLinkState({ busy: false, error: null });
      refresh('Link sent for organizer review.', operationScope);
    } catch (error) {
      if (scopeKeyRef.current !== operationScope) return;
      setLinkState({ busy: false, error: errorMessage(error, 'The link could not be added.') });
    }
  }

  async function submitFile(event) {
    event.preventDefault();
    if (!ready || fileState.busy) return;
    const operationScope = scopeKey;
    setFileState({ busy: true, error: null });
    try {
      await uploadSpeakerMaterialFile({ user, sessionId, file });
      if (scopeKeyRef.current !== operationScope) return;
      if (fileInputRef.current) fileInputRef.current.value = '';
      setFile(null);
      setFileState({ busy: false, error: null });
      refresh('File sent for organizer review.', operationScope);
    } catch (error) {
      if (scopeKeyRef.current !== operationScope) return;
      setFileState({ busy: false, error: errorMessage(error, 'The file could not be uploaded.') });
    }
  }

  return (
    <>
      {loading ? <LoadingState key={`${scopeKey}:${attempt}`} label="Loading materials…" rows={0} onRetry={canRead ? retryRead : undefined} /> : null}
      <div role="region" aria-label="Session materials" aria-busy={loading} className="grid gap-lg">
        {!loading && load.status === 'error' ? (
          <div>
            <p role="alert" className="text-body text-danger">{load.error}</p>
            <button type="button" className={`${secondaryActionClass} mt-sm`} onClick={retryRead}>
              Try again
            </button>
          </div>
        ) : null}
        {ready ? <section aria-labelledby="submitted-materials-heading">
          <h3 id="submitted-materials-heading" className="font-heading text-h3 font-semibold text-text-primary">
            Submitted materials
          </h3>
          {notice ? <p role="status" className="mt-xs text-caption text-text-secondary">{notice}</p> : null}
          {load.materials.length === 0 ? (
            <p className="mt-sm text-body text-text-secondary">No materials have been sent for this session.</p>
          ) : (
            <ul className="mt-sm divide-y divide-rule-hairline">
              {load.materials.map((material) => (
                <MaterialRow
                  key={material.id}
                  material={material}
                  speakerId={speakerId}
                  user={user}
                  onSaved={() => refresh('Material updated.', scopeKey)}
                />
              ))}
            </ul>
          )}
        </section> : null}

        {/* Keep the browser's file selection through a read or retry. */}
        <div hidden={!ready} className={ready ? 'grid gap-lg md:grid-cols-2' : undefined}>
          <form onSubmit={submitLink} className="grid content-start gap-sm border-t-hairline border-rule-hairline pt-sm">
            <h3 className="font-heading text-h3 font-semibold text-text-primary">Add a link</h3>
            <TextField
              label="Link URL"
              type="url"
              value={link.url}
              onChange={(url) => setLink((current) => ({ ...current, url }))}
              required
            />
            <TextField
              label="Display name"
              value={link.label}
              onChange={(label) => setLink((current) => ({ ...current, label }))}
              hint="Optional. If blank, the item is called External link."
            />
            {linkState.error ? <p role="alert" className="text-caption text-danger">{linkState.error}</p> : null}
            <button
              type="submit"
              className={primaryActionClass}
              aria-disabled={linkState.busy ? 'true' : undefined}
              aria-busy={linkState.busy ? 'true' : undefined}
            >
              {linkState.busy ? 'Sending…' : 'Send link'}
            </button>
          </form>

          <form onSubmit={submitFile} className="grid content-start gap-sm border-t-hairline border-rule-hairline pt-sm">
            <h3 className="font-heading text-h3 font-semibold text-text-primary">Upload a file</h3>
            <div className="flex flex-col gap-2xs">
              <label htmlFor={`speaker-material-file-${sessionId}`} className="font-data text-caption font-semibold text-text-primary">
                File
              </label>
              <p id={`speaker-material-file-${sessionId}-hint`} className="text-caption text-text-secondary">
                The file limit is 9 MB.
              </p>
              <input
                ref={fileInputRef}
                id={`speaker-material-file-${sessionId}`}
                type="file"
                className={inputClass}
                aria-describedby={`speaker-material-file-${sessionId}-hint`}
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                required
              />
            </div>
            {fileState.error ? <p role="alert" className="text-caption text-danger">{fileState.error}</p> : null}
            <button
              type="submit"
              className={primaryActionClass}
              aria-disabled={fileState.busy ? 'true' : undefined}
              aria-busy={fileState.busy ? 'true' : undefined}
            >
              {fileState.busy ? 'Uploading…' : 'Upload file'}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
