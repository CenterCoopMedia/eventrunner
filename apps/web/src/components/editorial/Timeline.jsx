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
import { PublicLink as Link } from '../PublicLink.jsx';
import { timelineHref, timelineImagePath } from '../../lib/timelineEntry.js';
import AssetImage from '../media/AssetImage.jsx';

/**
 * @param {{
 *   entries: Array<{
 *     id: string,
 *     title: string,
 *     date?: string,        // machine-readable, for <time dateTime>
 *     dateLabel?: string,   // what a reader sees: "2025", "14 October"
 *     body?: string,
 *     href?: string,        // an HTTPS address or internal path
 *     image?: string,       // a media-library object path
 *     alt?: string,
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
    <ol role="list" className={['timeline', className].filter(Boolean).join(' ')}>
      {rows.map((entry) => {
        const href = timelineHref(entry.href);
        const image = timelineImagePath(entry.image);
        const alt = typeof entry.alt === 'string' ? entry.alt.trim() : '';
        let title = entry.title;
        if (href?.startsWith('https://')) {
          title = <a href={href} target="_blank" rel="noopener" className="underline">{title}</a>;
        } else if (href) {
          title = <Link to={href} className="underline">{title}</Link>;
        }
        return (
          <li key={entry.id ?? entry.title} className="timeline__entry">
            <div className="flex flex-wrap items-baseline gap-x-sm gap-y-2xs">
              <Heading className="min-w-0 break-words font-heading text-h3 font-semibold text-text-primary">{title}</Heading>
              {entry.dateLabel ? (
                <p className="timeline__date text-caption text-text-secondary">
                  {entry.date ? <time dateTime={entry.date}>{entry.dateLabel}</time> : entry.dateLabel}
                </p>
              ) : null}
            </div>
            {entry.body ? (
              <p className="mt-xs max-w-prose break-words text-body text-text-secondary text-pretty">{entry.body}</p>
            ) : null}
            {image && alt ? (
              <div className="mt-sm max-w-prose">
                <AssetImage path={image} alt={alt} sizes="(max-width: 40rem) 100vw, 40rem"
                  className="h-auto max-w-full rounded-brand outline outline-1 -outline-offset-1 outline-text-primary/[0.08]" />
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
