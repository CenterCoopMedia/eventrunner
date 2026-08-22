// An attendee's photo, or a lettered stand-in.
//
// The value comes from `users_public/{uid}.photoPath` — a projection of an
// unvalidated client-written field. Two guards, both deliberate:
//
//   • only a `profile-photos/` path renders. The rules type-check photoPath
//     as a string but say nothing about WHICH object it names, so a profile
//     could point at any path in the bucket; anything else is treated as no
//     photo rather than fetched.
//   • a load failure falls back to the initial. A deleted object, an offline
//     bucket, and a path that was never uploaded all end the same way — a
//     directory card that still reads correctly.
//
// The fallback is decorative: the name it stands for is already rendered as
// text beside it, so the whole component is aria-hidden when there is no
// photo, and a photo carries an empty alt for the same reason.
import { useEffect, useState } from 'react';
import { assetUrl, storagePath } from '../../lib/mediaSource.js';

/** The first letter of a display name, for the stand-in. */
export function initialOf(displayName) {
  const name = typeof displayName === 'string' ? displayName.trim() : '';
  return name ? Array.from(name)[0].toUpperCase() : '?';
}

/** Only an object under the owner-bound namespace is rendered. */
export function profilePhotoUrl(photoPath) {
  const path = storagePath(photoPath);
  if (!path || !path.startsWith('profile-photos/')) return null;
  return assetUrl(path);
}

export default function ProfilePhoto({ photoPath, displayName, size = 'md', className = '' }) {
  const url = profilePhotoUrl(photoPath);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [url]);

  const dimensions = size === 'lg' ? 'h-24 w-24 text-2xl' : 'h-12 w-12 text-base';
  const shared = `shrink-0 rounded-full object-cover ${dimensions} ${className}`;

  if (!url || failed) {
    return (
      <span
        aria-hidden="true"
        className={`flex items-center justify-center bg-brand-surface font-heading font-semibold text-brand-ink-muted outline outline-1 -outline-offset-1 outline-brand-ink/[0.12] ${shared}`}
      >
        {initialOf(displayName)}
      </span>
    );
  }
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      className={`bg-brand-surface outline outline-1 -outline-offset-1 outline-brand-ink/[0.08] ${shared}`}
      onError={() => setFailed(true)}
    />
  );
}
