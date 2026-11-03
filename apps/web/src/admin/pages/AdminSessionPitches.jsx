// /admin/pitches: the session pitch queue (ADR 0008, admin review). It
// holds the queue alone, in the rail's list idiom: the title band with the
// count and the page actions, then one ruled row per pitch with its title,
// its badges, a line of detail in the data face, and a Review link.
//
// The pitch itself is /admin/pitches/:pitchId; the call, the form choices
// and the emails are /admin/pitches/settings; CSV and Airtable imports are
// /admin/pitches/import. Export writes the rows the filter shows.
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { readPresenters } from 'shared/pitchForm';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { subscribeAdminCollection } from '../adminSource.js';
import { saveTextFile } from '../downloadFile.js';
import { toMillis } from '../versionHistory.js';
import { pitchQueueCsv } from '../pitchCsv.js';
import { PITCH_STATUS_LABELS, PITCH_STATUS_OPTIONS, PITCH_STATUS_TONES } from '../pitchStatus.js';
import PitchSourceMarkers from './PitchSourceMarkers.jsx';
import AdminPageHeader, { AdminEmptyState, AdminLoadingState, StatusBadge } from '../components/adminChrome.jsx';
import {
  Notice, Panel, SelectField, TextField, linkButtonClass, rowClass, rowMetaClass, rowTitleLinkClass, secondaryButtonClass,
} from '../components/formControls.jsx';

/** The row's detail line: who, what, and how many presenters. */
function detailOf(row) {
  const presenters = readPresenters(row).length;
  return [
    row.email,
    row.format,
    row.lengthMinutes ? `${row.lengthMinutes} min` : null,
    row.track,
    presenters > 1 ? `${presenters} presenters` : null,
  ].filter(Boolean).join(' · ');
}

export default function AdminSessionPitches() {
  const { isOperator } = useAuth();
  const [rows, setRows] = useState(null);
  const [listError, setListError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  useEffect(() => subscribeAdminCollection('session_pitches', (docs) => { setRows(docs); setListError(null); }, setListError), []);

  const needle = search.trim().toLowerCase();
  const shown = (rows || [])
    .filter((row) => (filter === 'all' || row.status === filter)
      && `${row.title} ${row.email} ${row.organization || ''} ${readPresenters(row).map((p) => p.name || '').join(' ')}`.toLowerCase().includes(needle))
    .sort((a, b) => (toMillis(b.createdAt) ?? -Infinity) - (toMillis(a.createdAt) ?? -Infinity) || a.id.localeCompare(b.id));
  const total = rows?.length ?? 0;

  return (
    <div className="flex flex-col gap-md [overflow-wrap:anywhere]">
      <AdminPageHeader
        title="Session pitches"
        identifiers={rows ? `${total} pitch${total === 1 ? '' : 'es'}` : null}
        description="Private proposals from the call for sessions. Open a pitch to read it, decide, edit it, or turn it into drafts. Deciding sends no email and publishes nothing."
        actions={
          <>
            {isOperator ? <Link to="settings" className={secondaryButtonClass}>Call settings</Link> : null}
            <Link to="import" className={secondaryButtonClass}>Import pitches</Link>
            <button type="button" className={secondaryButtonClass} disabled={!rows || Boolean(listError)} onClick={() => saveTextFile('session-pitches.csv', pitchQueueCsv(shown))}>
              Export the shown pitches
            </button>
          </>
        }
      />
      <p className="text-admin-sm text-admin-ink-secondary">
        <Link to="/pitch" className={rowTitleLinkClass}>Open the public pitch form</Link>. The export holds contact details: keep the file private. Private notes are left out.
      </p>
      <div className="grid gap-sm sm:grid-cols-2 sm:items-end">
        <SelectField label="Decision" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All pitches' }, ...PITCH_STATUS_OPTIONS]} />
        <TextField label="Search" value={search} onChange={setSearch} hint="Title, email, organization or presenter." />
      </div>
      {listError ? <Notice tone="caution" message="Cannot load the queue. Reconnecting; the list may be out of date." /> : null}
      {rows === null ? <AdminLoadingState label="Loading session pitches…" /> : (
        <>
          <p role="status" className="text-admin-sm text-admin-ink-secondary">Showing {shown.length} of {total}.</p>
          {shown.length === 0 ? (
            <AdminEmptyState title={total ? 'No pitches in this view' : 'No pitches yet'} description={total ? 'Try another decision or search.' : 'Pitches from the public form, a CSV import or Airtable appear here.'} />
          ) : (
            <Panel flush>
              <ul aria-label="Session pitches">
                {shown.map((row) => (
                  <li key={row.id} className="border-admin-rule-hairline border-b-admin-hairline last:border-b-0">
                    <div className={rowClass}>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-sm gap-y-2xs">
                          <Link to={row.id} className={rowTitleLinkClass}>{row.title}</Link>
                          <StatusBadge tone={PITCH_STATUS_TONES[row.status]}>{PITCH_STATUS_LABELS[row.status]}</StatusBadge>
                          {row.submitted ? <StatusBadge tone="neutral">Edited by staff</StatusBadge> : null}
                          {row.conversion ? <StatusBadge tone="neutral">Drafts created</StatusBadge> : null}
                        </div>
                        <p className={`mt-3xs truncate ${rowMetaClass}`}>{detailOf(row) || '—'}</p>
                        <PitchSourceMarkers row={row} />
                      </div>
                      <Link to={row.id} className={linkButtonClass} aria-label={`Review ${row.title}`}>Review</Link>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
