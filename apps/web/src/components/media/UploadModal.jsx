// Upload modal: pick a file, describe it, send it to `mediaUpload`.
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
} from '../../lib/mediaSource.js';
import {
  TextAreaField,
  TextField,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../admin/components/formControls.jsx';
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
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <div className="flex flex-col gap-1">
          <label htmlFor="media-upload-file" className="text-sm font-semibold text-brand-ink">
            File
          </label>
          <input
            id="media-upload-file"
            type="file"
            accept={accepted.join(',')}
            onChange={chooseFile}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? 'media-upload-error' : undefined}
            className="touch-target w-full rounded-brand border border-brand-ink/20 bg-brand-surface px-3 py-2 text-brand-ink"
          />
          {file ? (
            <p className="text-sm text-brand-ink-muted">
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
          <p id="media-upload-error" role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-3">
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
