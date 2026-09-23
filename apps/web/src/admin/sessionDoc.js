import { recordStateOf } from './recordState.js';
import { formatDayDate } from '../lib/eventTime.js';

const byTimeAndTitle = (a, b) =>
  String(a.current.startTime ?? '').localeCompare(String(b.current.startTime ?? ''))
  || String(a.current.title ?? '').localeCompare(String(b.current.title ?? ''))
  || a.id.localeCompare(b.id);

// A session can carry a dayId that names no entry in config/event.days at
// all — an operator deleted the day, or (the exact case behind #248's
// screenshot) an environment's config/event was bootstrapped with fewer
// days than its seeded sessions cover, because a seed step that already
// found config/event skips writing it. There is no day record to read a
// label or a date from here, so this is a different case from "the day
// has no label": a plain, shared heading, never the raw dayId.
export const UNKNOWN_DAY_LABEL = 'Not on a configured day';

/**
 * A day's heading: its own label, or its date, or its position — never its
 * document id (#248). An id is an internal key, not a word an operator
 * chose, so it never reaches an admin list as the thing a day is called.
 *
 * @param {{ label?: string, date?: string }} day
 * @param {number} index position in the configured day order (0-based)
 * @param {string} [timeZone] the event's IANA timezone
 * @returns {string}
 */
export function resolveDayLabel(day, index, timeZone) {
  const label = typeof day?.label === 'string' ? day.label.trim() : '';
  if (label) return label;
  const date = formatDayDate(day, timeZone);
  if (date) return date;
  return `Day ${index + 1}`;
}

export function mergeSessionRevisions(liveDocs, draftDocs, days = [], timeZone) {
  const liveById = new Map((liveDocs ?? []).map((doc) => [doc.id, doc]));
  const draftById = new Map((draftDocs ?? []).map((doc) => [doc.id, doc]));
  const rows = [...new Set([...liveById.keys(), ...draftById.keys()])].map((id) => {
    const live = liveById.get(id) ?? null;
    const draft = draftById.get(id) ?? null;
    return { id, live, draft, current: draft ?? live, state: recordStateOf({ live, draft }) };
  });
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const dayOrder = new Map(days.map((day, index) => [day.id, index]));
  const dayLabel = new Map(
    days.map((day, index) => [day.id, resolveDayLabel(day, index, timeZone)]),
  );
  const grouped = new Map();
  for (const row of rows) {
    const id = row.current.dayId || 'unscheduled';
    const group = grouped.get(id) ?? [];
    group.push(row);
    grouped.set(id, group);
  }

  return [...grouped.entries()]
    .sort(([a], [b]) =>
      (dayOrder.get(a) ?? Number.MAX_SAFE_INTEGER) - (dayOrder.get(b) ?? Number.MAX_SAFE_INTEGER)
      || a.localeCompare(b),
    )
    .map(([dayId, dayRows]) => {
      const top = dayRows.filter((row) => {
        const parent = rowsById.get(row.current.parentId);
        return !parent || parent.current.dayId !== dayId || parent.current.parentId;
      }).sort(byTimeAndTitle);
      const flattened = [];
      const placed = new Set();
      for (const parent of top) {
        flattened.push(parent);
        placed.add(parent.id);
        const children = dayRows
          .filter((row) => row.current.parentId === parent.id)
          .sort(byTimeAndTitle);
        for (const child of children) {
          flattened.push(child);
          placed.add(child.id);
        }
      }
      for (const row of dayRows.filter((candidate) => !placed.has(candidate.id)).sort(byTimeAndTitle)) {
        flattened.push(row);
      }
      return {
        dayId,
        label:
          dayId === 'unscheduled'
            ? 'Unscheduled'
            : dayLabel.has(dayId)
              ? dayLabel.get(dayId)
              : UNKNOWN_DAY_LABEL,
        rows: flattened,
      };
    });
}

export function sessionIdFromTitle(title) {
  return String(title ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .slice(0, 100);
}

const optional = (value) => {
  const trimmed = String(value ?? '').trim();
  return trimmed || null;
};

export function sessionFields(form) {
  return {
    title: String(form.title ?? '').trim(),
    description: String(form.description ?? '').trim(),
    dayId: String(form.dayId ?? '').trim(),
    startTime: String(form.startTime ?? '').trim(),
    endTime: String(form.endTime ?? '').trim(),
    track: optional(form.track),
    placeId: optional(form.placeId),
    location: optional(form.location),
    parentId: optional(form.parentId),
    recordingUrl: optional(form.recordingUrl),
  };
}

export function publishSetForSession(row, rows) {
  const ids = [row.id];
  const parentId = row.current.parentId;
  if (!parentId) return ids;
  const parent = rows.find((candidate) => candidate.id === parentId);
  if (parent && !parent.live && parent.draft) ids.unshift(parent.id);
  return ids;
}
