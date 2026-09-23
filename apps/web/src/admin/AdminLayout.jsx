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
// edge, so the tool's frame and the work surface are never confused. The
// Overview stands first and alone, with no folio over it, because it is
// where the admin opens rather than a kind of work (issue #179). The named
// sections under it read as a standing list grouped by what the operator
// came to do: content, people, operations, system. Group heads are folios.
// Every item is a word — no icon rail, no collapse to glyphs, no counts in
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
//
// THE TIERS (issue #186). Every docket item names the tier it needs, and
// that one declaration does two things: the rail draws only the sections the
// signed-in tier may reach, and the shell refuses the route of one it may
// not, so a bookmarked or typed URL to an out-of-tier section meets a
// refusal rather than the page. A page a builder adds declares its tier by
// its docket entry and nowhere else. The tier comes from AuthContext's
// probes; the server's requireAdmin and the rules are the enforcement.
import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { brandingSrc } from '../lib/mediaSource.js';
import { AdminEmptyState } from './components/adminChrome.jsx';

/** Every docket item is an ABSOLUTE path. A relative `to` resolves against
 * the current LOCATION inside this nested `<Routes>`, so on /admin/branding
 * the old tab row linked to /admin/branding/pages — a dead route from every
 * section but the list itself. Naming the whole path is the fix. */
const ROOT = '/admin';

/**
 * The two admin tiers, as the server names them (functions/src/core/auth.cjs
 * ADMIN_TIERS). A docket item's `tier` is the LEAST it needs: 'staff' admits
 * both tiers, 'operator' admits operators only.
 */
export const ADMIN_TIERS = Object.freeze(['operator', 'staff']);

/**
 * The docket. A lead group with no label holds the Overview, the page the
 * admin opens on (issue #179): it reports on every group below it, so it
 * belongs to none of them, and the rail draws no folio over it. Then four
 * groups, in the order an operator works: what the event says, who is in
 * it, how it runs, and how the deployment is set up.
 *
 * The Overview is staff work: it shows counts only, and the rows behind the
 * unresolved error count stay on the operator-only System errors page.
 *
 * Content, people and operations are staff work. Under System, the event
 * settings admit staff (dates, venue, places and social handles are content
 * an organizer runs; the server holds the sender address back for an
 * operator); features, branding, access and system errors are the
 * operator's, because each one changes what the deployment is rather than
 * what the event says.
 */
export const DOCKET = Object.freeze([
  {
    id: 'lead',
    label: null,
    items: [{ to: 'overview', label: 'Overview', tier: 'staff' }],
  },
  {
    id: 'content',
    label: 'Content',
    items: [
      { to: 'pages', label: 'Pages', tier: 'staff' },
      { to: 'sessions', label: 'Sessions', tier: 'staff' },
      { to: 'content', label: 'Content', tier: 'staff' },
      { to: 'media', label: 'Media', tier: 'staff' },
      { to: 'materials', label: 'Materials', tier: 'staff' },
    ],
  },
  {
    id: 'people',
    label: 'People',
    items: [
      { to: 'speakers', label: 'Speakers', tier: 'staff' },
      { to: 'attendees', label: 'Attendees', tier: 'staff' },
      { to: 'badges', label: 'Badges', tier: 'staff' },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    items: [
      { to: 'live-updates', label: 'Live updates', tier: 'staff' },
      { to: 'ticketing', label: 'Ticketing', tier: 'staff' },
      { to: 'feedback', label: 'Feedback', tier: 'staff' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    items: [
      { to: 'settings', label: 'Event', tier: 'staff' },
      { to: 'features', label: 'Features', tier: 'operator' },
      { to: 'branding', label: 'Branding', tier: 'operator' },
      { to: 'access', label: 'Access', tier: 'operator' },
      { to: 'system-errors', label: 'System errors', tier: 'operator' },
    ],
  },
]);

/**
 * Whether a tier the caller holds reaches a tier a section asks for. An
 * item with no tier declared falls to the strictest, the same default the
 * server's requireAdmin takes, so a forgotten declaration closes a section
 * to staff rather than opening it.
 *
 * @param {'operator'|'staff'|null} held
 * @param {'operator'|'staff'|undefined} required
 * @returns {boolean}
 */
export function tierReaches(held, required = 'operator') {
  if (held === 'operator') return true;
  return held === 'staff' && required === 'staff';
}

/**
 * The tier the section at `pathname` asks for, from its docket entry. A
 * section owns every path under it, so /admin/pages/new is Pages. The
 * segment is read the way the router matches it — percent-decoded and
 * without regard to case, because `<Route>` matches case-insensitively and
 * /admin/Branding renders the Branding page — so the lookup cannot be
 * stepped around by spelling. A path no docket item owns is the
 * operator's, the same default an undeclared item takes: fail closed. Only
 * the bare index (the redirect to the Overview) asks for nothing.
 *
 * @param {string} pathname
 * @returns {'operator'|'staff'|null}
 */
export function sectionTier(pathname) {
  const raw = pathname.replace(/^\/admin\/?/, '').split('/')[0];
  if (!raw) return null;
  let segment;
  try {
    segment = decodeURIComponent(raw).toLowerCase();
  } catch {
    return 'operator';
  }
  for (const group of DOCKET) {
    const item = group.items.find((entry) => entry.to === segment);
    if (item) return item.tier ?? 'operator';
  }
  return 'operator';
}

/** "A, B and C" from a list of labels; one label stands alone. */
function listWords(labels) {
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}

const labelsForTier = (tier) =>
  DOCKET.flatMap((group) => group.items).filter((item) => item.tier === tier).map((item) => item.label);

/**
 * Each tier's sections, named once in the rail's own words, for every
 * sentence that describes a tier: the refusal below, the Access page's
 * description and its confirmation sentences. Derived from the docket so a
 * section added there is named everywhere at once.
 */
export const TIER_SCOPE = Object.freeze({
  staff: listWords(labelsForTier('staff')),
  operatorOnly: listWords(labelsForTier('operator')),
});

/** The docket with the sections `held` cannot reach left out. */
export function docketForTier(held) {
  return DOCKET.map((group) => ({
    ...group,
    items: group.items.filter((item) => tierReaches(held, item.tier)),
  })).filter((group) => group.items.length > 0);
}

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

/**
 * The refusal an out-of-tier route meets. It is a page, not a redirect: the
 * reader typed or followed a link here, and the honest answer is what this
 * section is and who may open it, with the rail still beside it so the next
 * move is one click away.
 */
function TierRefusal() {
  return (
    <div className="px-md py-lg">
      <AdminEmptyState
        title="This section needs operator access"
        description={`Your account has staff access. Staff run ${TIER_SCOPE.staff}. Ask an operator to change your access if you need this section.`}
      />
    </div>
  );
}

export default function AdminLayout() {
  const { eventConfig, theme } = useEventConfig();
  const { user, adminTier, signOut } = useAuth();
  const { pathname } = useLocation();
  // A branding slot can point at an object that has since been deleted from
  // the bucket, so the job mark degrades to the event's short name rather
  // than to a broken image.
  const [markFailed, setMarkFailed] = useState(false);
  const markSrc = brandingSrc(theme?.logos?.mark ?? theme?.logos?.primary);
  const docket = docketForTier(adminTier);
  const required = sectionTier(pathname);
  const refused = required !== null && !tierReaches(adminTier, required);

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
          {docket.map((group) => (
            <div
              key={group.id}
              className="flex flex-wrap items-center gap-x-xs gap-y-3xs py-3xs lg:mt-sm lg:block lg:py-0 lg:first:mt-0"
            >
              {group.label ? (
                <p className="admin-folio me-2xs lg:me-0 lg:px-sm lg:pb-3xs lg:pt-2xs">
                  {group.label}
                </p>
              ) : null}
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
              identifier, and identifiers are the machine's. The tier word
              beside it says what that account may do here. */}
          <div className="min-w-0">
            <p className="break-all font-admin-data text-admin-xs text-admin-rail-ink-muted">
              {user?.email}
            </p>
            {adminTier ? (
              <p className="text-admin-xs font-semibold text-admin-rail-ink" data-admin-tier={adminTier}>
                {adminTier === 'operator' ? 'Operator' : 'Staff'}
              </p>
            ) : null}
          </div>
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
          {refused ? <TierRefusal /> : <Outlet />}
        </div>
      </main>
    </div>
  );
}
