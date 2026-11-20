import { useEffect, useState } from 'react';
import { usePublicContent } from '../contexts/PublicLanguageProvider.jsx';
import { withoutSwitchedOffLinks } from './linkTargets.js';

export function usePageSectionBlocks(sections, features) {
  const { pages, getSectionBlocks } = usePublicContent();
  const sectionsById = new Map(sections.map(({ id }) => [
    id,
    withoutSwitchedOffLinks(getSectionBlocks(id), features, pages),
  ]));
  const needsUpdates = Boolean(features?.updates) && [...sectionsById.values()].some((blocks) =>
    blocks.some((block) => block.blockType === 'latest_updates'));
  const [withUpdates, setWithUpdates] = useState(null);

  useEffect(() => {
    if (!needsUpdates) return undefined;
    let active = true;
    let unsubscribe;
    import('../components/blocks/LatestUpdatesBlock.jsx').then(({ subscribeLatestUpdates }) => {
      if (!active) return;
      unsubscribe = subscribeLatestUpdates((resolveBlock) => {
        if (active) setWithUpdates(() => resolveBlock);
      });
    }, (error) => {
      if (active) console.warn('Latest updates block could not load.', error);
    });
    return () => {
      active = false;
      unsubscribe?.();
      setWithUpdates(null);
    };
  }, [needsUpdates]);

  return (id) => (sectionsById.get(id) ?? []).flatMap((block) => {
    if (block.blockType !== 'latest_updates') return [block];
    return needsUpdates && withUpdates ? withUpdates(block) : [];
  });
}
