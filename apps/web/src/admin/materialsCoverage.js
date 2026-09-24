// Materials coverage (issue #189): which sessions and which speakers have
// no materials yet. Pure, so the page and its tests read one rule.
//
// THE RULE. A pending or approved material counts; a rejected one does not.
// A session is considered when its LIVE document names at least one speaker
// who is not removed: `live.speakerIds` is the canonical speaker-to-session
// mapping the store already keeps (speakers/references.cjs), and a draft
// that adds a speaker has not happened yet. A draft-only session has no
// live document, so it cannot hold a material (materials/store.cjs checks
// the live document) and is left out. A speaker id with no record still
// counts and is shown as the id. A speaker is named when none of the
// considered sessions they are on has a counted material.
//
// The page hands this the same material array its table renders, before
// any filter, so the panel and the table cannot disagree.
import { UNKNOWN_DAY_LABEL, resolveDayLabel } from './sessionDoc.js';

/** The review states that count toward coverage. */
export const COUNTED_REVIEW_STATUSES = Object.freeze(['pending', 'approved']);

/**
 * The live sessions, in the order the admin's session rows give them, with
 * the title, day label and speakers of the live document.
 *
 * @param {Array<{ id: string, live: object|null }>} rows useAdminSessions rows, in schedule order
 * @param {Array<{ id: string, label?: string, date?: string }>} [days] config/event days
 * @param {string} [timeZone]
 * @returns {Array<{ id: string, title: string, dayLabel: string, speakerIds: string[] }>}
 */
export function liveSessions(rows, days = [], timeZone) {
  const dayLabels = new Map(days.map((day, index) => [day.id, resolveDayLabel(day, index, timeZone)]));
  return (rows ?? [])
    .filter((row) => row?.live)
    .map((row) => {
      const dayId = row.live.dayId;
      const title = typeof row.live.title === 'string' && row.live.title.trim() ? row.live.title : row.id;
      return {
        id: row.id,
        title,
        dayLabel: !dayId ? 'Unscheduled' : (dayLabels.get(dayId) ?? UNKNOWN_DAY_LABEL),
        speakerIds: Array.isArray(row.live.speakerIds) ? row.live.speakerIds : [],
      };
    });
}

/**
 * @param {{
 *   sessions: Array<{ id: string, title: string, dayLabel: string, speakerIds: string[] }>,
 *   speakers: Array<{ id: string, displayName?: string, status?: string }>,
 *   materials: Array<{ sessionId: string|null, reviewStatus: string|null }>,
 * }} input
 * @returns {{
 *   consideredCount: number,
 *   coveredCount: number,
 *   uncoveredSessions: Array<{ id: string, title: string, dayLabel: string,
 *     speakers: Array<{ id: string, name: string, known: boolean }> }>,
 *   uncoveredSpeakers: Array<{ id: string, name: string, known: boolean,
 *     sessions: Array<{ id: string, title: string }> }>,
 * }}
 */
export function materialsCoverage({ sessions, speakers, materials }) {
  const speakerById = new Map((speakers ?? []).map((speaker) => [speaker.id, speaker]));
  const covered = new Set(
    (materials ?? [])
      .filter((material) => COUNTED_REVIEW_STATUSES.includes(material?.reviewStatus))
      .map((material) => material.sessionId),
  );

  const considered = [];
  for (const session of sessions ?? []) {
    const ids = [...new Set(session.speakerIds ?? [])].filter(
      (id) => typeof id === 'string' && id && speakerById.get(id)?.status !== 'removed',
    );
    if (ids.length === 0) continue;
    considered.push({
      id: session.id,
      title: session.title,
      dayLabel: session.dayLabel,
      covered: covered.has(session.id),
      speakers: ids.map((id) => {
        const record = speakerById.get(id);
        return { id, name: record?.displayName || id, known: Boolean(record) };
      }),
    });
  }

  const bySpeaker = new Map();
  for (const session of considered) {
    for (const speaker of session.speakers) {
      const entry = bySpeaker.get(speaker.id) ?? { ...speaker, covered: false, sessions: [] };
      entry.sessions.push({ id: session.id, title: session.title });
      if (session.covered) entry.covered = true;
      bySpeaker.set(speaker.id, entry);
    }
  }

  const uncoveredSessions = considered
    .filter((session) => !session.covered)
    .map(({ id, title, dayLabel, speakers: names }) => ({ id, title, dayLabel, speakers: names }));
  const uncoveredSpeakers = [...bySpeaker.values()]
    .filter((entry) => !entry.covered)
    .map(({ id, name, known, sessions: onSessions }) => ({ id, name, known, sessions: onSessions }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  return {
    consideredCount: considered.length,
    coveredCount: considered.length - uncoveredSessions.length,
    uncoveredSessions,
    uncoveredSpeakers,
  };
}
