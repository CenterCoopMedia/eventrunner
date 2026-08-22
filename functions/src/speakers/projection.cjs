'use strict';

/**
 * speakers → speakers_public projection (spec §4.3, issue #20).
 *
 * `onSpeakerWritten` is a Firestore onWrite trigger over `speakers/{id}`.
 * It maintains `speakers_public/{id}` — a projection carrying only
 * publicly-safe fields — AND NOTHING ELSE. That "nothing else" is the
 * design: there is no reverse trigger, no `sessionInfo` map, and no
 * `_deletedSessions` archive, because session→speaker is a foreign key
 * (`cmsSchedule.speakerIds`) and speaker→session is a query. With no
 * copied data there is nothing to fall out of step, which is what retires
 * the tri-sync trigger set, the drift detector, and the eight
 * reconciliation scripts.
 *
 * One direction only: nothing here ever writes `speakers`, so there is no
 * cycle (the same rule users/projection.cjs applies to attendees).
 *
 * Only `status: 'approved'` publishes. Every other state — an
 * admin-created `draft`, an outstanding `invited`, an `accepted` speaker
 * awaiting approval, and the `removed` soft-delete tombstone — has NO
 * public document, which is what makes deleteSpeaker's soft-delete
 * fallback hide the speaker everywhere without touching sessions.
 *
 * Idempotent and self-limiting: a write that leaves the projection
 * byte-identical writes nothing, so trigger retries and unrelated speaker
 * churn do not amplify into writes.
 */

const { buildPublicSpeaker, isPubliclyVisibleSpeaker } = require('shared/speaker');

const SPEAKERS = 'speakers';
const SPEAKERS_PUBLIC = 'speakers_public';

/** Shallow-equal over the projection payload (scalars and a flat map). */
function sameProjection(a, b) {
  if (!a || !b) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const left = a[key];
    const right = b[key];
    if (left && right && typeof left === 'object' && typeof right === 'object') {
      if (!sameProjection(left, right)) return false;
      continue;
    }
    if (left !== right) return false;
  }
  return true;
}

/** Drop the fields the projection stamps rather than derives. */
function stripStamps(data) {
  if (!data || typeof data !== 'object') return data;
  const { updatedAt: _updatedAt, speakerId: _speakerId, ...rest } = data;
  return rest;
}

/**
 * Core of the trigger, driven directly by tests with a fake db.
 *
 * The event payload is NOT the input. Trigger deliveries are unordered and
 * may be retried, so projecting the `after` snapshot an event carries can
 * republish a stale state — an approve→remove edit whose older (approved)
 * delivery lands last would put the speaker back on the open web and leave
 * them there, which is precisely the soft delete failing to delete. Every
 * run therefore re-reads `speakers/{speakerId}` inside a transaction and
 * projects whatever is current, with the projection write in the same
 * transaction: the event is a wake-up, not data. Out-of-order and
 * duplicate deliveries then converge on the same document, and the last
 * writer is by definition the one that read the newest source.
 *
 * @param {{ db: object, now?: () => Date, log?: { error: Function } }} deps
 * @returns {(change: { speakerId: string }) =>
 *   Promise<{ action: 'deleted'|'written'|'unchanged' }>}
 */
function createSyncSpeakerPublic({ db, now = () => new Date(), log = console }) {
  return async function syncSpeakerPublic({ speakerId }) {
    if (typeof speakerId !== 'string' || speakerId.length === 0) {
      log.error('syncSpeakerPublic called without a speakerId');
      return { action: 'unchanged' };
    }

    const speakerRef = db.collection(SPEAKERS).doc(speakerId);
    const publicRef = db.collection(SPEAKERS_PUBLIC).doc(speakerId);

    return db.runTransaction(async (tx) => {
      const [speakerSnap, publicSnap] = await Promise.all([tx.get(speakerRef), tx.get(publicRef)]);

      // Gone, or not in a state that publishes: the public document must go
      // with it. A delete of an already-absent doc is a no-op in Firestore,
      // so this needs no existence check — but reporting `unchanged` when
      // there was nothing to delete keeps the return value honest.
      if (!speakerSnap.exists || !isPubliclyVisibleSpeaker(speakerSnap.data())) {
        if (!publicSnap.exists) return { action: 'unchanged' };
        tx.delete(publicRef);
        return { action: 'deleted' };
      }

      const payload = buildPublicSpeaker(speakerSnap.data());
      if (publicSnap.exists && sameProjection(stripStamps(publicSnap.data()), payload)) {
        return { action: 'unchanged' };
      }
      tx.set(publicRef, { ...payload, speakerId, updatedAt: now() });
      return { action: 'written' };
    });
  };
}

/** Deployable exports (spec §1.3 speakers/): onSpeakerWritten. */
function buildHandlers() {
  const { onDocumentWritten } = require('firebase-functions/v2/firestore');
  const region = (process.env.EVENT_FIREBASE_REGION || '').trim() || 'us-central1';

  return {
    onSpeakerWritten: onDocumentWritten({
      region,
      // Retry on failure. This projection is the ONLY thing that removes a
      // speaker from the public site — §4.3 deliberately leaves no periodic
      // reconciliation to heal it — so a single transient failure on a
      // soft-delete write would leave a removed speaker publicly readable
      // indefinitely. Retries are safe by construction: the handler
      // re-reads the source inside a transaction and writes nothing when
      // the projection is already correct, so a duplicate delivery is a
      // no-op rather than an amplification. (users/projection.cjs's
      // syncUserPublic does not set this; the difference is that a stale
      // users_public heals on the owner's next profile edit, while nothing
      // ever writes a deleted speaker again.)
      retry: true,
      document: 'speakers/{speakerId}',
    }, async (event) => {
      const { getDb } = require('../core/firestore.cjs');
      const db = getDb();
      const handler = createSyncSpeakerPublic({ db });
      // The event's snapshots are deliberately unused — see
      // createSyncSpeakerPublic: the handler re-reads the source document.
      await handler({ speakerId: event.params.speakerId });
    }),
  };
}

module.exports = {
  createSyncSpeakerPublic,
  get handlers() {
    return buildHandlers();
  },
  internals: { sameProjection, stripStamps, SPEAKERS, SPEAKERS_PUBLIC },
};
