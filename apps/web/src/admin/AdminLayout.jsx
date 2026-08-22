// Admin shell: skip link, landmark structure, keyboard-navigable tab nav —
// the same chrome contract as the public Layout, styled with the same brand
// tokens so an operator does not land in a visually foreign app.
//
// (Spec §7.3 reserves a fixed `admin-*` palette for admin tooling so a client
// cannot theme it. Those tokens do not exist yet; until they do the admin
// area uses the brand tokens, which has the side benefit of making the
// Branding tab's live preview visible on the surface you are editing.)
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';

const TABS = [
  { to: 'pages', label: 'Pages' },
  { to: 'content', label: 'Content' },
  { to: 'speakers', label: 'Speakers' },
  { to: 'settings', label: 'Event' },
  { to: 'features', label: 'Features' },
  { to: 'badges', label: 'Badges' },
  { to: 'branding', label: 'Branding' },
  { to: 'media', label: 'Media' },
  { to: 'materials', label: 'Materials' },
  { to: 'live-updates', label: 'Live updates' },
  { to: 'feedback', label: 'Feedback' },
  { to: 'system-errors', label: 'System errors' },
];

function tabClass({ isActive }) {
  return [
    'touch-target inline-flex items-center rounded-brand px-3 py-2',
    isActive
      ? 'font-semibold text-brand-primary-dark underline underline-offset-4'
      : 'text-brand-ink hover:bg-brand-surface-alt',
  ].join(' ');
}

export default function AdminLayout() {
  const { eventConfig } = useEventConfig();
  const { user, signOut } = useAuth();

  return (
    <div className="bg-paper flex min-h-screen flex-col">
      <a href="#admin-content" className="skip-link">
        Skip to main content
      </a>
      <header className="border-b border-brand-ink/10 bg-brand-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div>
            <p className="font-heading text-lg font-semibold text-brand-ink">
              Admin · {eventConfig.shortName}
            </p>
            <p className="text-sm text-brand-ink-muted">{user?.email}</p>
          </div>
          <div className="flex items-center gap-2">
            <NavLink
              to="/"
              className="touch-target inline-flex items-center rounded-brand px-3 py-2 text-brand-ink hover:bg-brand-surface-alt"
            >
              View site
            </NavLink>
            <button
              type="button"
              onClick={signOut}
              className="touch-target inline-flex items-center rounded-brand border border-brand-ink/20 px-3 py-2 text-brand-ink hover:bg-brand-surface-alt"
            >
              Sign out
            </button>
          </div>
        </div>
        <nav aria-label="Admin sections" className="mx-auto max-w-5xl px-4 pb-2">
          <ul className="flex flex-wrap items-center gap-1">
            {TABS.map((tab) => (
              <li key={tab.to}>
                <NavLink to={tab.to} className={tabClass}>
                  {tab.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="admin-content" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
