'use strict';

/**
 * What an accepted speaker still owes the event: the one rule behind the
 * speaker's own "Your next steps" list (apps/web lib/speakerCompletion.js),
 * the staff reminder page, its readiness export, and the reminder email
 * (functions/src/speakers/reminders.cjs). One module, so the list a speaker
 * reads and the email staff send them cannot disagree.
 *
 * THE RULE.
 *   - Biography: the effective record has a non-blank `bio`.
 *   - Headshot: the effective record has a non-blank `headshotPath`.
 *     "Effective" lays `pendingEdits` over the record, because a speaker
 *     who has submitted a change for review has done their part.
 *   - Session description: each of the speaker's sessions whose
 *     `description` has readable text (shared/richText hasRichTextContent,
 *     so markup and whitespace alone do not count).
 *   - Materials: each of the speaker's sessions with at least one pending
 *     or approved material. A rejected material does not count. This is the
 *     same counted set the Materials coverage panel uses.
 *
 * "The speaker's sessions" are the published, visible sessions whose
 * `speakerIds` name the speaker: the sessions the speaker sees on their
 * dashboard and can send materials for.
 */

const { hasRichTextContent } = require('./richText.cjs');

/** Material review states that count as sent. */
const COUNTED_MATERIAL_STATUSES = Object.freeze(['pending', 'approved']);

/** The readiness items, in the order every surface lists them. */
const READINESS_ITEMS = Object.freeze(['bio', 'headshot', 'description', 'materials']);

/** The staff words for each item. */
const READINESS_ITEM_LABELS = Object.freeze({
  bio: 'Biography',
  headshot: 'Headshot',
  description: 'Session description',
  materials: 'Materials',
});

/**
 * Speaker statuses that have accepted an invitation: the only speakers a
 * reminder may go to. A draft or invited speaker has agreed to nothing yet,
 * and a removed one is out of the programme.
 */
const REMINDABLE_SPEAKER_STATUSES = Object.freeze(['accepted', 'approved']);

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/** The speaker record with any edits waiting for review laid over it. */
function effectiveSpeakerProfile(speaker) {
  const pending = speaker?.pendingEdits && typeof speaker.pendingEdits === 'object'
    ? speaker.pendingEdits
    : {};
  return { ...(speaker ?? {}), ...pending };
}

function speakerHasBio(speaker) {
  return hasText(effectiveSpeakerProfile(speaker).bio);
}

function speakerHasHeadshot(speaker) {
  return hasText(effectiveSpeakerProfile(speaker).headshotPath);
}

function materialCounts(material) {
  return COUNTED_MATERIAL_STATUSES.includes(material?.reviewStatus);
}

function sessionHasDescription(session) {
  return hasRichTextContent(session?.description);
}

/**
 * The published, visible sessions that name a speaker, once each.
 *
 * @param {Array<object>} sessions live session documents, each with `id`
 * @param {string} speakerId
 */
function sessionsForSpeaker(sessions, speakerId) {
  if (typeof speakerId !== 'string' || speakerId === '') return [];
  const seen = new Set();
  const out = [];
  for (const session of Array.isArray(sessions) ? sessions : []) {
    if (!session || session.visible !== true || seen.has(session.id)) continue;
    if (!Array.isArray(session.speakerIds) || !session.speakerIds.includes(speakerId)) continue;
    seen.add(session.id);
    out.push(session);
  }
  return out;
}

function sessionTitle(session) {
  return hasText(session?.title) ? session.title.trim() : String(session?.id ?? '');
}

/**
 * What one speaker still owes.
 *
 * @param {{ speaker: object, sessions: Array<object>,
 *           materialsBySession: Record<string, Array<{ reviewStatus?: string }>> }} input
 *   `sessions` are the speaker's own sessions (sessionsForSpeaker).
 * @returns {{
 *   bio: boolean, headshot: boolean,
 *   descriptionSessions: Array<{ id: string, title: string }>,
 *   materialsSessions: Array<{ id: string, title: string }>,
 *   missing: string[],
 * }} `bio`/`headshot` are true when MISSING; `missing` lists the item ids
 *   with a gap, in READINESS_ITEMS order.
 */
function speakerReadiness({ speaker, sessions, materialsBySession }) {
  const bio = !speakerHasBio(speaker);
  const headshot = !speakerHasHeadshot(speaker);
  const descriptionSessions = [];
  const materialsSessions = [];
  const seen = new Set();
  for (const session of Array.isArray(sessions) ? sessions : []) {
    if (!session || seen.has(session.id)) continue;
    seen.add(session.id);
    const ref = { id: session.id, title: sessionTitle(session) };
    if (!sessionHasDescription(session)) descriptionSessions.push(ref);
    const materials = materialsBySession?.[session.id] ?? [];
    if (!materials.some(materialCounts)) materialsSessions.push(ref);
  }
  const gaps = {
    bio,
    headshot,
    description: descriptionSessions.length > 0,
    materials: materialsSessions.length > 0,
  };
  return {
    bio,
    headshot,
    descriptionSessions,
    materialsSessions,
    missing: READINESS_ITEMS.filter((item) => gaps[item]),
  };
}

/**
 * The readiness items a set of topics keeps. Unknown topics are dropped;
 * an empty or absent list means every item.
 *
 * @param {unknown} topics
 * @returns {string[]}
 */
function normalizeReadinessTopics(topics) {
  if (!Array.isArray(topics) || topics.length === 0) return [...READINESS_ITEMS];
  return READINESS_ITEMS.filter((item) => topics.includes(item));
}

module.exports = {
  COUNTED_MATERIAL_STATUSES,
  READINESS_ITEMS,
  READINESS_ITEM_LABELS,
  REMINDABLE_SPEAKER_STATUSES,
  effectiveSpeakerProfile,
  speakerHasBio,
  speakerHasHeadshot,
  materialCounts,
  sessionHasDescription,
  sessionsForSpeaker,
  speakerReadiness,
  normalizeReadinessTopics,
};
