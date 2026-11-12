// The page a new site shows visitors until its team first publishes
// (lib/launchSource.js). It states what is already true from setup — the
// event's name, its dates, its place — and the one action a visitor can
// take, so a client's link is never a page of starter text.
import { Link } from 'react-router';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { useDocumentTitle } from '../lib/useDocumentTitle.js';
import { usePitchCallOpen } from '../lib/usePitchCallOpen.js';
import { useRegistrationLink } from '../lib/useRegistrationLink.js';
import { brandingSrc } from '../lib/mediaSource.js';
import { formatEventDateRange } from '../lib/eventTime.js';
import { RegistrationLink } from './RegistrationAction.jsx';
import { secondaryActionClass } from './controlClasses.js';

function text(value) {
  return typeof value === 'string' && value.trim() && !value.includes('[Replace]') ? value.trim() : '';
}

export default function ComingSoon() {
  const { eventConfig, theme } = useEventConfig();
  const registration = useRegistrationLink();
  const pitchOpen = usePitchCallOpen();
  useDocumentTitle('Coming soon');

  const name = text(eventConfig?.name) || 'Event site';
  const days = Array.isArray(eventConfig?.days) ? eventConfig.days : [];
  const dates = days.length ? formatEventDateRange(days, eventConfig?.timezone) : null;
  const venue = text(eventConfig?.venue?.name);
  const city = text(eventConfig?.venue?.city);
  const place = [venue, city].filter(Boolean).join(', ');
  const tagline = text(eventConfig?.tagline);
  const organizer = text(eventConfig?.legal?.operatorName);
  const primary = typeof theme?.logos?.primary === 'string' ? theme.logos.primary.trim() : '';
  const logo = primary.split('/').length > 2 ? brandingSrc(primary) : null;

  return (
    <div className="coming-soon flex min-h-screen min-h-svh flex-col bg-surface text-text-primary">
      <main id="main-content" className="flex flex-1 items-center px-md py-2xl">
        <div className="mx-auto w-full max-w-stage">
          {logo ? <img src={logo} alt={organizer || name} className="mb-xl h-12 w-auto max-w-[12rem] object-contain" /> : null}
          <p className="font-data text-caption font-semibold uppercase tracking-wide text-text-secondary">
            Coming soon
          </p>
          <h1 className="mt-sm font-heading text-nameplate font-semibold text-text-primary text-balance">{name}</h1>
          {dates || place ? (
            <p className="mt-md border-t-hairline border-t-rule-hairline pt-md font-data text-lead text-text-primary">
              {dates ? <time>{dates}</time> : null}
              {dates && place ? <span aria-hidden="true" className="px-xs text-text-secondary">·</span> : null}
              {place ? <span>{place}</span> : null}
            </p>
          ) : null}
          {tagline ? <p className="mt-lg max-w-prose text-lead text-text-secondary text-pretty">{tagline}</p> : null}
          <p className="mt-lg max-w-prose text-body text-text-secondary text-pretty">
            The full event site is on its way. Check back here for the schedule, speakers and travel details.
          </p>
          {registration || pitchOpen ? (
            <div className="mt-xl flex flex-wrap gap-sm">
              {registration ? <RegistrationLink action={registration} placement="lead" /> : null}
              {pitchOpen ? <Link to="/pitch" className={secondaryActionClass}>Pitch a session</Link> : null}
            </div>
          ) : null}
        </div>
      </main>
      <footer className="border-t-hairline border-t-rule-hairline px-md py-md">
        <div className="mx-auto flex w-full max-w-stage flex-wrap items-center justify-between gap-sm font-data text-caption text-text-secondary">
          <span>{organizer ? `Presented by ${organizer}` : name}</span>
          <Link to="/admin" className="underline underline-offset-2">Organizer sign-in</Link>
        </div>
      </footer>
    </div>
  );
}
