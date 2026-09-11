// Nameplate is the optional editorial title block. Compact headers reuse
// its running identity; the masthead Header now has a compact navigation bar.
// A real client mark is optional. Only the closing divider uses a motif.
// The page owns its h1; the repeated site identity is a paragraph.
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
  // THE ROW MAY BREAK A WORD. A flex row is sized from its content's own
  // minimum, and the minimum of a line of text is its longest word. The
  // demo event's name holds "Harborlight", set at the 44px nameplate size
  // in each style's own face: 241px on Civic, 256px on Field Guide. With
  // the mark and the gutter beside it, that minimum is wider than the
  // 272px stage at 320px in every style, so the word paints out of the
  // block and into the page gutter.
  //
  // MEASURED on a built demo, in headless Chromium at a viewport of
  // exactly 320px, six styles across six routes. Field Guide is the style
  // whose word also crosses the viewport edge — 256px puts its right edge
  // at 328 — and all six of its routes scrolled sideways by 8px. In the
  // specimen book, where the device is framed in a 224px box, Civic went
  // 17px past the viewport and Newsroom 16px.
  //
  // `wrap-anywhere` lowers that minimum as well as drawing the break, which
  // is what lets the row fit a box narrower than its longest word. It
  // breaks only a word that cannot fit, so nothing changes at a width where
  // the word fits (interface guidelines, Responsive).
  //
  // `items-start`, not `items-center` (issue #252): centring aligned the
  // mark with the middle of the whole row, so a name that wrapped to two
  // lines stranded the mark beside the second line instead of the first —
  // the demo name rendered as "Harborlig / ht Media Summit" at 320px with
  // the mark floating between them. Starting the alignment pins the mark to
  // the first line at every width, and to the only line when the name does
  // not wrap: a single-line row keeps its height, so the at-rest figure in
  // every style moves by at most the mark's own overhang, a few pixels.
  const nameBody = (
    <span className="inline-flex items-start gap-xs wrap-anywhere">
      {mark}
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
