// Live updates dashboard card (issue #28, spec §9 "Live updates card"):
// renders the admin-authored `live_updates` feed. Feature-gated by the
// caller (config/features.liveUpdates) — this component only knows how to
// render whatever rows it is handed.
//
// A ruled feed, not a card (design brief §2.1, §5.1): SectionHead opens the
// boundary the way it does everywhere else on the site, each entry is a
// hairline-separated row, and the posted-at timestamp sits in the mono
// face. "Pinned" is the small ruled rectangle DirectoryTag/TypeBadge
// established (issue #113) — never a pill, never a colored badge — and it
// sits beside the timestamp, never above it.
import SectionHead from './editorial/SectionHead.jsx';
import Tag from './editorial/Tag.jsx';
import { useLiveUpdates } from '../hooks/useLiveUpdates.js';

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

export default function LiveUpdatesCard() {
  const { updates, loading } = useLiveUpdates();

  if (loading) return null;
  if (updates.length === 0) return null;

  // Pinned entries lead, newest first within each group — the query itself
  // orders by postedAt desc, so only the pinned/unpinned partition happens
  // client-side.
  const pinned = updates.filter((update) => update.pinned === true);
  const rest = updates.filter((update) => update.pinned !== true);
  const ordered = [...pinned, ...rest];

  return (
    <section aria-labelledby="live-updates-title">
      <SectionHead level={2} id="live-updates-title" title="Live updates" />
      <ul className="mt-sm">
        {ordered.map((update) => {
          const posted = formatPostedAt(update.postedAt);
          return (
            <li key={update.id} className="border-t-hairline border-t-rule-hairline py-sm">
              <div className="flex flex-wrap items-center gap-x-sm gap-y-2xs">
                {update.pinned ? (
                  <Tag>Pinned</Tag>
                ) : null}
                {posted ? (
                  <time
                    dateTime={toDate(update.postedAt)?.toISOString()}
                    className="font-mono text-caption text-text-secondary"
                  >
                    {posted}
                  </time>
                ) : null}
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
}
