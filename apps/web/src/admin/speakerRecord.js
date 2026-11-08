// The speaker words both admin speaker pages use: the record state and the
// self-service edits waiting for review. One copy, so the list and the editor
// cannot drift (state machine map, 02 finding 6).
import { canMoveSpeaker } from 'shared/speaker';
import { deadMatter, state } from './recordState.js';

/**
 * Field names queued in `speaker.pendingEdits` (spec §4.3): an approved
 * speaker's self-service edit that onSpeakerWritten did not publish, waiting
 * for staff to apply or discard it (functions/src/speakers/profile.cjs).
 */
export function pendingFieldsOf(speaker) {
  const pending = speaker?.pendingEdits;
  return pending && typeof pending === 'object' ? Object.keys(pending) : [];
}

/**
 * The speaker's record state in the admin's three words (brief §5.2). A
 * speaker is public only once approved; an approved speaker with edits
 * waiting is the third state. A removed speaker is dead matter.
 */
export function speakerRecordState(speaker) {
  if (!speaker) return null;
  if (speaker.status === 'removed') return deadMatter('Removed');
  if (speaker.status !== 'approved') return state('draft');
  return pendingFieldsOf(speaker).length > 0 ? state('dirty') : state('live');
}

/** The status choices staff may pick for a stored speaker, by the shared table. */
export function speakerStatusOptions(options, storedStatus) {
  if (storedStatus === undefined) return options;
  const from = typeof storedStatus === 'string' ? storedStatus : 'draft';
  return options.filter((option) => canMoveSpeaker(from, option.value));
}
