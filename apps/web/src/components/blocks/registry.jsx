// Block renderer registry — the frontend half of the BLOCK_TYPES contract
// (functions/src/cms/blockTypes.cjs, spec §5.2). One renderer per registry
// id; the parity test in registry.test.jsx imports the backend registry and
// asserts the two sets match exactly, so adding a block type is a two-file
// change that cannot silently ship half-done.
import { lazy, Suspense } from 'react';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { mapBlockFields, mapVenueFields } from './mapBlockFields.js';
import TextBlock from './TextBlock.jsx';
import RichTextBlock from './RichTextBlock.jsx';
import ImageBlock from './ImageBlock.jsx';
import CtaBlock from './CtaBlock.jsx';
import StatBlock from './StatBlock.jsx';
import FactBlock from './FactBlock.jsx';
import ListItemBlock from './ListItemBlock.jsx';
import UnknownBlock from './UnknownBlock.jsx';

export const BLOCK_RENDERERS = Object.freeze({
  // Keep the Home hero, information cards and opening copy ready for first
  // paint. Add new block types with a dynamic import.
  text: TextBlock,
  richtext: RichTextBlock,
  image: ImageBlock,
  cta: CtaBlock,
  stat: StatBlock,
  fact: FactBlock,
  list_item: ListItemBlock,
  map: lazy(() => import('./MapBlock.jsx')),
  quote: lazy(() => import('./QuoteBlock.jsx')),
  faq_item: lazy(() => import('./FaqItemBlock.jsx')),
  link_group: lazy(() => import('./LinkGroupBlock.jsx')),
  sponsor_package: lazy(() => import('./SponsorPackageBlock.jsx')),
  gallery: lazy(() => import('./GalleryBlock.jsx')),
});

function MapPlaceholder({ address }) {
  return (
    <div aria-hidden="true" className="invisible w-full max-w-prose space-y-xs">
      <div className="aspect-[4/3] min-h-[200px] w-full" />
      {address ? <p className="text-body">{address}</p> : null}
      <span>&nbsp;</span>
    </div>
  );
}

function VenueMapPlaceholder({ address }) {
  const { eventConfig } = useEventConfig();
  const venue = mapVenueFields(eventConfig?.venue);
  return venue ? <MapPlaceholder address={address || venue.address} /> : null;
}

function BlockPlaceholder({ block }) {
  if (block.blockType === 'map') {
    const fields = mapBlockFields(block);
    if (!fields) return null;
    return block.useEventVenue === true
      ? <VenueMapPlaceholder address={fields.address} />
      : <MapPlaceholder address={fields.address} />;
  }
  if (block.blockType === 'link_group') {
    return <li aria-hidden="true" className="min-h-11" />;
  }
  if (block.blockType === 'faq_item') {
    return (
      <div aria-hidden="true" className="invisible border-hairline">
        <div className="touch-target flex items-center px-md py-sm font-heading text-lead">
          {typeof block.question === 'string' ? block.question : null}
        </div>
      </div>
    );
  }
  if (block.blockType === 'gallery') {
    // The gallery draws its pictures in fixed boxes; hold a box's height.
    return <div aria-hidden="true" className="invisible aspect-[3/2] w-full" />;
  }
  // Prose and quotations have variable height. Leave room for their first
  // lines while the chunk loads, without adding a wrapper to the final DOM.
  return <div aria-hidden="true" className="min-h-16" />;
}

/** Renderer for an id — UnknownBlock for anything outside the registry.
 * Own-property check so prototype names ('toString') never resolve. */
export function rendererFor(blockType) {
  return typeof blockType === 'string' &&
    Object.prototype.hasOwnProperty.call(BLOCK_RENDERERS, blockType)
    ? BLOCK_RENDERERS[blockType]
    : UnknownBlock;
}

/** Render one cmsContent block through the registry. */
export default function BlockRenderer({ block }) {
  const Renderer = rendererFor(block?.blockType);
  return (
    <Suspense fallback={block ? <BlockPlaceholder block={block} /> : null}>
      <Renderer block={block} />
    </Suspense>
  );
}

export { UnknownBlock };
