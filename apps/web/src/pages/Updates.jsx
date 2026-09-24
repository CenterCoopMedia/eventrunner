// Updates list — /updates (issue #27 follow-up). Renders the already-live
// cmsUpdates data ContentContext already subscribes to; nothing new to wire
// up to Firestore here. Feature-gated by config/features.updates, same
// direct-navigation-bypasses-nav gate as every other optional route
// (Sponsors.jsx, SessionDetail.jsx). This is also the page updatesMeta's
// self-fetched SSR meta describes when no specific post id is requested.
//
// A CHRONOLOGICAL FEED WITH A SPINE (design brief §2.1, §5.1; this review).
//
// The dated column was right about the date; what it was missing was
// continuity. This page is a thread of time — what changed, newest first —
// and a run of rows that merely happen to carry dates does not read as one.
// So a hairline runs down the leading edge of every entry and each entry
// hangs a short tick off it, and the run is cut into standing heads a
// reader recognizes: "Pinned" first if the operator held anything to the
// top, then one head per month, then "Undated" for posts with no resolvable
// date. Pinned is not a date, which is exactly why it gets a name instead
// of a month it would otherwise drag to the top of the page.
//
// Nothing is boxed. The spine is a rule, the heads are folios on rules, and
// "Pinned" on an entry is the small ruled rectangle Tag established (issue
// #113): never a pill, never a colored badge, and beside the title, never
// above it.
//
// THE LEAD AND THE CATEGORY (issue #191). An operator can feature a post.
// The first featured post in the feed's order leads the page under its own
// folio, "Featured", before "Pinned", because featured is not a date either.
// It keeps the spine and sets its title a step larger, its date as a
// dateline, and its opening as a standfirst: a lead position, not a card.
// A post's category is a plain Tag beside its title, before "Pinned", and
// it draws only when it passes the rule the server stored it under
// (shared/update validUpdateCategory), so a stray stored value draws
// nothing.
import { Link } from 'react-router-dom';
import { validUpdateCategory } from 'shared/update';
import { useContent } from '../contexts/ContentContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { UpdateImage } from '../components/UpdateContent.jsx';
import EmptyState from '../components/EmptyState.jsx';
import SystemPage from '../components/SystemPage.jsx';
import SectionHead from '../components/editorial/SectionHead.jsx';
import Standfirst from '../components/editorial/Standfirst.jsx';
import Tag from '../components/editorial/Tag.jsx';
import { Dateline } from '../components/editorial/Byline.jsx';
import { groupUpdates, publishDateLabel, sortUpdates, toPublishDate } from '../lib/updateDates.js';
import { primaryActionClass } from '../components/controlClasses.js';

/** First ~200 chars of the body, word-boundary trimmed, for the list card. */
function excerpt(body, maxLen = 200) {
  if (typeof body !== 'string' || !body.trim()) return '';
  const trimmed = body.trim();
  if (trimmed.length <= maxLen) return trimmed;
  const cut = trimmed.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

/** The tags beside a title: the category, then "Pinned". */
function EntryTags({ update }) {
  const category = validUpdateCategory(update.category) ? update.category.trim() : null;
  return (
    <>
      {category ? <Tag>{category}</Tag> : null}
      {update.pinned === true ? <Tag>Pinned</Tag> : null}
    </>
  );
}

/** The featured post at the head of the page (issue #191). */
function LeadEntry({ update, timeZone }) {
  const dateLabel = publishDateLabel(update.publishAt, timeZone);
  const body = excerpt(update.body, 320);
  return (
    <li className="update-feed__entry">
      <div className="flex flex-wrap items-baseline gap-x-sm gap-y-2xs">
        <h3 className="font-heading text-h2 font-semibold text-text-primary">
          <Link to={`/updates/${update.id}`} className="hover:underline">
            {update.title}
          </Link>
        </h3>
        <EntryTags update={update} />
      </div>
      {dateLabel ? (
        <Dateline
          className="mt-3xs"
          dateTime={toPublishDate(update.publishAt).toISOString()}
          label={dateLabel}
        />
      ) : (
        <p className="byline mt-3xs">Undated</p>
      )}
      {update.featuredImage ? <div className="mt-sm max-w-2xl"><UpdateImage image={update.featuredImage} /></div> : null}
      {body ? <Standfirst className="mt-xs">{body}</Standfirst> : null}
    </li>
  );
}

export default function Updates() {
  const { features, eventConfig } = useEventConfig();
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
        <div className="update-feed mt-lg">
          {groupUpdates(visible, eventConfig?.timezone).map((run, index) => (
            <section
              key={`${run.kind}-${run.label}`}
              aria-labelledby={`update-run-${index}`}
              className="mt-lg first:mt-0"
            >
              <SectionHead
                variant="folio"
                level={2}
                id={`update-run-${index}`}
                title={run.label}
                rule="hairline"
              />
              <ul className="mt-sm">
                {run.kind === 'lead' ? (
                  <LeadEntry key={run.members[0].id} update={run.members[0]} timeZone={eventConfig?.timezone} />
                ) : run.members.map((update) => {
                  const dateLabel = publishDateLabel(update.publishAt, eventConfig?.timezone);
                  const publishDate = toPublishDate(update.publishAt);
                  const body = excerpt(update.body);
                  return (
                    <li key={update.id} className="update-feed__entry">
                      {/* Title first, day second. An entry on the spine is
                          one column at every width, so a date set above the
                          heading would be an eyebrow, and the ban holds at
                          every size (brief §2.4). SessionCard.jsx carries
                          the same order for the same reason. */}
                      <div className="flex flex-wrap items-baseline gap-x-sm gap-y-2xs">
                        <h3 className="font-heading text-h3 font-semibold text-text-primary">
                          <Link to={`/updates/${update.id}`} className="hover:underline">
                            {update.title}
                          </Link>
                        </h3>
                        <EntryTags update={update} />
                      </div>
                      {/* The day, in the mono face with tabular figures —
                          the run's head already carries the month, so the
                          entry says the day and does not repeat it. */}
                      <p className="mt-3xs font-mono text-caption text-text-secondary">
                        {dateLabel ? (
                          <time dateTime={publishDate.toISOString()}>{dateLabel}</time>
                        ) : (
                          <span>Undated</span>
                        )}
                      </p>
                      {update.featuredImage ? <div className="mt-sm max-w-xl"><UpdateImage image={update.featuredImage} /></div> : null}
                      {body ? (
                        <p
                          className="mt-xs max-w-prose text-body text-text-secondary text-pretty"
                        >
                          {body}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </SystemPage>
  );
}
