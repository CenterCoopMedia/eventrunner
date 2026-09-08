'use strict';

// Demo seeding uses the same reservation protocol as the admin speaker API:
// read the speaker, deterministic slug lock, and legacy canonical owners.
// Only the speaker set is atomic; the rest of the seed run is not a transaction.
const DOC_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const OPERATOR_FIELDS = Object.freeze([
  'updatedBy', 'uid', 'email', 'inviteToken',
  'pendingEdits', 'pendingEditsAt', 'pendingEditsBy',
]);

function canRefreshSpeaker(stored, fixture) {
  return stored.seeded === true && stored.status === fixture.status &&
    OPERATOR_FIELDS.every((field) => stored[field] == null);
}

function conflict(id) {
  const error = new Error(
    `Demo speaker ${id} has a conflicting slug reservation or canonical owner. ` +
    'No speaker changes were written. Resolve the conflict in the admin before retrying.',
  );
  error.code = 'demo-speaker-conflict';
  return error;
}

function validateFixtures(speakers) {
  if (!Array.isArray(speakers) || speakers.length > 100) {
    throw new Error('Demo speaker fixtures must be an array of at most 100 records.');
  }
  const ids = new Set();
  const slugs = new Set();
  for (const speaker of speakers) {
    if (!speaker || typeof speaker.id !== 'string' || !DOC_ID_RE.test(speaker.id) ||
        typeof speaker.slug !== 'string' || !DOC_ID_RE.test(speaker.slug) ||
        speaker.seeded !== true || ids.has(speaker.id) || slugs.has(speaker.slug)) {
      throw new Error('Demo speaker fixtures need unique valid ids and slugs, and seeded: true.');
    }
    ids.add(speaker.id);
    slugs.add(speaker.slug);
  }
}

/** Read-only planning and writes use identical ownership checks. */
async function seedDemoSpeakers({ db, speakers, dryRun = false, now = Date.now }) {
  validateFixtures(speakers);
  const at = new Date(now());
  if (!Number.isFinite(at.getTime())) throw new Error('Demo seed time is not valid.');

  return db.runTransaction(async (tx) => {
    // Keep state inside the callback: Firestore can retry it after an edit.
    const result = { created: [], refreshed: [], skipped: [] };
    const planned = [];
    for (const speaker of speakers) {
      const { id, ...fields } = speaker;
      const ref = db.collection('speakers').doc(id);
      const snapshot = await tx.get(ref);
      const stored = snapshot.exists ? snapshot.data() : null;
      if (stored && !canRefreshSpeaker(stored, fields)) {
        result.skipped.push(id);
        continue;
      }

      const slugRef = db.collection('speaker_slugs').doc(fields.slug);
      const reservation = await tx.get(slugRef);
      // A malformed reservation is not proof that the slug is free.
      if (reservation.exists && reservation.data()?.speakerId !== id) throw conflict(id);
      const owners = await tx.get(db.collection('speakers').where('slug', '==', fields.slug).limit(2));
      if (owners.docs.some((owner) => owner.id !== id)) throw conflict(id);

      let oldSlugRef = null;
      if (stored && stored.slug !== fields.slug && typeof stored.slug === 'string' &&
          DOC_ID_RE.test(stored.slug)) {
        const previousRef = db.collection('speaker_slugs').doc(stored.slug);
        const previous = await tx.get(previousRef);
        if (previous.exists && previous.data()?.speakerId === id) oldSlugRef = previousRef;
      }
      planned.push({ ref, slugRef, oldSlugRef, reserved: reservation.exists, id, stored, fields });
      result[snapshot.exists ? 'refreshed' : 'created'].push(id);
    }

    // Finish every read before the first write, including across speakers.
    if (!dryRun) {
      for (const item of planned) {
        if (!item.reserved) {
          tx.create(item.slugRef, { speakerId: item.id, updatedAt: at });
        }
        if (item.oldSlugRef) tx.delete(item.oldSlugRef);
        tx.set(item.ref, { ...item.stored, ...item.fields, updatedAt: at });
      }
    }
    return result;
  });
}

module.exports = { seedDemoSpeakers, canRefreshSpeaker };
