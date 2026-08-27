// The proof: the client's real page, locked in a chase on the admin ground
// (docs/plans/2026-08-27-admin-identity-story.md, moment 2).
//
// This is not a swatch board. The frame renders the app's OWN routes and
// components — `AppRoutes` from App.jsx, inside a MemoryRouter at the page
// the operator picked — reading the same providers the admin is already
// mounted inside. What differs is only the theme: the candidate document is
// applied to the frame ELEMENT through applyThemePreview, which stays the
// one path from a candidate to rendered CSS (brief §5.2).
//
// The frame carries data-theme, data-mode, and data-motif-set for the draft.
// The room around it never adopts them: the admin reads admin-* tokens,
// which the generator emits once per mode and never inside a [data-theme]
// block, and the scoped CSS lands on this element only. You can tell at a
// glance where the client's work ends and the tooling begins, which is
// precisely the point.
//
// The identification line sits BELOW the frame, on a hairline, in the data
// face — never above it, where it would stack over the page's own nameplate
// and become an eyebrow (brief §2.4).
import { useEffect, useRef } from 'react';
import {
  MemoryRouter,
  UNSAFE_LocationContext,
  UNSAFE_RouteContext,
} from 'react-router-dom';
import { AppRoutes } from '../../App.jsx';
import { applyThemePreview, clearThemePreview } from '../themePreview.js';

/**
 * The pages an operator can pull a proof of. Every one is a real route in
 * AppRoutes; the labels are the words the public navigation uses.
 */
export const PROOF_PAGES = Object.freeze([
  { path: '/', label: 'Home' },
  { path: '/schedule', label: 'Schedule' },
  { path: '/speakers', label: 'Speakers' },
  { path: '/updates', label: 'Updates' },
]);

export default function ThemeProof({ themeDoc, path, mode, identification }) {
  const frameRef = useRef(null);

  // The candidate lands on the frame on every change, and the overlay is
  // removed when the editor unmounts, so an abandoned edit leaves nothing
  // behind and the saved theme renders again.
  useEffect(() => {
    if (frameRef.current) applyThemePreview(themeDoc, { scope: frameRef.current, mode });
  }, [themeDoc, mode]);
  useEffect(() => () => clearThemePreview(), []);

  return (
    <div className="flex min-w-0 flex-col">
      {/* What the frame is, for a reader who cannot see it. The frame itself
          is inert: it holds a whole rendered page, landmarks and links
          included, and letting that into the tab order or the landmark tree
          would put a second copy of the site inside the admin's own. The
          identification line below carries the same three facts visually. */}
      <p className="sr-only">
        A proof of the {identification}. It is a picture of the page, not a
        working copy: nothing inside the frame can be reached by keyboard.
      </p>
      <div
        ref={frameRef}
        inert=""
        // The forme locked in a chase: a hairline frame on the room's
        // ground, held at true scale. No shadow, no rounded card, no
        // browser-window chrome pretending to be a device.
        className="h-[36rem] overflow-auto border-admin-hairline border-admin-rule-strong"
      >
        {/* React Router refuses a Router inside a Router, and rightly: two
            histories fighting over one URL is a bug everywhere else. Here it
            is the point — the proof has its OWN history, so nothing it
            renders can move the admin's location. Clearing the two contexts
            is what lets the frame start a router of its own; nothing outside
            this element sees it. */}
        <UNSAFE_RouteContext.Provider value={{ outlet: null, matches: [], isDataRoute: false }}>
          <UNSAFE_LocationContext.Provider value={null}>
            <MemoryRouter
              initialEntries={[path]}
              future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
            >
              <AppRoutes />
            </MemoryRouter>
          </UNSAFE_LocationContext.Provider>
        </UNSAFE_RouteContext.Provider>
      </div>
      <p className="mt-2xs border-admin-rule-hairline border-t-admin-hairline pt-3xs font-admin-data text-folio text-admin-ink-data">
        {identification}
      </p>
    </div>
  );
}
