// The display sizes for one image, as React state (issue #333).
//
// `pending` is true while the page reads the image's manifest. A caller
// holds the src back until then: a src set first would start the full
// original download that the sizes exist to avoid. The answer is kept per
// path (lib/mediaSource.js), so an image seen before renders at once.
//
// A size that fails to load (a copy removed after the manifest was read,
// or a browser without WebP) calls `onError`, which drops the srcset; the
// original then loads as the src.
import { useEffect, useState } from 'react';
import { imageSizeSrcSet, peekImageSizeSrcSet } from './mediaSource.js';

/**
 * @param {unknown} path the original's object path
 * @param {boolean} enabled false for a caller that wants the original only
 * @returns {{ pending: boolean, srcSet: string|undefined, onError: () => boolean }}
 *   onError answers true when it dropped the srcset, false when the
 *   original itself failed
 */
export function useImageSizeSrcSet(path, enabled = true) {
  const known = enabled ? peekImageSizeSrcSet(path) : null;
  const [loaded, setLoaded] = useState(() => ({ path, srcSet: known }));
  const [failedFor, setFailedFor] = useState(null);

  useEffect(() => {
    if (!enabled || known !== undefined) return undefined;
    let live = true;
    imageSizeSrcSet(path).then((srcSet) => {
      if (live) setLoaded({ path, srcSet });
    });
    return () => {
      live = false;
    };
  }, [path, enabled, known]);

  const answer = known !== undefined ? known : loaded.path === path ? loaded.srcSet : undefined;
  const offer = typeof answer === 'string' && failedFor !== path;
  return {
    pending: enabled && answer === undefined,
    srcSet: offer ? answer : undefined,
    onError: () => {
      if (!offer) return false;
      setFailedFor(path);
      return true;
    },
  };
}
