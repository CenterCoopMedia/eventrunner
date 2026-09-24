'use strict';

/**
 * Who seeded a document, and whether it is still the seed's.
 *
 * ADR 0001 §5.4: a seeded block carries `seeded: true`, and EDITING IT
 * CLEARS THE FLAG. That flag is what every reader of "has a human touched
 * this?" keys off — the seed's own re-run rules (scripts/lib/idempotency.cjs),
 * the launch-readiness count, the sample-content chips, and the home page's
 * live When fact (apps/web/src/pages/Home.jsx).
 *
 * THE FLAG ALONE IS NOT ENOUGH (adversarial review, 2026-09-24). The CMS
 * merged an edit onto the stored fields and carried `seeded: true` along
 * with them, so every block an operator had edited still read as the
 * seed's: a re-run of init overwrote it, and the home page replaced an
 * operator's When fact with the live range for good. The write path now
 * clears the flag, but deployments already live hold edited documents that
 * still carry it. So ownership is decided by the flag AND by who wrote the
 * document: the seed's writes carry SEED_ACTOR as `updatedBy` (drafts) and
 * `publishedBy` (live docs), and a document any other actor wrote is the
 * client's whatever its flag says. A document naming no writer at all — a
 * fixture, or data from before the publish model recorded one — is judged
 * by its flag alone.
 *
 * One rule, shared by the scripts, the functions and the web, so the three
 * cannot disagree about whose a document is.
 */

/** The actor recorded on every seeded write; not a person, and deliberately visible. */
const SEED_ACTOR = Object.freeze({ uid: 'init-event-script', email: 'init-event-script' });

/** Whether a recorded writer is the seed. Absent counts as the seed's. */
function wroteAsSeed(who) {
  return who == null || who === SEED_ACTOR.uid || who === SEED_ACTOR.email;
}

/**
 * Whether a document is still the seed's: flagged, and written by nobody
 * but the seed in the revision it describes.
 *
 * @param {object|null|undefined} doc a live doc, a draft, or a public copy
 * @returns {boolean}
 */
function isSeedOwned(doc) {
  if (doc == null || typeof doc !== 'object') return false;
  if (doc.seeded !== true) return false;
  return wroteAsSeed(doc.publishedBy) && wroteAsSeed(doc.updatedBy);
}

/**
 * The public shape of a content document: `seeded` states ownership by the
 * rule above (present and true, or absent), and the writer bookkeeping
 * that decided it stays off the public copy. Used at every boundary the
 * public site reads through — the committed snapshot, the public content
 * endpoint, and the live listener — so an operator's edit wins on every
 * path, on a deployment from before the write path cleared the flag too.
 *
 * @param {object} doc
 * @returns {object}
 */
function publicContentDoc(doc) {
  const { seeded, publishedBy, publishedByUid, updatedBy, ...rest } = doc;
  return isSeedOwned(doc) ? { ...rest, seeded: true } : rest;
}

module.exports = { SEED_ACTOR, isSeedOwned, publicContentDoc };
