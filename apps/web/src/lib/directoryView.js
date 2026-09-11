// Directory narrowing (issue #174).
//
// Pure: no React, no DOM. The page owns the controls; this module decides
// who survives them.
//
// THE INDEX FOLLOWS THE FILTER. The letter groups are derived from whatever
// list the caller passes (groupByLetter), so a narrowed list regroups
// itself: a letter with nobody left simply has no group, and the letters
// never become a second, disconnected list to keep in step.
//
// The search text is folded once, here, the way the schedule's is: a
// reader typing "ana" is looking for a person named Ana, not for a field
// name, and the case they typed is not the case the directory stores.

/** Lower-case, or ''. */
function fold(value) {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

/**
 * The folded search text of one profile: display name, organization, and
 * job title — the three things a reader knows about the person they met.
 *
 * @param {object} profile
 * @returns {string}
 */
export function directorySearchText(profile) {
  return [profile?.displayName, profile?.organization, profile?.jobTitle]
    .map(fold)
    .filter(Boolean)
    .join(' ');
}

/**
 * Whether one profile passes the query and the organization filter. An
 * empty query and an empty filter keep everybody; both must pass when set.
 *
 * @param {object} profile
 * @param {{ q?: string, organizations?: string[], searchIndex?: Map<string, string> }} selected
 *   `searchIndex` is the pre-folded text per profile id, when the caller
 *   built one; the function folds on the fly otherwise.
 */
export function matchesDirectoryFilters(profile, selected) {
  const q = typeof selected?.q === 'string' ? selected.q.trim().toLowerCase() : '';
  if (q) {
    const text =
      selected?.searchIndex instanceof Map
        ? selected.searchIndex.get(profile?.id) ?? directorySearchText(profile)
        : directorySearchText(profile);
    if (!text.includes(q)) return false;
  }
  const organizations = Array.isArray(selected?.organizations) ? selected.organizations : [];
  if (organizations.length > 0 && !organizations.includes(profile?.organization)) return false;
  return true;
}

/**
 * The organizations present in the loaded directory, each with its count —
 * most first (the "top organizations" a reader at a big event wants), then
 * alphabetically for the ties. An organization the projection never stored
 * offers nothing to filter on.
 *
 * @param {object[]} profiles
 * @returns {Array<{ value: string, label: string, count: number }>}
 */
export function collectOrganizations(profiles) {
  const counts = new Map();
  for (const profile of Array.isArray(profiles) ? profiles : []) {
    const organization = profile?.organization;
    if (typeof organization !== 'string' || !organization.trim()) continue;
    counts.set(organization, (counts.get(organization) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, label: value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}
