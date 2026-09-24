// The overview's Milestones panel (issue #180): the registration goal set
// against the approved count, and the event's own dated milestones with the
// days left until each one.
//
// Both come from config/event (edited on the event settings page), so the
// panel draws from the live config and does not wait for the figures. It
// renders nothing at all when the event has no milestone and no goal: an
// empty panel would be a heading with nothing under it.
//
// THE GOAL is a stated fraction beside a native <progress> that the sentence
// labels, never a ring and never colour alone (design vocabulary §3.2,
// Progress). Until the approved count arrives the panel states the goal on
// its own and draws no bar.
//
// THE MILESTONES are the Timeline device's contract in admin tokens: an
// ordered list on a spine, in date order, each entry the name, the date in
// the data face, and the distance from today in words ("In 12 days",
// "Today", "3 days ago"). A milestone that has passed stays on the list.
import { useId } from 'react';
import { formatDayDate } from '../../lib/eventTime.js';
import { useEventClock } from '../../hooks/useEventClock.js';
import { Panel } from '../components/formControls.jsx';
import { Figure } from './figures.jsx';
import { daysPhrase, daysUntil, sortMilestones } from './milestones.js';

function GoalLine({ goal, approved }) {
  const lineId = useId();
  if (!Number.isInteger(approved)) {
    return (
      <p className="text-admin-base text-admin-ink">
        Registration goal: <Figure value={goal} /> approved.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2xs">
      <p id={lineId} className="text-admin-base text-admin-ink">
        <Figure value={approved} /> of <Figure value={goal} /> approved toward the registration goal.
      </p>
      <progress
        aria-labelledby={lineId}
        value={Math.min(approved, goal)}
        max={goal}
        className="h-2 w-full max-w-xl accent-admin-action"
      />
    </div>
  );
}

/**
 * @param {object} props
 * @param {unknown} props.milestones config/event.milestones
 * @param {unknown} props.goal config/event.registration.goal
 * @param {number|undefined} props.approved the approved count, once the figures arrive
 * @param {string} props.timezone the event's IANA timezone
 * @param {Date} [props.now] a fixed time, for tests; the page passes none
 */
export default function MilestonesPanel({ milestones, goal, approved, timezone, now }) {
  // The ticking event clock (one tick a minute), so a page left open across
  // midnight on the event's clock moves "In 1 day" to "Today" by itself
  // (connector review of PR 272).
  const clock = useEventClock();
  const current = now ?? clock;
  const sorted = sortMilestones(milestones);
  const hasGoal = Number.isInteger(goal) && goal > 0;
  if (sorted.length === 0 && !hasGoal) return null;

  return (
    <Panel title="Milestones">
      <div className="flex flex-col gap-md">
        {hasGoal ? <GoalLine goal={goal} approved={approved} /> : null}
        {sorted.length > 0 ? (
          <ol className="flex flex-col gap-sm border-admin-rule-strong border-s-admin-strong ps-md">
            {sorted.map((milestone, index) => (
              <li key={index} className="flex flex-wrap items-baseline gap-x-sm gap-y-3xs">
                {/* The gaps set the three parts apart on screen; the hidden
                    commas do it for a screen reader. */}
                <span className="font-semibold text-admin-ink">{milestone.label}</span>
                <span className="sr-only">, </span>
                <span className="font-admin-data text-admin-sm text-admin-ink-data">
                  {formatDayDate({ date: milestone.date }, timezone) ?? milestone.date}
                </span>
                <span className="sr-only">, </span>
                <span className="text-admin-sm text-admin-ink-secondary">
                  {daysPhrase(daysUntil(milestone.date, timezone, current))}
                </span>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </Panel>
  );
}
