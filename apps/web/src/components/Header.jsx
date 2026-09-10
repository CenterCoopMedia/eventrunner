// Header — the site identity and the navigation, in one of four treatments.
// The theme names the default and a page may override it; `standard` is the
// base. The identity is never a heading: each page owns its own <h1>.
//
// The four treatments and their rules: docs/interface-guidelines.md, Headers.
import { Link } from 'react-router-dom';
import { DEFAULT_HEADER, THEME_HEADERS } from 'shared/theme';
import Nameplate from './editorial/Nameplate.jsx';

/**
 * The dates and place line. Figures run in the mono face so they line up as
 * a column. Renders nothing at all rather than an empty line.
 */
function Dateline({ dates, place, className = '' }) {
  if (!dates && !place) return null;
  return (
    <p className={['font-data text-caption text-text-secondary', className].filter(Boolean).join(' ')}>
      {dates ? <span className="font-mono">{dates}</span> : null}
      {dates && place ? ' · ' : null}
      {place}
    </p>
  );
}

/**
 * @param {{
 *   variant?: 'standard' | 'masthead' | 'compact' | 'minimal',
 *   name: string,
 *   dates?: string | null,
 *   place?: string | null,       // the venue's city and region, or its name
 *   mark?: import('react').ReactNode,
 *   to?: string,                 // where the identity links
 *   children?: import('react').ReactNode,  // the navigation
 * }} props
 */
export default function Header({
  variant = DEFAULT_HEADER,
  name,
  dates = null,
  place = null,
  mark = null,
  to = '/',
  children = null,
}) {
  // A theme document is unvalidated runtime data (spec §2.4 fail-soft
  // overlay), so an unrecognized value renders the base header.
  const treatment = THEME_HEADERS.includes(variant) ? variant : DEFAULT_HEADER;

  // THE ROW MAY BREAK A WORD. A flex row is sized from its content's own
  // minimum, and the minimum of a line of text is its longest word — so a
  // name with a long word in it held the whole word and ran past the stage
  // at 320px instead of wrapping inside it. `wrap-anywhere` lowers that
  // minimum as well as drawing the break, and it breaks only a word that
  // cannot fit, so nothing changes at a width where the word fits. It is
  // the same shape the nameplate carries; the measurement is written up
  // there (interface guidelines, Responsive: no page scrolls sideways at
  // 320px).
  const wordmark = (
    <span className="inline-flex items-center gap-xs wrap-anywhere">
      {mark}
      {name}
    </span>
  );
  const identityLink = (body) => (
    <Link to={to} className="hover:underline">
      {body}
    </Link>
  );

  if (treatment === 'masthead') {
    return (
      <div className="border-b-hairline border-b-rule-hairline">
        <Nameplate name={name} dates={dates} edition={place} to={to} mark={mark} />
        {children}
      </div>
    );
  }

  if (treatment === 'minimal') {
    // Where a deployment has no mark the name stands in for it, and either
    // way a screen reader hears the name.
    return (
      <div className="flex flex-wrap items-center gap-x-md gap-y-2xs border-b-hairline border-b-rule-hairline py-sm">
        <p className="font-heading text-body text-text-primary">
          {identityLink(
            mark ? (
              <>
                {mark}
                <span className="sr-only">{name}</span>
              </>
            ) : (
              name
            ),
          )}
        </p>
        {children}
      </div>
    );
  }

  if (treatment === 'compact') {
    // The nameplate device at running-header size.
    return (
      <div className="border-b-hairline border-b-rule-hairline">
        <Nameplate
          variant="compact"
          name={name}
          dates={dates}
          edition={place}
          to={to}
          mark={mark}
        />
        {children}
      </div>
    );
  }

  // standard — the base: the name at normal weight, the dates, the
  // navigation. No device, nothing decorative.
  return (
    <div className="border-b-hairline border-b-rule-hairline">
      <div className="flex flex-wrap items-baseline justify-between gap-x-md gap-y-3xs pt-md">
        <p className="font-heading text-h3 text-text-primary">{identityLink(wordmark)}</p>
        <Dateline dates={dates} place={place} />
      </div>
      {children}
    </div>
  );
}
