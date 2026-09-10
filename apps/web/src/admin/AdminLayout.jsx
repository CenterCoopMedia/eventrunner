// The desk — the admin shell (design brief §5.2; full spec
// docs/plans/2026-08-27-admin-identity-story.md, amended by
// docs/plans/2026-09-10-admin-editorial-desk.md).
//
// The admin has ONE fixed Event Runner identity. It reads the `admin-*`
// tokens only: it obeys `data-mode` and ignores `data-theme`, so a client's
// preset never reaches this surface. The live preview in AdminBranding
// renders the client's real pages inside a framed chase, which is the only
// place a client's design renders inside the admin.
//
// The chrome contract is unchanged: skip link, landmark structure, one
// keyboard path per control, `aria-current` on the active section.
//
// THE RAIL. The navigation stands on its own dark ground down the leading
// edge, so the tool's frame and the work surface are never confused. Fifteen
// named sections read as a standing list grouped by what the operator came
// to do: content, people, operations, system. Group heads are folios. Every
// item is a word — no icon rail, no collapse to glyphs, no counts in
// bubbles. The current item is a filled block in the action blue and carries
// four signals, never colour alone: the marker at its leading edge, the bold
// weight, the ground shift, and `aria-current="page"`.
//
// On a narrow screen the rail becomes the head of the page: the same groups,
// each set as one wrapping row of words with its folio at the start, so the
// work surface begins inside the first screen rather than under a list that
// fills it. Nothing collapses into a menu and every item stays a word.
//
// THE JOB MARK. The client logo sits at the top of the rail on a small paper
// tile, beside the event's short name. A tile, because a client's mark is
// drawn for a light ground and the rail is dark; the tile is the one light
// thing on the rail and it belongs to the client. With the accent in
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
 * A docket item. The marker is a short rule in the rail's own ink at the
 * leading edge of the current item, full item height, and it never appears
 * on an inactive item — the transparent border on the inactive state keeps
 * the label from shifting sideways when the marker arrives.
 */
function docketItemClass({ isActive }) {
  return [
    'admin-target flex items-center rounded-admin border-s-admin-marker py-2xs ps-sm pe-sm text-admin-sm',
    'lg:py-xs lg:text-admin-base',
    isActive
      ? 'border-admin-nav-active-marker bg-admin-rail-current font-bold text-admin-rail-ink'
      : 'border-transparent font-medium text-admin-rail-ink-muted hover:bg-admin-rail-ground-hover hover:text-admin-rail-ink',
  ].join(' ');
}

const railButtonClass =
  'inline-flex min-h-admin-control items-center justify-center rounded-admin border-admin-hairline ' +
  'border-admin-rail-rule px-sm py-2xs text-admin-sm font-semibold text-admin-rail-ink ' +
  'hover:bg-admin-rail-ground-hover';

export default function AdminLayout() {
  const { eventConfig, theme } = useEventConfig();
  const { user, signOut } = useAuth();
  // A branding slot can point at an object that has since been deleted from
  // the bucket, so the job mark degrades to the event's short name rather
  // than to a broken image.
  const [markFailed, setMarkFailed] = useState(false);
  const markSrc = brandingSrc(theme?.logos?.mark ?? theme?.logos?.primary);

  return (
    <div className="admin-room flex min-h-screen flex-col bg-admin-ground font-admin-ui text-admin-base text-admin-ink lg:flex-row">
      <a href="#admin-content" className="skip-link skip-link--admin">
        Skip to main content
      </a>
      <div className="admin-rail flex shrink-0 flex-col bg-admin-rail-ground text-admin-rail-ink lg:sticky lg:top-0 lg:h-screen lg:w-admin-rail lg:overflow-y-auto">
        <div className="flex items-center gap-sm border-admin-rail-rule border-b-admin-hairline px-md py-sm">
          {markSrc && !markFailed ? (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-admin-small bg-admin-ground-raised p-3xs">
              <img
                src={markSrc}
                alt=""
                className="h-7 w-7 object-contain"
                onError={() => setMarkFailed(true)}
              />
            </span>
          ) : null}
          <p className="min-w-0 truncate text-admin-base font-bold text-admin-rail-ink">
            {eventConfig.shortName}
          </p>
        </div>

        <nav aria-label="Admin sections" className="flex-1 px-md py-xs lg:px-xs lg:py-sm">
          {DOCKET.map((group) => (
            <div
              key={group.id}
              className="flex flex-wrap items-center gap-x-xs gap-y-3xs py-3xs lg:mt-sm lg:block lg:py-0 lg:first:mt-0"
            >
              <p className="admin-folio me-2xs lg:me-0 lg:px-sm lg:pb-3xs lg:pt-2xs">
                {group.label}
              </p>
              <ul className="flex flex-wrap gap-2xs lg:flex-col lg:gap-3xs">
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

        <div className="flex flex-wrap items-center justify-between gap-xs border-admin-rail-rule border-t-admin-hairline px-md py-sm lg:flex-col lg:items-stretch">
          {/* An operator has to be able to tell which account the server
              will see, so the address is set in the data face: it is an
              identifier, and identifiers are the machine's. */}
          <p className="min-w-0 break-all font-admin-data text-admin-xs text-admin-rail-ink-muted">
            {user?.email}
          </p>
          <div className="flex flex-wrap items-center gap-xs">
            <NavLink to="/" className={railButtonClass}>
              View site
            </NavLink>
            <button type="button" onClick={signOut} className={railButtonClass}>
              Sign out
            </button>
          </div>
        </div>
      </div>

      <main id="admin-content" className="min-w-0 flex-1">
        <div className="admin-stone mx-auto w-full max-w-admin-canvas">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
