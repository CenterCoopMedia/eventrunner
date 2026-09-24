// Timeline — dated entries in order, on a spine (expansion record §3.1).
//
// Past editions, key dates, milestones. It is an ORDERED list, because the
// order is the content, and each entry hangs off the same hairline spine
// the updates feed draws (the `timeline` contract; `.update-feed__entry`
// reads the same tokens), so a list of years and a list of announcements
// read as one thread of time.
//
// THE NUMBERS ARE YEARS AND DATES, NEVER SEQUENCE ORNAMENTS. The list draws
// no counter and nothing zero-padded (brief §2.4): an entry's number is the
// date it carries, in the mono face with tabular figures, and it sits
// BESIDE the entry's title on the same line — never above it, because
// nothing sits directly above a heading.
import { Link } from 'react-router-dom';

/**
 * @param {{
 *   entries: Array<{
 *     id: string,
 *     title: string,
 *     date?: string,        // machine-readable, for <time dateTime>
 *     dateLabel?: string,   // what a reader sees: "2025", "14 October"
 *     body?: string,
 *     href?: string,        // an internal path the title links to
 *   }>,
 *   level?: 2 | 3 | 4,
 *   className?: string,
 * }} props
 */
export default function Timeline({ entries, level = 3, className = '' }) {
  const rows = (Array.isArray(entries) ? entries : []).filter(
    (entry) => entry && typeof entry.title === 'string' && entry.title.trim(),
  );
  if (rows.length === 0) return null;
  const Heading = `h${level >= 2 && level <= 6 ? level : 3}`;
  return (
    <ol className={['timeline', className].filter(Boolean).join(' ')}>
      {rows.map((entry) => (
        <li key={entry.id ?? entry.title} className="timeline__entry">
          <div className="flex flex-wrap items-baseline gap-x-sm gap-y-2xs">
            <Heading className="font-heading text-h3 font-semibold text-text-primary">
              {entry.href ? (
                <Link to={entry.href} className="hover:underline">
                  {entry.title}
                </Link>
              ) : (
                entry.title
              )}
            </Heading>
            {entry.dateLabel ? (
              <p className="timeline__date text-caption text-text-secondary">
                {entry.date ? <time dateTime={entry.date}>{entry.dateLabel}</time> : entry.dateLabel}
              </p>
            ) : null}
          </div>
          {entry.body ? (
            <p className="mt-xs max-w-prose text-body text-text-secondary text-pretty">{entry.body}</p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
