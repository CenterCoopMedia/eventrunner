// The admin's state vocabulary (design brief §5.2; admin story part 2 and
// moment 1).
//
// A record in this product is one of exactly three things, and the admin
// says so in exactly these words across every editor — pages, content,
// speakers, sessions, badges, and branding:
//
//   Draft                          set, not sent to press
//   Live                           on the public site, nothing pending
//   Live with unpublished changes  on the public site, with a newer draft
//
// One term per flow (§8.5). Every surface reads its words from here, so a
// fifth spelling cannot appear by accident, and the word is ALWAYS rendered
// beside the tint — a state is never signalled by colour alone (§8.1).

/** The three state ids the admin renders. */
export const RECORD_STATE_IDS = Object.freeze(['draft', 'live', 'dirty']);

/** State id → the exact words. Nothing else may spell these. */
export const RECORD_STATE_WORDS = Object.freeze({
  draft: 'Draft',
  live: 'Live',
  dirty: 'Live with unpublished changes',
});

/**
 * One record's state from its two revisions.
 *
 * @param {{ live: object|null, draft: object|null }} revisions
 * @returns {{ id: string, label: string }}
 */
export function recordStateOf({ live, draft }) {
  if (!live && draft) return state('draft');
  if (live && draft && draft.status === 'dirty') return state('dirty');
  if (live) return state('live');
  return { id: 'unknown', label: 'Unknown' };
}

/**
 * @param {'draft'|'live'|'dirty'} id
 * @returns {{ id: string, label: string }}
 */
export function state(id) {
  return { id, label: RECORD_STATE_WORDS[id] };
}

/**
 * Dead matter: archived, revoked, disabled, and superseded records. They
 * drop to the standing-matter ink and KEEP every word — nothing is hidden to
 * make the room look tidy (admin story part 2).
 *
 * @param {string} label the word this flow uses, e.g. 'Removed'
 * @returns {{ id: string, label: string }}
 */
export function deadMatter(label) {
  return { id: 'dead', label };
}
