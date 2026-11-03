// The words and badge tones of a pitch's decision, shared by the queue and
// the pitch page, and the review revision a write must name.
export const PITCH_STATUS_LABELS = Object.freeze({ new: 'New', in_review: 'In review', accepted: 'Accepted', rejected: 'Declined' });
export const PITCH_STATUS_TONES = Object.freeze({ new: 'caution', in_review: 'info', accepted: 'ok', rejected: 'dead' });
export const PITCH_STATUS_OPTIONS = Object.freeze(Object.entries(PITCH_STATUS_LABELS).map(([value, label]) => ({ value, label })));
export const pitchRevision = (row) => row?.reviewRevision ?? 0;
