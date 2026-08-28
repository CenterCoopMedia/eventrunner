import { recordStateOf } from './recordState.js';

const byTimeAndTitle = (a, b) =>
  String(a.current.startTime ?? '').localeCompare(String(b.current.startTime ?? ''))
  || String(a.current.title ?? '').localeCompare(String(b.current.title ?? ''))
  || a.id.localeCompare(b.id);

export function mergeSessionRevisions(liveDocs, draftDocs, days = []) {
  const liveById = new Map((liveDocs ?? []).map((doc) => [doc.id, doc]));
  const draftById = new Map((draftDocs ?? []).map((doc) => [doc.id, doc]));
  const rows = [...new Set([...liveById.keys(), ...draftById.keys()])].map((id) => {
    const live = liveById.get(id) ?? null;
    const draft = draftById.get(id) ?? null;
    return { id, live, draft, current: draft ?? live, state: recordStateOf({ live, draft }) };
  });
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const dayOrder = new Map(days.map((day, index) => [day.id, index]));
  const dayLabel = new Map(days.map((day) => [day.id, day.label || day.id]));
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
        label: dayId === 'unscheduled' ? 'Unscheduled' : dayLabel.get(dayId) ?? dayId,
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
