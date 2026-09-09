// App shell: skip link first, landmark structure, keyboard-navigable nav.
// Everything renders from context — no hardcoded event name, city, or date
// (event-neutrality).
//
// The header is the site identity plus the navigation, in one of the four
// treatments the active theme names (docs/interface-guidelines.md, Headers).
// The identity repeats on every page, so it is never a heading: every page
// owns its own <h1>.
//
// A PAGE MAY STILL STATE ITS OWN, and when it does it wins — resolveHeader
// takes the page's answer first. The page stores the two nameplate
// treatments it has always stored, so `pageHeaderTreatment` reads them into
// the theme's vocabulary rather than making the page learn a second one.
//
// Navigation is in the editorial register: text links, no pills, no tinted
// ground. The active item is marked twice over (§8.1 — never color alone):
// heavier weight plus a strong rule under the word. `side` moves the same
// list to the leading edge at wide viewports; at narrow viewports, and to a
// screen reader, the two placements are the same nav in the same place in
// the document.
//
// WHAT IS IN THE LIST IS DATA, NOT CODE. The items are the visible cmsPages
// documents in their own `order`, built by lib/siteNavigation.js — see that
// module for the two gates (an editor's `visible`, plus the feature flag a
// system page's route already checks). ONE ITEM IS NOT A PAGE: the account
// control closes the list, and it is the shell's own (see ACCOUNT_SIGNED_OUT
// below) because no page document describes a route that changes with who
// is reading.
//
// WHERE THE PLACEMENT COMES FROM, IN ORDER — THE PAGE, THEN THE SITE.
//
// The navigation is the part of the shell that tells a reader where they
// are, so ONE choice is meant to cover the whole site: config/theme
// .navPlacement, set once on the Branding tab, is the answer for every page
// that does not say otherwise. That is the normal case and the default.
//
// A page may still say otherwise, and when it does it WINS. A stated
// `layout.navPlacement` is an exception an operator made on purpose — the
// one long directory that wants a rail beside it, the one landing page that
// wants nothing but a top row — and an exception that the site setting
// could overrule would not be an exception at all; it would be a value the
// editor accepts and the shell ignores. Reading the page first is also what
// keeps deployments that set it per page before the site setting existed
// rendering exactly what they rendered.
//
// So: what the page states, then what the site states, then the default.
// Each step is "did anyone actually say", never "is this the default value"
// — statedPageLayout and resolveNavPlacement both report absence as absence.
import { useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { resolveHeader } from 'shared/theme';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useContent } from '../contexts/ContentContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { DEFAULT_NAV_PLACEMENT, resolveNavPlacement } from 'shared/theme';
import { statedPageLayout } from '../lib/pageLayout.js';
import { buildNavItems } from '../lib/siteNavigation.js';
import { brandingSrc } from '../lib/mediaSource.js';
import Header from './Header.jsx';
import { quietActionClass } from './controlClasses.js';
import { buildNameplate } from './editorial/Nameplate.jsx';
import FeedbackModal from './FeedbackModal.jsx';
import DemoBanner from './DemoBanner.jsx';
import PublicWebMcpRegistration from '../webmcp/PublicWebMcpRegistration.jsx';

/**
 * The page's own header, read into the theme's vocabulary.
 *
 * A page stores one of the two nameplate treatments (lib/pageLayout.js); the
 * theme names one of four (shared/theme THEME_HEADERS). They are the same
 * axis said two ways, so the page's answer is translated here rather than
 * either side learning the other's words. A page that stated nothing returns
 * undefined, which is what leaves the theme's answer standing.
 *
 * @param {string|undefined} stated what the page's `layout.header` says
 * @returns {'masthead'|'compact'|undefined}
 */
function pageHeaderTreatment(stated) {
  if (stated === 'nameplate') return 'masthead';
  if (stated === 'nameplate-compact') return 'compact';
  return undefined;
}

// The mark is bigger under a masthead than in a running header. Each entry
// pairs the class that draws the box with the pixel size, so the <img>
// attributes and the CSS can never state different sizes.
const MARK_SIZE = {
  masthead: { className: 'h-10 w-10', px: 40 },
  running: { className: 'h-6 w-6', px: 24 },
};

function navClass({ isActive }) {
  return [
    'touch-target inline-flex items-center border-b-strong px-2xs py-xs font-data text-caption',
    isActive
      ? 'border-b-rule-strong font-semibold text-text-primary'
      : 'border-b-transparent text-text-secondary hover:text-text-primary',
  ].join(' ');
}

// THE ACCOUNT CONTROL: ONE CONTROL, TWO DESTINATIONS (M7 issue 2).
//
// A reader who is not signed in is offered the sign-in page; a reader who is
// gets their own profile. There is no third state and no second control —
// signing out lives on the sign-in page itself, where the account it ends is
// named, rather than as a header button that logs a reader out of a site
// they were only reading.
//
// It is the LAST ITEM OF THE NAV, not a separate control beside it, so it
// inherits everything the nav already settled: one landmark, one keyboard
// path in document order, and both placements at once (`side` moves the
// whole list, so a control outside it would have to be placed twice and
// would then be two controls to a screen reader).
//
// WHILE THE AUTH HANDSHAKE IS STILL IN FLIGHT the shell renders the
// signed-out answer. `loading` from useAuth is what reports that tick, and
// it is read here rather than left to `user` being null by coincidence —
// the two states are different facts and the code should say which one it
// is acting on.
//
// Rendering the sign-in control is the right stand-in rather than a gap in
// the nav: a reader who is not signed in is the common case, and Login.jsx's
// own already-signed-in branch means a signed-in reader who clicks during
// that tick still lands somewhere true instead of on a form they do not
// need. It is not free — "Sign in" and "Your profile" are different widths,
// so a signed-in reader can see the last item of the nav resettle once. That
// is one reflow of one item, against a nav that is otherwise empty of an
// account control until the handshake finishes.
//
// `end` is the same question the nav items answer (lib/siteNavigation.js
// `children`): does this route own a subtree the item should stay marked
// inside? /signin does not and never will — it is one form — so it matches
// its own URL exactly. /profile owns none TODAY, which is exactly why it
// must not be pinned to `end`: the day it grows /profile/settings, an `end`
// match would quietly stop marking the control while the reader is inside
// the section it names.
const ACCOUNT_SIGNED_OUT = Object.freeze({ to: '/signin', label: 'Sign in', end: true });
// "Your profile" is what the profile page and ProfileSidebar already call
// it (docs/COPY_STYLE.md: one term for one concept).
const ACCOUNT_SIGNED_IN = Object.freeze({ to: '/profile', label: 'Your profile', end: false });

/**
 * Tailwind's font-weight utilities by name. Deliberately a closed list and
 * not `/^font-/`: `font-data` and `font-heading` are font FAMILIES in this
 * theme and share the prefix.
 */
const FONT_WEIGHT_UTILITY =
  /^font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/;

/**
 * The quiet action with its own font weight taken out, so the active state
 * below can set one WITHOUT competing with it.
 *
 * Two utilities for one property in one class attribute are not resolved by
 * their order in the string — CSS does not read that — but by which rule the
 * stylesheet emits last. That is Tailwind's business and not something this
 * file should be relying on, so the weight is REMOVED rather than overridden
 * and the string carries exactly one. Removing by name also survives the
 * shared shape changing its weight, which a hardcoded 'font-medium' would
 * not.
 */
const QUIET_ACTION_UNWEIGHTED = quietActionClass
  .split(/\s+/)
  .filter((token) => !FONT_WEIGHT_UTILITY.test(token))
  .join(' ');

/**
 * The account control's classes. The quiet action is the shared shape
 * (controlClasses.js) and the active state adds WEIGHT plus a RULE UNDER
 * THE WORD — the same two markers the nav items carry, and never color
 * alone (docs/interface-guidelines.md, Accessibility). The underline sets a
 * property the quiet action does not touch at all; the weight replaces the
 * one it does (see QUIET_ACTION_UNWEIGHTED).
 */
function accountClass({ isActive }) {
  return isActive
    ? `${QUIET_ACTION_UNWEIGHTED} font-semibold underline underline-offset-4`
    : quietActionClass;
}

export default function Layout() {
  const { eventConfig, features, theme } = useEventConfig();
  const { pages, getPage } = useContent();
  const { user, loading: authLoading } = useAuth();
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

  // The page this URL renders, if it has a document. A route below a page
  // (/schedule/:id) matches nothing here and keeps the shell's own rule,
  // which is what it rendered before layouts existed.
  const layout = statedPageLayout(getPage(pathname));
  // The theme's treatment, unless this page states one of its own.
  const headerVariant = resolveHeader(theme?.header, pageHeaderTreatment(layout.header));
  const navPlacement = layout.navPlacement ?? resolveNavPlacement(theme) ?? DEFAULT_NAV_PLACEMENT;
  // Only the event bar prefers the short name.
  const plate = buildNameplate(eventConfig, { compact: headerVariant === 'compact' });
  const markSize = headerVariant === 'masthead' ? MARK_SIZE.masthead : MARK_SIZE.running;

  // The navigation IS the page list (lib/siteNavigation.js). Every visible
  // page document becomes a link, in its own `order`, with system pages
  // still gated on the feature flag their route checks — so the seeded
  // travel, FAQ, conduct, contact, privacy, and terms pages are reachable
  // from the header instead of only by a typed URL, and an operator adding
  // a page gets a link without a deploy.
  // Memoized because the shell re-renders on every route change and every
  // config or content snapshot, and the list only changes when the pages or
  // the flags do.
  const navItems = useMemo(() => buildNavItems(pages, features), [pages, features]);

  // Two destinations, one control. An unfinished handshake is the
  // signed-out answer, said explicitly (see ACCOUNT_SIGNED_OUT above).
  const account = !authLoading && user ? ACCOUNT_SIGNED_IN : ACCOUNT_SIGNED_OUT;

  // One nav, placed two ways. The list, its labels, its landmark, and its
  // position in the document are identical either way — `side` only moves
  // it to the leading edge at wide viewports, where there is room for a
  // rail beside the page (brief §6.1).
  //
  // The landmark always renders now. It used to disappear when no page was
  // navigable, so that a deployment with every page hidden did not ship an
  // empty "Main" nav for a screen reader to land in; the account control is
  // in the list unconditionally, so the list is never empty and that reader
  // can still reach sign-in.
  const nav = (
    <nav
      aria-label="Main"
      className={
        navPlacement === 'side'
          ? 'border-b-hairline border-b-rule-hairline lg:w-48 lg:shrink-0 lg:self-stretch lg:border-b-0 lg:border-e-hairline lg:border-e-rule-hairline lg:pe-md lg:pt-xl'
          : 'border-b-hairline border-b-rule-hairline'
      }
    >
      <ul
        className={
          navPlacement === 'side'
            ? 'flex flex-wrap items-center gap-x-md lg:flex-col lg:items-start lg:gap-x-0'
            : 'flex flex-wrap items-center gap-x-md'
        }
      >
        {navItems.map((item) => (
          <li key={item.to}>
            <NavLink to={item.to} end={item.end} className={navClass}>
              {item.label}
            </NavLink>
          </li>
        ))}
        <li>
          <NavLink to={account.to} end={account.end} className={accountClass}>
            {account.label}
          </NavLink>
        </li>
      </ul>
    </nav>
  );

  // Ordinary pages sit on a flat surface. The Atlas sheet — the faint
  // coordinate grid behind a section (brief §4.6) — is drawn on the SCHEDULE
  // only (owner review, 2026-08-27): a grid is a device for reading a
  // timetable, and behind an about page or a speaker bio it is texture for
  // its own sake. Schedule.jsx and MySchedule.jsx carry the `map-grid` class
  // on the surface that holds the programme.
  const main = (
    <main
      id="main-content"
      className={
        navPlacement === 'side'
          ? 'min-w-0 flex-1 pb-2xl pt-xl'
          : 'mx-auto w-full max-w-5xl flex-1 px-md pb-2xl pt-xl'
      }
    >
      <Outlet />
    </main>
  );

  return (
    <div className="page-surface flex min-h-screen flex-col">
      <PublicWebMcpRegistration />
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <DemoBanner />
      <header className="bg-surface">
        <div className="mx-auto w-full max-w-5xl px-md">
          <Header
            variant={headerVariant}
            name={plate.name}
            dates={plate.dates}
            place={plate.edition}
            mark={
              markSrc && !markFailed ? (
                // width/height must match the box the class draws. They
                // reserve the space before the stylesheet applies, so a
                // wrong pair moves the header on first paint.
                <img
                  src={markSrc}
                  alt=""
                  className={markSize.className}
                  width={markSize.px}
                  height={markSize.px}
                  onError={() => setMarkFailed(true)}
                />
              ) : null
            }
          >
            {navPlacement === 'side' ? null : nav}
          </Header>
        </div>
      </header>
      {navPlacement === 'side' ? (
        // The rail and the page it serves share one measure, so the nav
        // sits at the leading edge of the page rather than at the edge of
        // the window. Below `lg` the row stacks and this is the top nav
        // again, in the same order, with the same rule under it.
        <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-md lg:flex-row lg:gap-xl">
          {nav}
          {main}
        </div>
      ) : (
        main
      )}
      <footer className="bg-surface">
        <div className="mx-auto w-full max-w-5xl px-md">
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
                className={`${quietActionClass} mt-md`}
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
