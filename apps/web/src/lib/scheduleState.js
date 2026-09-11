// Session state against the event clock (issue #167).
//
// THE EVENT TIMEZONE, NOT THE BROWSER'S. A session's window is a wall clock
// in config/event.timezone (lib/eventTime.js resolves it to real instants);
// the wall clock the page compares against is the same zone's present. A
// reader in another timezone still sees the event's own "now".
//
// The mark is words first: "Running now" and "Finished" are sentences about
// the programme, and the ink (the tag treatment, the weight) only repeats
// them for a sighted reader. Reduced motion changes nothing here — there is
// no motion to reduce; the marks are static text that arrives with the
// render.
import { resolveSessionInstants } from './eventTime.js';

/**
 * Whether a session is running or finished at `now`.
 *
 * @param {object} eventConfig
 * @param {object} session
 * @param {Date} now
 * @returns {'running' | 'finished' | null}
 *   null where the session's window cannot be resolved (no day, malformed
 *   times) or where it has not started — a session that is not yet running
 *   is not marked.
 */
export function sessionStateOf(eventConfig, session, now) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return null;
  const { start, end } = resolveSessionInstants(eventConfig, session);
  if (!start || !end) return null;
  if (now < start) return null;
  // The end minute is over: a session listed 09:05–09:45 is finished at
  // 09:45, not still running.
  return now < end ? 'running' : 'finished';
}
