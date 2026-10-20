// LeadImage — the one optional image that opens a page, beside the copy or
// below it. The device requires alt text, a token-fixed crop, and a stated
// focal point, and all three are enforced here.
//
// The device and its rules: docs/interface-guidelines.md, Editorial devices.
import { useState } from 'react';
import { isSafeHref } from '../lib/sanitizeHtml.js';
import { imageBlockSources } from '../lib/mediaSource.js';

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

/** The lead image is the full column on a phone and a fixed token width beside the copy. */
const LEAD_IMAGE_SIZES = '(min-width: 64rem) 22rem, 100vw';

/**
 * The src, srcset and error handler for an image block's url (issue #333).
 *
 * A picked library path resolves to the bucket and offers its display
 * sizes. If a size fails to load, the srcset goes and the original loads.
 * The event hero uses this too, so the two image devices stay in step.
 *
 * @param {unknown} url a block's url, already through isSafeHref
 * @returns {{ src: unknown, srcSet: string|undefined, onError: () => void }}
 */
export function useSizedImageSources(url) {
  const { src, srcSet } = imageBlockSources(url);
  const [failedFor, setFailedFor] = useState(null);
  const offer = Boolean(srcSet) && failedFor !== src;
  return {
    src,
    srcSet: offer ? srcSet : undefined,
    onError: () => {
      if (offer) setFailedFor(src);
    },
  };
}

/**
 * @param {{ block: object, className?: string }} props
 */
export default function LeadImage({ block, className = '' }) {
  // url is CMS-authored data; the same href allowlist ImageBlock uses keeps
  // data: and attacker-controlled schemes out.
  const alt = typeof block?.alt === 'string' ? block.alt.trim() : '';
  const image = useSizedImageSources(block?.url);
  if (!block?.url || !isSafeHref(block.url) || !alt) return null;

  const caption =
    typeof block.caption === 'string' && block.caption.trim() ? block.caption.trim() : null;

  return (
    <figure className={['lead-image-slot', className].filter(Boolean).join(' ')}>
      <img
        src={image.src}
        srcSet={image.srcSet}
        sizes={image.srcSet ? LEAD_IMAGE_SIZES : undefined}
        onError={image.onError}
        alt={alt}
        loading="lazy"
        className="lead-image rounded-brand outline outline-1 -outline-offset-1 outline-text-primary/[0.08]"
        style={{ objectPosition: focalPosition(block) }}
      />
      {caption ? (
        <figcaption className="mt-2xs font-data text-caption text-text-secondary">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
