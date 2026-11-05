'use strict';

/**
 * Staff review notes on a session pitch, one entry per note.
 *
 * Each note records who wrote it and when. Any staff member can add a note;
 * only its author can change it. Notes live in `reviewNotes` on the pitch
 * row, which only admins can read and only the server writes. A note does
 * not change the pitch's `reviewRevision`, so writing one never makes another
 * reviewer's decision stale.
 *
 * The older single `privateNotes` field stays as it was. The review page
 * shows it as an earlier note with no author.
 */

const crypto = require('node:crypto');
const { requireAdmin } = require('../core/auth.cjs');
const {
  sendError, badRequest, notFound, methodNotAllowed, internal,
} = require('../core/errors.cjs');
const { isValidDocId } = require('../cms/store.cjs');

const PITCHES = 'session_pitches';
const ADMIN_LOGS = 'admin_logs';
const MAX_NOTE_LENGTH = 5000;
const MAX_NOTES = 200;
// All note text on one pitch, in bytes. Firestore caps a document at 1 MiB;
// this leaves room for the pitch itself and each note's other fields.
const MAX_NOTES_BYTES = 400 * 1024;
const MAX_BODY_BYTES = 32 * 1024;
const NOTE_ID_RE = /^[a-f0-9]{16}$/;

/** @param {unknown} body */
function readNoteRequest(body) {
  const source = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  if (!isValidDocId(source.id)) return { ok: false, message: 'id: must be a session pitch id.' };
  if (source.action !== 'add' && source.action !== 'edit') {
    return { ok: false, message: 'action: must be add or edit.' };
  }
  if (source.action === 'edit' && !(typeof source.noteId === 'string' && NOTE_ID_RE.test(source.noteId))) {
    return { ok: false, message: 'noteId: must be a note id.' };
  }
  const text = typeof source.text === 'string' ? source.text.trim() : '';
  if (!text) return { ok: false, message: 'Write the note first.' };
  if (text.length > MAX_NOTE_LENGTH) {
    return { ok: false, message: `A note can be at most ${MAX_NOTE_LENGTH.toLocaleString('en-US')} characters.` };
  }
  // An edit names the text it started from, so a stale editor cannot
  // silently replace a newer version of the same note.
  if (source.action === 'edit' && typeof source.baseText !== 'string') {
    return { ok: false, message: 'baseText: must be the note text the edit started from.' };
  }
  return { ok: true, id: source.id, action: source.action, noteId: source.noteId ?? null, text, baseText: source.baseText ?? null };
}

/**
 * The note list after one change. Pure, so the authorship rule is tested
 * without Firestore.
 *
 * @returns {{ ok: true, notes: object[], note: object } | { ok: false, code: string }}
 */
function applyNoteChange(stored, request, actor, at, newId) {
  const change = changeNotes(stored, request, actor, at, newId);
  if (!change.ok) return change;
  const bytes = change.notes.reduce((sum, note) => sum + Buffer.byteLength(String(note.text ?? '')), 0);
  return bytes > MAX_NOTES_BYTES ? { ok: false, code: 'notes-full' } : change;
}

function changeNotes(stored, request, actor, at, newId = () => crypto.randomBytes(8).toString('hex')) {
  const notes = Array.isArray(stored) ? stored.filter((note) => note && typeof note === 'object') : [];
  if (request.action === 'add') {
    if (notes.length >= MAX_NOTES) return { ok: false, code: 'too-many-notes' };
    const note = { id: newId(), uid: actor.uid, email: actor.email, text: request.text, createdAt: at, editedAt: null };
    return { ok: true, notes: [...notes, note], note };
  }
  const index = notes.findIndex((note) => note.id === request.noteId);
  if (index === -1) return { ok: false, code: 'note-missing' };
  if (notes[index].uid !== actor.uid) return { ok: false, code: 'not-your-note' };
  if (notes[index].text !== request.baseText) return { ok: false, code: 'note-changed' };
  const note = { ...notes[index], text: request.text, editedAt: at };
  return { ok: true, notes: notes.map((each, i) => (i === index ? note : each)), note };
}

/** A Date, or a Firestore Timestamp read back from a stored note, as ISO text. */
function isoDate(value) {
  if (!value) return null;
  return (typeof value.toDate === 'function' ? value.toDate() : new Date(value)).toISOString();
}

const REFUSALS = Object.freeze({
  'too-many-notes': [409, `This pitch has ${MAX_NOTES} notes, the most it can hold. Edit an earlier note instead.`],
  'note-missing': [404, 'That note is no longer on this pitch. Reload the page to see the current notes.'],
  'not-your-note': [403, 'You can only edit notes you wrote.'],
  'notes-full': [409, 'This pitch has no room for more note text. Shorten an earlier note you wrote, then try again.'],
  'note-changed': [409, 'This note changed in another window. Copy your text, select Cancel to see the current note, then edit again.'],
});

function createSaveSessionPitchNoteHandler({ db, auth, getConfig, now = Date.now, log = console }) {
  return async function saveSessionPitchNote(req, res) {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const gate = await requireAdmin({ auth, db, getConfig }, req, { tier: 'staff' });
    if (!gate.ok) return sendError(res, gate.status, gate.code, gate.message);
    if (Buffer.byteLength(JSON.stringify(req.body ?? null)) > MAX_BODY_BYTES) {
      return sendError(res, 413, 'payload-too-large', 'This note is too long to save.');
    }
    const request = readNoteRequest(req.body);
    if (!request.ok) return badRequest(res, request.message);
    const ref = db.collection(PITCHES).doc(request.id);
    let outcome;
    try {
      outcome = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return { ok: false, code: 'missing' };
        const at = new Date(now());
        const change = applyNoteChange(snap.data()?.reviewNotes, request, gate, at);
        if (!change.ok) return change;
        tx.update(ref, { reviewNotes: change.notes });
        tx.set(db.collection(ADMIN_LOGS).doc(), {
          action: request.action === 'add' ? 'addSessionPitchNote' : 'editSessionPitchNote',
          docPath: `${PITCHES}/${request.id}`,
          uid: gate.uid,
          email: gate.email,
          at,
          details: { noteId: change.note.id },
        });
        return { ok: true, note: change.note };
      });
    } catch (err) {
      log.error('saveSessionPitchNote failed', err);
      return internal(res, 'The note was not saved. Try again in a moment.');
    }
    if (!outcome.ok) {
      if (outcome.code === 'missing') return notFound(res, 'This pitch was removed.');
      const [status, message] = REFUSALS[outcome.code];
      return sendError(res, status, outcome.code, message);
    }
    const { note } = outcome;
    return res.status(200).json({ note: { ...note, createdAt: isoDate(note.createdAt), editedAt: isoDate(note.editedAt) } });
  };
}

module.exports = {
  createSaveSessionPitchNoteHandler,
  internals: { readNoteRequest, applyNoteChange, MAX_NOTES, MAX_NOTE_LENGTH },
};
