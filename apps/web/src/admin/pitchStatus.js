// The words and badge tones of a pitch's decision, shared by the queue and
// the pitch page, and the review revision a write must name.
import { PITCH_STATUSES, pitchNoticesOf, pitchStatusOf } from 'shared/pitch';

export const PITCH_STATUS_LABELS = Object.freeze({ new: 'New', in_review: 'In review', accepted: 'Accepted', declined: 'Declined' });
export const PITCH_STATUS_TONES = Object.freeze({ new: 'caution', in_review: 'info', accepted: 'ok', declined: 'dead' });
export const PITCH_STATUS_OPTIONS = Object.freeze(PITCH_STATUSES.map((value) => ({ value, label: PITCH_STATUS_LABELS[value] })));
export const pitchRevision = (row) => row?.reviewRevision ?? 0;

/** A stored pitch under today's names: older sites stored a decline as `rejected`. */
export function pitchRow(doc) {
  return { ...doc, status: pitchStatusOf(doc.status), ...(doc.notices ? { notices: pitchNoticesOf(doc.notices) } : {}) };
}
