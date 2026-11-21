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
import { imageDimensions } from '@generated/siteContent.js';
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
  // The live content overlay can replace a block while retaining its upload path.
  const dimensions = sources.path ? imageDimensions[sources.path] : undefined;
  // Uploads wider than the smallest copy used the srcset slot as their natural width.
  const fillsSlot = dimensions?.width > small;
  const image = (
    <img
      lang={block.publicLanguage}
      src={bundledDemoAssetUrl(block.url) ?? sources.src}
      srcSet={sources.srcSet}
      sizes={sources.srcSet ? sizes : undefined}
      onError={sources.onError}
      alt={block.alt ?? ''}
      width={dimensions?.width}
      height={dimensions?.height}
      loading="lazy"
      className={`h-auto max-w-full rounded-brand outline outline-1 -outline-offset-1 outline-text-primary/[0.08] ${alignmentClass}${fillsSlot ? ' w-full' : ''}`}
      style={sources.pending ? {
        visibility: 'hidden',
        aspectRatio: dimensions ? `${dimensions.width} / ${dimensions.height}` : undefined,
      } : undefined}
    />
  );
  return (
    <ImageFigure
      placement={block}
      assetPath={sources.path}
      className={hasLayout ? `w-fit max-w-full wrap-anywhere ${alignmentClass}` : undefined}
      style={width || fillsSlot ? {
        width: fillsSlot ? '100%' : undefined,
        maxWidth: width ? `min(100%, ${width}px)` : undefined,
      } : undefined}
    >
      {image}
    </ImageFigure>
  );
}
