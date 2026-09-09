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
// Counting is an ALLOWLIST of the phases before the event starts — draft,
// and any phase this file does not yet know about, render nothing rather
// than a countdown — because a denylist of the phases that stop counting
// would count down on a draft event nobody has announced yet.
//
// The figures sit in the mono face with tabular figures (interface
// guidelines, Typography), the same contract StatBlock's legacy shape
// uses. Ticking is a once-per-second text update, never a transform or an
// opacity animation, so it needs no `prefers-reduced-motion` guard — CSS
// motion durations already collapse under that media query (index.css),
// and there is no motion here to begin with.
//
// The running line also polls the phase, at a much lower frequency: nothing
// else re-renders this component while the event is in progress (the event
// config does not change on its own), so without its own low-frequency
// check the running line would sit there forever after the last day ends,
// only correcting itself on the reader's next page load.
//
// draft polls the same way, for the same reason: `getEventPhase` reads
// `announcedAt` first (packages/shared/src/config/lifecycle.cjs) and stays
// draft until the clock reaches it, so a reader who opens the page before
// that moment would otherwise see nothing here forever — the lead only
// ever appears on its next page load, past the moment it was supposed to
// appear on its own. There is nothing to poll toward when `announcedAt` is
// unset or unparseable — that boundary never arrives on the clock alone,
// only by an operator's own edit, which already re-renders this component
// through a changed `eventConfig` prop.
import { useEffect, useId, useState } from 'react';
import { getEventPhase } from 'shared/config';
import { countdownParts, resolveEventStart } from '../lib/eventTime.js';

// The same "YYYY-MM-DDTHH:MM" shape getEventPhase's own toMinuteIso
// requires of announcedAt, so this agrees with the lifecycle clock about
// what counts as a real boundary to wait for, not merely a truthy string.
const ISO_MINUTE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function hasPendingAnnouncement(eventConfig) {
  return (
    typeof eventConfig?.announcedAt === 'string' && ISO_MINUTE_RE.test(eventConfig.announcedAt)
  );
}

const RUNNING_LINE = 'This event is happening now.';
const POST_EVENT_LINE = 'This event has ended.';
const COUNTDOWN_LABEL = 'Time until the event starts';

// Only these phases count down. Anything else — draft, in_progress, ended,
// archived, or a phase this file has not been taught — renders nothing or
// its own stated line below, never a countdown.
const COUNTING_PHASES = new Set(['announced', 'registration_open', 'registration_closed']);

// Once a minute is enough to catch the event's own end without a reload;
// it is not a rendering rate, so it carries no motion concern of its own.
const RUNNING_CHECK_MS = 60_000;

const UNITS = [
  { key: 'days', label: 'Days', pad: false },
  { key: 'hours', label: 'Hours', pad: true },
  { key: 'minutes', label: 'Minutes', pad: true },
  { key: 'seconds', label: 'Seconds', pad: true },
];

const STATED_LINE_CLASS = 'mt-md max-w-prose text-body text-text-secondary text-pretty';

export default function EventCountdown({ eventConfig }) {
  const labelId = useId();
  const [now, setNow] = useState(() => new Date());
  const phase = getEventPhase(eventConfig, now);
  const target = resolveEventStart(eventConfig);
  const counting = COUNTING_PHASES.has(phase) && Boolean(target);
  const watchingRunning = phase === 'in_progress';
  // Waiting on the announcement is its own gate, distinct from `counting`:
  // a draft event never renders a countdown (the allowlist above excludes
  // it), but it still needs a clock running toward the moment it stops
  // being draft, or that moment only ever arrives on a reload.
  const watchingDraft = phase === 'draft' && hasPendingAnnouncement(eventConfig);

  useEffect(() => {
    const delayMs = counting
      ? 1000
      : watchingRunning || watchingDraft
        ? RUNNING_CHECK_MS
        : null;
    if (delayMs === null) return undefined;
    // The one interval this component ever runs, and its callback touches
    // nothing but this component's own state: no window, no document, no
    // DOM read of any kind, so there is nothing here for an unmounted
    // instance's stray tick to fail against. React runs this same cleanup
    // both when the delay changes (phase moved) and on unmount, so a timer
    // this effect started is never the one left running past either.
    const id = setInterval(() => setNow(new Date()), delayMs);
    return () => clearInterval(id);
  }, [counting, watchingRunning, watchingDraft]);

  if (phase === 'in_progress') {
    return <p className={STATED_LINE_CLASS}>{RUNNING_LINE}</p>;
  }

  if (phase === 'ended' || phase === 'archived') {
    return <p className={STATED_LINE_CLASS}>{POST_EVENT_LINE}</p>;
  }

  if (!counting) return null;

  // Clamped at zero (never negative): a tick can land in the moment
  // between the target passing and this component's own next read of
  // `getEventPhase` switching it away from the countdown.
  const parts = countdownParts(target.getTime() - now.getTime());

  return (
    // The outer gap (from the copy above) reads at least twice the gap
    // between the figures themselves (interface guidelines, Layout: named
    // steps pair sm with lg) — a group boundary, not a run of equally
    // spaced siblings.
    <div className="mt-lg border-t-hairline border-t-rule-hairline pt-sm">
      <p id={labelId} className="font-data text-caption text-text-secondary">
        {COUNTDOWN_LABEL}
      </p>
      {/* Not a live region: a screen reader is not interrupted once a
          second for a figure nobody asked to be read aloud. The visible
          label above states what the group is; a reader who tabs to it
          hears that label, then the figures, at their own pace. */}
      <dl aria-labelledby={labelId} className="mt-xs flex flex-wrap gap-sm">
        {UNITS.map((unit) => (
          <div key={unit.key} className="flex flex-col">
            <dt className="order-last mt-2xs font-data text-caption text-text-secondary">
              {unit.label}
            </dt>
            <dd data-numeric className="font-mono text-h3 font-semibold text-text-primary">
              {unit.pad ? String(parts[unit.key]).padStart(2, '0') : String(parts[unit.key])}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
