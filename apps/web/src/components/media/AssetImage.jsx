// One asset thumbnail. A media_assets row stores an object PATH, not a URL,
// so every rendering site would otherwise repeat the same resolve-and-guard
// dance; this component owns it, including the "the object is gone from the
// bucket while its row survives" case, which arrives as a load error rather
// than a resolve failure now that URLs are built rather than fetched
// (lib/mediaSource.js).
//
// A failed image shows a short message to people who can replace it.
// Decorative images stay silent. Their nearby text supplies the context,
// so a missing sponsor logo does not add a technical message for visitors.
//
// `decorative` is the caller's statement that this image carries no
// information of its own (it is the `alt=""` case, and the two go together).
// A miss then draws nothing at all and says nothing to a screen reader. It
// still occupies the slot, because the layout around it — the sponsor
// wall's mark box, for one — is what sizes that slot, so a silent miss
// leaves an empty frame holding its place instead of collapsing the wall.
//
// DISPLAY SIZES (issue #333). A caller that knows how wide its slot is
// passes `sizes`, and the image then offers the WebP sizes the function
// writes beside an upload, each at the real width its manifest states
// (lib/useImageSizeSrcSet.js). The src waits for the manifest, so the
// original is not downloaded first. The original stays the src. If a size fails to
// load (an upload from before the feature, one still being processed, or
// one the function refused), the image drops the srcset and loads the
// original, and only a failure of the original is a miss. With no `sizes`
// the image is the original alone: an editor's preview shows an upload
// seconds old, before its sizes exist.
import { useEffect, useState } from 'react';
import { assetUrl } from '../../lib/mediaSource.js';
import { useImageSizeSrcSet } from '../../lib/useImageSizeSrcSet.js';

/**
 * THIS COMPONENT RESERVES NO SPACE OF ITS OWN. It renders an <img>, or one
 * <span> standing in its place, and neither states a size — the CALLER's
 * wrapper does. The sponsor wall's `.logo-wall__mark` box, for one, sets
 * the size from the tier's own token, and the image and the miss both fill
 * whatever box they land in. A caller that sizes nothing gets a slot that
 * collapses when the object is missing, which is the caller's decision to
 * make and not this component's to guess.
 *
 * @param {{
 *   path: unknown,
 *   alt?: string,
 *   className?: string,
 *   decorative?: boolean,  // the image carries no information; a miss is silent
 *   sizes?: string,        // the slot's width, for the display sizes
 * }} props
 */
export default function AssetImage({ path, alt = '', className = '', decorative = false, sizes }) {
  const url = assetUrl(path);
  const display = useImageSizeSrcSet(path, Boolean(sizes) && Boolean(url));
  const [failed, setFailed] = useState(false);

  // A new path is a new image: clear the previous failure so one missing
  // object does not poison the slot for everything chosen after it.
  useEffect(() => {
    setFailed(false);
  }, [path]);

  if (!url || failed) {
    if (decorative) {
      // The slot, and nothing in it. aria-hidden because there is nothing
      // here to hear either: a decorative image's absence is not content.
      return <span aria-hidden="true" className={`block ${className}`} />;
    }
    return (
      <span
        className={`flex items-center justify-center bg-surface-alt p-2 text-center text-xs text-text-secondary ${className}`}
      >
        This image could not load. Try again.
      </span>
    );
  }
  return (
    <img
      src={display.pending ? undefined : url}
      srcSet={display.srcSet}
      sizes={display.srcSet ? sizes : undefined}
      alt={alt}
      loading="lazy"
      className={className}
      // Hidden only while the manifest is read, so the alt text does not
      // flash in the slot before the picture.
      style={display.pending ? { visibility: 'hidden' } : undefined}
      onError={() => {
        if (!display.onError()) setFailed(true);
      }}
    />
  );
}
