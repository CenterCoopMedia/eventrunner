import { DEFAULT_LATEST_UPDATES_COUNT, validLatestUpdatesCount } from 'shared/update';
import { usePublicLanguage } from '../../contexts/PublicLanguageContext.jsx';
import { subscribeContentCollection } from '../../lib/contentSource.js';
import { latestPublishedUpdates } from '../../lib/updateDates.js';
import { PublicLink } from '../PublicLink.jsx';

const linkClass = 'break-words underline underline-offset-4';

export function subscribeLatestUpdates(onNext) {
  // Draft pages also link to published posts. One listener supplies all
  // Latest updates blocks on the current page.
  return subscribeContentCollection('cmsUpdates', 'published', (docs) => {
    const updates = latestPublishedUpdates(docs);
    onNext((block) => {
      if (!updates.length) return [];
      const count = validLatestUpdatesCount(block.count) ? block.count : DEFAULT_LATEST_UPDATES_COUNT;
      return [{ ...block, updates: updates.slice(0, count) }];
    });
  });
}

export default function LatestUpdatesBlock({ block }) {
  const { text } = usePublicLanguage();
  if (!block.updates?.length) return null;
  const heading = typeof block.label === 'string' ? block.label.trim() : '';

  return (
    <div>
      {heading ? <h3 lang={block.publicLanguage} className="mb-sm font-heading text-h3 font-semibold">{heading}</h3> : null}
      <ul className="space-y-xs">
        {block.updates.map((update) => (
          <li key={update.id}>
            <PublicLink to={`/updates/${encodeURIComponent(update.id)}`} className={linkClass}>
              {update.title}
            </PublicLink>
          </li>
        ))}
      </ul>
      <p className="mt-xs">
        <PublicLink to="/updates" className={linkClass}>{text('All updates', 'Todas las novedades')}</PublicLink>
      </p>
    </div>
  );
}
