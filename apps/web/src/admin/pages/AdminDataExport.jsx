import HelpTooltip from '../components/HelpTooltip.jsx';
// Data export (issue #329): the event's records as spreadsheets, and, for
// an operator, the event data package for the handoff after an event.
//
// SPREADSHEETS. Each row asks exportEventData (functions/src/admin/
// dataExport.cjs) for one CSV file and saves it with the attendee export's
// download code. Sessions, speakers, speaker logistics, organizations, and
// invoices are staff tier.
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
import { Link } from 'react-router';
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
import AdminIconControl from '../components/AdminIconControl.jsx';

/** The spreadsheets, in page order. `tier` matches the server's DATASETS. */
export const SPREADSHEETS = Object.freeze([
  {
    dataset: 'sessions',
    label: 'Sessions',
    tier: 'staff',
    noun: ['session', 'sessions'],
    description: 'Title, status, visibility, day, times, location, speakers, and description of every session.',
  },
  {
    dataset: 'speakers',
    label: 'Speakers',
    tier: 'staff',
    noun: ['speaker', 'speakers'],
    description: 'Name, email address, organization, status, and published sessions of every speaker.',
  },
  {
    dataset: 'speakerLogistics',
    label: 'Speaker logistics',
    tier: 'staff',
    noun: ['speaker', 'speakers'],
    description: 'Travel, access needs, and audio and video needs each speaker gave. Private: share it only with the people who arrange them.',
  },
  {
    dataset: 'organizations',
    label: 'Organizations and sponsors',
    tier: 'staff',
    noun: ['organization', 'organizations'],
    description: 'Name, status, visibility, sponsorship level, website, and description of every organization.',
  },
  {
    dataset: 'orders',
    label: 'Ticket orders',
    tier: 'operator',
    noun: ['order', 'orders'],
    description: 'Purchaser email address, amounts, payment status, and refunds of every order.',
  },
  {
    dataset: 'admissions',
    label: 'Admissions',
    tier: 'operator',
    noun: ['admission', 'admissions'],
    description: 'Ticket holder, ticket type, status, and check-in of every ticket.',
  },
  {
    dataset: 'invoices',
    label: 'Invoices',
    tier: 'staff',
    noun: ['invoice', 'invoices'],
    description: 'Number, status, who it bills, dates, totals, and the payment or void of every invoice.',
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
          <div className="flex items-center gap-2xs"><h3 className="text-admin-base font-bold text-admin-ink">{sheet.label}</h3><HelpTooltip label="this section">Download this set of event records as a spreadsheet. Keep files with private attendee or staff information secure.</HelpTooltip></div>
          <p id={descriptionId} className="text-admin-sm text-admin-ink-secondary">
            {sheet.description}
          </p>
        </div>
        <AdminIconControl
          icon="download"
          label={`Export ${sheet.label.toLowerCase()}`}
          busy={busy}
          className={secondaryButtonClass}
          onClick={() => onExport(sheet)}
          aria-describedby={descriptionId}
          aria-busy={busy ? 'true' : undefined}
          aria-disabled={busy ? 'true' : undefined}
        />
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
          message: `Exported ${countOf(result.rowCount, sheet.noun)} to ${result.filename}.`,
        },
      }));
    } catch (err) {
      setResults((current) => ({ ...current, [sheet.dataset]: { tone: 'error', message: err?.status === 403 ? 'You do not have access to this download. Ask an operator to export it.' : 'The spreadsheet could not be downloaded. Try again.' } }));
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
        message: `Downloaded ${filename}. This file contains personal data; share it only with people who need it.`,
      });
    } catch (err) {
      setPackageResult({ tone: 'error', message: /too large/i.test(err?.message ?? '') ? 'This event is too large for one download. Choose fewer parts and try again.' : 'The package could not be downloaded. Try again.' });
    } finally {
      packageBusyRef.current = false;
      setPackageBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-md">
      <AdminPageHeader help="Download spreadsheets or a package of your event’s records."
        title="Data export"
        description="Download spreadsheets or a package of your event’s records."
      />

      <Panel help="Each spreadsheet includes current records and drafts, with their status."
        flush
        title="Spreadsheets"
        description="Each spreadsheet includes current records and drafts, with their status."
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
            <Link className={linkButtonClass} to="/admin/attendees">Attendees</Link>
            <Link className={linkButtonClass} to="/admin/pitches">Session pitches</Link>
          </div>
          {isOperator ? null : (
            <p>An operator exports ticket orders, admissions, and the event data package.</p>
          )}
        </div>
      </Panel>

      {isOperator ? (
        <Panel help="Download published records, including hidden records, in one file. Drafts and uploaded files are not included."
          title="Event data package"
          description="Download published records, including hidden records, in one file. Drafts and uploaded files are not included."
        >
          <div className="flex flex-col gap-md">
            <fieldset aria-label={[" Parts to include (", (chosen.size), " of ", (PACKAGE_SECTIONS.length), " chosen) "].join('').trim()} className="flex flex-col gap-sm">
              <legend className={`${fieldLabelClass} mb-xs`}>
                Parts to include ({chosen.size} of {PACKAGE_SECTIONS.length} chosen)
               <HelpTooltip label="Parts to include ({chosen.size} of {PACKAGE_SECTIONS.length} chosen)">Choose which parts of the event to include in the download.</HelpTooltip></legend>
              {PACKAGE_SECTIONS.map((section) => (
                <CheckboxField help="Include this part of the event in the download."
                  key={section.id}
                  label={section.label}
                  hint={section.id === 'organizations' ? 'Names, sponsorship levels, websites, and logos.' : section.id === 'materials' ? 'Links to slides and handouts, with their review status.' : section.id === 'content' ? 'Event details, pages, updates, announcements, and images.' : section.hint}
                  checked={chosen.has(section.id)}
                  onChange={(on) => toggleSection(section.id, on)}
                />
              ))}
            </fieldset>
            <CheckboxField help="Reviewers’ private notes. Leave this off unless the client asked for them."
              label="Include staff notes on session pitches"
              
              checked={includeStaffNotes}
              onChange={setIncludeStaffNotes}
            />
            <div className="flex flex-col items-start gap-xs">
              <AdminIconControl
                icon="download"
                label="Download event data package"
                busy={packageBusy}
                className={primaryButtonClass}
                onClick={downloadPackage}
                aria-busy={packageBusy ? 'true' : undefined}
                aria-disabled={packageBusy ? 'true' : undefined}
              />
              {packageResult?.tone === 'ok' ? <SaveStatus message={packageResult.message} /> : null}
              {packageResult && packageResult.tone !== 'ok' ? (
                <Notice tone={packageResult.tone} message={packageResult.message} />
              ) : null}
            </div>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
