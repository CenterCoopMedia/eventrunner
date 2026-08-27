// A speaker's own headshot — the wizard's counterpart to ProfilePhotoField
// (spec §9 "Speaker profile wizard", issue #22).
//
// Unlike an attendee photo, `speaker-photos/{speakerId}/**` is
// server-authorized (storage.rules `write: if false`), so the file cannot go
// straight to the bucket — it travels through speakerPhotoUpload
// (functions/src/media/upload.cjs), which checks the caller is either an
// admin or the speaker who owns the record before it writes anything. See
// ProfilePhotoField's header for why the upload lands BEFORE the profile is
// saved, and why this field never deletes the old object itself: the same
// ordering applies here, and SpeakerProfile.jsx is what removes the
// replaced object after a save commits.
import { useRef, useState } from 'react';
import { checkFile } from '../../lib/mediaSource.js';
import {
  SPEAKER_PHOTO_MAX_BYTES,
  SPEAKER_PHOTO_TYPES,
  formatBytes,
  typeLabel,
  uploadSpeakerPhoto,
} from '../../lib/speakerProfileApi.js';
import AssetImage from './AssetImage.jsx';

export default function SpeakerPhotoField({ user, speakerId, value, onChange }) {
  const inputRef = useRef(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function choose(event) {
    const file = event.target.files?.[0] ?? null;
    if (!file) return;
    // Same pre-check ProfilePhotoField runs: a courtesy that turns a server
    // rejection into a sentence before a slow upload even starts, not the
    // boundary — speakerPhotoUpload enforces the same limits server-side.
    const problem = checkFile(file, {
      types: SPEAKER_PHOTO_TYPES,
      maxBytes: SPEAKER_PHOTO_MAX_BYTES,
      exclusive: true,
    });
    if (problem) {
      setError(problem);
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { path } = await uploadSpeakerPhoto({ user, speakerId, file });
      onChange(path);
    } catch (err) {
      setError(err?.message || 'Your photo could not be uploaded. Try again.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function remove() {
    onChange('');
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="block font-semibold text-brand-ink">Photo</span>
      {/* Square portrait, brand radius (design brief §2.4) — not a circle. */}
      <div className="flex items-center gap-4">
        {value ? (
          <AssetImage
            path={value}
            alt="Your current speaker photo"
            className="h-20 w-20 rounded-brand bg-brand-surface-alt object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-20 w-20 items-center justify-center rounded-brand border border-dashed border-brand-ink/20 text-xs text-brand-ink-muted"
          >
            None
          </span>
        )}
        <div className="flex flex-col gap-2">
          <label
            htmlFor="speaker-photo"
            className="touch-target inline-flex w-fit cursor-pointer items-center justify-center rounded-brand border border-brand-ink/20 bg-brand-surface px-4 py-2 font-semibold text-brand-ink hover:bg-brand-surface-alt"
          >
            {busy ? 'Uploading…' : value ? 'Replace photo' : 'Upload a photo'}
          </label>
          <input
            id="speaker-photo"
            ref={inputRef}
            type="file"
            accept={SPEAKER_PHOTO_TYPES.join(',')}
            className="sr-only"
            disabled={busy}
            onChange={choose}
            aria-describedby="speaker-photo-hint"
          />
          {value ? (
            <button
              type="button"
              className="touch-target inline-flex w-fit items-center rounded-brand px-3 py-2 text-brand-ink-muted underline hover:bg-brand-surface-alt"
              onClick={remove}
              disabled={busy}
            >
              Remove photo
            </button>
          ) : null}
        </div>
      </div>
      <p id="speaker-photo-hint" className="text-sm text-brand-ink-muted">
        {SPEAKER_PHOTO_TYPES.map(typeLabel).join(', ')} · up to{' '}
        {formatBytes(SPEAKER_PHOTO_MAX_BYTES)}. Save to publish the change; an organizer reviews it
        before it appears on the public programme.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
