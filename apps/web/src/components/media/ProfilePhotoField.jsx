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
// The cropped file stays in the browser until the profile save commits it.
// `profile-photos` allows a public read, so an upload before save would
// publish a photo the attendee has not kept (issues 363 and 372). The save
// uploads first and then writes the path, so a saved path still has an
// object. A failed save deletes that new object. The previous object stays
// until syncUserPublic has published the new path, and that trigger deletes
// it. This field never deletes a path the saved profile still names.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  PROFILE_PHOTO_MAX_BYTES,
  PROFILE_PHOTO_TYPES,
  checkFile,
  formatBytes,
  typeLabel,
  defaultAvatarUrl,
} from '../../lib/mediaSource.js';
import { uploadProfilePhoto } from '../../lib/photoUpload.js';
import AssetImage from './AssetImage.jsx';
import PhotoCrop from './PhotoCrop.jsx';
import DefaultAvatarPicker from './DefaultAvatarPicker.jsx';

const ProfilePhotoField = forwardRef(function ProfilePhotoField({ uid, value, onChange, onPendingChange }, ref) {
  const inputRef = useRef(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // The chosen-but-not-yet-cropped picture (issue #175): the crop step sits
  // between the file picker and the local preview.
  const [cropFile, setCropFile] = useState(null);
  const [pendingFile, setPendingFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function reportPending(pending) {
    onPendingChange?.(pending);
  }

  function replacePreview(file) {
    const next = URL.createObjectURL(file);
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return next;
    });
  }

  function hold(file) {
    setError(null);
    setCropFile(null);
    setPendingFile(file);
    replacePreview(file);
    reportPending(false);
    if (inputRef.current) inputRef.current.value = '';
  }

  useImperativeHandle(ref, () => ({
    hasPending() {
      return pendingFile !== null;
    },
    async commit() {
      if (!pendingFile) return null;
      setBusy(true);
      onPendingChange?.(true);
      setError(null);
      try {
        const { path } = await uploadProfilePhoto({ uid, file: pendingFile });
        onChange(path);
        setPendingFile(null);
        return path;
      } catch (error) {
        setError('Your photo could not be uploaded. Try again.');
        throw error;
      } finally {
        setBusy(false);
        onPendingChange?.(false);
      }
    },
  }), [onChange, onPendingChange, pendingFile, uid]);

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
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    // The upload starts only once the picture has been squared (issue
    // #175); the picker's input is cleared now, so choosing again after a
    // cancel re-fires the change event.
    if (inputRef.current) inputRef.current.value = '';
    setCropFile(file);
    reportPending(true);
  }

  function remove() {
    // Drop the unsaved file and clear the form path. The saved object stays
    // until the profile save lands and syncUserPublic deletes it.
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPendingFile(null);
    onChange('');
  }

  const defaultUrl = defaultAvatarUrl(value);

  return (
    <div className="flex flex-col gap-2">
      <span className="block font-semibold text-text-primary">Photo</span>
      {/* Square portrait, brand radius (design brief §2.4) — not a circle. */}
      <div className="flex items-center gap-4">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt="Your new profile photo"
            className="h-20 w-20 rounded-brand bg-surface-alt object-cover"
          />
        ) : value && !defaultUrl ? (
          <AssetImage
            path={value}
            alt="Your current profile photo"
            className="h-20 w-20 rounded-brand bg-surface-alt object-cover"
          />
        ) : defaultUrl ? (
          <img
            src={defaultUrl}
            alt="Your chosen default avatar"
            className="h-20 w-20 rounded-brand bg-surface-alt object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-20 w-20 items-center justify-center rounded-brand border border-dashed border-text-primary/20 text-xs text-text-secondary"
          >
            None
          </span>
        )}
        <div className="flex flex-col gap-2">
          <label
            htmlFor="profile-photo"
            className="file-input-label touch-target inline-flex w-fit cursor-pointer items-center justify-center rounded-brand border border-text-primary/20 bg-surface px-4 py-2 font-semibold text-text-primary hover:bg-surface-alt"
          >
            {busy ? 'Uploading…' : (value || pendingFile) ? 'Replace photo' : 'Upload a photo'}
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
          {(value || pendingFile) ? (
            <button
              type="button"
              className="touch-target inline-flex w-fit items-center rounded-brand px-3 py-2 text-text-secondary underline hover:bg-surface-alt"
              onClick={remove}
              disabled={busy}
            >
              Remove photo
            </button>
          ) : null}
        </div>
      </div>
      {cropFile ? (
        <PhotoCrop
          file={cropFile}
          label="your profile photo"
          onApply={(file) => hold(file)}
          onCancel={() => {
            setCropFile(null);
            reportPending(false);
          }}
        />
      ) : null}
      <DefaultAvatarPicker value={value} onChange={onChange} namePrefix="profile" />
      <p id="profile-photo-hint" className="text-sm text-text-secondary">
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
});

export default ProfilePhotoField;
