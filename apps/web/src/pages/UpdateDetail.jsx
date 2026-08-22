// UpdateDetail — one published update at /updates/:id (issue #27 follow-up).
// This is the route updatesMeta's self-fetched SSR OG meta describes when a
// specific post id is requested — the OG card's link target has to actually
// resolve, not fall through to the ContentPage catch-all -> NotFound.
// Feature-gated by config/features.updates, same direct-navigation gate as
// SessionDetail.jsx. An id that does not resolve to a visible cmsUpdates doc
// 404s here (never a leaked draft), matching the SSR side's own
// visible === true requirement (functions/src/public/og.cjs).
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
          className="touch-target inline-flex items-center rounded-brand bg-brand-primary px-6 py-3 font-semibold text-brand-surface hover:bg-brand-primary-dark"
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
            className="touch-target inline-flex items-center rounded-brand bg-brand-primary px-4 py-2 font-semibold text-brand-surface"
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
      <p className="mb-4">
        <Link to="/updates" className="text-sm font-semibold text-brand-primary-dark hover:underline">
          ← Back to updates
        </Link>
      </p>
      <header>
        <h1 className="font-heading text-3xl font-semibold text-brand-ink">{update.title}</h1>
        {dateLabel ? (
          <p className="mt-2 text-brand-ink-muted">
            <time dateTime={dateInstant.toISOString()}>{dateLabel}</time>
          </p>
        ) : null}
      </header>
      {update.body ? (
        <p className="mt-6 max-w-prose whitespace-pre-wrap text-brand-ink" style={{ textWrap: 'pretty' }}>
          {update.body}
        </p>
      ) : null}
    </article>
  );
}
