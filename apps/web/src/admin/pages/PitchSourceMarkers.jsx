// Badges tell staff when an imported pitch changed after it entered the queue.
import { StatusBadge } from '../components/adminChrome.jsx';
import { formatPublishedAt, toMillis } from '../versionHistory.js';

const FIELD_WORDS = { email: 'email', title: 'title', description: 'description', organization: 'organization', format: 'format' };

/** The update marker shows until a review is saved after the change. */
function sourceMarkers(row) {
  if (!row) return [];
  const updated = toMillis(row.sourceUpdatedAt);
  const reviewed = toMillis(row.reviewedAt);
  const markers = [];
  if (updated !== null && (reviewed === null || updated > reviewed)) markers.push('updated');
  if (row.sourceRemovedAt) markers.push('removed');
  if (row.sourceConsentMissingAt) markers.push('consent');
  return markers;
}

const LABELS = { updated: 'Updated from source', removed: 'Removed from Airtable', consent: 'Consent unchecked in Airtable' };
const TONES = { updated: 'info', removed: 'caution', consent: 'error' };

function changedWords(fields) {
  const words = (Array.isArray(fields) ? fields : []).map((field) => FIELD_WORDS[field]).filter(Boolean);
  return words.length ? words.join(', ') : 'the proposal';
}

/**
 * @param {{ row: object, detailed?: boolean, timeZone?: string }} props
 */
export default function PitchSourceMarkers({ row, detailed = false, timeZone }) {
  const markers = sourceMarkers(row);
  if (!markers.length) return null;
  if (!detailed) {
    return <span className="flex flex-wrap gap-xs">{markers.map((marker) => <StatusBadge key={marker} tone={TONES[marker]}>{LABELS[marker]}</StatusBadge>)}</span>;
  }
  return <ul className="space-y-xs text-admin-sm" aria-label="Source changes">
    {markers.includes('updated') ? <li><StatusBadge tone="info">{LABELS.updated}</StatusBadge> An import changed {changedWords(row.sourceChangedFields)} on {formatPublishedAt(row.sourceUpdatedAt, timeZone)}. Read the current text before you save a decision. Review any earlier drafts in their own editors.</li> : null}
    {markers.includes('removed') ? <li><StatusBadge tone="caution">{LABELS.removed}</StatusBadge> The record is no longer in the approved Airtable view. The pitch stays here until staff decide what to do with it.</li> : null}
    {markers.includes('consent') ? <li><StatusBadge tone="error">{LABELS.consent}</StatusBadge> Do not use this proposal until the submitter confirms consent again.</li> : null}
  </ul>;
}
