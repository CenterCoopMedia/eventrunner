// Asset detail modal: the file's facts, its editable description, where it
// is used, and delete. Admin-only (design brief §5.2, admin story part 2
// "the cut file") — a print shop's cabinet of engravings, not a photo
// gallery. The thumbnail is evidence; the metadata is the point, so every
// fact below is set in the data face.
//
// The usage list is the reason this screen exists rather than a row of icons
// in the grid. Deleting an asset that a published page renders leaves a hole
// in the live site, so the scan runs when the modal opens and the delete
// button says what it will break. `mediaDelete` refuses an in-use asset with
// a 409 regardless — the server decides, this only makes the decision
// legible — and confirming re-sends with `force`.
import { useEffect, useState } from 'react';
import { formatBytes } from '../../../lib/mediaSource.js';
import {
  DestructiveConfirm,
  TextAreaField,
  TextField,
  primaryButtonClass,
  secondaryButtonClass,
} from '../formControls.jsx';
import AssetImage from '../../../components/media/AssetImage.jsx';
import ModalShell from './ModalShell.jsx';

function UsageList({ references }) {
  if (references === null) {
    return <p className="text-caption text-admin-ink-secondary">Checking usage…</p>;
  }
  if (references.length === 0) {
    return (
      <p className="text-caption text-admin-ink-secondary">
        Nothing references this file. Deleting it is safe.
      </p>
    );
  }
  return (
    <div className="rounded-admin border-admin-hairline border-admin-rule-hairline bg-admin-ground-proof px-sm py-2xs">
      <p className="text-caption font-semibold text-admin-state-caution">
        Used by {references.length} {references.length === 1 ? 'document' : 'documents'}
      </p>
      <ul className="mt-2xs list-disc ps-5 text-caption text-admin-ink">
        {references.map((reference) => (
          <li key={`${reference.docPath}:${reference.field}`}>
            <code className="font-admin-data text-admin-ink-data">{reference.docPath}</code>
            {reference.field ? (
              <span className="text-admin-ink-secondary"> · {reference.field}</span>
            ) : null}
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
      <div className="grid gap-md sm:grid-cols-2">
        <AssetImage
          path={asset.path}
          alt={asset.alt ?? ''}
          className="max-h-64 w-full rounded-admin border-admin-hairline border-admin-rule-hairline object-contain"
        />
        <dl className="text-caption text-admin-ink">
          <dt className="font-semibold">Path</dt>
          <dd className="mb-2xs break-all font-admin-data text-folio text-admin-ink-data">
            {asset.path}
          </dd>
          <dt className="font-semibold">Type and size</dt>
          <dd className="mb-2xs font-admin-data text-folio text-admin-ink-data">
            {asset.contentType} · {formatBytes(asset.size)}
          </dd>
          <dt className="font-semibold">Uploaded by</dt>
          <dd className="font-admin-data text-folio text-admin-ink-data">
            {asset.uploadedBy ?? 'unknown'}
          </dd>
        </dl>
      </div>

      <form className="mt-md flex flex-col gap-sm" onSubmit={save}>
        <TextAreaField label="Alt text" value={alt} onChange={setAlt} rows={2} />
        <TextField label="Title" value={title} onChange={setTitle} />
        {status ? <p className="text-caption text-admin-state-ok">{status}</p> : null}
        {error ? (
          <p role="alert" className="text-caption text-admin-state-error">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-xs">
          <button type="submit" className={primaryButtonClass} disabled={busy}>
            {busy ? 'Saving…' : 'Save description'}
          </button>
          <button type="button" className={secondaryButtonClass} onClick={onClose} disabled={busy}>
            Done
          </button>
        </div>
      </form>

      <section className="mt-md border-admin-rule-hairline border-t-admin-hairline pt-sm">
        <h3 className="text-lead font-semibold text-admin-ink">Where this is used</h3>
        <div className="mt-2xs">
          <UsageList references={references} />
        </div>
        {/* Moment 3: the delete states what it costs before it runs, and
            the in-use case says how many live documents lose their file. */}
        <div className="mt-sm flex flex-wrap gap-xs">
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
