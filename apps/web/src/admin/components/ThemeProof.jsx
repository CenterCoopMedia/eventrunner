// The page preview: the client's real page, locked in a chase on the admin
// ground (docs/plans/2026-08-27-admin-identity-story.md, moment 2).
//
// This is not a swatch board and it is never allowed to become one. The frame
// renders the app's OWN routes and components — `AppRoutes` from App.jsx,
// inside a MemoryRouter at the page the operator picked — reading the same
// providers the admin is already mounted inside. What differs is only the
// theme: the candidate document is applied to the frame ELEMENT through
// applyThemePreview, which stays the one path from a candidate to rendered
// CSS (brief §5.2).
//
// The frame carries data-theme, data-mode, and data-motif-set for the draft.
// The room around it never adopts them: the admin reads admin-* tokens,
// which the generator emits once per mode and never inside a [data-theme]
// block, and the scoped CSS lands on this element only. You can tell at a
// glance where the client's work ends and the tooling begins, which is
// precisely the point.
//
// WHAT THE PREVIEW ANSWERS (owner review, 2026-08-27). A picture of the home
// page at one width in one mode is not enough to publish on. So:
//
//   • WIDTH. Desktop (1440px) and phone (390px) are the two the responsive
//     work is done against, and the frame renders at that true CSS width —
//     the page inside really is 390px wide, so its own breakpoints fire.
//     "Fit" scales the whole frame down to the column with a transform, so
//     nothing about the layout changes; "Actual size" scrolls instead.
//   • STRESS. Real content flatters a theme. "Stress test" swaps in an event
//     name that wraps three times and a day with twenty-eight sessions, so
//     a long title and a dense schedule are seen before a client sends one.
//     The fixture is built either way — from the deployment's own sessions
//     where there are any, from a written stand-in where there are none.
//     A deployment with nothing entered yet is precisely who is choosing a
//     style, and it used to be the one case where the stress test showed an
//     empty page and called it stressed.
//   • COMPARISON. "Compare light and dark" renders the same page twice, side
//     by side, on both grounds. Dark mode is its own palette and it is where
//     a brand colour usually fails; flipping a toggle and remembering is not
//     the same as looking at both.
//   • FALLBACKS. What the candidate asks for that will not render as asked:
//     a colour the resolver cannot read, and a font the browser has not
//     loaded. Both fall back silently otherwise.
//
// The controls live HERE, not on the bench beside it: which page, which
// width, which mode are questions about the picture. The mode is lifted to
// the editor because the admin marker's legibility warning is judged in the
// mode being shown, and the warning and the picture have to agree.
//
// The identification line sits BELOW each frame, on a hairline, in the data
// face — never above it, where it would stack over the page's own nameplate
// and become an eyebrow (brief §2.4).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  MemoryRouter,
  UNSAFE_LocationContext,
  UNSAFE_RouteContext,
} from 'react-router-dom';
import { AppRoutes } from '../../App.jsx';
import EventConfigContext, { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import ContentContext, { useContent } from '../../contexts/ContentContext.jsx';
import { themeFallbackWarnings } from '../../lib/themeRuntime.js';
import {
  PREVIEW_COMPARE_SCOPE_ID,
  PREVIEW_SCOPE_ID,
  applyThemePreview,
  clearThemePreview,
} from '../themePreview.js';
import { Notice, primaryButtonClass, secondaryButtonClass } from './formControls.jsx';

/**
 * The pages an operator can pull a preview of. Every one is a real route in
 * AppRoutes; the labels are the words the public navigation uses.
 *
 * Session detail is the odd one, and it is here because it is the page a
 * visitor most often lands on from a shared link — the one page where a
 * theme meets a single session's own type, room, and speakers. Its route
 * carries an id, so `proofPath` resolves it against whatever the frame is
 * showing rather than hard-coding one. When nothing resolves — a real
 * deployment with no sessions yet — the page is not offered, because a
 * preview of "this session is not available" is not a preview of a theme.
 * The stress test always resolves, so the page is one toggle away.
 */
export const PROOF_PAGES = Object.freeze([
  { id: 'home', path: '/', label: 'Home' },
  { id: 'schedule', path: '/schedule', label: 'Schedule' },
  { id: 'session', path: null, label: 'Session', needsSession: true },
  { id: 'speakers', path: '/speakers', label: 'Speakers' },
  { id: 'updates', path: '/updates', label: 'Updates' },
]);

/** The first session the frame could open, or null when there is none. */
export function firstPreviewSession(sessions) {
  return (sessions ?? []).find(
    (session) => session && session.visible !== false && typeof session.id === 'string' && session.id,
  ) ?? null;
}

/**
 * The route one preview page renders at, against the sessions the frame is
 * showing.
 *
 * @param {{ path: string|null, needsSession?: boolean }} page
 * @param {object[]} sessions
 * @returns {string|null} null when the page has nothing to open
 */
export function proofPath(page, sessions) {
  if (!page?.needsSession) return page?.path ?? null;
  const session = firstPreviewSession(sessions);
  return session ? `/schedule/${session.id}` : null;
}

/**
 * The two widths the responsive work is done against.
 *
 * Real numbers, not "small" and "large": the frame renders at this CSS width
 * so the page's own breakpoints fire inside it, and an operator checking a
 * phone is checking a phone.
 */
export const PREVIEW_VIEWPORTS = Object.freeze([
  { id: 'desktop', label: 'Desktop', width: 1440 },
  { id: 'mobile', label: 'Phone', width: 390 },
]);

/** How tall a frame is drawn, per width. A phone is drawn phone-shaped. */
const VIEWPORT_HEIGHT = Object.freeze({ desktop: 576, mobile: 844 });

/**
 * The gutter between the two frames of the light-and-dark comparison, in
 * pixels. It is `gap-xs` on the grid below, which is one --space-xs, and
 * zoom-to-fit has to subtract the same measure it draws — a number here that
 * does not match the class there scales the picture to a column that is not
 * the column.
 */
const COMPARE_GUTTER = 8;

/** How many sessions the dense-schedule fixture puts on one day. */
const STRESS_SESSION_COUNT = 28;

/**
 * The event name the long-title fixture uses.
 *
 * Long, real-shaped, and event-neutral: no client is named, and nothing here
 * reaches a published document — it exists only inside the frame while the
 * stress test is on.
 */
const STRESS_EVENT_NAME =
  'The Fifteenth Annual Regional Convening on Collaborative Public-Interest ' +
  'Reporting and Community Information Needs';

const STRESS_SESSION_TITLE =
  'Roundtable: Sustaining multi-newsroom investigative partnerships across ' +
  'state lines when the funding cycle and the election cycle disagree';

/**
 * The session the fixture is built from when the deployment has none.
 *
 * Written here rather than drawn from the document, because the moment an
 * operator most needs this preview is the moment they have entered nothing:
 * a brand new deployment picking a style. The fixture used to fall back to
 * the real schedule, which on an empty deployment meant the stress test
 * quietly showed an empty schedule and said "stress test" under it.
 *
 * Event-neutral on purpose. No client is named, and nothing here reaches a
 * published document — it exists only inside the frame while the stress
 * test is on.
 */
const STRESS_BASE_SESSION = Object.freeze({
  title: 'Panel: What a regional newsroom owes the county next door',
  type: 'panel',
  location: 'Hall 2',
  description:
    'A made-up session, shown so you can see a full row. Nothing here is saved and nothing here is published.',
  speakerIds: [],
  visible: true,
});

/** The day the fixture hangs on when the deployment has configured none. */
export const STRESS_DAY = Object.freeze({ id: 'stress-day', label: 'Day one', date: '2026-03-14' });

/**
 * A day packed to a width no real programme reaches.
 *
 * It builds the same twenty-eight rows either way: from the deployment's own
 * sessions where there are any, so the fixture reads as this event, and from
 * the written stand-in where there are none. It never returns the real
 * schedule unchanged, so "Stress test" always shows a stressed page.
 *
 * @param {object[]} sessions the real published schedule
 * @param {string} dayId the day to pack
 * @returns {object[]}
 */
export function denseSchedule(sessions, dayId) {
  const source = (sessions ?? []).filter((session) => session && session.visible !== false);
  const clock = (total) =>
    `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  const packed = [];
  for (let i = 0; i < STRESS_SESSION_COUNT; i += 1) {
    const base = source.length > 0 ? source[i % source.length] : STRESS_BASE_SESSION;
    const minutes = 8 * 60 + i * 20;
    packed.push({
      ...base,
      id: `stress-${i}`,
      dayId,
      order: i,
      visible: true,
      startTime: clock(minutes),
      endTime: clock(minutes + 20),
      title: i === 0 ? STRESS_SESSION_TITLE : `${base.title} (${i + 1})`,
    });
  }
  return packed;
}

/** One rendered frame, at one width, in one mode. */
function PreviewFrame({ path, scopeRef, width, height, scale, identification }) {
  return (
    <div className="flex min-w-0 flex-col">
      {/* What the frame is, for a reader who cannot see it. The frame itself
          is inert: it holds a whole rendered page, landmarks and links
          included, and letting that into the tab order or the landmark tree
          would put a second copy of the site inside the admin's own. The
          identification line below carries the same facts visually. */}
      <p className="sr-only">
        A preview of the {identification}. It is a picture of the page, not a
        working copy: nothing inside the frame can be reached by keyboard.
      </p>
      {/* The forme locked in a chase: a hairline frame on the room's ground.
          No shadow, no rounded card, no browser-window chrome pretending to
          be a device. The scale is a transform on the page inside, so the
          layout is untouched — a scaled 390px page is still a 390px page. */}
      <div
        className="overflow-auto border-admin-hairline border-admin-rule-strong"
        style={{ height: `${Math.round(height * scale)}px` }}
      >
        <div
          ref={scopeRef}
          inert=""
          style={{
            width: `${width}px`,
            height: `${height}px`,
            transform: scale === 1 ? undefined : `scale(${scale})`,
            transformOrigin: 'top left',
          }}
          className="overflow-auto"
        >
          {/* React Router refuses a Router inside a Router, and rightly: two
              histories fighting over one URL is a bug everywhere else. Here
              it is the point — the preview has its OWN history, so nothing
              it renders can move the admin's location. Clearing the two
              contexts is what lets the frame start a router of its own;
              nothing outside this element sees it. */}
          <UNSAFE_RouteContext.Provider value={{ outlet: null, matches: [], isDataRoute: false }}>
            <UNSAFE_LocationContext.Provider value={null}>
              {/* `key={path}` is load-bearing. `initialEntries` is read once,
                  when the router mounts, so without the key the identification
                  line would say Schedule while the frame kept rendering Home.
                  The key remounts the router — and only the router, so the
                  frame element and the id the scoped CSS is written against
                  both survive the switch. */}
              <MemoryRouter
                key={path}
                initialEntries={[path]}
                future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
              >
                <AppRoutes />
              </MemoryRouter>
            </UNSAFE_LocationContext.Provider>
          </UNSAFE_RouteContext.Provider>
        </div>
      </div>
      <p className="mt-2xs border-admin-rule-hairline border-t-admin-hairline pt-3xs font-admin-data text-folio text-admin-ink-data">
        {identification}
      </p>
    </div>
  );
}

/** A row of toggle buttons that reads as one control to a screen reader. */
function ControlGroup({ label, options, value, onChange }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-2xs">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          className={value === option.value ? primaryButtonClass : secondaryButtonClass}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export default function ThemeProof({ themeDoc, isDirty, mode, onModeChange }) {
  const frameRef = useRef(null);
  const compareRef = useRef(null);
  const columnRef = useRef(null);
  const [pageId, setPageId] = useState(PROOF_PAGES[0].id);
  const [viewportId, setViewportId] = useState(PREVIEW_VIEWPORTS[0].id);
  const [fit, setFit] = useState(true);
  const [stress, setStress] = useState(false);
  const [compare, setCompare] = useState(false);
  const [columnWidth, setColumnWidth] = useState(0);

  const viewport =
    PREVIEW_VIEWPORTS.find((entry) => entry.id === viewportId) ?? PREVIEW_VIEWPORTS[0];
  const height = VIEWPORT_HEIGHT[viewport.id] ?? VIEWPORT_HEIGHT.desktop;

  // Zoom to fit: measure the column, then scale the frame down to it. A
  // measurement of zero — jsdom, or a first paint before layout — means
  // "do not scale", because guessing would be worse than true scale.
  useLayoutEffect(() => {
    const element = columnRef.current;
    if (!element) return undefined;
    const measure = () => setColumnWidth(element.clientWidth || 0);
    measure();
    if (typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const frameCount = compare ? 2 : 1;
  const available =
    columnWidth > 0 ? (columnWidth - (compare ? COMPARE_GUTTER : 0)) / frameCount : 0;
  const scale = fit && available > 0 ? Math.min(1, available / viewport.width) : 1;

  // The candidate lands on every frame on every change, and the overlay is
  // removed when the editor unmounts, so an abandoned edit leaves nothing
  // behind and the saved theme renders again.
  useEffect(() => {
    const scopes = [];
    if (frameRef.current) {
      scopes.push({
        element: frameRef.current,
        id: PREVIEW_SCOPE_ID,
        mode: compare ? 'light' : mode,
      });
    }
    if (compare && compareRef.current) {
      scopes.push({ element: compareRef.current, id: PREVIEW_COMPARE_SCOPE_ID, mode: 'dark' });
    }
    if (scopes.length > 0) applyThemePreview(themeDoc, { scopes });
  }, [themeDoc, mode, compare, stress]);
  useEffect(() => () => clearThemePreview(), []);

  // The stress fixtures. Both contexts are overridden by VALUE only — the
  // providers themselves keep running above, so nothing here touches the
  // document, the listeners, or the saved theme.
  const realConfig = useEventConfig();
  const realContent = useContent();
  // The fixture needs a day to hang its sessions on. A deployment that has
  // configured none still gets one, because a brand new deployment is
  // exactly who this preview is for.
  const stressDay = realConfig.eventConfig?.days?.[0]?.id ? null : STRESS_DAY;
  const stressConfig = useMemo(
    () => ({
      ...realConfig,
      eventConfig: {
        ...realConfig.eventConfig,
        name: STRESS_EVENT_NAME,
        ...(stressDay ? { days: [STRESS_DAY] } : null),
      },
    }),
    [realConfig, stressDay],
  );
  const stressContent = useMemo(
    () => ({
      ...realContent,
      scheduleData: denseSchedule(
        realContent.scheduleData ?? [],
        realConfig.eventConfig?.days?.[0]?.id ?? STRESS_DAY.id,
      ),
    }),
    [realContent, realConfig],
  );

  const warnings = useMemo(() => themeFallbackWarnings(themeDoc), [themeDoc]);

  // Which pages can be offered depends on what the frame is showing: session
  // detail needs a session to open. The frame follows the same content, so
  // the list and the picture always agree.
  const shownSessions = stress ? stressContent.scheduleData : realContent.scheduleData;
  const offeredPages = PROOF_PAGES.filter((page) => proofPath(page, shownSessions));
  const page = offeredPages.find((entry) => entry.id === pageId) ?? offeredPages[0];
  const path = proofPath(page, shownSessions);

  const draftLabel = isDirty ? 'unpublished draft' : 'published theme';
  const sizeLabel = `${viewport.width}px${scale === 1 ? '' : ` at ${Math.round(scale * 100)}%`}`;
  const stressLabel = stress ? ' · stress test' : '';
  const identification = (frameMode) =>
    `${page.label} · ${frameMode} · ${sizeLabel}${stressLabel} · ${draftLabel}`;

  const frames = (
    <div className={compare ? 'grid grid-cols-2 gap-xs' : ''}>
      <PreviewFrame
        path={path}
        scopeRef={frameRef}
        width={viewport.width}
        height={height}
        scale={scale}
        identification={identification(compare ? 'light' : mode)}
      />
      {compare ? (
        <PreviewFrame
          path={path}
          scopeRef={compareRef}
          width={viewport.width}
          height={height}
          scale={scale}
          identification={identification('dark')}
        />
      ) : null}
    </div>
  );

  return (
    <div ref={columnRef} className="flex min-w-0 flex-col gap-xs">
      <div className="flex flex-wrap items-center justify-between gap-xs border-admin-rule-hairline border-b-admin-hairline pb-2xs">
        <h2 className="font-admin-ui text-lead font-semibold text-admin-ink">Page preview</h2>
        <ControlGroup
          label="Page to preview"
          value={page.id}
          onChange={setPageId}
          options={offeredPages.map((entry) => ({ value: entry.id, label: entry.label }))}
        />
      </div>

      <div className="flex flex-wrap items-center gap-xs">
        <ControlGroup
          label="Width to preview"
          value={viewportId}
          onChange={setViewportId}
          options={PREVIEW_VIEWPORTS.map((entry) => ({
            value: entry.id,
            label: `${entry.label} (${entry.width}px)`,
          }))}
        />
        <ControlGroup
          label="Scale"
          value={fit}
          onChange={setFit}
          options={[
            { value: true, label: 'Fit' },
            { value: false, label: 'Actual size' },
          ]}
        />
        {/* Two previews of the same forme. Switching re-renders instantly,
            with no animation, because wayfinding is instant (§2.2). */}
        <ControlGroup
          label="Mode to preview"
          value={compare ? 'compare' : mode}
          onChange={(value) => {
            if (value === 'compare') {
              setCompare(true);
              return;
            }
            setCompare(false);
            onModeChange(value);
          }}
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
            { value: 'compare', label: 'Compare light and dark' },
          ]}
        />
        <ControlGroup
          label="Content to preview"
          value={stress}
          onChange={setStress}
          options={[
            { value: false, label: 'Real content' },
            { value: true, label: 'Stress test' },
          ]}
        />
      </div>

      {stress ? (
        <p className="max-w-[65ch] text-caption text-admin-ink-secondary">
          A made-up event name that wraps three times, and one day packed with{' '}
          {STRESS_SESSION_COUNT} sessions. Nothing here is saved or published — it
          is a harder page than any client will send, shown so you meet it now.
        </p>
      ) : null}

      {warnings.length > 0 ? (
        <Notice
          tone="caution"
          message={`This preview is not showing everything you asked for. ${warnings
            .map((warning) => warning.message)
            .join(' ')}`}
        />
      ) : null}

      {/* The providers are ALWAYS here, and only their value changes. A
          conditional wrapper would change the element tree and remount the
          frames, which would throw away the ids the scoped preview CSS is
          written against — the page would render unstyled for a beat and
          then not at all. */}
      <EventConfigContext.Provider value={stress ? stressConfig : realConfig}>
        <ContentContext.Provider value={stress ? stressContent : realContent}>
          {frames}
        </ContentContext.Provider>
      </EventConfigContext.Provider>
    </div>
  );
}
