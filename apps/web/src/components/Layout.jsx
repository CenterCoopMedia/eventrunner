// App shell: skip link first, landmark structure, keyboard-navigable nav.
// Everything renders from context — no hardcoded event name, city, or date
// (event-neutrality).
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { brandingSrc } from '../lib/mediaSource.js';
import FeedbackModal from './FeedbackModal.jsx';

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
    'touch-target inline-flex items-center rounded-brand px-3 py-2',
    isActive
      ? 'font-semibold text-brand-primary-dark underline underline-offset-4'
      : 'text-brand-ink hover:bg-brand-surface-alt',
  ].join(' ');
}

export default function Layout() {
  const { eventConfig, features, theme } = useEventConfig();
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

  return (
    <div className="bg-paper flex min-h-screen flex-col">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <header className="border-b border-brand-ink/10 bg-brand-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <NavLink
            to="/"
            className="touch-target inline-flex items-center gap-2 rounded-brand font-heading text-lg font-semibold text-brand-ink"
          >
            {markSrc && !markFailed ? (
              <img
                src={markSrc}
                alt=""
                className="h-8 w-8"
                width="32"
                height="32"
                onError={() => setMarkFailed(true)}
              />
            ) : null}
            {eventConfig.shortName}
          </NavLink>
          <nav aria-label="Main">
            <ul className="flex flex-wrap items-center gap-1">
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
      <main id="main-content" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <Outlet />
      </main>
      <footer className="border-t border-brand-ink/10 bg-brand-surface-alt">
        <div className="mx-auto max-w-5xl px-4 py-6 text-sm text-brand-ink-muted">
          <p>{eventConfig?.name}</p>
          {operatorName || supportEmail ? (
            <p>
              {operatorName ? `Operated by ${operatorName}` : null}
              {operatorName && supportEmail ? ' · ' : null}
              {supportEmail ? (
                <a
                  href={`mailto:${supportEmail}`}
                  className="underline underline-offset-2 hover:text-brand-ink"
                >
                  Contact support
                </a>
              ) : null}
            </p>
          ) : null}
          {features.feedbackInbox ? (
            <button
              type="button"
              className="touch-target mt-3 inline-flex items-center rounded-brand border border-brand-ink/20 px-3 py-2 text-brand-ink hover:bg-brand-surface"
              onClick={() => setFeedbackOpen(true)}
            >
              Share feedback
            </button>
          ) : null}
        </div>
      </footer>
      {feedbackOpen ? <FeedbackModal onClose={() => setFeedbackOpen(false)} /> : null}
    </div>
  );
}
