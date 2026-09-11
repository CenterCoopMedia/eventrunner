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
// THE SHELL RUNS TO THE STAGE. The header, the navigation, the page, and
// the footer all sit on one frame — `.stage` in index.css, capped at
// --stage-max and gutter-padded from the spacing scale. Running text
// inside it is capped again at --measure-text, so a paragraph never runs
// the width of a schedule grid. Both widths are tokens a style retunes
// (docs/interface-guidelines.md, Layout).
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
import { Link, NavLink, Outlet, matchPath, useLocation } from 'react-router-dom';
import { resolveHeader } from 'shared/theme';
import { safeUrlHref } from 'shared/urlSafety';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useContent } from '../contexts/ContentContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { DEFAULT_NAV_PLACEMENT, resolveNavPlacement } from 'shared/theme';
import { statedPageLayout } from '../lib/pageLayout.js';
import { buildNavItems } from '../lib/siteNavigation.js';
import { brandingSrc } from '../lib/mediaSource.js';
import BackToTop from './BackToTop.jsx';
import Header from './Header.jsx';
import { quietActionClass } from './controlClasses.js';
import { buildNameplate } from './editorial/Nameplate.jsx';
import RegistrationAction from './RegistrationAction.jsx';
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
// "Dashboard" is the signed-in attendee's home (issue #168): the account
// control lands there, and the dashboard carries the link to the profile
// form beside it. Still not pinned to `end`, for the same reason /profile
// was not: the day the dashboard grows children, an end match would quietly
// stop marking the control while the reader is inside the section it names.
const ACCOUNT_SIGNED_IN = Object.freeze({ to: '/dashboard', label: 'Dashboard', end: false });

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

// The banner at the top of the shell, named so the back-to-top control can
// move focus to it (M7 issue 6). Landing there puts the keyboard at the top
// of the page, with the identity and the whole navigation still ahead of it
// — which is what "back to top" means to a reader who is not looking at the
// screen. The skip link stays the first focusable element on the page:
// tabIndex={-1} makes the banner a focus TARGET without joining the tab
// order, and the ring is drawn on the attribute the control sets, never on
// bare :focus — a header carrying tabindex="-1" takes focus from a click
// anywhere inside it, so :focus would outline the whole thing the moment a
// reader clicked the nameplate (lib/scrollToTop.js, index.css).
const TOP_LANDMARK_ID = 'site-top';

// The footer, named so the back-to-top control can withdraw while it is on
// screen instead of sitting on top of its last row (BackToTop.jsx).
const FOOTER_ID = 'site-footer';

// One treatment for every link in the footer: an underlined word at the
// caption size, at the full touch target. The footer is a dense block of
// links and a reader has to be able to hit them.
const FOOTER_LINK_CLASS =
  'touch-target inline-flex items-center underline underline-offset-2 hover:text-text-primary';

/**
 * The longest platform name — and the longest handle — the footer will
 * render. The same 40 as `MAX_SOCIAL_LABEL_LENGTH` in
 * packages/shared/src/speaker.cjs, which caps the same kind of value on a
 * speaker record; it is repeated rather than imported because the shared
 * package's ESM entry does not re-export it and a footer is not a reason to
 * widen that surface.
 */
const MAX_SOCIAL_LABEL_LENGTH = 40;

/**
 * The event's social accounts, as links (M7 issue 3).
 *
 * config/event.social.handles is `{ platform, handle, url }[]` (ADR 0001) —
 * the shape the mail footer already reads (functions/src/email/render.cjs),
 * so the site and the mail say the same thing from one field rather than
 * each learning its own. NOTHING IS ADDED TO THE SCHEMA HERE: an event that
 * has recorded no accounts has an empty list, and an empty list renders no
 * block at all.
 *
 * A RUNTIME config/event DOC IS UNVALIDATED FIRESTORE DATA (§2.4 fail-soft
 * overlay) and validateEventConfig does not describe this field at all, so
 * nothing upstream has bounded what arrives here. Every entry is therefore
 * met as it is AND normalized before it renders:
 *
 *   • not an object, no platform, or a URL that is not http(s) → dropped,
 *     rather than a link with no name or a link that is not a link
 *   • the platform AND the handle are trimmed and cut to
 *     MAX_SOCIAL_LABEL_LENGTH, so one bad write cannot hand itself the whole
 *     bottom of the site
 *   • the URL is CANONICALIZED, not merely approved: safeUrlHref returns the
 *     parsed href, so `https://example.org` and `https://example.org/` are
 *     one address rather than two — which is what a reader sees — and the
 *     string that is rendered is exactly the string that passed the check
 *   • an entry recorded twice renders once — a repeated link is noise a
 *     reader has to resolve (the rule buildNavItems applies to a duplicated
 *     route), and it also keeps the render key unique
 *
 * The handle is kept because it is the only thing that tells two accounts on
 * one service apart: an event with a summit account and a newsroom account
 * on the same platform would otherwise render two links both reading
 * "Mastodon", and a reader cannot choose between them.
 *
 * @param {unknown} social config/event.social
 * @returns {Array<{ platform: string, handle: string, url: string }>}
 */
function socialAccounts(social) {
  const handles = Array.isArray(social?.handles) ? social.handles : [];
  const seen = new Set();
  const accounts = [];
  for (const entry of handles) {
    if (!entry || typeof entry !== 'object') continue;
    if (typeof entry.platform !== 'string' || typeof entry.url !== 'string') continue;
    // The canonical href, or '' when this is not a link target at all.
    const url = safeUrlHref(entry.url);
    if (!url) continue;
    const platform = entry.platform.trim().slice(0, MAX_SOCIAL_LABEL_LENGTH);
    if (!platform) continue;
    // A handle is optional in the record and in the label; anything that is
    // not a non-empty string is simply absent.
    const handle =
      typeof entry.handle === 'string' ? entry.handle.trim().slice(0, MAX_SOCIAL_LABEL_LENGTH) : '';
    const key = `${platform}:${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    accounts.push({ platform, handle, url });
  }
  return accounts;
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
  const primaryNavItems = navPlacement === 'side' ? navItems : navItems.slice(0, 5);
  const moreNavItems = navPlacement === 'side' ? [] : navItems.slice(5);
  const moreIsActive = moreNavItems.some((item) => matchPath({ path: item.to, end: item.end }, pathname));

  // The event's own social accounts, if it has recorded any (M7 issue 3).
  const socialLinks = useMemo(() => socialAccounts(eventConfig?.social), [eventConfig?.social]);

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
          ? 'relative border-b-hairline border-b-rule-hairline lg:w-48 lg:shrink-0 lg:self-stretch lg:border-b-0 lg:border-e-hairline lg:border-e-rule-hairline lg:pe-md lg:pt-xl'
          : 'relative border-b-hairline border-b-rule-hairline'
      }
    >
      <ul
        className={
          navPlacement === 'side'
            ? 'flex flex-wrap items-center gap-x-md lg:flex-col lg:items-start lg:gap-x-0'
            : 'flex flex-wrap items-center gap-x-md'
        }
      >
        {primaryNavItems.map((item) => (
          <li key={item.to}>
            <NavLink to={item.to} end={item.end} className={navClass}>
              {item.label}
            </NavLink>
          </li>
        ))}
        {moreNavItems.length ? (
          <li>
            <details className="site-nav-more" onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              event.currentTarget.open = false;
              event.currentTarget.querySelector('summary').focus();
            }}>
              <summary className={`touch-target font-data text-caption border-b-strong ${moreIsActive
                ? 'border-b-rule-strong font-semibold text-text-primary'
                : 'border-b-transparent text-text-secondary'}`}>More</summary>
              <ul className="site-nav-more__links">
                {moreNavItems.map((item) => (
                  <li key={item.to}>
                    <NavLink to={item.to} end={item.end} className={navClass} onClick={(event) => {
                      event.currentTarget.closest('details').open = false;
                    }}>{item.label}</NavLink>
                  </li>
                ))}
              </ul>
            </details>
          </li>
        ) : null}
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
          : 'stage flex-1 pb-2xl pt-md'
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
      {/* The top of the page, by name: the back-to-top control moves focus
          here so a reader who is not looking at the screen arrives with the
          keyboard where the picture is (M7 issue 6). */}
      <header id={TOP_LANDMARK_ID} tabIndex={-1} className="bg-surface">
        <div className="stage">
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
            {/* The event's configured registration action (M7 issue 8).
                It owns its own row and renders nothing at all when no
                destination is configured, so mounting it is this one line
                and no other control in the header has to move. */}
            <RegistrationAction placement="header" />
          </Header>
        </div>
      </header>
      {navPlacement === 'side' ? (
        // The rail and the page it serves share one stage, so the nav
        // sits at the leading edge of the page rather than at the edge of
        // the window. Below `lg` the row stacks and this is the top nav
        // again, in the same order, with the same rule under it.
        <div className="stage flex flex-1 flex-col lg:flex-row lg:gap-xl">
          {nav}
          {main}
        </div>
      ) : (
        main
      )}
      {/* AFTER the content it offers to leave and BEFORE the footer, because
          the control withdraws for the footer: behind the footer links a
          keyboard reader could never reach it, since tabbing to a footer
          link scrolls the footer on screen and takes the control away.
          BackToTop.jsx states the rest. It renders fixed at the corner
          either way, so its place here is a sequential one only. */}
      <BackToTop targetId={TOP_LANDMARK_ID} footerId={FOOTER_ID} />
      <footer id={FOOTER_ID} className="bg-surface">
        <div className="stage">
          <div className="section-rule pb-xl pt-md font-data text-caption text-text-secondary">
            <p className="font-heading text-body font-semibold text-text-primary">
              {eventConfig?.name}
            </p>
            {/* THE SAME PAGE LIST THE NAVIGATION CARRIES (M7 issue 3), from
                the same buildNavItems call above — one gate, read once, so
                a page hidden in the editor or a system page whose feature
                is off cannot leave the header and stay in the footer.
                <Link>, not <a>: the demo runs under HashRouter, where a raw
                href reloads a path the static host does not serve. */}
            {navItems.length === 0 ? null : (
              <nav aria-label="Site pages" className="mt-md">
                <ul className="footer-links">
                  {navItems.map((item) => (
                    <li key={item.to}>
                      <Link to={item.to} className={FOOTER_LINK_CLASS}>
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            )}
            {operatorName || supportEmail ? (
              <p className="mt-md">
                {operatorName ? `Operated by ${operatorName}` : null}
                {operatorName && supportEmail ? ' · ' : null}
                {supportEmail ? (
                  <a href={`mailto:${supportEmail}`} className={FOOTER_LINK_CLASS}>
                    Contact support
                  </a>
                ) : null}
              </p>
            ) : null}
            {/* An event that has recorded no social account renders no
                block, no heading, and no empty list. */}
            {socialLinks.length === 0 ? null : (
              <nav aria-label="Social accounts" className="mt-md">
                <ul className="flex flex-wrap gap-x-md">
                  {/* Keyed on both halves: an event can record two accounts
                      that share a URL (one platform, two labels) or two
                      platforms pointing at one profile page, and either
                      would collide on a key made from one half alone. */}
                  {socialLinks.map((handle) => (
                    <li key={`${handle.platform}:${handle.url}`}>
                      {/* No target: a social account opens in the tab the
                          reader is already in, which is what a link off the
                          site is meant to do. rel="noreferrer" then withholds
                          the referrer, since there is no opener to sever. */}
                      <a href={handle.url} rel="noreferrer" className={FOOTER_LINK_CLASS}>
                        {handle.handle ? `${handle.platform} ${handle.handle}` : handle.platform}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            )}
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
