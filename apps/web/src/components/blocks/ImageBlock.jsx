// image: an image by URL; alt is required by the registry contract
// (BLOCK_TYPES.image). The 1px inset outline follows the interface
// guidelines' image treatment, via the text-primary token at 8% — the same
// outline and the same caption treatment LeadImage draws, so the two image
// devices cannot drift apart.
//
// The media library picker stores an object path such as
// `cms-images/{assetId}/{name}`. useSizedImageSources resolves it to the
// bucket, as LeadImage and the event hero do; a bare relative src would
// request a page on the site and show a broken image.
//
// url is CMS-authored data (unvalidated server-side beyond reserved-key
// checks); the same href allowlist keeps data:/attacker-controlled schemes
// out even though javascript: is inert on <img src> in modern browsers.
import { IMAGE_SIZE_WIDTHS } from 'shared/imageSizes';
import { isSafeHref } from '../../lib/sanitizeHtml.js';
import { bundledDemoAssetUrl } from '../../lib/bundledAssets.js';
import { useSizedImageSources } from '../../lib/useImageSizeSrcSet.js';
import ImageFigure from '../media/ImageFigure.jsx';

const [small, medium, large, full] = IMAGE_SIZE_WIDTHS;
const widths = new Map(Object.entries({ small, medium, large, full }));

export default function ImageBlock({ block }) {
  const sources = useSizedImageSources(block?.url);
  if (!block?.url || !isSafeHref(block.url)) return null;
  const width = widths.get(block.size);
  const alignmentClass = block.alignment === 'center' ? 'mx-auto' : block.alignment === 'right' ? 'ml-auto' : '';
  const hasLayout = Boolean(width || alignmentClass);
  const sizes = width ? `(max-width: ${width}px) 100vw, ${width}px` : '100vw';
  const image = (
    <img
      lang={block.publicLanguage}
      src={bundledDemoAssetUrl(block.url) ?? sources.src}
      srcSet={sources.srcSet}
      sizes={sources.srcSet ? sizes : undefined}
      onError={sources.onError}
      alt={block.alt ?? ''}
      loading="lazy"
      className={`h-auto max-w-full rounded-brand outline outline-1 -outline-offset-1 outline-text-primary/[0.08] ${alignmentClass}`}
      style={sources.pending ? { visibility: 'hidden' } : undefined}
    />
  );
  return (
    <ImageFigure
      placement={block}
      assetPath={sources.path}
      className={hasLayout ? `w-fit max-w-full wrap-anywhere ${alignmentClass}` : undefined}
      style={width ? { maxWidth: `min(100%, ${width}px)` } : undefined}
    >
      {image}
    </ImageFigure>
  );
}
