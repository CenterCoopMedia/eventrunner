// Nameplate — the masthead of the public site (design brief §2.1, §5.1).
//
// A rule-bounded title block carrying the event name, the dates, and the
// edition line. It is type and rules only: never a hero banner, never a
// background image, never a photo behind the name. It replaces the hero
// pattern on every public page, and every public page carries one.
//
// Two treatments, one device:
//   'full'     the name at --text-nameplate with the dateline under it. The
//              home page opener.
//   'compact'  the same block at running-header size, name and dateline on
//              one baseline. Every other page.
// (The `layout.header` page variant in brief §6.2 chooses between them from
// stored data; that schema lands in PR3. Until then the shell picks.)
//
// The dates and the edition line sit INSIDE the rule-bounded block, so they
// are the nameplate device rather than an eyebrow — brief §2.4 names this
// exception explicitly. Nothing else may sit above a title anywhere. WHERE
// inside the block they sit is the Header style's own decision, stated as
// --nameplate-meta-placement and drawn by the `.nameplate__lockup` rule in
// index.css: on their own line under the name, or on the name's baseline at
// the far end of the measure.
//
// The name is a heading on exactly one page. A running masthead repeats
// everywhere, so on an inner page it is a <p> and the page's own <h1> is that
// page's subject. On the home page the masthead IS the subject — the brief's
// own front-page moment sets the nameplate first and the lead headline after
// it — so the shell passes `nameAs="h1"` there. Either way a page carries
// exactly one <h1> (§8.1, semantic heading order).
//
// Two motif slots land inside the block (brief §3.8, §2.3): the
// `nameplate-mark` beside the name, and the `divider` closing the full
// treatment. Both render only where the active set carries them, so a
// preset on the `none` set gets exactly the block it had before. The mark
// yields to a client's own branding mark — a paper prints its own flag, not
// the printer's ornament — and the divider is Atlas's schematic
// line-diagram moment (visual story, Atlas, moment 1).
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
 *   nameAs?: string,           // 'p' by default; 'h1' where the masthead
 *                              // is the page's own subject
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
