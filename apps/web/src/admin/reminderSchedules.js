// Scheduled reminders page helpers (functions/src/reminders/schedules.cjs).
// Pure, so the page and its tests read one set of words.
import { describeEventDateTime } from '../lib/eventDateTime.js';

/** The schedule's state in words. Never shown by colour alone. */
export function stateWords(state) {
  if (state === 'on') return 'Scheduled speaker reminders are on.';
  if (state === 'paused') return 'Scheduled speaker reminders are paused.';
  return 'Scheduled speaker reminders are off.';
}

/** "1 day" / "7 days". */
export function dayCount(days) {
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/** "1 speaker" / "3 speakers". */
export function speakerWord(count) {
  return `${count} ${count === 1 ? 'speaker' : 'speakers'}`;
}

/** An instant on the event's clock, with the zone named. */
export function eventTime(iso, timeZone) {
  if (!iso) return '';
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return '';
  if (!timeZone) return instant.toISOString();
  try {
    return `${describeEventDateTime(instant, timeZone)}, ${timeZone}`;
  } catch {
    return instant.toISOString();
  }
}

/**
 * Offsets typed as text, one per input, read as whole days. Returns the
 * days largest first, or the problem that stops a save.
 *
 * @returns {{ days: number[]|null, problem: string|null }}
 */
export function readOffsetInputs(values, { maxOffsets = 6, maxOffsetDays = 365 } = {}) {
  const filled = values.map((value) => String(value).trim()).filter(Boolean);
  if (filled.length === 0) return { days: null, problem: 'Enter at least one number of days.' };
  if (filled.length > maxOffsets) return { days: null, problem: `Enter at most ${maxOffsets} numbers of days.` };
  const days = filled.map(Number);
  if (!days.every((n) => Number.isInteger(n) && n >= 1 && n <= maxOffsetDays)) {
    return { days: null, problem: `Each number of days must be a whole number from 1 to ${maxOffsetDays}.` };
  }
  if (new Set(days).size !== days.length) return { days: null, problem: 'Each number of days may appear once.' };
  return { days: [...days].sort((a, b) => b - a), problem: null };
}

/** The last run, in one sentence. */
export function lastRunWords(lastRun, timeZone) {
  if (!lastRun) return 'The schedule has not run yet.';
  const when = eventTime(lastRun.finishedAt ?? lastRun.startedAt, timeZone);
  const counts = lastRun.counts ?? {};
  let what;
  switch (lastRun.outcome) {
    case 'completed': {
      const parts = [`sent ${counts.sent ?? 0} ${counts.sent === 1 ? 'reminder' : 'reminders'}`];
      if (counts.failed) parts.push(`${counts.failed} could not be emailed`);
      if (counts.uncertain) parts.push(`${counts.uncertain} may have gone (check the Email log)`);
      if (counts.waiting) parts.push(`${speakerWord(counts.waiting)} waited on the 24-hour limit`);
      const left = counts.deferred ?? 0;
      if (lastRun.reason === 'quiet-hours') parts.push(`quiet hours began, so ${speakerWord(left)} ${left === 1 ? 'waits' : 'wait'} for the next run`);
      if (lastRun.reason === 'schedule-changed') parts.push(`the schedule changed during the run, so it stopped before ${speakerWord(left)}`);
      if (lastRun.reason === 'window-closed') parts.push(`the reminder day ended during the run, before ${speakerWord(left)}`);
      what = `${lastRun.offsetDays ? `the ${lastRun.offsetDays}-day reminder: ` : ''}${parts.join(', ')}`;
      break;
    }
    case 'nothing-due':
      what = 'nothing was due';
      break;
    case 'paused':
      what = 'the wording was not the approved wording, so it sent nothing and paused the schedule';
      break;
    case 'failed':
      what = `it stopped: ${lastRun.error?.message ?? 'a server error'}`;
      break;
    default:
      what = lastRun.outcome ?? 'unknown';
  }
  return `Last run ${when}: ${what}.`;
}

/** The next run, in one sentence, from the `get` action's `nextRun`. */
export function nextRunWords(nextRun, timeZone) {
  if (!nextRun) return '';
  if (nextRun.status === 'due') {
    return `The ${nextRun.offsetDays}-day reminder is due now. The next hourly run sends it.`;
  }
  if (nextRun.status === 'upcoming') {
    return `Next: the ${nextRun.offsetDays}-day reminder, ${eventTime(nextRun.at, timeZone)}.`;
  }
  return nextRun.message ?? '';
}
