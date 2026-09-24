// The editor tour (issue #198): a short introduction to the admin, one step
// at a time, that any step can end.
//
// IT IS NOT A MODAL. It stands at the head of the work surface as a panel,
// with no scrim, no motion and no anchored overlay, so the admin stays usable
// behind it: a reader can open the section a step names and the tour stays
// on screen across routes (it lives in the shell, not on a page).
//
// ITS STEPS COME FROM THE DOCKET the signed-in tier can reach
// (AdminLayout.jsx docketForTier): a welcome, one step per group, and a last
// step on the public edit links. A page added to a group appears in its step
// with no edit here, and a staff admin never reads an operator section. The
// group copy names no page for the same reason.
//
// THE KEYBOARD PATH. Next and Back move the step and focus its heading, so a
// screen reader hears the new heading and the step line under it. End tour,
// Finish tour and Escape anywhere inside the panel end it; the shell stores
// that and moves focus to "Take the tour" on the rail.
//
// It is its own lazy chunk (AdminLayout.jsx), so the admin entry chunk
// carries only the button and the stored flag.
import { useEffect, useId, useRef, useState } from 'react';
import { listWords } from '../AdminLayout.jsx';
import { RECORD_STATE_IDS, state } from '../recordState.js';
import { RecordState } from './adminChrome.jsx';
import { linkButtonClass, secondaryButtonClass } from './formControls.jsx';

/** One line per docket group. It names no page: builders add pages to groups. */
export const TOUR_GROUP_COPY = Object.freeze({
  lead: 'How the event is going, in figures the server counts.',
  content: 'What the site says and shows.',
  people: 'Who takes part in the event.',
  operations: 'The event while it runs.',
  system: 'How this site is set up.',
});

/**
 * The tour's steps for a docket (already filtered to the reader's tier).
 * A group with no label (the lead group) takes its first item's label.
 *
 * @param {{ id: string, label: string|null, items: { label: string }[] }[]} docket
 * @returns {{ id: string, heading: string, copy?: string|null, items?: string[] }[]}
 */
export function tourSteps(docket) {
  return [
    { id: 'welcome', heading: 'Welcome to the admin panel' },
    ...docket.map((group) => ({
      id: group.id,
      heading: group.label ?? group.items[0]?.label ?? '',
      copy: TOUR_GROUP_COPY[group.id] ?? null,
      items: group.items.map((item) => item.label),
    })),
    { id: 'site', heading: 'Edit from the site' },
  ];
}

function StepBody({ step }) {
  if (step.id === 'welcome') {
    return (
      <>
        <p>
          This tour shows where each part of the site is edited. End it at any step with End tour
          or the Escape key. Take it again from the foot of the rail.
        </p>
        <p>
          A change you save is a draft. Visitors see it only after you publish it. Each record
          shows one of three words:
        </p>
        <ul className="flex flex-wrap gap-xs">
          {RECORD_STATE_IDS.map((id) => (
            <li key={id}>
              <RecordState state={state(id)} />
            </li>
          ))}
        </ul>
      </>
    );
  }
  if (step.id === 'site') {
    return (
      <p>
        Open the site with View site. While you are signed in as an admin, each section of a page
        shows an Edit section link. It opens the editor for that section here.
      </p>
    );
  }
  return (
    <>
      {step.copy ? <p>{step.copy}</p> : null}
      <p>In this group: {listWords(step.items)}.</p>
    </>
  );
}

/**
 * @param {{
 *   docket: object[],
 *   takeFocus?: boolean, // focus the first heading on mount (opened on request)
 *   onEnd: () => void,   // End tour, Finish tour, or Escape
 * }} props
 */
export default function AdminTour({ docket, takeFocus = false, onEnd }) {
  const steps = tourSteps(docket);
  const [index, setIndex] = useState(0);
  const [focusPending, setFocusPending] = useState(takeFocus);
  const headingRef = useRef(null);
  const stepLineId = useId();
  // The docket can only shrink under an open tour if the tier changes; the
  // step then clamps to the last one rather than reading past the end.
  const at = Math.min(index, steps.length - 1);
  const step = steps[at];
  const last = at === steps.length - 1;

  useEffect(() => {
    if (!focusPending) return;
    headingRef.current?.focus();
    setFocusPending(false);
  }, [focusPending, at]);

  function move(delta) {
    setIndex(at + delta);
    setFocusPending(true);
  }

  return (
    <aside
      aria-label="Admin tour"
      className="admin-tour"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        onEnd();
      }}
    >
      <h2
        ref={headingRef}
        tabIndex={-1}
        aria-describedby={stepLineId}
        className="font-admin-ui text-admin-lg font-bold text-admin-ink"
      >
        {step.heading}
      </h2>
      {/* Under the heading, never above it: a line over a heading is an
          eyebrow. It is language, so it takes the reading face. */}
      <p id={stepLineId} className="text-admin-sm text-admin-ink-secondary">
        Step {at + 1} of {steps.length}
      </p>
      <div className="mt-sm flex max-w-[65ch] flex-col gap-xs text-admin-base text-admin-ink">
        <StepBody step={step} />
      </div>
      <div className="mt-md flex flex-wrap items-center gap-xs">
        <button type="button" className={secondaryButtonClass} disabled={at === 0} onClick={() => move(-1)}>
          Back
        </button>
        <button type="button" className={secondaryButtonClass} onClick={last ? onEnd : () => move(1)}>
          {last ? 'Finish tour' : 'Next'}
        </button>
        <button type="button" className={linkButtonClass} onClick={onEnd}>
          End tour
        </button>
      </div>
    </aside>
  );
}
