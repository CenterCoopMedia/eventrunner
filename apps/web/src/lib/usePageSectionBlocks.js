import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_LATEST_UPDATES_COUNT, validLatestUpdatesCount } from 'shared/update';
import { usePublicContent } from '../contexts/PublicLanguageProvider.jsx';
import { withoutSwitchedOffLinks } from './linkTargets.js';

export function usePageSectionBlocks(sections, features) {
  const { pages, getSectionBlocks, publishedUpdates, requestLatestUpdates } = usePublicContent();
  const sectionsById = new Map(sections.map(({ id }) => [
    id,
    withoutSwitchedOffLinks(getSectionBlocks(id), features, pages),
  ]));
  const needsUpdates = Boolean(features?.updates) && [...sectionsById.values()].some((blocks) =>
    blocks.some((block) => block.blockType === 'latest_updates'));
  const [selectUpdates, setSelectUpdates] = useState(null);

  useEffect(() => {
    if (!needsUpdates) return undefined;
    requestLatestUpdates?.();
    let active = true;
    // Keep the update date helpers off pages without this block.
    import('./updateDates.js').then(({ latestPublishedUpdates }) => {
      if (active) setSelectUpdates(() => latestPublishedUpdates);
    }, () => {});
    return () => { active = false; };
  }, [needsUpdates, requestLatestUpdates]);

  const updates = useMemo(() => needsUpdates ? selectUpdates?.(publishedUpdates) ?? [] : [],
    [needsUpdates, publishedUpdates, selectUpdates]);

  return (id) => (sectionsById.get(id) ?? []).flatMap((block) => {
    if (block.blockType !== 'latest_updates') return [block];
    const count = validLatestUpdatesCount(block.count) ? block.count : DEFAULT_LATEST_UPDATES_COUNT;
    return updates.length ? [{ ...block, updates: updates.slice(0, count) }] : [];
  });
}
