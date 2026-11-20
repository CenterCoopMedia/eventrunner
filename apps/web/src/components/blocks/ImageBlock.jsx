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
import { isSafeHref } from '../../lib/sanitizeHtml.js';
import { bundledDemoAssetUrl } from '../../lib/bundledAssets.js';
import { useSizedImageSources } from '../LeadImage.jsx';

export default function ImageBlock({ block }) {
  const sources = useSizedImageSources(block?.url);
  if (!block?.url || !isSafeHref(block.url)) return null;
  const image = (
    <img
      lang={block.publicLanguage}
      src={bundledDemoAssetUrl(block.url) ?? sources.src}
      srcSet={sources.srcSet}
      sizes={sources.srcSet ? '100vw' : undefined}
      onError={sources.onError}
      alt={block.alt ?? ''}
      loading="lazy"
      className="h-auto max-w-full rounded-brand outline outline-1 -outline-offset-1 outline-text-primary/[0.08]"
      style={sources.pending ? { visibility: 'hidden' } : undefined}
    />
  );
  if (!block.caption) return image;
  return (
    <figure lang={block.publicLanguage}>
      {image}
      <figcaption className="mt-2xs font-data text-caption text-text-secondary">
        {block.caption}
      </figcaption>
    </figure>
  );
}
