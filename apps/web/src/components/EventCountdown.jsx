// The home lead's lifecycle-aware line (M7, "Add a countdown and a
// lifecycle aware home lead"): the static identity frame the splash screen
// row stood in for now carries the event's own clock instead of an
// animated intro.
//
// `getEventPhase` (shared/config) is the one place that decides where the
// event stands, so this reads it rather than re-deriving a boolean from
// the days array — the site and the lifecycle clock can never disagree.
// Three renderings, driven by the same phase every other lifecycle surface
// reads:
//
//   before in_progress   count down to the event's own start instant.
//   in_progress           stop counting; state that the event is running.
//   ended or archived     state the stated post event line.
//
// The figures sit in the mono face with tabular figures (interface
// guidelines, Typography), the same contract StatBlock's legacy shape
// uses. Ticking is a once-per-second text update, never a transform or an
// opacity animation, so it needs no `prefers-reduced-motion` guard — CSS
// motion durations already collapse under that media query (index.css),
// and there is no motion here to begin with.
import { useEffect, useState } from 'react';
import { getEventPhase } from 'shared/config';
import { countdownParts, resolveEventStart } from '../lib/eventTime.js';

const RUNNING_LINE = 'This event is happening now.';
const POST_EVENT_LINE = 'This event has ended.';

const UNITS = [
  { key: 'days', label: 'Days' },
  { key: 'hours', label: 'Hours' },
  { key: 'minutes', label: 'Minutes' },
  { key: 'seconds', label: 'Seconds' },
];

const STATED_LINE_CLASS = 'mt-md max-w-prose text-body text-text-secondary text-pretty';

export default function EventCountdown({ eventConfig }) {
  const [now, setNow] = useState(() => new Date());
  const phase = getEventPhase(eventConfig, now);
  const target = resolveEventStart(eventConfig);
  // Counting is gated on both the phase and a resolvable target: a
  // misconfigured event with no valid days never reaches in_progress on
  // its own clock, so phase alone would tick forever toward nothing.
  const counting =
    phase !== 'in_progress' && phase !== 'ended' && phase !== 'archived' && Boolean(target);

  useEffect(() => {
    if (!counting) return undefined;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [counting]);

  if (phase === 'in_progress') {
    return <p className={STATED_LINE_CLASS}>{RUNNING_LINE}</p>;
  }

  if (phase === 'ended' || phase === 'archived') {
    return <p className={STATED_LINE_CLASS}>{POST_EVENT_LINE}</p>;
  }

  if (!target) return null;

  // Clamped at zero (never negative): a tick can land in the moment
  // between the target passing and this component's own next read of
  // `getEventPhase` switching it away from the countdown.
  const parts = countdownParts(target.getTime() - now.getTime());

  return (
    <dl className="mt-md flex flex-wrap gap-lg border-t-hairline border-t-rule-hairline pt-sm">
      {UNITS.map((unit) => (
        <div key={unit.key} className="flex flex-col">
          <dt className="order-last mt-2xs font-data text-caption text-text-secondary">
            {unit.label}
          </dt>
          <dd data-numeric className="font-mono text-h3 font-semibold text-text-primary">
            {String(parts[unit.key]).padStart(2, '0')}
          </dd>
        </div>
      ))}
    </dl>
  );
}
