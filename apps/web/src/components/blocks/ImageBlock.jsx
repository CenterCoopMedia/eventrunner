// image: an image by URL; alt is required by the registry contract
// (BLOCK_TYPES.image). The 1px inset outline follows the interface
// guidelines' image treatment, via the text-primary token at 8% — the same
// outline and the same caption treatment LeadImage draws, so the two image
// devices cannot drift apart.
//
// url is CMS-authored data (unvalidated server-side beyond reserved-key
// checks); the same href allowlist keeps data:/attacker-controlled schemes
// out even though javascript: is inert on <img src> in modern browsers.
import { isSafeHref } from '../../lib/sanitizeHtml.js';

export default function ImageBlock({ block }) {
  if (!block?.url || !isSafeHref(block.url)) return null;
  const image = (
    <img
      src={block.url}
      alt={block.alt ?? ''}
      loading="lazy"
      className="h-auto max-w-full rounded-brand outline outline-1 -outline-offset-1 outline-text-primary/[0.08]"
    />
  );
  if (!block.caption) return image;
  return (
    <figure>
      {image}
      <figcaption className="mt-2xs font-data text-caption text-text-secondary">
        {block.caption}
      </figcaption>
    </figure>
  );
}
