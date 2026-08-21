// Badge display helpers shared by every page that renders a stored badge
// list (spec §4.5): the public profile page, the attendee directory, and
// ProfileSidebar's own-profile summary.
//
// Two rules apply everywhere a stored `badges` array is rendered:
//   1. Filter through the LIVE config/badges, not just what was stored —
//      the projection is only rewritten when its user's account document
//      is next written, so a badge the operator removed from config stays
//      in a stale projection until that person edits their profile again.
//      Rendering through the same validator the projection uses means a
//      removed badge stops appearing the moment the config changes.
//   2. Show the configured label, never the raw id — an id is an internal
//      key, not attendee-facing copy.
import { validateBadgeSelection } from 'shared/badges';

/**
 * The subset of a stored badge list that is still configured, in stored
 * order, with unknown/removed ids dropped.
 *
 * @param {unknown} storedBadges
 * @param {{ categories?: Array<object> } | null | undefined} badgesConfig
 * @returns {string[]}
 */
export function visibleBadgeIds(storedBadges, badgesConfig) {
  return validateBadgeSelection(
    Array.isArray(storedBadges) ? storedBadges : [],
    badgesConfig,
  ).valid;
}

/**
 * The configured label for a badge id already known to be configured
 * (i.e. one that came out of {@link visibleBadgeIds}). Falls back to the id
 * itself if the config is missing a label, so a half-seeded config never
 * renders blank chips.
 *
 * @param {{ categories?: Array<object> } | null | undefined} badgesConfig
 * @param {string} badgeId
 * @returns {string}
 */
export function badgeLabel(badgesConfig, badgeId) {
  const categories = Array.isArray(badgesConfig?.categories) ? badgesConfig.categories : [];
  for (const category of categories) {
    for (const badge of Array.isArray(category?.badges) ? category.badges : []) {
      if (badge?.id === badgeId) {
        return typeof badge.label === 'string' && badge.label ? badge.label : badgeId;
      }
    }
  }
  return badgeId;
}
