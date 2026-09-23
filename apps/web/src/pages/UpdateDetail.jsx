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
import UpdateContent, { UpdateImage } from '../components/UpdateContent.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { Dateline } from '../components/editorial/Byline.jsx';
import { publishDateLabel, toPublishDate } from '../lib/updateDates.js';
import { primaryActionClass } from '../components/controlClasses.js';

function NotFoundState() {
  return (
    <EmptyState
      title="This update is not available"
      description="It may not be published yet, or the link may be out of date."
      action={
        <Link to="/updates" className={primaryActionClass}>
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
          <Link to="/" className={primaryActionClass}>
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
        {/* The dateline device: the day the update was published, under
            the title and never above it. */}
        {dateLabel ? (
          <Dateline className="mt-2xs" dateTime={dateInstant.toISOString()} label={dateLabel} />
        ) : null}
      </header>
      {update.featuredImage ? <div className="mt-lg"><UpdateImage image={update.featuredImage} /></div> : null}
      {update.body ? (
        <p className="mt-lg max-w-prose whitespace-pre-wrap text-body text-text-secondary text-pretty">
          {update.body}
        </p>
      ) : null}
      <UpdateContent key={update.id} content={update.content} />
    </article>
  );
}
