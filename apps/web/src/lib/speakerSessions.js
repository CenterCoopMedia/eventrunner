// The signed-in speaker's programme rows (M12 issue #211).
//
// A session belongs to a speaker only when its canonical `speakerIds` array
// carries the account's canonical `speakerId`. Names are display text and are
// never identity. The public schedule projection is the source: this helper
// neither reads nor accepts another speaker's private profile.
import { resolveSessionInstants } from './eventTime.js';

function resolvedStart(eventConfig, session) {
  return resolveSessionInstants(eventConfig, session).start?.getTime() ?? null;
}

function compareSessions(eventConfig, a, b) {
  const aStart = resolvedStart(eventConfig, a);
  const bStart = resolvedStart(eventConfig, b);
  if (aStart !== bStart) {
    if (aStart === null) return 1;
    if (bStart === null) return -1;
    return aStart - bStart;
  }
  return (
    (a.order ?? 0) - (b.order ?? 0) ||
    String(a.title ?? '').localeCompare(String(b.title ?? '')) ||
    String(a.id ?? '').localeCompare(String(b.id ?? ''))
  );
}

/**
 * The visible public sessions assigned to one canonical speaker, in event
 * clock order. A row with an unresolved clock remains available to the
 * session hub, after the rows whose time is known; it cannot become the next
 * session because its position in time is not known.
 */
export function selectOwnSpeakerSessions(scheduleData, speakerId, eventConfig) {
  if (typeof speakerId !== 'string' || speakerId.length === 0) return [];
  return (Array.isArray(scheduleData) ? scheduleData : [])
    .filter(
      (session) =>
        session?.visible === true &&
        Array.isArray(session.speakerIds) &&
        session.speakerIds.includes(speakerId),
    )
    .slice()
    .sort((a, b) => compareSessions(eventConfig, a, b));
}

/**
 * The first assigned session that is still ahead or in progress. A session
 * with no end may be selected before it starts, but never after it starts:
 * without an end the page cannot claim that it is still current.
 */
export function nextSpeakerSession(sessions, eventConfig, now) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return null;
  const ordered = (Array.isArray(sessions) ? sessions : [])
    .slice()
    .sort((a, b) => compareSessions(eventConfig, a, b));

  for (const session of ordered) {
    const { start, end } = resolveSessionInstants(eventConfig, session);
    if (!start) continue;
    if (end ? now < end : now <= start) return session;
  }
  return null;
}
