// UpdateDetail — one published update at /updates/:id (issue #27 follow-up).
// This is the route updatesMeta's self-fetched SSR OG meta describes when a
// specific post id is requested — the OG card's link target has to actually
// resolve, not fall through to the ContentPage catch-all -> NotFound.
// Feature-gated by config/features.updates, same direct-navigation gate as
// SessionDetail.jsx. An id that does not resolve to a visible cmsUpdates doc
// 404s here (never a leaked draft), matching the SSR side's own
// visible === true requirement (functions/src/public/og.cjs).
//
// Editorial base restyle (design brief §2.1): the same back-link, header,
// and body treatment SessionDetail.jsx gives its own detail page.
import { Link, useParams } from 'react-router-dom';
import { useContent } from '../contexts/ContentContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { publishDateLabel, toPublishDate } from '../lib/updateDates.js';

function NotFoundState() {
  return (
    <EmptyState
      title="This update is not available"
      description="It may not be published yet, or the link may be out of date."
      action={
        <Link
          to="/updates"
          className="touch-target inline-flex items-center rounded-brand bg-accent px-md py-xs font-data text-caption font-semibold text-surface hover:bg-accent-strong"
        >
          Back to updates
        </Link>
      }
    />
  );
}

export default function UpdateDetail() {
  const { id } = useParams();
  const { features } = useEventConfig();
  const { updates } = useContent();

  if (!features.updates) {
    return (
      <EmptyState
        title="This event doesn’t have public updates"
        description="Everything else about the event is on the home page."
        action={
          <Link
            to="/"
            className="touch-target inline-flex items-center rounded-brand bg-accent px-md py-xs font-data text-caption font-semibold text-surface hover:bg-accent-strong"
          >
            Go to the home page
          </Link>
        }
      />
    );
  }

  const update = updates.find((u) => u.id === id && u.visible !== false);
  if (!update) return <NotFoundState />;

  const dateLabel = publishDateLabel(update.publishAt);
  const dateInstant = toPublishDate(update.publishAt);

  return (
    <article>
      <p className="mb-md">
        <Link to="/updates" className="font-data text-caption font-semibold text-text-secondary hover:text-text-primary hover:underline">
          ← Back to updates
        </Link>
      </p>
      <header>
        <h1 className="font-heading text-h1 font-semibold text-text-primary">{update.title}</h1>
        {dateLabel ? (
          <p className="mt-2xs font-data text-caption text-text-secondary">
            <time dateTime={dateInstant.toISOString()}>{dateLabel}</time>
          </p>
        ) : null}
      </header>
      {update.body ? (
        <p className="mt-lg max-w-prose whitespace-pre-wrap text-body text-text-secondary" style={{ textWrap: 'pretty' }}>
          {update.body}
        </p>
      ) : null}
    </article>
  );
}
