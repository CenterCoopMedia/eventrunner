// App shell: skip link first, landmark structure, keyboard-navigable nav.
// Everything renders from context — no hardcoded event name, city, or date
// (event-neutrality).
import { NavLink, Outlet } from 'react-router-dom';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';

const NAV_ITEMS = [
  { to: '/', label: 'Home', end: true },
  { to: '/schedule', label: 'Schedule', feature: 'schedule' },
  { to: '/speakers', label: 'Speakers', feature: 'speakers' },
  { to: '/sponsors', label: 'Sponsors', feature: 'sponsors' },
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
  // Branding slots come from config/theme (spec §7.2 logos) — Storage-style
  // paths under branding/, served from public/ until per-event uploads land.
  const markPath = theme?.logos?.mark;
  const markSrc = markPath ? `/${markPath.replace(/^\/+/, '')}` : null;

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <header className="border-b border-brand-ink/10 bg-brand-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <NavLink
            to="/"
            className="touch-target inline-flex items-center gap-2 rounded-brand font-heading text-lg font-semibold text-brand-ink"
          >
            {markSrc ? (
              <img
                src={markSrc}
                alt=""
                className="h-8 w-8"
                width="32"
                height="32"
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
          <p>{eventConfig.name}</p>
          <p>
            Operated by {eventConfig.legal.operatorName} ·{' '}
            <a
              href={`mailto:${eventConfig.legal.supportEmail}`}
              className="underline underline-offset-2 hover:text-brand-ink"
            >
              Contact support
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
