// The attendee's own photo — the one upload in the product that does NOT go
// through a function.
//
// `profile-photos/{uid}/**` is owner-bound in storage.rules (§8.5), so the
// browser uploads straight to the bucket and the rules are the boundary: the
// uid in the path must equal the uid on the token, the object must be a
// png/jpeg/webp, and it must be under 2 MiB. Routing an attendee photo
// through the admin-gated media endpoints would need an admin, which is
// exactly backwards.
//
// The upload lands BEFORE the profile is saved, and the field only reports
// the new path upward. That ordering is deliberate: an object with no
// profile pointing at it is invisible and costs a few kilobytes, while a
// saved path with no object is a broken image on the attendee directory.
//
// DELETION FOLLOWS THE SAME RULE, which is why this field never deletes
// anything. "Remove photo" only clears the path in the form; the object is
// removed by Profile.jsx AFTER the save commits, once the stored profile —
// and the users_public projection built from it — has stopped referencing
// it. Deleting on click instead would mean an abandoned edit (navigate away,
// failed save, closed tab) leaves the directory pointing at an object that
// no longer exists, which is the one failure mode a photo field must not
// have. The cost is an orphaned object when a save never happens; that is
// cheap, invisible, and collectable by a later maintenance sweep (§9
// cleanup.cjs), whereas a broken avatar is neither.
import { useRef, useState } from 'react';
import {
  PROFILE_PHOTO_MAX_BYTES,
  PROFILE_PHOTO_TYPES,
  checkFile,
  formatBytes,
  typeLabel,
  uploadProfilePhoto,
} from '../../lib/mediaSource.js';
import AssetImage from './AssetImage.jsx';

export default function ProfilePhotoField({ uid, value, onChange }) {
  const inputRef = useRef(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function choose(event) {
    const file = event.target.files?.[0] ?? null;
    if (!file) return;
    const problem = checkFile(file, {
      types: PROFILE_PHOTO_TYPES,
      maxBytes: PROFILE_PHOTO_MAX_BYTES,
      // storage.rules refuses a file of EXACTLY the cap (`size < 2 MiB`).
      exclusive: true,
    });
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { path } = await uploadProfilePhoto({ uid, file });
      onChange(path);
    } catch {
      // A rules refusal and a dropped connection read the same to the person
      // holding the phone: the photo is not up there, try again.
      setError('Your photo could not be uploaded. Try again.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function remove() {
    // Clear the form value only. Profile.jsx deletes the object once the
    // save has committed — see the module header.
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
            alt="Your current profile photo"
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
            htmlFor="profile-photo"
            className="touch-target inline-flex w-fit cursor-pointer items-center justify-center rounded-brand border border-brand-ink/20 bg-brand-surface px-4 py-2 font-semibold text-brand-ink hover:bg-brand-surface-alt"
          >
            {busy ? 'Uploading…' : value ? 'Replace photo' : 'Upload a photo'}
          </label>
          <input
            id="profile-photo"
            ref={inputRef}
            type="file"
            accept={PROFILE_PHOTO_TYPES.join(',')}
            className="sr-only"
            disabled={busy}
            onChange={choose}
            aria-describedby="profile-photo-hint"
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
      <p id="profile-photo-hint" className="text-sm text-brand-ink-muted">
        {PROFILE_PHOTO_TYPES.map(typeLabel).join(', ')} · up to{' '}
        {formatBytes(PROFILE_PHOTO_MAX_BYTES)}. Save your profile to publish the change.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
