// Asset detail modal: the file's facts, its editable description, where it
// is used, and delete.
//
// The usage list is the reason this screen exists rather than a row of icons
// in the grid. Deleting an asset that a published page renders leaves a hole
// in the live site, so the scan runs when the modal opens and the delete
// button says what it will break. `mediaDelete` refuses an in-use asset with
// a 409 regardless — the server decides, this only makes the decision
// legible — and confirming re-sends with `force`.
import { useEffect, useState } from 'react';
import { formatBytes } from '../../lib/mediaSource.js';
import {
  DestructiveConfirm,
  TextAreaField,
  TextField,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../admin/components/formControls.jsx';
import AssetImage from './AssetImage.jsx';
import ModalShell from './ModalShell.jsx';

function UsageList({ references }) {
  if (references === null) return <p className="text-sm text-brand-ink-muted">Checking usage…</p>;
  if (references.length === 0) {
    return (
      <p className="text-sm text-brand-ink-muted">
        Nothing references this file. Deleting it is safe.
      </p>
    );
  }
  return (
    <div className="rounded-brand border border-warning/40 bg-warning/10 px-3 py-2">
      <p className="text-sm font-semibold text-warning">
        Used by {references.length} {references.length === 1 ? 'document' : 'documents'}
      </p>
      <ul className="mt-1 list-disc pl-5 text-sm text-brand-ink">
        {references.map((reference) => (
          <li key={`${reference.docPath}:${reference.field}`}>
            <code>{reference.docPath}</code>
            {reference.field ? <span className="text-brand-ink-muted"> · {reference.field}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function AssetModal({ asset, onClose, onChanged, scanUsage, updateMetadata, remove }) {
  const [alt, setAlt] = useState(asset.alt ?? '');
  const [title, setTitle] = useState(asset.title ?? '');
  const [references, setReferences] = useState(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let active = true;
    scanUsage([asset.path])
      .then((usage) => {
        if (active) setReferences(usage?.[asset.path] ?? []);
      })
      .catch(() => {
        // A scan that cannot run must not read as "unused": the delete
        // button below stays honest by saying the check failed.
        if (active) setReferences(null);
      });
    return () => {
      active = false;
    };
  }, [asset.path, scanUsage]);

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setStatus('');
    try {
      await updateMetadata({ assetId: asset.id, alt: alt.trim(), title: title.trim() });
      setStatus('Saved.');
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function destroy(force) {
    setBusy(true);
    setError(null);
    try {
      await remove({ assetId: asset.id, force });
      onChanged?.();
      onClose();
    } catch (err) {
      if (err.code === 'asset-in-use') {
        // The server found references this modal's own scan may have missed
        // (a doc edited since it ran). Show them and ask again.
        setReferences(err.usage ?? references ?? []);
        setConfirming(true);
      }
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title={asset.title || asset.filename || 'Asset'} onClose={onClose}>
      <div className="grid gap-6 sm:grid-cols-2">
        <AssetImage
          path={asset.path}
          alt={asset.alt ?? ''}
          className="max-h-64 w-full rounded-brand object-contain outline outline-1 -outline-offset-1 outline-brand-ink/[0.08]"
        />
        <dl className="text-sm text-brand-ink">
          <dt className="font-semibold">Path</dt>
          <dd className="mb-2 break-all text-brand-ink-muted">{asset.path}</dd>
          <dt className="font-semibold">Type and size</dt>
          <dd className="mb-2 text-brand-ink-muted">
            {asset.contentType} · {formatBytes(asset.size)}
          </dd>
          <dt className="font-semibold">Uploaded by</dt>
          <dd className="text-brand-ink-muted">{asset.uploadedBy ?? 'unknown'}</dd>
        </dl>
      </div>

      <form className="mt-6 flex flex-col gap-4" onSubmit={save}>
        <TextAreaField label="Alt text" value={alt} onChange={setAlt} rows={2} />
        <TextField label="Title" value={title} onChange={setTitle} />
        {status ? <p className="text-sm text-success">{status}</p> : null}
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <button type="submit" className={primaryButtonClass} disabled={busy}>
            {busy ? 'Saving…' : 'Save description'}
          </button>
          <button type="button" className={secondaryButtonClass} onClick={onClose} disabled={busy}>
            Done
          </button>
        </div>
      </form>

      <section className="mt-6 border-t border-brand-ink/10 pt-4">
        <h3 className="font-heading text-lg text-brand-ink">Where this is used</h3>
        <div className="mt-2">
          <UsageList references={references} />
        </div>
        {/* Moment 3: the delete states what it costs before it runs, and
            the in-use case says how many live documents lose their file. */}
        <div className="mt-4 flex flex-wrap gap-3">
          {confirming || (references?.length ?? 0) > 0 ? (
            <DestructiveConfirm
              trigger="Delete this file anyway"
              title="Delete a file that is in use"
              confirmLabel="Delete this file anyway"
              busyLabel="Deleting…"
              busy={busy}
              consequence={`The object is removed from storage, and the ${
                references?.length ?? 0
              } document${
                (references?.length ?? 0) === 1 ? '' : 's'
              } listed above render a missing file until you point them at another one.`}
              permanence="This cannot be undone."
              onConfirm={() => destroy(true)}
            />
          ) : (
            <DestructiveConfirm
              trigger="Delete this file"
              title="Delete this file"
              confirmLabel="Delete this file"
              busyLabel="Deleting…"
              busy={busy}
              consequence="The object is removed from storage. Its library row goes with it."
              permanence="This cannot be undone."
              onConfirm={() => destroy(false)}
            />
          )}
        </div>
      </section>
    </ModalShell>
  );
}
