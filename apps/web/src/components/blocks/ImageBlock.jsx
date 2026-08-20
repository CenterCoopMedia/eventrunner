// image: an image by URL; alt is required by the registry contract
// (BLOCK_TYPES.image). The 1px inset outline follows the interface
// guidelines' image treatment, via the ink token at 8%.
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
      className="h-auto max-w-full rounded-brand outline outline-1 -outline-offset-1 outline-brand-ink/[0.08]"
    />
  );
  if (!block.caption) return image;
  return (
    <figure>
      {image}
      <figcaption className="mt-2 text-sm text-brand-ink-muted">
        {block.caption}
      </figcaption>
    </figure>
  );
}
