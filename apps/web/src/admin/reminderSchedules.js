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
      if (lastRun.reason === 'time-limit') parts.push(`the run reached its time limit, so ${speakerWord(left)} ${left === 1 ? 'waits' : 'wait'} for the next run`);
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

// --- attendees ---------------------------------------------------------------

/** The attendee schedule's state in words. Never shown by colour alone. */
export function attendeeStateWords(state) {
  if (state === 'on') return 'Scheduled attendee reminders are on.';
  if (state === 'paused') return 'Scheduled attendee reminders are paused.';
  return 'Scheduled attendee reminders are off.';
}

/** "1 attendee" / "2 attendees". */
export function attendeeWord(count) {
  return `${count} ${count === 1 ? 'attendee' : 'attendees'}`;
}

/** "1 address" / "2 addresses". */
export function addressWord(count) {
  return `${count} ${count === 1 ? 'address' : 'addresses'}`;
}

/** Who the reminder would reach, and who unsubscribed, as counts. */
export function reachWords(reach) {
  if (!reach) return '';
  if (reach.count === null || reach.count === undefined) return reach.problem ?? '';
  if (reach.remaining) {
    return `${addressWord(reach.count)} ${reach.count === 1 ? 'is' : 'are'} left in this reminder day’s send.`;
  }
  const parts = [`It would reach ${attendeeWord(reach.count)}.`];
  if (reach.suppressed) {
    parts.push(`${addressWord(reach.suppressed)} unsubscribed and ${reach.suppressed === 1 ? 'is' : 'are'} left out.`);
  }
  return parts.join(' ');
}

const PLACEHOLDER = '{{days_until}}';

/**
 * The wording problems the server would refuse, for a message before any
 * request: an empty field, or a placeholder other than {{days_until}}.
 *
 * @returns {{ subject: string|null, message: string|null }}
 */
export function draftProblems(draft, { maxSubjectLength = 120, maxMessageLength = 5000 } = {}) {
  const check = (text, max, name) => {
    const value = String(text ?? '').trim();
    if (!value) return `Write a ${name}.`;
    if (value.length > max) return `Use ${max} characters or fewer.`;
    const unknown = [...new Set((value.match(/\{\{[^{}]*\}\}/g) || []).filter((found) => found !== PLACEHOLDER))];
    if (unknown.length) return `Only ${PLACEHOLDER} can be used. Remove ${unknown.join(', ')}.`;
    return null;
  };
  return {
    subject: check(draft.subject, maxSubjectLength, 'subject'),
    message: check(draft.message, maxMessageLength, 'message'),
  };
}

/** The last attendee run, in one sentence, counted in emails and addresses. */
export function attendeeLastRunWords(lastRun, timeZone) {
  if (!lastRun) return 'The schedule has not run yet.';
  const when = eventTime(lastRun.finishedAt ?? lastRun.startedAt, timeZone);
  const counts = lastRun.counts ?? {};
  let what;
  switch (lastRun.outcome) {
    case 'completed': {
      const sent = counts.sent ?? 0;
      const parts = [`sent ${sent} ${sent === 1 ? 'email' : 'emails'}`];
      if (counts.failed) parts.push(`${counts.failed} could not be emailed`);
      if (counts.uncertain) parts.push(`${counts.uncertain} may have gone (check the Email log)`);
      if (counts.suppressed) parts.push(`${addressWord(counts.suppressed)} unsubscribed during the send`);
      const left = counts.deferred ?? 0;
      if (lastRun.reason === 'quiet-hours') parts.push(`quiet hours began, so ${addressWord(left)} ${left === 1 ? 'waits' : 'wait'} for the next run`);
      if (lastRun.reason === 'schedule-changed') parts.push(`the schedule changed during the run, so it stopped before ${addressWord(left)}`);
      if (lastRun.reason === 'window-closed') parts.push(`the reminder day ended during the run, before ${addressWord(left)}`);
      if (lastRun.reason === 'time-limit') parts.push(`the run reached its time limit, so ${addressWord(left)} ${left === 1 ? 'waits' : 'wait'} for the next run`);
      if (lastRun.reason === 'superseded') parts.push('the send began on an earlier approval, so it stopped and sends no more');
      if (lastRun.reason === 'busy') parts.push('another run held the send, so this run stopped');
      what = `${lastRun.offsetDays ? `the ${lastRun.offsetDays}-day reminder: ` : ''}${parts.join(', ')}`;
      break;
    }
    case 'nothing-due':
      what = 'nothing was due';
      break;
    case 'paused':
      what = lastRun.reason === 'facts-changed'
        ? 'the event start, the venue or the ticket link was not the approved one, so it sent nothing and paused the schedule'
        : 'the wording was not the approved wording, so it sent nothing and paused the schedule';
      break;
    case 'failed':
      what = `it stopped: ${String(lastRun.error?.message ?? 'a server error').replace(/\.$/, '')}`;
      break;
    default:
      what = lastRun.outcome ?? 'unknown';
  }
  return `Last run ${when}: ${what}.`;
}
