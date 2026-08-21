// Updates list — /updates (issue #27 follow-up). Renders the already-live
// cmsUpdates data ContentContext already subscribes to; nothing new to wire
// up to Firestore here. Feature-gated by config/features.updates, same
// direct-navigation-bypasses-nav gate as every other optional route
// (Sponsors.jsx, SessionDetail.jsx). This is also the page updatesMeta's
// self-fetched SSR meta describes when no specific post id is requested.
import { Link } from 'react-router-dom';
import { useContent } from '../contexts/ContentContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { publishDateLabel, sortUpdates, toPublishDate } from '../lib/updateDates.js';

/** First ~200 chars of the body, word-boundary trimmed, for the list card. */
function excerpt(body, maxLen = 200) {
  if (typeof body !== 'string' || !body.trim()) return '';
  const trimmed = body.trim();
  if (trimmed.length <= maxLen) return trimmed;
  const cut = trimmed.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

export default function Updates() {
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

  // The published-source listener already filters visible == true
  // server-side (contentSource.js); this guards a draft-preview overlay
  // (?preview=1), which reads unfiltered.
  const visible = sortUpdates(updates.filter((u) => u?.visible !== false));

  return (
    <article>
      <h1 className="font-heading text-3xl font-semibold text-brand-ink">Updates</h1>
      {visible.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No updates yet"
            description="Announcements appear here once they are published."
          />
        </div>
      ) : (
        <ul className="mt-6 space-y-4">
          {visible.map((update) => {
            const dateLabel = publishDateLabel(update.publishAt);
            return (
              <li
                key={update.id}
                className="rounded-brand-lg border border-brand-ink/10 bg-brand-surface-alt p-5"
              >
                <Link
                  to={`/updates/${update.id}`}
                  className="font-heading text-lg text-brand-ink underline-offset-2 hover:text-brand-primary-dark hover:underline"
                >
                  {update.pinned ? <span aria-hidden="true">📌 </span> : null}
                  {update.title}
                </Link>
                {dateLabel ? (
                  <p className="mt-1 text-sm text-brand-ink-muted">
                    <time dateTime={toPublishDate(update.publishAt).toISOString()}>{dateLabel}</time>
                  </p>
                ) : null}
                {excerpt(update.body) ? (
                  <p className="mt-2 text-brand-ink-muted">{excerpt(update.body)}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}
