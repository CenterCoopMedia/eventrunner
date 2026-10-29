// Profile photos use a bounded server upload endpoint. The browser keeps
// the cropped file local until Save; the saved photo is never overwritten.
//
// The cropped file stays in the browser until the profile save succeeds.
// `profile-photos` allows a public read, so an upload before save would
// publish a photo the attendee has not kept (issues 363 and 372). The save
// uploads first and then writes the path. The local file stays until that
// write succeeds, so a failed save can delete the new object and try the
// same file again. If that delete fails, the next save retries the same
// object. A neutral avatar or Remove drops the local file first. This
// field never deletes a path the saved profile still names.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  PROFILE_PHOTO_MAX_BYTES,
  PROFILE_PHOTO_TYPES,
  checkFile,
  formatBytes,
  typeLabel,
  defaultAvatarUrl,
} from '../../lib/mediaSource.js';
import { deleteOwnPhoto, uploadProfilePhoto } from '../../lib/photoUpload.js';
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
  // Refs, not state: commit() stores the uploaded path and the parent
  // discards it in the same turn, before a re-render can publish state.
  const pendingFileRef = useRef(null);
  const stagedPathRef = useRef(null);
  const stagedExpiryRef = useRef(null);

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

  function rememberFile(file) {
    pendingFileRef.current = file;
    setPendingFile(file);
  }

  function rememberStaged(path, expiresAtMs = null) {
    stagedPathRef.current = path;
    stagedExpiryRef.current = Number.isFinite(expiresAtMs) ? expiresAtMs : null;
  }

  const dropLocal = useCallback(() => {
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    rememberFile(null);
    setCropFile(null);
    onPendingChange?.(false);
  }, [onPendingChange]);

  async function hold(file) {
    if (busy) return;
    const staged = stagedPathRef.current;
    if (staged) {
      try {
        await deleteOwnPhoto(staged);
      } catch {
        setError('Your new photo is still public. Try again.');
        return;
      }
      rememberStaged(null);
    }
    setError(null);
    setCropFile(null);
    rememberFile(file);
    replacePreview(file);
    reportPending(false);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function clearLocal(nextPath) {
    if (busy) return;
    const staged = stagedPathRef.current;
    if (staged) {
      try {
        await deleteOwnPhoto(staged);
      } catch {
        setError('Your new photo is still public. Try again.');
        return;
      }
      rememberStaged(null);
    }
    dropLocal();
    onChange(nextPath);
  }

  useImperativeHandle(ref, () => ({
    hasPending() {
      return pendingFileRef.current !== null;
    },
    async commit() {
      const file = pendingFileRef.current;
      if (!file) return null;
      const staged = stagedPathRef.current;
      if (staged && (stagedExpiryRef.current === null || stagedExpiryRef.current > Date.now())) {
        onChange(staged);
        return staged;
      }
      setBusy(true);
      onPendingChange?.(true);
      setError(null);
      try {
        if (staged) {
          await deleteOwnPhoto(staged);
          rememberStaged(null);
        }
        const { path, expiresAtMs } = await uploadProfilePhoto({ uid, file });
        rememberStaged(path, expiresAtMs);
        onChange(path);
        return path;
      } catch (error) {
        setError('Your photo could not be uploaded. Try again.');
        throw error;
      } finally {
        setBusy(false);
        onPendingChange?.(false);
      }
    },
    release() {
      dropLocal();
      rememberStaged(null);
    },
    async discard() {
      const staged = stagedPathRef.current;
      if (!staged) return;
      await deleteOwnPhoto(staged);
      rememberStaged(null);
    },
  }), [dropLocal, onChange, onPendingChange, uid]);

  async function choose(event) {
    const file = event.target.files?.[0] ?? null;
    if (!file) return;
    const problem = checkFile(file, {
      types: PROFILE_PHOTO_TYPES,
      maxBytes: PROFILE_PHOTO_MAX_BYTES,
      // The upload endpoint refuses a file of exactly 2 MiB.
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
    clearLocal('');
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
      <DefaultAvatarPicker value={value} onChange={clearLocal} namePrefix="profile" />
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
