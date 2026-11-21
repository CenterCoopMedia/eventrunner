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
import { formatImageSizeSrcSet, imageBlockSources, imageSizeSrcSet, peekImageSizeSrcSet } from './mediaSource.js';

/**
 * @param {unknown} path the original's object path
 * @param {boolean} enabled false for a caller that wants the original only
 * @param {string|null} publishedSrcSet responsive sources already available at render
 * @returns {{ pending: boolean, srcSet: string|undefined, onError: () => boolean }}
 *   onError answers true when it dropped the srcset, false when the
 *   original itself failed
 */
export function useImageSizeSrcSet(path, enabled = true, publishedSrcSet = null) {
  const known = enabled ? publishedSrcSet ?? peekImageSizeSrcSet(path) : null;
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

/** Where the crop centres when the block states no focal point. */
const CENTRE = 50;

/**
 * The `object-position` for one image block. A stored coordinate is CMS data
 * and may be any type or out of range, so each axis is clamped to a
 * percentage and anything unusable falls back to the centre.
 *
 * @param {object} block a cmsContent image block
 * @returns {string} an `object-position` value
 */
export function focalPosition(block) {
  const axis = (value) =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.max(0, Math.min(100, value))
      : CENTRE;
  return `${axis(block?.focalX)}% ${axis(block?.focalY)}%`;
}

/**
 * The src, srcset and error handler for an image block's url (issue #333).
 *
 * A picked library path resolves to the bucket and offers its display
 * sizes at the real widths its manifest states. Published sizes can be used
 * immediately. Otherwise the src waits for the manifest, so the original
 * is not downloaded first. If a size fails to load, the original loads.
 *
 * @param {unknown} url a block's url, already through isSafeHref
 * @param {Record<string, { width: number, sizes: Array<{ width: number, path: string }> }>} [publishedSizes]
 * @returns {{ path: string|null, src: unknown, srcSet: string|undefined, pending: boolean, onError: () => void }}
 */
export function useSizedImageSources(url, publishedSizes) {
  const { src, path } = imageBlockSources(url);
  const publishedSrcSet = path ? formatImageSizeSrcSet(path, publishedSizes?.[path]) : null;
  const display = useImageSizeSrcSet(path, Boolean(path), publishedSrcSet);
  return {
    path,
    src: display.pending ? undefined : src,
    srcSet: display.srcSet,
    pending: display.pending,
    onError: () => {
      display.onError();
    },
  };
}
