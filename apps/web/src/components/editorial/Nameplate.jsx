// Nameplate — the rule-bounded title block: the event name, the dates, and
// the edition line, in type and rules only. `full` is the `masthead` header
// and `compact` is the `compact` one (Header.jsx).
//
// The device and its rules: docs/interface-guidelines.md, Editorial devices.
//
// Three things the guidelines do not carry, because they are wiring:
//
// WHERE THE DATELINE SITS is the Header style's decision, not this file's.
// The dates and the edition line always sit inside the rule-bounded block —
// that is what keeps them the nameplate device rather than an eyebrow — and
// `--nameplate-meta-placement` chooses between a line of their own under the
// name and the name's own baseline at the far end of the measure. The
// `.nameplate__lockup` rule in index.css draws it.
//
// THE NAME IS A HEADING ON EXACTLY ONE PAGE. A running masthead repeats
// everywhere, so on an inner page it is a <p> and the page's own <h1> is
// that page's subject. On the home page the masthead IS the subject, so the
// shell passes `nameAs="h1"` there. Either way a page carries exactly one
// <h1>.
//
// TWO MOTIF SLOTS land inside the block: the `nameplate-mark` beside the
// name, and the `divider` closing the full treatment. Both render only where
// the active set carries them, so a preset on the `none` set gets exactly
// the block it had before. The mark yields to a client's own branding mark —
// a paper prints its own flag, not the printer's ornament.
import { Link } from 'react-router-dom';
import { formatEventDateRange } from '../../lib/eventTime.js';
import Motif from './Motif.jsx';

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
      {mark ?? (
        <Motif
          slot="nameplate-mark"
          className={compact ? 'h-6 w-6 shrink-0' : 'h-10 w-10 shrink-0'}
        />
      )}
      {name}
    </span>
  );
  // The literal class matters: Tailwind scans for whole strings, and
  // `nameplate__meta` carries the rule that reads the Header style's
  // --nameplate-meta-placement (components/editorial/purge.test.js).
  const dateline =
    dates || edition ? (
      <p className="nameplate__meta font-data text-caption text-text-secondary">
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
      <div className="nameplate__lockup">
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
      {compact ? null : <Motif slot="divider" className="mt-sm" />}
      {/* Coordinate marks: two corners of a survey sheet's title block
          (brief §4.6). They draw at --nameplate-corner-mark-width, which is
          zero in every preset that is not locating something on a sheet, so
          a mark never appears where nothing is being located. */}
      <span aria-hidden="true" className="nameplate__coordinate nameplate__coordinate--start" />
      <span aria-hidden="true" className="nameplate__coordinate nameplate__coordinate--end" />
    </div>
  );
}
