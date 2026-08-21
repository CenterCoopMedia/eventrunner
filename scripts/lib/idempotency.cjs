'use strict';

/**
 * Re-run rules for the seeding scripts (spec §5.1: "idempotent; safe to
 * re-run").
 *
 * The hazard is not writing twice — it is writing over a client. A second
 * `init-event.cjs` run against a live deployment must not restore
 * `[Replace] Hotel name` on top of the hotel a client typed last week. So
 * the merge rules key off the one flag the platform already maintains for
 * exactly this question (§5.4): a seeded block carries `seeded: true`, and
 * EDITING IT CLEARS THE FLAG. That makes "has a human touched this?" a
 * property of the document rather than a guess from timestamps.
 *
 *   - missing  → create it. A page added to the defaults in a later
 *                release lands on re-run; that is the point of re-running.
 *   - seeded   → overwrite. Still untouched sample content, and refreshing
 *                it picks up corrected copy and config-derived values
 *                (venue, dates) after an answers-file fix.
 *   - edited   → skip, and report it. Any doc without `seeded: true` was
 *                either edited or authored by a client.
 *
 * Config documents follow the same spirit at document granularity, with
 * one addition from §5.1 step a: init REFUSES to run at all against a
 * project that already has `config/event` unless `--force` is passed, so
 * the common accident (running init twice against the wrong project) stops
 * before the first write rather than being merged around.
 *
 * Pure: decides, never writes.
 */

/** @typedef {'create'|'overwrite'|'skip'} SeedAction */

/**
 * What to do with one seeded document.
 *
 * @param {object|null|undefined} existing the live doc, or null when absent
 * @param {{ force?: boolean }} [opts] `force` still respects client edits;
 *   it only relaxes the whole-run refusal, not this rule.
 * @returns {{ action: SeedAction, reason: string }}
 */
function decideSeedWrite(existing, opts = {}) {
  if (existing == null) return { action: 'create', reason: 'absent' };
  if (existing.seeded === true) {
    return { action: 'overwrite', reason: 'still seeded (unedited)' };
  }
  if (opts.force === true) {
    // Even --force does not clobber client content: the flag it overrides
    // is the run-level refusal, and a doc a human edited is the exact
    // thing this module exists to protect.
    return { action: 'skip', reason: 'client-edited (protected even under --force)' };
  }
  return { action: 'skip', reason: 'client-edited' };
}

/**
 * What to do with one `config/*` document.
 *
 * `config/bootstrap` is the exception: admin emails are additive, because
 * re-running init with a new `--admin` must be able to add an operator
 * without dropping the admins a client granted through the UI.
 *
 * @param {{ docId: string, existing: object|null, next: object, force?: boolean }} args
 * @returns {{ action: SeedAction, reason: string, value: object }}
 */
function decideConfigWrite({ docId, existing, next, force = false }) {
  if (existing == null) return { action: 'create', reason: 'absent', value: next };
  if (docId === 'bootstrap') {
    const merged = mergeAdminEmails(existing, next);
    const changed = merged.adminEmails.length !== (existing.adminEmails || []).length;
    return {
      action: changed ? 'overwrite' : 'skip',
      reason: changed ? 'admin list extended' : 'admin list unchanged',
      value: { ...existing, ...merged },
    };
  }
  if (!force) {
    return { action: 'skip', reason: 'exists (re-run with --force to refresh)', value: existing };
  }
  return { action: 'overwrite', reason: 'refreshed under --force', value: mergeConfigDoc(existing, next) };
}

/**
 * Union of the existing and new admin lists, lowercased and de-duplicated.
 * Lowercase is load-bearing: firestore.rules compares the stored list
 * against `request.auth.token.email.lower()`, so a mixed-case entry is an
 * admin who can never authenticate.
 *
 * @param {object|null} existing
 * @param {object} next
 * @returns {{ adminEmails: string[] }}
 */
function mergeAdminEmails(existing, next) {
  const normalize = (list) => (Array.isArray(list) ? list : [])
    .map((e) => String(e).trim().toLowerCase())
    .filter(Boolean);
  return { adminEmails: [...new Set([...normalize(existing?.adminEmails), ...normalize(next?.adminEmails)])] };
}

/**
 * Fields a `--force` config refresh must never take back from the
 * deployment, because something other than init owns them:
 * verify-sender-domain.cjs owns the sender verification pair (§1.3), the
 * admin Settings UI owns the legal review flag and the lifecycle stamps
 * (§2.5), the ticketing webhook script owns its registration stamps, and
 * the auth attestation is recorded by a separate operator action.
 */
const PRESERVED_PATHS = Object.freeze([
  'sender.domainVerified',
  'sender.domainVerifiedAt',
  'legal.reviewRequired',
  'announcedAt',
  'archivedAt',
  'auth',
  'ticketing.webhookRegisteredAt',
  'ticketing.webhookId',
]);

function getPath(obj, path) {
  return path.split('.').reduce((node, part) => (node == null ? undefined : node[part]), obj);
}

function setPath(obj, path, value) {
  const parts = path.split('.');
  let node = obj;
  for (const part of parts.slice(0, -1)) {
    if (typeof node[part] !== 'object' || node[part] === null) node[part] = {};
    node = node[part];
  }
  node[parts.at(-1)] = value;
}

/**
 * `next`, with every PRESERVED_PATH the existing doc actually carries
 * copied back over it.
 *
 * @param {object} existing
 * @param {object} next
 * @returns {object}
 */
function mergeConfigDoc(existing, next) {
  const merged = JSON.parse(JSON.stringify(next));
  for (const path of PRESERVED_PATHS) {
    const value = getPath(existing, path);
    if (value !== undefined) setPath(merged, path, value);
  }
  return merged;
}

module.exports = {
  decideSeedWrite,
  decideConfigWrite,
  mergeAdminEmails,
  mergeConfigDoc,
  PRESERVED_PATHS,
};
