// Header — the site identity and the navigation, in one of four treatments.
// The theme names the default and a page may override it; `standard` is the
// base. The identity is never a heading: each page owns its own <h1>.
//
// The four treatments and their rules: docs/interface-guidelines.md, Headers.
import { Link } from 'react-router';
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
 *   mobileControl?: import('react').ReactNode, // small-screen navigation disclosure
 *   actions?: import('react').ReactNode, // account controls when navigation is beside the page
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
  mobileControl = null,
  actions = null,
}) {
  // A theme document is unvalidated runtime data (spec §2.4 fail-soft
  // overlay), so an unrecognized value renders the base header.
  const treatment = THEME_HEADERS.includes(variant) ? variant : DEFAULT_HEADER;

  // The repeated title uses one line. Beside a mark on phones,
  // it remains available to screen readers without taking layout space.
  const title = (
    <span className={`site-header-title block min-w-0 truncate${mark ? ' site-header-title--with-mark' : ''}`}>
      {name}
    </span>
  );
  const wordmark = (
    <span className="inline-flex max-w-full items-start gap-xs">
      {mark}
      {title}
    </span>
  );
  const identityLink = (body) => (
    <Link to={to} className="hover:underline">
      {body}
    </Link>
  );

  if (treatment === 'masthead') {
    return (
      <div className="site-masthead site-header-treatment">
        <div className="site-masthead__bar">
          <p className="site-masthead__identity font-heading">{identityLink(wordmark)}</p>
          {mobileControl}
          {actions}
          {children}
        </div>
      </div>
    );
  }

  if (treatment === 'minimal') {
    // Where a deployment has no mark the name stands in for it, and either
    // way a screen reader hears the name.
    return (
      <div className="site-header-treatment site-header-minimal flex flex-wrap items-center gap-x-md gap-y-2xs border-b-hairline border-b-rule-hairline py-sm">
        <p className="site-header-identity font-heading text-body text-text-primary">
          {identityLink(
            mark ? (
              <>
                {mark}
                <span className="sr-only">{name}</span>
              </>
            ) : (
              wordmark
            ),
          )}
        </p>
        {mobileControl}
        {actions}
        {children}
      </div>
    );
  }

  if (treatment === 'compact') {
    // The nameplate device at running-header size.
    return (
      <div className="site-header-treatment border-b-hairline border-b-rule-hairline">
        <div className="site-header-identity-row">
          <Nameplate
            variant="compact"
            name={title}
            dates={dates}
            edition={place}
            to={to}
            mark={mark}
          />
          {mobileControl}
          {actions}
        </div>
        {children}
      </div>
    );
  }

  // standard — the base: the name at normal weight, the dates, the
  // navigation. No device, nothing decorative.
  return (
    <div className="site-header-treatment border-b-hairline border-b-rule-hairline">
      <div className="site-header-identity-row flex flex-wrap items-baseline justify-between gap-x-md gap-y-3xs pt-md">
        <p className="site-header-identity font-heading text-h3 text-text-primary">{identityLink(wordmark)}</p>
        <Dateline dates={dates} place={place} className="site-header-dateline" />
        {mobileControl}
        {actions}
      </div>
      {children}
    </div>
  );
}
