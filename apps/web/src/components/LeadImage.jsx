// LeadImage — the one optional image that opens a page, beside the copy or
// below it. The device requires alt text, a token-fixed crop, and a stated
// focal point, and all three are enforced here.
//
// The device and its rules: docs/interface-guidelines.md, Editorial devices.
import { isSafeHref } from '../lib/sanitizeHtml.js';
import { focalPosition, useSizedImageSources } from '../lib/useImageSizeSrcSet.js';
import ImageFigure from './media/ImageFigure.jsx';

/** The lead image is the full column on a phone and a fixed token width beside the copy. */
const LEAD_IMAGE_SIZES = '(min-width: 64rem) 22rem, 100vw';

/**
 * @param {{ block: object, className?: string }} props
 */
export default function LeadImage({ block, className = '' }) {
  // url is CMS-authored data; the same href allowlist ImageBlock uses keeps
  // data: and attacker-controlled schemes out.
  const alt = typeof block?.alt === 'string' ? block.alt.trim() : '';
  const image = useSizedImageSources(block?.url);
  if (!block?.url || !isSafeHref(block.url) || !alt) return null;

  return (
    <ImageFigure placement={block} assetPath={image.path} className={['lead-image-slot', className].filter(Boolean).join(' ')}>
      <img
        src={image.src}
        srcSet={image.srcSet}
        sizes={image.srcSet ? LEAD_IMAGE_SIZES : undefined}
        onError={image.onError}
        alt={alt}
        loading="lazy"
        className="lead-image rounded-brand outline outline-1 -outline-offset-1 outline-text-primary/[0.08]"
        style={{
          objectPosition: focalPosition(block),
          ...(image.pending ? { visibility: 'hidden' } : null),
        }}
      />
    </ImageFigure>
  );
}
