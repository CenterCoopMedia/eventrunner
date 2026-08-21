'use strict';

/**
 * Badge-set validation against per-event config (spec §4.5).
 *
 * Badge definitions live in config/badges — nothing here knows any event's
 * badge names. Free-text custom badges do not exist in v1, so validation is
 * a pure intersection with the configured set plus per-category maxPicks
 * enforcement. Used by the profile-save Cloud Function and the
 * users_public projection trigger, which rewrites the stored set to the
 * `valid` result.
 */

/**
 * The one aggregate cap on how many badges a user's stored selection may
 * ever contain, shared by three layers that cannot share a single import:
 *   - `config/schema.cjs` (validateBadgesConfig) rejects an operator's
 *     config whose maximum possible selection — summed across categories —
 *     would exceed this, so the picker and the rules boundary never
 *     disagree about what a legal config allows.
 *   - `firestore.rules` cannot `require()` this module, so its
 *     `validBadgesList()` repeats the literal with a comment naming this
 *     constant; `badges.test.cjs` pins the two values equal so they cannot
 *     drift apart silently.
 *   - the Profile picker (apps/web/src/pages/Profile.jsx) surfaces this
 *     number in its copy once a config's total picks get close to it.
 */
const MAX_TOTAL_BADGES = 40;

/**
 * Filter a user's badge selection down to the configured set and the
 * per-category pick caps.
 *
 * Order is preserved from `selectedIds`: within each category the first
 * `maxPicks` selections are kept, overflow is rejected. Unknown ids and
 * duplicates are rejected. A missing/invalid maxPicks on a category is
 * treated as unlimited (validation of the config itself lives in
 * config/schema.cjs). Total — never throws.
 *
 * @param {string[]} selectedIds - badge ids the user picked, in order
 * @param {{ categories?: Array<{ id: string, maxPicks?: number, badges?: Array<{id: string}> }> }} badgesConfig
 * @returns {{ valid: string[], rejected: string[] }}
 */
function validateBadgeSelection(selectedIds, badgesConfig) {
  const valid = [];
  const rejected = [];
  if (!Array.isArray(selectedIds)) return { valid, rejected };

  // badgeId -> categoryId
  const badgeCategory = new Map();
  const maxPicksByCategory = new Map();
  const categories = badgesConfig && Array.isArray(badgesConfig.categories)
    ? badgesConfig.categories
    : [];
  for (const cat of categories) {
    if (!cat || typeof cat !== 'object') continue;
    const cap = Number.isInteger(cat.maxPicks) && cat.maxPicks > 0 ? cat.maxPicks : Infinity;
    maxPicksByCategory.set(cat.id, cap);
    if (!Array.isArray(cat.badges)) continue;
    for (const badge of cat.badges) {
      if (badge && typeof badge.id === 'string' && !badgeCategory.has(badge.id)) {
        badgeCategory.set(badge.id, cat.id);
      }
    }
  }

  const seen = new Set();
  const countByCategory = new Map();
  for (const id of selectedIds) {
    if (typeof id !== 'string' || !badgeCategory.has(id) || seen.has(id)) {
      rejected.push(id);
      continue;
    }
    const categoryId = badgeCategory.get(id);
    const used = countByCategory.get(categoryId) || 0;
    if (used >= maxPicksByCategory.get(categoryId)) {
      rejected.push(id);
      continue;
    }
    seen.add(id);
    countByCategory.set(categoryId, used + 1);
    valid.push(id);
  }

  return { valid, rejected };
}

module.exports = { validateBadgeSelection, MAX_TOTAL_BADGES };
