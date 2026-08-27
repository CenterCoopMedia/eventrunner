// App shell: skip link first, landmark structure, keyboard-navigable nav.
// Everything renders from context — no hardcoded event name, city, or date
// (event-neutrality).
//
// The header is the masthead nameplate (design brief §2.1, §5.1): every
// public page carries one, and there is no hero banner anywhere. The home
// page takes the full treatment; every other page takes the compact one, so
// the reader always knows which paper they are holding without the masthead
// pushing the page's own subject below the fold. Brief §6.2 moves that
// choice into stored page data (`layout.header`) in PR3; until then the
// shell picks it from the route.
//
// On the home page the masthead is the page's subject, so the nameplate
// carries the <h1> and the page's own lead headline follows under it. On
// every other page the masthead is a running header and the page owns its
// <h1>. Either way there is exactly one per page.
//
// Navigation is in the editorial register: text links, no pills, no tinted
// ground. The active item is marked twice over (§8.1 — never color alone):
// heavier weight plus a strong rule under the word.
import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { brandingSrc } from '../lib/mediaSource.js';
import Nameplate, { buildNameplate } from './editorial/Nameplate.jsx';
import FeedbackModal from './FeedbackModal.jsx';
import DemoBanner from './DemoBanner.jsx';

const NAV_ITEMS = [
  { to: '/', label: 'Home', end: true },
  { to: '/schedule', label: 'Schedule', feature: 'schedule' },
  { to: '/speakers', label: 'Speakers', feature: 'speakers' },
  { to: '/sponsors', label: 'Sponsors', feature: 'sponsors' },
  { to: '/attendees', label: 'Attendees', feature: 'attendeeDirectory' },
  { to: '/updates', label: 'Updates', feature: 'updates' },
];

function navClass({ isActive }) {
  return [
    'touch-target inline-flex items-center border-b-strong px-2xs py-xs font-data text-caption',
    isActive
      ? 'border-b-rule-strong font-semibold text-text-primary'
      : 'border-b-transparent text-text-secondary hover:text-text-primary',
  ].join(' ');
}

export default function Layout() {
  const { eventConfig, features, theme } = useEventConfig();
  const { pathname } = useLocation();
  // Branding slots come from config/theme (spec §7.2 logos). A slot holds
  // either a flat seeded path (`branding/mark.svg`, which also ships in the
  // bundle) or an uploaded asset (`branding/{assetId}/{name}`, which exists
  // only in the bucket) — brandingSrc resolves each to the origin that
  // actually serves it. A runtime config/theme doc is unvalidated Firestore
  // data (§2.4 fail-soft overlay), so a value that is not a usable path
  // resolves to null and no logo is rendered at all.
  const markSrc = brandingSrc(theme?.logos?.mark);
  // A slot can point at an object that has since been deleted from the
  // bucket. The shell must degrade to the wordmark, never to a broken image.
  const [markFailed, setMarkFailed] = useState(false);
  // A runtime config/event doc can replace `legal` wholesale (shallow
  // overlay) with a partial or malformed object; fall back per-field so one
  // bad admin write never white-screens the shell that wraps every route.
  const legal = eventConfig?.legal || {};
  const operatorName = legal.operatorName;
  const supportEmail = legal.supportEmail;
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const isHome = pathname === '/';
  const plate = buildNameplate(eventConfig, { compact: !isHome });

  return (
    <div className="page-surface flex min-h-screen flex-col">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <DemoBanner />
      <header className="bg-brand-surface">
        <div className="mx-auto w-full max-w-5xl px-md">
          <Nameplate
            variant={isHome ? 'full' : 'compact'}
            nameAs={isHome ? 'h1' : 'p'}
            name={plate.name}
            dates={plate.dates}
            edition={plate.edition}
            to="/"
            mark={
              markSrc && !markFailed ? (
                <img
                  src={markSrc}
                  alt=""
                  className={isHome ? 'h-10 w-10' : 'h-6 w-6'}
                  width="32"
                  height="32"
                  onError={() => setMarkFailed(true)}
                />
              ) : null
            }
          />
          <nav aria-label="Main" className="border-b-hairline border-b-rule-hairline">
            <ul className="flex flex-wrap items-center gap-x-md">
              {NAV_ITEMS.filter((item) => !item.feature || features[item.feature]).map(
                (item) => (
                  <li key={item.to}>
                    <NavLink to={item.to} end={item.end} className={navClass}>
                      {item.label}
                    </NavLink>
                  </li>
                ),
              )}
            </ul>
          </nav>
        </div>
      </header>
      <main id="main-content" className="mx-auto w-full max-w-5xl flex-1 px-md pb-2xl pt-xl">
        <Outlet />
      </main>
      <footer className="bg-brand-surface">
        <div className="mx-auto max-w-5xl px-md">
          <div className="section-rule pb-xl pt-md font-data text-caption text-text-secondary">
            <p className="font-heading text-body font-semibold text-text-primary">
              {eventConfig?.name}
            </p>
            {operatorName || supportEmail ? (
              <p className="mt-2xs">
                {operatorName ? `Operated by ${operatorName}` : null}
                {operatorName && supportEmail ? ' · ' : null}
                {supportEmail ? (
                  <a
                    href={`mailto:${supportEmail}`}
                    className="underline underline-offset-2 hover:text-text-primary"
                  >
                    Contact support
                  </a>
                ) : null}
              </p>
            ) : null}
            {features.feedbackInbox ? (
              <button
                type="button"
                className="touch-target mt-md inline-flex items-center rounded-brand border-hairline border-rule-hairline px-sm py-2xs text-text-primary hover:bg-brand-surface-alt"
                onClick={() => setFeedbackOpen(true)}
              >
                Share feedback
              </button>
            ) : null}
          </div>
        </div>
      </footer>
      {feedbackOpen ? <FeedbackModal onClose={() => setFeedbackOpen(false)} /> : null}
    </div>
  );
}
