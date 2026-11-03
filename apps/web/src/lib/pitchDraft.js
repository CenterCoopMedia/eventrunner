// The pitch stepper's draft (ADR 0008 §2). It lives in this browser tab's
// session storage, as the one-page form's did, so a pitch on a shared
// computer does not outlive the tab. A draft from the one-page form
// (`session-pitch-draft-v1`) is read once and carried into the new shape.
import { newSubmissionKey } from './submissionKey.js';

export const DRAFT_KEY = 'session-pitch-draft-v2';
const LEGACY_KEY = 'session-pitch-draft-v1';
const KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;
const TEXT_FIELDS = ['title', 'summary', 'description', 'organization', 'format', 'track',
  'audienceLevel', 'leadName', 'leadRole', 'accessNeeds', 'notes'];

let rowCounter = 0;
/** A local id for a co-presenter row; never sent. */
export const newRowId = () => `presenter-${Date.now()}-${rowCounter += 1}`;

export function blankPitch() {
  return {
    title: '', summary: '', description: '', organization: '', format: '', lengthMinutes: '',
    track: '', audienceLevel: '', leadName: '', leadRole: '', presenters: [], accessNeeds: '',
    notes: '', consent: false, visited: [], submissionKey: newSubmissionKey(),
  };
}

function shapeOf(value) {
  if (!value || typeof value !== 'object') return null;
  const draft = blankPitch();
  for (const field of TEXT_FIELDS) if (typeof value[field] === 'string') draft[field] = value[field];
  if (Number.isInteger(value.lengthMinutes)) draft.lengthMinutes = value.lengthMinutes;
  if (Array.isArray(value.presenters)) {
    draft.presenters = value.presenters
      .filter((row) => row && typeof row === 'object')
      .slice(0, 4)
      .map((row) => ({
        id: newRowId(),
        name: typeof row.name === 'string' ? row.name : '',
        email: typeof row.email === 'string' ? row.email : '',
        organization: typeof row.organization === 'string' ? row.organization : '',
        role: typeof row.role === 'string' ? row.role : '',
      }));
  }
  if (Array.isArray(value.visited)) draft.visited = value.visited.filter((slug) => typeof slug === 'string');
  draft.consent = value.consent === true;
  if (typeof value.submissionKey === 'string' && KEY_RE.test(value.submissionKey)) draft.submissionKey = value.submissionKey;
  return draft;
}

// Reading `sessionStorage` itself can throw (a SecurityError when the
// browser blocks site data), so the lookup is inside each try, never in a
// default argument.
const tabStorage = (storage) => storage ?? globalThis.sessionStorage;

/** The saved draft, a carried-over one-page draft, or a blank pitch. */
export function restorePitch(given) {
  try {
    const storage = tabStorage(given);
    const current = shapeOf(JSON.parse(storage.getItem(DRAFT_KEY)));
    if (current) return current;
    const legacy = shapeOf(JSON.parse(storage.getItem(LEGACY_KEY)));
    if (legacy) {
      storage.removeItem(LEGACY_KEY);
      return legacy;
    }
  } catch { /* Storage may be unavailable; the mounted page still keeps entries. */ }
  return blankPitch();
}

/** @returns {boolean} false when the browser refused the write */
export function savePitch(draft, given) {
  try {
    tabStorage(given).setItem(DRAFT_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearPitch(given) {
  try { tabStorage(given).removeItem(DRAFT_KEY); } catch { /* nothing to clear */ }
}

/**
 * The body the server reads: trimmed text, empty choices as null, and
 * co-presenters without their local row ids.
 *
 * A question the call no longer asks sends no answer. When staff empty the
 * length or track list, or allow no co-presenters, after the reader answered,
 * the control is gone, and a stale answer would fail a check the reader has
 * no control to fix. With no format list, format is free text, so it stays.
 *
 * @param {object} draft
 * @param {{ lengths: number[], tracks: string[], maxCoPresenters: number }} [options]
 */
export function submissionOf(draft, options) {
  const text = (value) => (typeof value === 'string' ? value.trim() : '');
  const orNull = (value) => text(value) || null;
  return {
    title: text(draft.title),
    summary: orNull(draft.summary),
    description: text(draft.description),
    organization: orNull(draft.organization),
    format: orNull(draft.format),
    lengthMinutes: draft.lengthMinutes === '' || (options && !options.lengths.length) ? null : Number(draft.lengthMinutes),
    track: options && !options.tracks.length ? null : orNull(draft.track),
    audienceLevel: orNull(draft.audienceLevel),
    leadName: text(draft.leadName),
    leadRole: orNull(draft.leadRole),
    presenters: (options && options.maxCoPresenters === 0 ? [] : draft.presenters).map((row) => ({
      name: text(row.name), email: text(row.email), organization: orNull(row.organization), role: orNull(row.role),
    })),
    accessNeeds: orNull(draft.accessNeeds),
    notes: orNull(draft.notes),
    consent: draft.consent === true,
    submissionKey: draft.submissionKey,
  };
}
