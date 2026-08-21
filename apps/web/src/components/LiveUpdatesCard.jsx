// Live updates dashboard card (issue #28, spec §9 "Live updates card"):
// renders the admin-authored `live_updates` feed. Feature-gated by the
// caller (config/features.liveUpdates) — this component only knows how to
// render whatever rows it is handed.
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
    <section
      aria-labelledby="live-updates-title"
      className="rounded-brand-lg border border-brand-ink/10 bg-brand-surface-alt p-5"
    >
      <h2 id="live-updates-title" className="font-heading text-lg font-semibold text-brand-ink">
        Live updates
      </h2>
      <ul className="mt-3 flex flex-col gap-3">
        {ordered.map((update) => {
          const posted = formatPostedAt(update.postedAt);
          return (
            <li key={update.id} className="border-b border-brand-ink/10 pb-3 last:border-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                {update.pinned ? (
                  <span className="rounded-brand border border-brand-accent/40 bg-brand-accent/10 px-2 py-0.5 text-xs font-semibold text-brand-accent">
                    Pinned
                  </span>
                ) : null}
                {posted ? (
                  <time dateTime={toDate(update.postedAt)?.toISOString()} className="text-xs text-brand-ink-muted">
                    {posted}
                  </time>
                ) : null}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-brand-ink">{update.message}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
