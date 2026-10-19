// Data export (issue #329): the event's records as spreadsheets, and, for
// an operator, the event data package for the handoff after an event.
//
// SPREADSHEETS. Each row asks exportEventData (functions/src/admin/
// dataExport.cjs) for one CSV file and saves it with the attendee export's
// download code. Sessions, speakers, and organizations are staff tier.
// Ticket orders and admissions name purchasers and amounts, so the server
// gives them to an operator only, and this page does not draw those rows
// for staff. It says in one sentence who can reach them instead. Attendees
// and session pitches keep their exports on their own pages, which apply the
// page's filter; this page links to them.
//
// THE PACKAGE. downloadEventPackage (functions/src/admin/eventPackage.cjs)
// answers one zip with a manifest and a README. Every part is ticked at the
// start, and staff notes on pitches are off: the operator turns on what the
// handoff needs. The server writes the admin_logs row before it sends a
// byte. A result line stays under the control that caused it.
//
// No control is disabled for a choice: a press with no part chosen states
// why. A running export carries aria-busy and aria-disabled and ignores a
// second press.
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useAdminApi } from '../adminApi.js';
import { saveTextFile } from '../downloadFile.js';
import { PACKAGE_SECTIONS, downloadEventPackage } from '../eventPackage.js';
import {
  CheckboxField,
  Notice,
  Panel,
  SaveStatus,
  fieldLabelClass,
  linkButtonClass,
  primaryButtonClass,
  rowClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import AdminPageHeader from '../components/adminChrome.jsx';

/** The spreadsheets, in page order. `tier` matches the server's DATASETS. */
export const SPREADSHEETS = Object.freeze([
  {
    dataset: 'sessions',
    label: 'Sessions',
    tier: 'staff',
    noun: ['session', 'sessions'],
    description: 'Title, state, whether it is hidden, day, times, location, speakers, and description of every session.',
  },
  {
    dataset: 'speakers',
    label: 'Speakers',
    tier: 'staff',
    noun: ['speaker', 'speakers'],
    description: 'Name, email address, organization, status, and published sessions of every speaker.',
  },
  {
    dataset: 'organizations',
    label: 'Organizations and sponsors',
    tier: 'staff',
    noun: ['organization', 'organizations'],
    description: 'Name, state, whether it is hidden, tier, website, and description of every organization.',
  },
  {
    dataset: 'orders',
    label: 'Ticket orders',
    tier: 'operator',
    noun: ['order', 'orders'],
    description: 'Purchaser email address, amounts, payment state, and refunds of every order.',
  },
  {
    dataset: 'admissions',
    label: 'Admissions',
    tier: 'operator',
    noun: ['admission', 'admissions'],
    description: 'Ticket holder, ticket type, status, and check-in of every ticket.',
  },
]);

function countOf(n, [one, many]) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

function SpreadsheetRow({ sheet, busy, result, onExport }) {
  const descriptionId = `export-${sheet.dataset}-description`;
  return (
    <li className="border-admin-rule-hairline border-b-admin-hairline last:border-b-0">
      <div className={rowClass}>
        <div className="min-w-0 flex-1">
          <h3 className="text-admin-base font-bold text-admin-ink">{sheet.label}</h3>
          <p id={descriptionId} className="max-w-[65ch] text-admin-sm text-admin-ink-secondary">
            {sheet.description}
          </p>
        </div>
        <button
          type="button"
          className={secondaryButtonClass}
          onClick={() => onExport(sheet)}
          aria-describedby={descriptionId}
          aria-busy={busy ? 'true' : undefined}
          aria-disabled={busy ? 'true' : undefined}
        >
          {busy ? 'Exporting…' : `Export ${sheet.label.toLowerCase()}`}
        </button>
      </div>
      {result ? (
        <div className="px-md pb-sm">
          {result.tone === 'ok' ? <SaveStatus message={result.message} /> : <Notice tone="error" message={result.message} />}
        </div>
      ) : null}
    </li>
  );
}

export default function AdminDataExport() {
  const { user, adminTier } = useAuth();
  const call = useAdminApi();
  const isOperator = adminTier === 'operator';

  const [busyDataset, setBusyDataset] = useState(null);
  const busyRef = useRef(null);
  const [results, setResults] = useState({});

  const [chosen, setChosen] = useState(() => new Set(PACKAGE_SECTIONS.map((section) => section.id)));
  const [includeStaffNotes, setIncludeStaffNotes] = useState(false);
  const [packageBusy, setPackageBusy] = useState(false);
  const packageBusyRef = useRef(false);
  const [packageResult, setPackageResult] = useState(null);

  const sheets = SPREADSHEETS.filter((sheet) => sheet.tier === 'staff' || isOperator);

  async function exportSheet(sheet) {
    if (busyRef.current) return;
    busyRef.current = sheet.dataset;
    setBusyDataset(sheet.dataset);
    setResults((current) => ({ ...current, [sheet.dataset]: null }));
    try {
      const result = await call('exportEventData', { dataset: sheet.dataset });
      saveTextFile(result.filename, result.csv);
      setResults((current) => ({
        ...current,
        [sheet.dataset]: {
          tone: 'ok',
          message: `Exported ${countOf(result.rowCount, sheet.noun)} to ${result.filename}. The export is in the admin log.`,
        },
      }));
    } catch (err) {
      setResults((current) => ({ ...current, [sheet.dataset]: { tone: 'error', message: err.message } }));
    } finally {
      busyRef.current = null;
      setBusyDataset(null);
    }
  }

  function toggleSection(id, on) {
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function downloadPackage() {
    if (packageBusyRef.current) return;
    const sections = PACKAGE_SECTIONS.map((section) => section.id).filter((id) => chosen.has(id));
    if (sections.length === 0) {
      setPackageResult({ tone: 'caution', message: 'Choose at least one part to include.' });
      return;
    }
    packageBusyRef.current = true;
    setPackageBusy(true);
    setPackageResult(null);
    try {
      const { filename } = await downloadEventPackage({
        getIdToken: () =>
          user && typeof user.getIdToken === 'function'
            ? user.getIdToken()
            : Promise.reject(new Error('not signed in')),
        sections,
        includeStaffNotes,
      });
      setPackageResult({
        tone: 'ok',
        message: `Downloaded ${filename}. The download is in the admin log. The file holds personal data: store it with access control.`,
      });
    } catch (err) {
      setPackageResult({ tone: 'error', message: err.message });
    } finally {
      packageBusyRef.current = false;
      setPackageBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-md">
      <AdminPageHeader
        title="Data export"
        description="Download the event’s records as spreadsheets, or as one package for the handoff after the event. Every export is recorded in the admin log."
      />

      <Panel
        flush
        title="Spreadsheets"
        description="One CSV file for each list. Each file shows the current version of every record, drafts included, with its state. A cell that starts with =, +, - or @ gains a leading apostrophe, so a spreadsheet shows it as text and does not run it."
      >
        <ul>
          {sheets.map((sheet) => (
            <SpreadsheetRow
              key={sheet.dataset}
              sheet={sheet}
              busy={busyDataset === sheet.dataset}
              result={results[sheet.dataset]}
              onExport={exportSheet}
            />
          ))}
        </ul>
        <div className="flex flex-col gap-2xs border-admin-rule-hairline border-t-admin-hairline px-md py-sm text-admin-sm text-admin-ink-secondary">
          <p>Attendees and session pitches export from their own pages, with the page’s filter applied.</p>
          <div className="flex flex-wrap gap-sm">
            <Link className={linkButtonClass} to="/admin/attendees">Go to the Attendees page</Link>
            <Link className={linkButtonClass} to="/admin/pitches">Go to the Session pitches page</Link>
          </div>
          {isOperator ? null : (
            <p>An operator exports ticket orders, admissions, and the event data package.</p>
          )}
        </div>
      </Panel>

      {isOperator ? (
        <Panel
          title="Event data package"
          description="One zip file for the handoff. It holds a JSON file for each record type, CSV files for the main lists, a manifest with record counts and checksums, and a README that describes each file. It holds live records only: no drafts. A hidden record is in it and marked hidden. It leaves out credentials, the admin allowlist, and raw payment provider records. Uploaded files stay in Storage; the package lists their paths."
        >
          <div className="flex flex-col gap-md">
            <fieldset className="flex flex-col gap-sm">
              <legend className={`${fieldLabelClass} mb-xs`}>
                Parts to include ({chosen.size} of {PACKAGE_SECTIONS.length} chosen)
              </legend>
              {PACKAGE_SECTIONS.map((section) => (
                <CheckboxField
                  key={section.id}
                  label={section.label}
                  hint={section.hint}
                  checked={chosen.has(section.id)}
                  onChange={(on) => toggleSection(section.id, on)}
                />
              ))}
            </fieldset>
            <CheckboxField
              label="Include staff notes on session pitches"
              hint="Reviewers’ private notes. Leave this off unless the client asked for them."
              checked={includeStaffNotes}
              onChange={setIncludeStaffNotes}
            />
            <div className="flex flex-col items-start gap-xs">
              <button
                type="button"
                className={primaryButtonClass}
                onClick={downloadPackage}
                aria-busy={packageBusy ? 'true' : undefined}
                aria-disabled={packageBusy ? 'true' : undefined}
              >
                {packageBusy ? 'Preparing package…' : 'Download event data package'}
              </button>
              {packageResult?.tone === 'ok' ? <SaveStatus message={packageResult.message} /> : null}
              {packageResult && packageResult.tone !== 'ok' ? (
                <Notice tone={packageResult.tone} message={packageResult.message} />
              ) : null}
            </div>
            <p className="max-w-[65ch] text-admin-sm text-admin-ink-secondary">
              A large event can pass the size this page can send. Run{' '}
              <code className="font-admin-data text-admin-xs text-admin-ink-data">scripts/export-event-package.cjs</code>{' '}
              from a terminal instead. The operator guide for the archive handoff also covers a full Firebase backup and how to keep the past site online.
            </p>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
