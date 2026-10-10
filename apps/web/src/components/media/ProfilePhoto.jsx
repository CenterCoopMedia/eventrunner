// An attendee's photo, or a lettered stand-in.
//
// THE FRAME IS THE AVATAR DEVICE (expansion record §3.3, components/
// editorial/Avatar.jsx): square on the brand radius, never a circle, the
// initial in the heading face on the alternate ground. What this component
// owns is everything the device does not — which URL a stored path turns
// into, and what happens when the object is gone.
//
// The value comes from `users_public/{uid}.photoPath` — a projection of an
// unvalidated client-written field. Two guards, both deliberate:
//
//   • an uploaded photo must be `profile-photos/{uid}/` for the account
//     this card is showing. Another attendee's object is treated as no
//     photo. Bundled default avatars and fictional demo portraits do not
//     read from the bucket.
//   • a load failure falls back to the initial. A deleted object, an offline
//     bucket, and a path that was never uploaded all end the same way — a
//     directory card that still reads correctly.
//
// The fallback is decorative: the name it stands for is already rendered as
// text beside it, so the stand-in is aria-hidden and a photo carries an
// empty alt for the same reason.
import { useEffect, useState } from 'react';
import { isPublishablePhotoPath } from 'shared/profile';
import { assetUrl, isDefaultAvatarPath, storagePath } from '../../lib/mediaSource.js';
import { bundledDemoAssetUrl } from '../../lib/bundledAssets.js';
import Avatar, { initialOf } from '../editorial/Avatar.jsx';

export { initialOf };

/**
 * Uploaded photos use this account's own prefix. Default avatars and
 * fictional demo speaker portraits resolve only to bundled static assets.
 * Another attendee's object, and any other path, is treated as no photo.
 *
 * @param {unknown} photoPath
 * @param {string} [uid] the account this card belongs to
 */
export function profilePhotoUrl(photoPath, uid) {
  if (typeof photoPath === 'string' && photoPath.startsWith('demo/speakers/')) {
    return bundledDemoAssetUrl(photoPath);
  }
  if (isDefaultAvatarPath(photoPath)) return assetUrl(photoPath);
  if (!isPublishablePhotoPath(uid, photoPath)) return null;
  const path = storagePath(photoPath);
  if (!path) return null;
  return assetUrl(path);
}

/**
 * Three sizes, and each one belongs to a surface rather than to a taste:
 * `lg` is a profile page's own portrait, `md` is a card, and `sm` is the
 * attendee index — a list read one line per person, where a 48px frame
 * would set the row height and undo the compactness the index is for.
 */
export default function ProfilePhoto({ photoPath, displayName, uid, size = 'md', className = '' }) {
  const url = profilePhotoUrl(photoPath, uid);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [url]);

  return (
    <Avatar
      src={failed ? null : url}
      name={displayName}
      size={size}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
