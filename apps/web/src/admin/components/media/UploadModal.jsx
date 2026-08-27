// Upload modal: pick a file, describe it, send it to `mediaUpload`.
// Admin-only (design brief §5.2, admin story part 2 "the cut file").
//
// Alt text is asked for HERE, at the only moment the uploader is actually
// looking at the image. It is not required — an asset with no description is
// better than an upload someone abandons — but it is the first field, and
// the library marks what is missing so it can be filled in later.
//
// The file limits shown are the same constants storage.rules and
// functions/src/media/upload.cjs enforce; this form checks them before
// spending a slow upload on a file the server will refuse.
import { useState } from 'react';
import {
  MEDIA_FOLDERS,
  MEDIA_MAX_BYTES,
  checkFile,
  formatBytes,
  typeLabel,
} from '../../../lib/mediaSource.js';
import {
  TextAreaField,
  TextField,
  primaryButtonClass,
  secondaryButtonClass,
} from '../formControls.jsx';
import ModalShell from './ModalShell.jsx';

export default function UploadModal({ folder, onClose, onUploaded, upload }) {
  const accepted = MEDIA_FOLDERS[folder] ?? MEDIA_FOLDERS['cms-images'];
  const [file, setFile] = useState(null);
  const [alt, setAlt] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function chooseFile(event) {
    const chosen = event.target.files?.[0] ?? null;
    setFile(chosen);
    setError(chosen ? checkFile(chosen, { types: accepted, maxBytes: MEDIA_MAX_BYTES }) : null);
  }

  async function submit(event) {
    event.preventDefault();
    const problem = checkFile(file, { types: accepted, maxBytes: MEDIA_MAX_BYTES });
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const asset = await upload({ file, folder, alt: alt.trim(), title: title.trim() });
      onUploaded(asset);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell
      title="Upload a file"
      description={`${accepted.map(typeLabel).join(', ')} · up to ${formatBytes(MEDIA_MAX_BYTES)} · stored in ${folder}/`}
      onClose={onClose}
    >
      <form className="flex flex-col gap-sm" onSubmit={submit}>
        <div className="flex flex-col gap-3xs">
          <label htmlFor="media-upload-file" className="text-caption font-semibold text-admin-ink">
            File
          </label>
          <input
            id="media-upload-file"
            type="file"
            accept={accepted.join(',')}
            onChange={chooseFile}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? 'media-upload-error' : undefined}
            className="admin-target w-full rounded-admin border-admin-hairline border-admin-rule-strong bg-admin-ground-input px-sm py-2xs font-admin-ui text-caption text-admin-ink"
          />
          {file ? (
            <p className="font-admin-data text-folio text-admin-ink-data">
              {file.name} · {formatBytes(file.size)}
            </p>
          ) : null}
        </div>

        <TextAreaField
          label="Alt text"
          value={alt}
          onChange={setAlt}
          rows={2}
          hint="What the image shows, for someone who cannot see it. Leave blank for a purely decorative image."
        />
        <TextField
          label="Title (optional)"
          value={title}
          onChange={setTitle}
          hint="A name for this file in the library."
        />

        {error ? (
          <p id="media-upload-error" role="alert" className="text-caption text-admin-state-error">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-xs">
          <button type="submit" className={primaryButtonClass} disabled={busy}>
            {busy ? 'Uploading…' : 'Upload'}
          </button>
          <button type="button" className={secondaryButtonClass} onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
