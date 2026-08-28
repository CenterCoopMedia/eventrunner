// The composing room — the admin shell (design brief §5.2; full spec
// docs/plans/2026-08-27-admin-identity-story.md).
//
// The admin has ONE fixed Event Runner identity. It reads the `admin-*`
// tokens only: it obeys `data-mode` and ignores `data-theme`, so a client's
// preset never reaches this surface. (The shell used to mirror the brand
// tokens on purpose, to make the Branding tab's preview visible on the
// surface being edited. The live preview in AdminBranding now renders the
// client's real pages inside a framed chase instead, which is the only
// place a client's design renders inside the admin.)
//
// The chrome contract is unchanged: skip link, landmark structure, one
// keyboard path per control, `aria-current` on the active section.
//
// THE DOCKET. Fifteen named sections do not fit a tab row honestly, so
// they read as a standing list down the leading edge, grouped by what the
// operator came to do: content, people, operations, system. Group heads are
// folios on a hairline. Every item is a word — no icon rail, no collapse to
// glyphs, no counts in bubbles. The active item carries four signals, never
// colour alone: the accent marker at its leading edge, the semibold weight,
// a ground shift, and `aria-current="page"`.
//
// THE JOB MARK. The client logo sits in the top-left slot at one fixed
// height, on the base ground, with no frame and no card. With the accent in
// AdminPageHeader's mark, it is one of exactly two client-owned elements on
// this surface.
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { brandingSrc } from '../lib/mediaSource.js';

/** Every docket item is an ABSOLUTE path. A relative `to` resolves against
 * the current LOCATION inside this nested `<Routes>`, so on /admin/branding
 * the old tab row linked to /admin/branding/pages — a dead route from every
 * section but the list itself. Naming the whole path is the fix. */
const ROOT = '/admin';

/**
 * The docket. Four groups, in the order an operator works: what the event
 * says, who is in it, how it runs, and how the deployment is set up.
 */
export const DOCKET = Object.freeze([
  {
    id: 'content',
    label: 'Content',
    items: [
      { to: 'pages', label: 'Pages' },
      { to: 'sessions', label: 'Sessions' },
      { to: 'content', label: 'Content' },
      { to: 'media', label: 'Media' },
      { to: 'materials', label: 'Materials' },
    ],
  },
  {
    id: 'people',
    label: 'People',
    items: [
      { to: 'speakers', label: 'Speakers' },
      { to: 'attendees', label: 'Attendees' },
      { to: 'badges', label: 'Badges' },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    items: [
      { to: 'live-updates', label: 'Live updates' },
      { to: 'ticketing', label: 'Ticketing' },
      { to: 'feedback', label: 'Feedback' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    items: [
      { to: 'settings', label: 'Event' },
      { to: 'features', label: 'Features' },
      { to: 'branding', label: 'Branding' },
      { to: 'system-errors', label: 'System errors' },
    ],
  },
]);

/**
 * A docket item. The marker is a 2px accent rule at the leading edge, full
 * item height, and it never appears on an inactive item — the transparent
 * border on the inactive state keeps the label from shifting sideways when
 * the marker arrives.
 */
function docketItemClass({ isActive }) {
  return [
    'admin-target flex items-center border-s-admin-marker py-3xs ps-sm pe-xs text-caption',
    isActive
      ? 'border-admin-nav-active-marker bg-admin-ground-raised font-semibold text-admin-ink'
      : 'border-transparent text-admin-ink hover:bg-admin-ground-raised',
  ].join(' ');
}

const roomButtonClass =
  'admin-target inline-flex items-center justify-center rounded-admin border-admin-hairline ' +
  'border-admin-rule-hairline bg-admin-ground-raised px-sm py-3xs text-caption text-admin-ink ' +
  'hover:bg-admin-ground-input';

export default function AdminLayout() {
  const { eventConfig, theme } = useEventConfig();
  const { user, signOut } = useAuth();
  // A branding slot can point at an object that has since been deleted from
  // the bucket, so the job mark degrades to the event's short name rather
  // than to a broken image.
  const [markFailed, setMarkFailed] = useState(false);
  const markSrc = brandingSrc(theme?.logos?.mark ?? theme?.logos?.primary);

  return (
    <div className="admin-room flex min-h-screen flex-col bg-admin-ground font-admin-ui text-admin-ink lg:flex-row">
      <a href="#admin-content" className="skip-link skip-link--admin">
        Skip to main content
      </a>
      <div className="flex shrink-0 flex-col border-admin-rule-hairline border-b-admin-hairline lg:w-64 lg:border-b-0 lg:border-e-admin-hairline">
        <div className="flex flex-wrap items-center gap-sm px-md py-sm">
          {markSrc && !markFailed ? (
            <img
              src={markSrc}
              alt=""
              className="h-7 w-auto"
              onError={() => setMarkFailed(true)}
            />
          ) : null}
          <p className="text-caption font-semibold text-admin-ink">{eventConfig.shortName}</p>
        </div>

        <nav aria-label="Admin sections" className="flex-1 pb-sm">
          {DOCKET.map((group) => (
            <div key={group.id} className="mt-sm first:mt-0">
              <p className="admin-folio border-admin-rule-hairline border-t-admin-hairline px-md pt-3xs">
                {group.label}
              </p>
              <ul className="mt-3xs">
                {group.items.map((item) => (
                  <li key={item.to}>
                    <NavLink to={`${ROOT}/${item.to}`} className={docketItemClass}>
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="flex flex-wrap items-center gap-xs border-admin-rule-hairline px-md py-sm lg:border-t-admin-hairline">
          {/* An operator has to be able to tell which account the server
              will see, so the address is set in the data face: it is an
              identifier, and identifiers are the machine's. */}
          <p className="w-full break-all font-admin-data text-folio text-admin-ink-data">
            {user?.email}
          </p>
          <NavLink to="/" className={roomButtonClass}>
            View site
          </NavLink>
          <button type="button" onClick={signOut} className={roomButtonClass}>
            Sign out
          </button>
        </div>
      </div>

      <main id="admin-content" className="min-w-0 flex-1 px-md py-md">
        <Outlet />
      </main>
    </div>
  );
}
