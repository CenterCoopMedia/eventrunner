// LeadImage — the one optional image that opens a page (design brief §2.5.2).
//
// It sits beside the opening copy at wide viewports and below it at narrow
// ones. Text never sits over it, so it is never a hero banner.
//
// The device requires three things and enforces all three here: alt text (an
// image without it does not render), a stable crop (the aspect ratio is a
// token, so swapping the picture never reflows the page), and a focal point
// from the block's own data, so the fixed crop keeps the part of the picture
// that matters.
import { isSafeHref } from '../lib/sanitizeHtml.js';

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
 * @param {{ block: object, className?: string }} props
 */
export default function LeadImage({ block, className = '' }) {
  // url is CMS-authored data; the same href allowlist ImageBlock uses keeps
  // data: and attacker-controlled schemes out.
  const alt = typeof block?.alt === 'string' ? block.alt.trim() : '';
  if (!block?.url || !isSafeHref(block.url) || !alt) return null;

  const caption =
    typeof block.caption === 'string' && block.caption.trim() ? block.caption.trim() : null;

  return (
    <figure className={['lead-image-slot', className].filter(Boolean).join(' ')}>
      <img
        src={block.url}
        alt={alt}
        loading="lazy"
        className="lead-image rounded-brand outline outline-1 -outline-offset-1 outline-brand-ink/[0.08]"
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
