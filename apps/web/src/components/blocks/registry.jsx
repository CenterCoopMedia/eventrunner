// Block renderer registry — the frontend half of the BLOCK_TYPES contract
// (functions/src/cms/blockTypes.cjs, spec §5.2). One renderer per registry
// id; the parity test in registry.test.jsx imports the backend registry and
// asserts the two sets match exactly, so adding a block type is a two-file
// change that cannot silently ship half-done.
import TextBlock from './TextBlock.jsx';
import RichTextBlock from './RichTextBlock.jsx';
import ImageBlock from './ImageBlock.jsx';
import CtaBlock from './CtaBlock.jsx';
import StatBlock from './StatBlock.jsx';
import ListItemBlock from './ListItemBlock.jsx';
import FaqItemBlock from './FaqItemBlock.jsx';
import LinkGroupBlock from './LinkGroupBlock.jsx';
import UnknownBlock from './UnknownBlock.jsx';

export const BLOCK_RENDERERS = Object.freeze({
  text: TextBlock,
  richtext: RichTextBlock,
  image: ImageBlock,
  cta: CtaBlock,
  stat: StatBlock,
  list_item: ListItemBlock,
  faq_item: FaqItemBlock,
  link_group: LinkGroupBlock,
});

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
  return <Renderer block={block} />;
}

export { UnknownBlock };
