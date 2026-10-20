// The admin's remembered layout (issue #477): whether the rail is hidden,
// which docket groups are open, and how the Branding panes are split.
//
// These are one viewer's conveniences in one browser. Nothing here reaches
// Firestore, and nothing here is per account: a layout is a matter of the
// screen in front of the reader, not of what the account may do.
//
// Browser storage can be missing or refuse a read or a write (a private
// window, blocked site data). Every call is wrapped. A write that fails is
// held in memory for the life of the tab, so the layout still holds until a
// reload; a read that fails or finds nothing usable gives the default.

/** The values this tab wrote, so a refused store still holds them. */
const memory = new Map();

const KEY_PREFIX = 'eventrunner.adminLayout.v1:';

export const RAIL_COLLAPSED_KEY = `${KEY_PREFIX}railCollapsed`;
export const DOCKET_GROUPS_KEY = `${KEY_PREFIX}docketGroups`;
export const BRANDING_SPLIT_KEY = `${KEY_PREFIX}brandingSplit`;
export const COMPARE_SPLIT_KEY = `${KEY_PREFIX}compareSplit`;

function readRaw(key) {
  if (memory.has(key)) return memory.get(key);
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function writeRaw(key, value) {
  memory.set(key, value);
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Held in memory above; the tab keeps the layout until a reload.
  }
}

/** Forget what this tab holds in memory. For tests only. */
export function forgetLayoutMemory() {
  memory.clear();
}

/** @returns {boolean} true when the reader hid the rail */
export function readRailCollapsed() {
  return readRaw(RAIL_COLLAPSED_KEY) === true;
}

/** @param {boolean} collapsed */
export function writeRailCollapsed(collapsed) {
  writeRaw(RAIL_COLLAPSED_KEY, collapsed === true);
}

/**
 * The docket groups the reader opened or closed by hand, as
 * `{ [groupId]: boolean }`. A group with no entry follows the default.
 *
 * @returns {Record<string, boolean>}
 */
export function readDocketGroups() {
  const stored = readRaw(DOCKET_GROUPS_KEY);
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
  const choices = {};
  for (const [id, open] of Object.entries(stored)) {
    if (typeof open === 'boolean') choices[id] = open;
  }
  return choices;
}

/** @param {Record<string, boolean>} choices */
export function writeDocketGroups(choices) {
  writeRaw(DOCKET_GROUPS_KEY, choices);
}

/**
 * A stored pane split, as the leading pane's whole percent of the row.
 * A missing or unreadable value, or one outside the limits, gives the
 * default, so a changed limit can never leave a pane below its minimum.
 *
 * @param {string} key
 * @param {{ min: number, max: number, defaultValue: number }} limits
 * @returns {number}
 */
export function readSplit(key, { min, max, defaultValue }) {
  const stored = readRaw(key);
  if (typeof stored !== 'number' || !Number.isFinite(stored)) return defaultValue;
  if (stored < min || stored > max) return defaultValue;
  return Math.round(stored);
}

/**
 * @param {string} key
 * @param {number} value
 */
export function writeSplit(key, value) {
  writeRaw(key, value);
}
