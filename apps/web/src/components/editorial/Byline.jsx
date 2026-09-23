// Byline and Dateline — who, in what role, and when (expansion record §3.1).
//
// Both are set in the data face at the caption step through the one
// `byline` contract, because they are the same kind of line: the small
// factual credit under a title. Broadsheet sets them in small capitals with
// tracking, Zine, Atlas and Field Guide in the mono face.
//
// A DATELINE CARRIES THE EVENT'S CLOCK, NEVER THE READER'S. The caller
// formats the label in the event's zone (lib/eventTime.js, lib/updateDates.js)
// and passes the machine-readable instant for <time>; the device never
// reads `Date.now()` and never formats in the browser's zone.
//
// Neither is an eyebrow: both sit below or beside the title they credit.
import { Link } from 'react-router-dom';

/** A string with something in it, or null. */
function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Who, in what role.
 *
 * @param {{
 *   name: string,
 *   role?: string,          // "opening speaker", "programme editor"
 *   href?: string,          // an internal path the name links to
 *   className?: string,
 * }} props
 */
export default function Byline({ name, role, href, className = '' }) {
  const who = text(name);
  if (!who) return null;
  const part = text(role);
  return (
    <p className={['byline', className].filter(Boolean).join(' ')}>
      <span className="byline__name font-semibold text-text-primary">
        {href ? (
          <Link to={href} className="hover:underline">
            {who}
          </Link>
        ) : (
          who
        )}
      </span>
      {part ? <span>, {part}</span> : null}
    </p>
  );
}

/**
 * When, on the event's clock.
 *
 * @param {{
 *   dateTime: string,       // the ISO instant or date for <time>
 *   label: string,          // the same moment, formatted in the event's zone
 *   zone?: string,          // the zone's own label, where the page states one
 *   className?: string,
 * }} props
 */
export function Dateline({ dateTime, label, zone, className = '' }) {
  const words = text(label);
  if (!words) return null;
  return (
    <p className={['byline', className].filter(Boolean).join(' ')}>
      <time dateTime={dateTime}>{words}</time>
      {text(zone) ? <span> {text(zone)}</span> : null}
    </p>
  );
}
