// Updates list — /updates (issue #27 follow-up). Renders the already-live
// cmsUpdates data ContentContext already subscribes to; nothing new to wire
// up to Firestore here. Feature-gated by config/features.updates, same
// direct-navigation-bypasses-nav gate as every other optional route
// (Sponsors.jsx, SessionDetail.jsx). This is also the page updatesMeta's
// self-fetched SSR meta describes when no specific post id is requested.
//
// A dated column, not a card feed (design brief §2.1, §5.1): a hairline
// opens each row, the publish date sits in the mono face as a true
// left-hand column with tabular figures — the same shape SessionCard.jsx
// gives the schedule — and the title carries the heading face. A rule
// replaces the card border, so nothing here is boxed. "Pinned" is the small
// ruled rectangle DirectoryTag/TypeBadge established (issue #113): never a
// pill, never a colored badge, and it sits beside the title, never above it.
import { Link } from 'react-router-dom';
import { useContent } from '../contexts/ContentContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import SystemPage from '../components/SystemPage.jsx';
import Tag from '../components/editorial/Tag.jsx';
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
            className="touch-target inline-flex items-center rounded-brand bg-accent px-md py-xs font-data text-caption font-semibold text-surface"
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
    <SystemPage pageId="updates">
      <h1 className="font-heading text-h1 font-semibold text-text-primary">Updates</h1>
      {visible.length === 0 ? (
        <div className="mt-lg">
          <EmptyState
            title="No updates yet"
            description="Announcements appear here once they are published."
          />
        </div>
      ) : (
        <ul className="mt-lg">
          {visible.map((update) => {
            const dateLabel = publishDateLabel(update.publishAt);
            const publishDate = toPublishDate(update.publishAt);
            const body = excerpt(update.body);
            return (
              <li key={update.id} className="border-t-hairline border-t-rule-hairline">
                <div className="directory-row grid gap-2xs sm:grid-cols-[9.5rem,1fr] sm:gap-md">
                  <p className="font-mono text-caption text-text-secondary">
                    {dateLabel ? (
                      <time dateTime={publishDate.toISOString()}>{dateLabel}</time>
                    ) : (
                      <span>Undated</span>
                    )}
                  </p>
                  <div>
                    <div className="flex flex-wrap items-baseline gap-x-sm gap-y-2xs">
                      <h2 className="font-heading text-h3 font-semibold text-text-primary">
                        <Link to={`/updates/${update.id}`} className="hover:underline">
                          {update.title}
                        </Link>
                      </h2>
                      {update.pinned ? (
                        <Tag>Pinned</Tag>
                      ) : null}
                    </div>
                    {body ? (
                      <p
                        className="mt-xs max-w-prose text-body text-text-secondary"
                        style={{ textWrap: 'pretty' }}
                      >
                        {body}
                      </p>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SystemPage>
  );
}
