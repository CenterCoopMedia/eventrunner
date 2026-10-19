// Speaker reminders page helpers (functions/src/speakers/reminders.cjs).
// Pure, so the page and its tests read one set of words and one filter.
import { READINESS_ITEMS, READINESS_ITEM_LABELS } from 'shared/speakerReadiness';

/** The "Show" filter: which accepted speakers the list holds. */
export const REMINDER_GROUPS = Object.freeze([
  { value: 'any', label: 'Anything missing' },
  { value: 'bio', label: 'Biography missing' },
  { value: 'headshot', label: 'Headshot missing' },
  { value: 'description', label: 'Session description missing' },
  { value: 'materials', label: 'Materials missing' },
  { value: 'all', label: 'Every accepted speaker' },
]);

const GROUP_VALUES = new Set(REMINDER_GROUPS.map((group) => group.value));

/** A group from the page address, or the default. */
export function readGroup(value) {
  return GROUP_VALUES.has(value) ? value : 'any';
}

/** The speakers a group shows. Rows come from the `list` action. */
export function rowsInGroup(rows, group) {
  return (rows ?? []).filter((row) => {
    if (group === 'all') return true;
    const missing = row?.readiness?.missing ?? [];
    if (group === 'any') return missing.length > 0;
    return missing.includes(group);
  });
}

/** The items as staff read them, with the sessions each one names. */
export function describeMissing(readiness) {
  const missing = readiness?.missing ?? [];
  if (missing.length === 0) return 'Nothing missing';
  const titles = (sessions) => sessions.map((session) => session.title).join('; ');
  return missing.map((item) => {
    const label = READINESS_ITEM_LABELS[item] ?? item;
    if (item === 'description') return `${label} (${titles(readiness.descriptionSessions ?? [])})`;
    if (item === 'materials') return `${label} (${titles(readiness.materialsSessions ?? [])})`;
    return label;
  }).join(', ');
}

/** Item labels for a list of item ids, in the fixed order. */
export function itemLabels(items) {
  return READINESS_ITEMS.filter((item) => (items ?? []).includes(item))
    .map((item) => READINESS_ITEM_LABELS[item])
    .join(', ');
}

/** "1 speaker" / "3 speakers". */
export function speakerCount(count) {
  return `${count} ${count === 1 ? 'speaker' : 'speakers'}`;
}

/** "Send 1 reminder" / "Send 3 reminders". */
export function sendLabel(count) {
  return `Send ${count} ${count === 1 ? 'reminder' : 'reminders'}`;
}

/** The result of a send, as one sentence per outcome that happened. */
export function sendSummary(result) {
  const lines = [];
  const sent = result?.sent?.length ?? 0;
  lines.push(`Sent ${sent} ${sent === 1 ? 'reminder' : 'reminders'}.`);
  const already = result?.alreadySent?.length ?? 0;
  if (already) lines.push(`${speakerCount(already)} already had this reminder, so nothing more was sent.`);
  const skipped = result?.skipped?.length ?? 0;
  if (skipped) lines.push(`${speakerCount(skipped)} got no reminder.`);
  const failed = result?.failed?.length ?? 0;
  if (failed) lines.push(`${speakerCount(failed)} could not be emailed. Preview again to retry.`);
  const uncertain = result?.uncertain?.length ?? 0;
  if (uncertain) {
    lines.push(`${speakerCount(uncertain)} may have the reminder: the email provider did not confirm it.`);
    lines.push(`${uncertain === 1 ? 'The speaker gets' : 'These speakers get'} no other reminder for 24 hours. Check the Email log.`);
  }
  return lines.join(' ');
}

/**
 * One id per preview. The server records it per speaker, so pressing Send
 * twice, or a retry after a lost answer, sends nothing more.
 */
export function newBatchId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/** A stored instant on the event's clock, as a date and a time with the zone. */
export function formatWhen(iso, timeZone) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const options = { dateStyle: 'medium', timeStyle: 'short' };
  try {
    const text = new Intl.DateTimeFormat('en-US', { ...options, timeZone }).format(date);
    return timeZone ? `${text} (${timeZone})` : text;
  } catch {
    return new Intl.DateTimeFormat('en-US', options).format(date);
  }
}
