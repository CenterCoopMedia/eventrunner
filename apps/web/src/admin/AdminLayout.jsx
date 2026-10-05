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
// On a narrow screen the rail becomes one compact head of the page: job,
// current section and a native Menu disclosure. Opening it shows the same
// groups as full-width control rows in a viewport sheet, with the account
// controls at its foot. This keeps the work surface in the first screen
// without replacing destinations with unlabeled icons.
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
//
// THE TOUR (issue #198). A first visit opens the editor tour at the head of
// the stone; "Take the tour" on the rail opens it again. It is its own lazy
// chunk (components/AdminTour.jsx), and its steps are this docket.
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { brandingSrc } from '../lib/mediaSource.js';
import { useMediaQuery } from '../lib/viewport.js';
import { AdminEmptyState } from './components/adminChrome.jsx';
import PendingChangesBanner from './components/PendingChangesBanner.jsx';
import { linkButtonClass } from './components/formControls.jsx';
import { PendingChangesProvider } from './PendingChangesContext.jsx';
import { markTourDone, readTourDone } from './tourState.js';

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

// This must stay identical to Tailwind's `lg` screen. The summary is hidden
// at that pixel breakpoint, so the disclosure must be forced open there too.
// A rem query would move when a reader changes the browser's default font
// size and could leave both a closed docket and a hidden Menu control.
export const ADMIN_DESKTOP_VIEWPORT = '(min-width: 1024px)';

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
      { to: 'organizations', label: 'Organizations', tier: 'staff' },
      { to: 'content', label: 'Content', tier: 'staff' },
      { to: 'updates', label: 'Updates', tier: 'staff' },
      { to: 'timeline', label: 'Timeline', tier: 'staff' },
      { to: 'media', label: 'Media', tier: 'staff' },
      { to: 'materials', label: 'Materials', tier: 'staff' },
      { to: 'versions', label: 'Version history', tier: 'staff' },
      { to: 'unpublished', label: 'Unpublished changes', tier: 'staff' },
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
      { to: 'announcements', label: 'Announcements', tier: 'staff' },
      { to: 'live-updates', label: 'Live updates', tier: 'staff' },
      { to: 'ticketing', label: 'Ticketing', tier: 'staff' },
      { to: 'feedback', label: 'Feedback', tier: 'staff' },
      { to: 'email-log', label: 'Email log', tier: 'staff' },
      { to: 'change-requests', label: 'Change requests', tier: 'staff' },
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
 * WHOLE pathname is read the way the router matches it — every segment
 * percent-decoded and lowercased, the /admin prefix included, because
 * `<Route>` matches case-insensitively and /Admin/Branding renders the
 * Branding page — so the lookup cannot be stepped around by spelling
 * either half. A path no docket item owns is the operator's, the same
 * default an undeclared item takes: fail closed. So is a segment that
 * decodes to a slash, or an empty segment with more path after it —
 * nothing the docket names. Only the bare index (the redirect to the Overview)
 * asks for nothing.
 *
 * @param {string} pathname
 * @returns {'operator'|'staff'|null}
 */
export function sectionTier(pathname) {
  const segments = [];
  for (const raw of String(pathname ?? '').split('/').slice(1)) {
    let segment;
    try {
      segment = decodeURIComponent(raw).toLowerCase();
    } catch {
      return 'operator';
    }
    if (segment.includes('/')) return 'operator';
    segments.push(segment);
  }
  // A trailing slash is not a section.
  if (segments.length > 1 && segments[segments.length - 1] === '') segments.pop();
  if (segments[0] !== 'admin') return 'operator';
  const section = segments[1];
  if (section === undefined) return null;
  for (const group of DOCKET) {
    const item = group.items.find((entry) => entry.to === section);
    if (item) return item.tier ?? 'operator';
  }
  return 'operator';
}

/** "A, B and C" from a list of labels; one label stands alone. */
export function listWords(labels) {
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
    'flex min-h-admin-control w-full items-center rounded-admin border-s-admin-marker py-2xs ps-sm pe-sm text-admin-sm',
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

/**
 * What a tour chunk that fails to load leaves: a stated line and a way to
 * close it, so "Take the tour" never becomes a control that does nothing.
 */
function TourLoadFailed({ onEnd }) {
  return (
    <aside aria-label="Admin tour" className="admin-tour">
      <p role="status">The tour did not load. Reload the page to try again.</p>
      <button type="button" className={linkButtonClass} onClick={onEnd}>End tour</button>
    </aside>
  );
}

const AdminTour = lazy(() => import('./components/AdminTour.jsx').catch(() => ({ default: TourLoadFailed })));

/**
 * The shell opens one unpublished-count document for the banner. The
 * Unpublished changes page loads its own rows. The shell mounts only inside
 * AdminGate, so a non-admin opens neither listener here.
 */
export default function AdminLayout() {
  return (
    <PendingChangesProvider>
      <AdminDesk />
    </PendingChangesProvider>
  );
}

function AdminDesk() {
  const { eventConfig, theme } = useEventConfig();
  const { user, adminTier, refreshAdminStatus, signOut } = useAuth();
  const { pathname } = useLocation();
  // A branding slot can point at an object that has since been deleted from
  // the bucket, so the job mark degrades to the event's short name rather
  // than to a broken image.
  const [markFailed, setMarkFailed] = useState(false);
  const wide = useMediaQuery(ADMIN_DESKTOP_VIEWPORT);
  const [mobileDocketOpen, setMobileDocketOpen] = useState(
    () => typeof window === 'undefined' || typeof window.matchMedia !== 'function',
  );
  const markSrc = brandingSrc(theme?.logos?.mark ?? theme?.logos?.primary);
  // An unknown tier (the probe failed for a reason other than
  // permission-denied) draws the sections every admin holds and refuses
  // nothing on a guess: the server decides, and the rail says the check
  // failed and offers it again.
  const tierKnown = adminTier === 'operator' || adminTier === 'staff';
  const docket = docketForTier(tierKnown ? adminTier : 'staff');
  const required = sectionTier(pathname);
  const refused = tierKnown && required !== null && !tierReaches(adminTier, required);
  const activeSection = docket
    .flatMap((group) => group.items)
    .find((item) => pathname === `${ROOT}/${item.to}` || pathname.startsWith(`${ROOT}/${item.to}/`));
  // The editor tour (issue #198): null while closed, else the run number.
  // Run 0 is the first visit and takes no focus; each "Take the tour" is a
  // new run, so it starts again at step 1 with the focus on its heading.
  // Ending it stores the mark and gives the focus back to the rail button.
  const uid = user?.uid;
  const [tour, setTour] = useState(null);
  const takeTourRef = useRef(null);
  const mobileMenuRef = useRef(null);
  useEffect(() => {
    setTour(readTourDone(uid) ? null : 0);
  }, [uid]);
  useEffect(() => {
    if (wide || !mobileDocketOpen) return undefined;
    // The sheet owns the phone viewport while it is open. Lock the document
    // scroll root so PageDown and touch scrolling cannot move the top bar,
    // which carries the sheet's only dismiss control, out of view. Media
    // dialogs own body overflow separately; leaving it alone prevents the two
    // independent overlays from restoring a stale lock over each other.
    const root = document.documentElement;
    const rootOverflow = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = rootOverflow;
    };
  }, [wide, mobileDocketOpen]);
  const endTour = () => {
    markTourDone(uid);
    setTour(null);
    (wide || mobileDocketOpen ? takeTourRef : mobileMenuRef).current?.focus();
  };

  return (
    <div className="admin-room flex min-h-screen flex-col bg-admin-ground font-admin-ui text-admin-base text-admin-ink lg:flex-row">
      <a href="#admin-content" className="skip-link skip-link--admin">
        Skip to main content
      </a>
      <div className="admin-rail relative flex min-h-14 shrink-0 flex-row flex-wrap items-stretch bg-admin-rail-ground text-admin-rail-ink lg:sticky lg:top-0 lg:h-screen lg:w-admin-rail lg:flex-col lg:flex-nowrap lg:overflow-y-auto">
        <div className="flex min-w-0 flex-1 items-center gap-xs border-admin-rail-rule border-e-admin-hairline px-sm lg:flex-none lg:gap-sm lg:border-b-admin-hairline lg:border-e-0 lg:px-md lg:py-sm">
          {markSrc && !markFailed ? (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-admin-small bg-admin-ground-raised p-3xs lg:h-9 lg:w-9">
              <img
                src={markSrc}
                alt=""
                className="h-6 w-6 object-contain lg:h-7 lg:w-7"
                onError={() => setMarkFailed(true)}
              />
            </span>
          ) : null}
          <p className="min-w-0 truncate text-admin-base font-bold text-admin-rail-ink">
            {eventConfig.shortName}
          </p>
        </div>

        <details
          className="admin-mobile-docket shrink-0 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col"
          open={wide || mobileDocketOpen}
          onToggle={(event) => {
            if (!wide) setMobileDocketOpen(event.currentTarget.open);
          }}
        >
          <summary
            ref={mobileMenuRef}
            className="admin-target flex h-14 cursor-pointer items-center gap-xs px-sm font-semibold text-admin-rail-ink lg:hidden"
          >
            <span
              className="max-w-28 truncate font-admin-data text-admin-xs text-admin-rail-ink-muted"
              title={activeSection?.label ?? 'Admin sections'}
            >
              {activeSection?.label ?? 'Admin sections'}
            </span>
            <span className="shrink-0">Menu</span>
          </summary>
          <div className="admin-mobile-docket__content fixed inset-x-0 bottom-0 top-14 z-40 min-h-0 overflow-y-auto overscroll-contain bg-admin-rail-ground lg:static lg:z-auto lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-visible">
            <nav aria-label="Admin sections" className="flex-1 px-md py-sm lg:px-xs">
              {docket.map((group) => (
                <div key={group.id} className="py-xs first:pt-0 lg:mt-sm lg:py-0 lg:first:mt-0">
                  {group.label ? (
                    <p className="admin-folio px-sm pb-3xs pt-2xs">
                      {group.label}
                    </p>
                  ) : null}
                  <ul className="flex flex-col gap-3xs">
                    {group.items.map((item) => (
                      <li key={item.to} className="w-full">
                        <NavLink
                          to={`${ROOT}/${item.to}`}
                          className={docketItemClass}
                          onClick={() => {
                            if (!wide) mobileMenuRef.current?.focus();
                            setMobileDocketOpen(false);
                          }}
                        >
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
                {tierKnown ? (
                  <p className="text-admin-xs font-semibold text-admin-rail-ink" data-admin-tier={adminTier}>
                    {adminTier === 'operator' ? 'Operator' : 'Staff'}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-xs">
                <button
                  type="button"
                  ref={takeTourRef}
                  onClick={() => {
                    setMobileDocketOpen(false);
                    setTour((run) => (run ?? 0) + 1);
                  }}
                  className={railButtonClass}
                >
                  Take the tour
                </button>
                <NavLink to="/" className={railButtonClass}>
                  View site
                </NavLink>
                <button type="button" onClick={signOut} className={railButtonClass}>
                  Sign out
                </button>
              </div>
            </div>
          </div>
        </details>

        {adminTier === 'unknown' ? (
          <div className="order-last flex w-full flex-wrap items-center justify-between gap-xs border-admin-rail-rule border-b-admin-hairline bg-admin-rail-ground px-md py-xs lg:border-b-0 lg:border-t-admin-hairline lg:py-sm">
            <p className="text-admin-xs text-admin-rail-ink-muted" role="status">
              Your access tier could not be checked.
            </p>
            <button type="button" onClick={refreshAdminStatus} className={railButtonClass}>
              Check again
            </button>
          </div>
        ) : null}
      </div>

      <main
        id="admin-content"
        className="min-w-0 flex-1"
        {...(!wide && mobileDocketOpen ? { inert: '' } : null)}
      >
        {/* Above the stone, never inside it: the title band pulls itself
            up by the stone's top padding and would slide over it. */}
        <PendingChangesBanner />
        <div className="admin-stone mx-auto w-full max-w-admin-canvas">
          {/* The tour is the one thing in the stone before the page:
              `.admin-tour` (index.css) keeps room under it for the title
              band's pull, so the band lands below it, never over it. */}
          {tour === null ? null : (
            <Suspense fallback={null}>
              <AdminTour key={tour} docket={docket} takeFocus={tour > 0} onEnd={endTour} />
            </Suspense>
          )}
          {refused ? <TierRefusal /> : <Outlet />}
        </div>
      </main>
    </div>
  );
}
