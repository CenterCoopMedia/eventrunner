// Section index for a long content page (issue #14 spec M7-14): a plain
// list of same-page links that marks which section is currently in view and
// moves keyboard/screen-reader focus to that section's own heading when a
// reader activates one — the same "current" idiom Layout.jsx's main nav
// already uses (weight plus a rule, never colour alone — interface
// guidelines: Accessibility), and the same instant, unanimated wayfinding
// every route change and focus move on this site keeps (interface
// guidelines: Animation).
//
// Generic over any page's own sections — nothing here names FAQ or any
// other page. ContentPage.jsx decides when a page is long enough to show it.
import { useEffect, useState } from 'react';

/** Scroll a section into view and move focus onto its own heading. The
 * heading needs its own tabIndex={-1} to be focusable at all (Accessibility:
 * only tabindex 0 and -1 are used, and -1 keeps it out of the tab order). */
function focusSection(id) {
  const el = typeof document === 'undefined' ? null : document.getElementById(id);
  if (!el) return;
  // Wayfinding never animates (interface guidelines: Animation) — the
  // default 'auto' behavior is an instant jump, not a smooth scroll.
  // jsdom does not implement scrollIntoView (there is no layout to scroll).
  if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start' });
  el.focus({ preventScroll: true });
}

/**
 * @param {{ sections: Array<{ id: string, label: string }> }} props
 */
export default function SectionIndexNav({ sections }) {
  const [activeId, setActiveId] = useState(sections[0]?.id ?? null);
  // A stable key for the effect below: the actual section ids change when a
  // keyword filter narrows the page, and the observer has to re-target.
  const ids = sections.map((section) => section.id).join('|');

  useEffect(() => {
    // The section a filter removed can no longer be "current".
    if (sections.length > 0 && !sections.some((section) => section.id === activeId)) {
      setActiveId(sections[0].id);
    }
    // activeId is read, not depended on: this only reacts to the id SET
    // changing, and reading it fresh here (rather than in the deps array)
    // avoids re-running on every observer-driven activeId update below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  useEffect(() => {
    const ObserverType = globalThis.IntersectionObserver;
    if (typeof ObserverType !== 'function') return undefined;
    const targets = sections
      .map((section) => document.getElementById(section.id))
      .filter(Boolean);
    if (targets.length === 0) return undefined;

    // The band a heading has to cross to count as "in view": past a fixed
    // header allowance at the top, and within the top third of the
    // viewport, so the reader's own reading position decides which section
    // is current rather than whatever merely touches the viewport edge.
    const observer = new ObserverType(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length === 0) return;
        // Two sections can cross the band in the same tick; observer entry
        // order is not guaranteed, so the topmost heading wins rather than
        // whichever entry the browser happened to report last.
        const topmost = visible.reduce((best, entry) =>
          entry.boundingClientRect.top < best.boundingClientRect.top ? entry : best,
        );
        setActiveId(topmost.target.id);
      },
      { rootMargin: '-96px 0px -70% 0px' },
    );
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  if (sections.length === 0) return null;

  return (
    <nav aria-label="Sections on this page" className="mb-lg">
      <ul className="flex flex-col gap-3xs border-s-hairline border-s-rule-hairline">
        {sections.map((section) => {
          const current = section.id === activeId;
          return (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                // aria-current="location" is the token WAI-ARIA names for a
                // link to the reader's own place within a page's sections —
                // not "page", which names a different document.
                aria-current={current ? 'location' : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  focusSection(section.id);
                  setActiveId(section.id);
                }}
                className={[
                  'touch-target block border-s-strong ps-sm py-2xs font-data text-caption',
                  current
                    ? 'border-s-rule-strong font-semibold text-text-primary'
                    : 'border-s-transparent text-text-secondary hover:text-text-primary',
                ].join(' ')}
              >
                {section.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
