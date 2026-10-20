// Live updates dashboard card (issue #28, spec §9 "Live updates card"):
// renders the admin-authored `live_updates` feed. Feature-gated by the
// caller (config/features.liveUpdates) — this component only knows how to
// render whatever rows it is handed.
//
// A ruled feed, not a card (design brief §2.1, §5.1): SectionHead opens the
// boundary the way it does everywhere else on the site, each entry is a
// hairline-separated row, and the posted-at timestamp sits in the mono
// face. "Pinned" is the small ruled rectangle DirectoryTag/SessionFormat
// established (issue #113) — never a pill, never a colored badge — and it
// sits beside the timestamp, never above it.
//
// Issue #200 adds three things:
//   - A category, as a second tag beside the timestamp.
//   - The audience, as a tag in words ("For speakers", "For attendees") on
//     a row that is not for everyone, so a reader knows the row is not
//     public. The card shows what it is handed: firestore.rules decide
//     which rows reach it (lib/liveUpdatesSource.js).
//   - The event's key dates, from config/event.milestones (the dates the
//     event settings page edits), in date order and then name order, as a
//     Timeline after the feed. They render when the feed is empty; the card
//     renders nothing only when both are empty. They do not wait for the
//     feed: they are config, already on the page.
import SectionHead from './editorial/SectionHead.jsx';
import Marginalia from './editorial/Marginalia.jsx';
import Tag from './editorial/Tag.jsx';
import Timeline from './editorial/Timeline.jsx';
import { useLiveUpdates } from '../hooks/useLiveUpdates.js';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { sortMilestones } from '../lib/milestones.js';
import { isCalendarDate } from '../lib/eventTime.js';
import { validUpdateCategory } from 'shared/update';

/** The audience tag's words; `everyone` draws no tag. */
const AUDIENCE_TAG = { attendees: 'For attendees', speakers: 'For speakers' };

/** Firestore Timestamp, Date, or epoch millis — whatever the doc carries. */
function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function formatPostedAt(value) {
  const date = toDate(value);
  if (!date) return null;
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

// A key date is a calendar date, not an instant, so it is formatted as the
// wall date it is, in UTC, where no zone can move it to the day before. The
// year is always stated: key dates can run into the next year, and
// "Saturday, February 1" alone does not say which one.
const KEY_DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
});

function keyDateLabel(date) {
  return isCalendarDate(date) ? KEY_DATE_FORMAT.format(new Date(`${date}T00:00:00Z`)) : date;
}

function KeyDates({ milestones }) {
  // Two milestones may share a date and a name, so the index keeps keys apart.
  const entries = milestones.map((milestone, index) => ({
    id: `${index}-${milestone.date}`,
    title: milestone.label,
    date: milestone.date,
    dateLabel: keyDateLabel(milestone.date),
  }));
  return (
    <section aria-labelledby="key-dates-title">
      <SectionHead level={2} id="key-dates-title" title="Key dates" />
      <Timeline entries={entries} level={3} className="mt-sm" />
    </section>
  );
}

export default function LiveUpdatesCard() {
  const { updates, loading } = useLiveUpdates();
  const { eventConfig } = useEventConfig();
  const keyDates = sortMilestones(eventConfig?.milestones);
  const showFeed = !loading && updates.length > 0;

  if (!showFeed && keyDates.length === 0) return null;
  if (!showFeed) return <KeyDates milestones={keyDates} />;

  // Pinned entries lead, newest first within each group — the query itself
  // orders by postedAt desc, so only the pinned/unpinned partition happens
  // client-side.
  const pinned = updates.filter((update) => update.pinned === true);
  const rest = updates.filter((update) => update.pinned !== true);
  const ordered = [...pinned, ...rest];

  const feed = (
    <section aria-labelledby="live-updates-title">
      <SectionHead level={2} id="live-updates-title" title="Live updates" />
      <ul className="mt-sm">
        {ordered.map((update) => {
          const posted = formatPostedAt(update.postedAt);
          // A stored value that fails the shared rule draws nothing, the
          // way the Updates page treats its own category.
          const category = validUpdateCategory(update.category) ? update.category.trim() : null;
          const audienceTag = Object.hasOwn(AUDIENCE_TAG, update.audience ?? '') ? AUDIENCE_TAG[update.audience] : null;
          return (
            <li key={update.id} className="border-t-hairline border-t-rule-hairline py-sm">
              <div className="flex flex-wrap items-center gap-x-sm gap-y-2xs">
                {update.pinned ? (
                  // The pen rings ONE label per page (visual story, Zine,
                  // moment 3), so only the first pinned entry carries the
                  // mark. It goes around the whole label, never around a
                  // word inside a headline, and it is off until a client
                  // turns marginalia on.
                  <span className="marginalia-ring">
                    <Tag>Pinned</Tag>
                    {update.id === ordered[0]?.id ? <Marginalia mark="circle" /> : null}
                  </span>
                ) : null}
                {posted ? (
                  <time
                    dateTime={toDate(update.postedAt)?.toISOString()}
                    className="font-mono text-caption text-text-secondary"
                  >
                    {posted}
                  </time>
                ) : null}
                {category ? <Tag>{category}</Tag> : null}
                {audienceTag ? <Tag>{audienceTag}</Tag> : null}
              </div>
              <p className="mt-2xs whitespace-pre-wrap text-body text-text-secondary">
                {update.message}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );

  if (keyDates.length === 0) return feed;
  return (
    <div className="flex flex-col gap-lg">
      {feed}
      <KeyDates milestones={keyDates} />
    </div>
  );
}
