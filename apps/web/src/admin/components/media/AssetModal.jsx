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
//
// For staff (issue 186) a branding asset — one in the branding folder, or
// one a theme slot or the social card names — is read-only here: the words
// and the delete are the operator's, the server refuses both, and the modal
// says so once instead of offering controls that fail. `operator` is the
// caller's tier; it defaults closed.
import { useEffect, useRef, useState } from 'react';
import { formatBytes, typeLabel } from '../../../lib/mediaSource.js';
import {
  DestructiveConfirm,
  Notice,
  SaveStatus,
  TextAreaField,
  TextField,
  primaryButtonClass,
  rowMetaClass,
  secondaryButtonClass,
} from '../formControls.jsx';
import AssetImage from '../../../components/media/AssetImage.jsx';
import {
  BRANDING_NOTE,
  isBrandingAsset,
  mediaErrorMessage,
  referencedByBranding,
} from './mediaErrors.js';
import ModalShell from './ModalShell.jsx';

function usageLocation(reference) {
  const [stored, id] = (reference.docPath ?? '').split('/');
  const collection = stored?.replace(/_drafts$/, '');
  const locations = {
    cmsPages: ['Page', `/admin/pages/${encodeURIComponent(id ?? '')}`],
    cmsContent: ['Content block', '/admin/content'],
    cmsSchedule: ['Session', `/admin/sessions/${encodeURIComponent(id ?? '')}`],
    cmsOrganizations: ['Organization', `/admin/organizations/${encodeURIComponent(id ?? '')}`],
    cmsUpdates: ['Update', `/admin/updates/${encodeURIComponent(id ?? '')}`],
    cmsTimeline: ['Timeline entry', `/admin/timeline/${encodeURIComponent(id ?? '')}`],
    speakers: ['Speaker', `/admin/speakers/${encodeURIComponent(id ?? '')}`],
  };
  if (collection === 'config') return id === 'theme' ? ['Branding', '/admin/branding'] : ['Event settings', '/admin/settings'];
  return locations[collection] ?? ['Event content', '/admin/content'];
}

function UsageList({ references, error, onRetry }) {
  if (error) {
    return (
      <div className="space-y-xs">
        <Notice tone="error" message="Usage could not be checked. Retry before deleting this file." />
        <button type="button" className={secondaryButtonClass} onClick={onRetry}>Retry usage check</button>
      </div>
    );
  }
  if (references === null) {
    return <p role="status" className="flex items-center gap-xs text-admin-sm text-admin-ink-secondary"><span className="admin-busy-mark" aria-hidden="true" />Checking usage…</p>;
  }
  if (references.length === 0) {
    return (
      <p className="text-admin-sm text-admin-ink-secondary">
        This file is not used in your event.
      </p>
    );
  }
  return (
    <div className="rounded-admin border-admin-hairline border-admin-rule-hairline bg-admin-ground-proof px-md py-sm">
      <p className="text-admin-base font-bold text-admin-state-caution">
        Used in {references.length} {references.length === 1 ? 'place' : 'places'}
      </p>
      <ul className="mt-2xs list-disc ps-5 text-admin-sm text-admin-ink">
        {references.map((reference, index) => {
          const [label, href] = usageLocation(reference);
          return (
            <li key={`${reference.docPath}:${reference.field}`}>
              <a href={href} className="admin-target text-admin-ink-link underline underline-offset-2" aria-label={`Open ${label.toLowerCase()} ${index + 1}`}>{label}</a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function AssetModal({
  asset,
  onClose,
  onChanged,
  scanUsage,
  updateMetadata,
  remove,
  operator = false,
  returnFocusRef,
}) {
  const [alt, setAlt] = useState(asset.alt ?? '');
  const [title, setTitle] = useState(asset.title ?? '');
  const [references, setReferences] = useState(null);
  const [usageError, setUsageError] = useState(false);
  const [scanAttempt, setScanAttempt] = useState(0);
  const [status, setStatus] = useState('');
  const [saveError, setSaveError] = useState(null);
  const [deleteError, setDeleteError] = useState(null);
  const [action, setAction] = useState('');
  const pending = useRef(false);
  const busy = Boolean(action);
  const [confirming, setConfirming] = useState(false);
  const locked = !operator && (isBrandingAsset(asset) || referencedByBranding(references));

  useEffect(() => {
    let active = true;
    setReferences(null);
    setUsageError(false);
    scanUsage([asset.path])
      .then((usage) => {
        if (active) setReferences(usage?.[asset.path] ?? []);
      })
      .catch(() => {
        // A scan that cannot run must not read as "unused": the delete
        // button below stays honest by saying the check failed.
        if (active) setUsageError(true);
      });
    return () => {
      active = false;
    };
  }, [asset.path, scanUsage, scanAttempt]);

  async function save(event) {
    event.preventDefault();
    if (pending.current || locked) return;
    pending.current = true;
    setAction('save');
    setSaveError(null);
    setDeleteError(null);
    setStatus('');
    try {
      await updateMetadata({ assetId: asset.id, alt: alt.trim(), title: title.trim() });
      setStatus('Description saved.');
    } catch (err) {
      setSaveError(mediaErrorMessage(err, 'The description could not be saved. Try again.'));
    } finally {
      pending.current = false;
      setAction('');
    }
  }

  async function destroy(force) {
    if (pending.current || locked || references === null || usageError) return;
    pending.current = true;
    setAction('delete');
    setDeleteError(null);
    setSaveError(null);
    try {
      await remove({ assetId: asset.id, force });
      onChanged?.({ type: 'deleted', asset });
      onClose();
    } catch (err) {
      if (err.code === 'asset-in-use') {
        // The server found references this modal's own scan may have missed
        // (a doc edited since it ran). Show them and ask again.
        setReferences(err.usage ?? references ?? []);
        setConfirming(true);
      }
      setDeleteError(mediaErrorMessage(err, 'The file could not be deleted. Try again.'));
    } finally {
      pending.current = false;
      setAction('');
    }
  }

  return (
    <ModalShell title={asset.title || asset.filename || 'Asset'} onClose={onClose} busy={busy} returnFocusRef={returnFocusRef}>
      <div className="grid gap-md sm:grid-cols-2">
        <AssetImage
          path={asset.path}
          alt={asset.alt ?? ''}
          className="max-h-64 w-full rounded-admin border-admin-hairline border-admin-rule-hairline object-contain"
        />
        <dl className="text-admin-sm text-admin-ink">
          <dt className="font-semibold">File name</dt>
          <dd className={`mb-2xs break-all ${rowMetaClass}`}>{asset.filename || asset.path?.split('/').pop()}</dd>
          <dt className="font-semibold">Type and size</dt>
          <dd className={`mb-2xs ${rowMetaClass}`}>
            {typeLabel(asset.contentType)} · {formatBytes(asset.size)}
          </dd>
        </dl>
      </div>

      {locked ? <p className="mt-md text-admin-sm text-admin-ink-secondary">{BRANDING_NOTE}</p> : (
        <form className="mt-md flex flex-col gap-sm" onSubmit={save}>
          <TextAreaField label="Image description" hint="Describe what the image shows for people who cannot see it." value={alt} onChange={(value) => { setAlt(value); setStatus(''); }} rows={2} disabled={busy} />
          <TextField label="Title" value={title} onChange={(value) => { setTitle(value); setStatus(''); }} disabled={busy} />
          {status ? <SaveStatus message={status} /> : null}
          {saveError ? <Notice tone="error" message={saveError} /> : null}
          <div className="flex flex-wrap gap-xs">
            <button type="submit" className={primaryButtonClass} disabled={busy}>
              {action === 'save' ? <span className="admin-busy-mark" aria-hidden="true" /> : null}
              {action === 'save' ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      )}

      <section className="mt-md border-admin-rule-hairline border-t-admin-hairline pt-sm">
        <h3 className="text-admin-lg font-bold text-admin-ink">Where this is used</h3>
        <div className="mt-2xs">
          <UsageList references={references} error={usageError} onRetry={() => setScanAttempt((attempt) => attempt + 1)} />
        </div>
        {/* Moment 3: the delete states what it costs before it runs, and
            the in-use case says how many live documents lose their file.
            A locked asset offers no delete at all: the note above says whose
            it is. */}
        <div className="mt-sm flex flex-wrap gap-xs">
          {deleteError ? <Notice tone="error" message={deleteError} /> : null}
          {locked ? null : confirming || (references?.length ?? 0) > 0 ? (
            <DestructiveConfirm
              trigger="Delete this file anyway"
              triggerIcon="delete"
              title="Delete a file that is in use"
              confirmLabel="Delete this file anyway"
              busyLabel="Deleting…"
              busy={busy}
              disabled={busy || references === null || usageError}
              consequence={`This file is deleted, and the ${
                references?.length ?? 0
              } place${
                (references?.length ?? 0) === 1 ? '' : 's'
              } listed above will show a missing image until you choose a replacement.`}
              permanence="This cannot be undone."
              onConfirm={() => destroy(true)}
            />
          ) : (
            <DestructiveConfirm
              trigger="Delete this file"
              triggerIcon="delete"
              title="Delete this file"
              confirmLabel="Delete this file"
              busyLabel="Deleting…"
              busy={busy}
              disabled={busy || references === null || usageError}
              consequence="This file is deleted from your event and the media library."
              permanence="This cannot be undone."
              onConfirm={() => destroy(false)}
            />
          )}
        </div>
      </section>
    </ModalShell>
  );
}
