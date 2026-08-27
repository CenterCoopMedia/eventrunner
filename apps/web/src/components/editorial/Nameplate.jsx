// Nameplate — the rule-bounded title block that the `masthead` header draws
// (design brief §2.1). It carries the event name, the dates, and the edition
// line, in type and rules only: never a hero banner, never a photo behind
// the name.
//
// This is a theme device, not the base header. A theme opts into it through
// config/theme.header; the base header is `standard` (Header.jsx).
//
// The dates and the edition line sit INSIDE the rule-bounded block, which is
// the one place brief §2.4 allows metadata beside a title.
//
// Two treatments: 'full' sets the name at --text-nameplate with the dateline
// under it, 'compact' sets the same block at running-header size with the
// name and dateline on one baseline.
import { Link } from 'react-router-dom';
import { formatEventDateRange } from '../../lib/eventTime.js';

/**
 * Derive the nameplate's three lines from config/event.
 *
 * config/event is runtime data that a live write can replace with a partial
 * or malformed object (spec §2.4 fail-soft overlay), so every field is type
 * checked and a line that cannot be resolved is simply not rendered.
 *
 * @param {object} eventConfig
 * @param {{ compact?: boolean }} [options] compact prefers the short name.
 * @returns {{ name: string, dates: string | null, edition: string | null }}
 */
export function buildNameplate(eventConfig, { compact = false } = {}) {
  const str = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
  const full = str(eventConfig?.name);
  const short = str(eventConfig?.shortName);
  const venue = eventConfig?.venue && typeof eventConfig.venue === 'object' ? eventConfig.venue : {};
  const place = [str(venue.city), str(venue.region)].filter(Boolean).join(', ');
  return {
    name: (compact ? short || full : full || short) ?? '',
    dates: formatEventDateRange(eventConfig?.days, eventConfig?.timezone),
    edition: place || str(venue.name),
  };
}

/**
 * @param {{
 *   name: string,
 *   dates?: string | null,
 *   edition?: string | null,
 *   variant?: 'full' | 'compact',
 *   to?: string | null,        // wraps the name in a link when set
 *   mark?: import('react').ReactNode,  // optional branding mark, inline
 *   nameAs?: string,           // 'p' by default: the running site identity
 *                              // is not a heading, so the page keeps its h1
 *   nameId?: string,
 *   className?: string,
 * }} props
 */
export default function Nameplate({
  name,
  dates = null,
  edition = null,
  variant = 'full',
  to = null,
  mark = null,
  nameAs: NameTag = 'p',
  nameId,
  className = '',
}) {
  const compact = variant === 'compact';
  const nameBody = (
    <span className="inline-flex items-center gap-xs">
      {mark}
      {name}
    </span>
  );
  const dateline =
    dates || edition ? (
      <p
        className={[
          'font-data text-caption text-text-secondary',
          compact ? '' : 'mt-2xs',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {dates ? <span className="font-mono">{dates}</span> : null}
        {dates && edition ? ' · ' : null}
        {edition}
      </p>
    ) : null;

  return (
    <div
      className={['nameplate', compact ? 'nameplate--compact' : '', className]
        .filter(Boolean)
        .join(' ')}
    >
      <div
        className={
          compact ? 'flex flex-wrap items-baseline justify-between gap-x-md gap-y-3xs' : ''
        }
      >
        <NameTag id={nameId} className="nameplate__name font-heading font-semibold">
          {to ? (
            <Link to={to} className="hover:underline">
              {nameBody}
            </Link>
          ) : (
            nameBody
          )}
        </NameTag>
        {dateline}
      </div>
    </div>
  );
}
