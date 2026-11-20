import { useEffect, useState } from 'react';
import { loadLatestUpdatesBlock } from '../components/blocks/registry.jsx';
import { usePublicContent } from '../contexts/PublicLanguageProvider.jsx';
import { withoutSwitchedOffLinks } from './linkTargets.js';

export function usePageSectionBlocks(sections, features) {
  const { pages, getSectionBlocks } = usePublicContent();
  const sectionsById = new Map();
  let needsUpdates = false;
  for (const { id } of sections) {
    const blocks = withoutSwitchedOffLinks(getSectionBlocks(id), features, pages);
    sectionsById.set(id, blocks);
    if (features?.updates && blocks.some((block) => block.blockType === 'latest_updates')) needsUpdates = true;
  }
  const [withUpdates, setWithUpdates] = useState(null);

  useEffect(() => {
    if (!needsUpdates) return undefined;
    let active = true;
    let unsubscribe;
    loadLatestUpdatesBlock().then(({ subscribeLatestUpdates }) => {
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
