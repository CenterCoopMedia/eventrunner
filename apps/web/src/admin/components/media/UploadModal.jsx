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
import { useRef, useState } from 'react';
import {
  MEDIA_FOLDERS,
  MEDIA_MAX_BYTES,
  checkFile,
  formatBytes,
  typeLabel,
} from '../../../lib/mediaSource.js';
import {
  FieldError,
  TextAreaField,
  TextField,
  fieldLabelClass,
  inputClass,
  primaryButtonClass,
  rowMetaClass,
  secondaryButtonClass,
} from '../formControls.jsx';
import { mediaErrorMessage } from './mediaErrors.js';
import ModalShell from './ModalShell.jsx';

export default function UploadModal({ folder, onClose, onUploaded, upload, returnFocusRef }) {
  const accepted = MEDIA_FOLDERS[folder] ?? MEDIA_FOLDERS['cms-images'];
  const [file, setFile] = useState(null);
  const [alt, setAlt] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);

  function fileProblem(chosen) {
    if (chosen && !accepted.includes(chosen.type)) return `This file type is not supported. Choose ${accepted.map(typeLabel).join(', ')}.`;
    const problem = checkFile(chosen, { types: accepted, maxBytes: MEDIA_MAX_BYTES });
    return problem && chosen ? `${problem} Choose a smaller file.` : problem;
  }

  function chooseFile(event) {
    const chosen = event.target.files?.[0] ?? null;
    setFile(chosen);
    setError(chosen ? fileProblem(chosen) : null);
  }

  async function submit(event) {
    event.preventDefault();
    if (pending.current) return;
    const problem = fileProblem(file);
    if (problem) {
      setError(problem);
      return;
    }
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const asset = await upload({ file, folder, alt: alt.trim(), title: title.trim() });
      onUploaded(asset);
    } catch (err) {
      setError(mediaErrorMessage(err, 'The file could not be uploaded. Try again.'));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <ModalShell
      title="Upload a file"
      description={`${accepted.map(typeLabel).join(', ')} · Up to ${formatBytes(MEDIA_MAX_BYTES)}`}
      onClose={onClose}
      busy={busy}
      returnFocusRef={returnFocusRef}
    >
      <form className="flex flex-col gap-sm" onSubmit={submit}>
        <div className="flex flex-col gap-3xs">
          <label htmlFor="media-upload-file" className={fieldLabelClass}>
            File
          </label>
          <input
            id="media-upload-file"
            type="file"
            accept={accepted.join(',')}
            onChange={chooseFile}
            disabled={busy}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? 'media-upload-error' : undefined}
            className={inputClass}
          />
          {file ? (
            <p className={rowMetaClass}>
              {file.name} · {formatBytes(file.size)}
            </p>
          ) : null}
        </div>

        <TextAreaField
          label="Image description"
          value={alt}
          onChange={setAlt}
          rows={2}
          disabled={busy}
          hint="What the image shows, for someone who cannot see it. Leave blank for a purely decorative image."
        />
        <TextField
          label="Title (optional)"
          value={title}
          disabled={busy}
          onChange={setTitle}
          hint="A name for this file in the library."
        />

        {/* The one thing on this surface that can be rejected, so it carries
            the announcement a ServerErrorSummary would carry on a page with
            several fields. */}
        <FieldError id="media-upload-error" role="alert" message={error} />

        <div className="flex flex-wrap gap-xs">
          <button type="submit" className={primaryButtonClass} disabled={busy}>
            {busy ? <span className="admin-busy-mark" aria-hidden="true" /> : null}
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
