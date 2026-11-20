import { useEffect, useMemo } from 'react';
import { DEFAULT_LATEST_UPDATES_COUNT, validLatestUpdatesCount } from 'shared/update';
import { usePublicContent } from '../contexts/PublicLanguageProvider.jsx';
import { withoutSwitchedOffLinks } from './linkTargets.js';
import { compareUpdateDates } from './updateDates.js';

export function usePageSectionBlocks(sections, features) {
  const { pages, getSectionBlocks, publishedUpdates, requestLatestUpdates } = usePublicContent();
  const sectionsById = new Map(sections.map(({ id }) => [
    id,
    withoutSwitchedOffLinks(getSectionBlocks(id), features, pages),
  ]));
  const needsUpdates = Boolean(features?.updates) && [...sectionsById.values()].some((blocks) =>
    blocks.some((block) => block.blockType === 'latest_updates'));

  useEffect(() => {
    if (needsUpdates) requestLatestUpdates?.();
  }, [needsUpdates, requestLatestUpdates]);

  const updates = useMemo(() => needsUpdates ? (publishedUpdates ?? [])
    .filter((update) => update?.visible === true &&
      typeof update.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/u.test(update.id) &&
      typeof update.title === 'string' && update.title.trim())
    .sort(compareUpdateDates) : [], [needsUpdates, publishedUpdates]);

  return (id) => (sectionsById.get(id) ?? []).flatMap((block) => {
    if (block.blockType !== 'latest_updates') return [block];
    const count = validLatestUpdatesCount(block.count) ? block.count : DEFAULT_LATEST_UPDATES_COUNT;
    return updates.length ? [{ ...block, updates: updates.slice(0, count) }] : [];
  });
}
