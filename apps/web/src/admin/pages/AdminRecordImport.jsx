// Import records: staff CSV import for speakers, sessions and organizations
// (functions/src/imports/recordImport.cjs).
//
// The flow is the ticket import's (AdminTicketing.jsx): the browser parses
// the file, staff point each field at a column, a preview runs the server
// pipeline without writing, and the import runs only when staff confirm.
// The confirm sends back the preview's digest, so the server refuses a file
// or a mapping that changed after the preview.
//
// Everything the import writes is a draft: a speaker in Draft, a session or
// an organization as a hidden draft. Staff publish from the record's own
// list. The page says so before and after the import, and it never sends
// mail.
//
// A speaker has no draft revision, so a change to a published speaker is
// queued for review on the Speakers page instead; the page says so.
//
// The preview is a ruled table (RuledTable): each verdict a word in a badge
// whose tint agrees with it, never colour alone and never a pill.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { parseCsvFile } from '../../lib/csv.js';
import { useAdminApi } from '../adminApi.js';
import { saveTextFile } from '../downloadFile.js';
import { subscribeRegistrationForm } from '../../lib/registrationFormSource.js';
import '../operationRecovery.css';
import {
  MATCHED_WORD,
  RECORD_IMPORT_TYPES,
  VERDICT_TONES,
  VERDICT_WORDS,
  guessMapping,
  importTypeById,
  missingMapping,
  projectRows,
  summaryWords,
  pruneMapping,
  templateCsv,
  withAnswerFields,
} from '../recordImport.js';
import {
  Notice,
  Panel,
  SelectField,
  fieldHintClass,
  fieldLabelClass,
  inputClass,
  linkButtonClass,
  primaryButtonClass,
  rowMetaClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import AdminPageHeader, { StatusBadge } from '../components/adminChrome.jsx';
import RuledTable from '../components/RuledTable.jsx';

/** The most rows the server takes in one import (MAX_IMPORT_ROWS). */
const MAX_ROWS = 500;
/** The largest file the page reads. A file this size is far past MAX_ROWS of real data. */
const MAX_FILE_MB = 5;

const LIST_PAGES = {
  speakers: '/admin/speakers',
  sessions: '/admin/sessions',
  organizations: '/admin/organizations',
  registrations: '/admin/attendees',
};

const PREVIEW_COLUMNS = [
  { id: 'row', label: 'Row', numeric: true },
  { id: 'result', label: 'Result' },
  { id: 'externalId', label: 'External ID' },
  { id: 'record', label: 'Record' },
  { id: 'detail', label: 'Detail' },
];

/** What a row's detail cell says: the reasons, the notes, or the fields that change. */
function rowDetail(row) {
  const lines = [...(row.reasons ?? []), ...(row.notes ?? [])];
  if (row.verdict === 'update' && row.changedFields?.length) {
    lines.unshift(`Changes ${row.changedFields.join(', ')}.`);
  }
  return lines.length > 0 ? lines.join(' ') : '—';
}

function MappingFields({ type, headers, mapping, onChange }) {
  const options = [{ value: '', label: 'Not in this file' }, ...headers.map((h) => ({ value: h, label: h }))];
  return (
    <div className="grid grid-cols-1 gap-sm sm:grid-cols-2">
      {type.fields.map((field) => (
        <SelectField
          key={`${type.id}-${field.id}`}
          label={field.required ? `${field.label} (required)` : field.label}
          value={mapping[field.id] ?? ''}
          onChange={(value) => onChange({ ...mapping, [field.id]: value })}
          options={options}
        />
      ))}
    </div>
  );
}

function PreviewTable({ result, type }) {
  const rows = result.rows.map((row) => ({
    id: String(row.index),
    cells: {
      row: row.index + 1,
      result: (
        <StatusBadge tone={VERDICT_TONES[row.verdict] ?? 'neutral'}>
          {row.matched ? MATCHED_WORD : VERDICT_WORDS[row.verdict] ?? row.verdict}
        </StatusBadge>
      ),
      externalId: <span className="font-admin-data text-admin-ink-data wrap-anywhere">{row.externalId ?? '—'}</span>,
      record: <span className="wrap-anywhere">{row.label ?? '—'}</span>,
      detail: <span className="text-admin-ink-secondary wrap-anywhere">{rowDetail(row)}</span>,
    },
  }));
  return (
    <RuledTable
      caption={`${result.dryRun ? 'Preview' : 'Result'}: ${type.plural}, one line per row of the file`}
      columns={PREVIEW_COLUMNS}
      rows={rows}
      className="max-h-[32rem]"
      tableClassName="min-w-[44rem]"
    />
  );
}

export default function AdminRecordImport() {
  const call = useAdminApi();
  const [typeId, setTypeId] = useState(RECORD_IMPORT_TYPES[0].id);
  // Registrations take one column per registration question (ADR 0008 §7).
  const [answerForm, setAnswerForm] = useState(null);
  useEffect(() => (typeId === 'registrations' ? subscribeRegistrationForm(setAnswerForm) : undefined), [typeId]);
  const type = useMemo(() => withAnswerFields(importTypeById(typeId), answerForm), [typeId, answerForm]);
  const [parsed, setParsed] = useState(null); // { headers, rows, fileName }
  const [mapping, setMapping] = useState({});
  const [result, setResult] = useState(null); // the last preview or import response
  const [busy, setBusy] = useState(null); // 'preview' | 'import' | null
  const [notice, setNotice] = useState(null);
  const inputRevision = useRef(0);
  const busyRef = useRef(null);
  const previewRevision = useRef(null);
  const noticeRef = useRef(null);

  useEffect(() => { if (notice) noticeRef.current?.focus(); }, [notice]);

  const writes = result?.dryRun ? (result.summary.create ?? 0) + (result.summary.update ?? 0) : 0;
  const sentRows = useMemo(() => (parsed ? projectRows(parsed.rows, mapping) : []), [parsed, mapping]);

  function chooseType(next) {
    if (busyRef.current === 'import') return;
    inputRevision.current += 1;
    setTypeId(next);
    setResult(null);
    setNotice(null);
    setMapping(parsed ? guessMapping(parsed.headers, withAnswerFields(importTypeById(next), answerForm)) : {});
  }

  // The questions can arrive after the file, and can change: map new
  // question columns, keep every choice already made, and drop a mapping
  // whose question the form no longer asks, so its column is not sent.
  useEffect(() => {
    if (!parsed || typeId !== 'registrations' || busy === 'import') return;
    const next = pruneMapping({ ...guessMapping(parsed.headers, type), ...mapping }, type);
    if (JSON.stringify(next) === JSON.stringify(mapping)) return;
    inputRevision.current += 1;
    setResult(null);
    setMapping(next);
  }, [type, parsed, typeId, mapping, busy]);

  function changeMapping(next) {
    if (busyRef.current === 'import') return;
    inputRevision.current += 1;
    setMapping(next);
    // A preview's digest covers the mapping: a changed mapping needs a new one.
    setResult(null);
    setNotice(null);
  }

  async function chooseFile(event) {
    if (busyRef.current === 'import') return;
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const revision = ++inputRevision.current;
    setNotice(null);
    setResult(null);
    setParsed(null);
    // Refused before the file is read, so a huge file never fills memory.
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      setNotice({ tone: 'error', message: `That file is larger than ${MAX_FILE_MB} MB. Split the file.` });
      return;
    }
    try {
      const contents = await file.text();
      if (revision !== inputRevision.current) return;
      const { headers, rows } = parseCsvFile(contents);
      if (rows.length === 0) {
        setNotice({ tone: 'error', message: 'That file has no data rows. The first row must name the columns.' });
        return;
      }
      if (rows.length > MAX_ROWS) {
        setNotice({ tone: 'error', message: `That file has ${rows.length} rows. Import at most ${MAX_ROWS} rows at a time. Split the file.` });
        return;
      }
      setParsed({ headers, rows, fileName: file.name });
      setMapping(guessMapping(headers, type));
    } catch {
      if (revision !== inputRevision.current) return;
      setNotice({ tone: 'error', message: 'That file could not be read as text.' });
    }
  }

  async function preview() {
    if (busyRef.current) return;
    const missing = missingMapping(mapping, type);
    if (missing) {
      setNotice({ tone: 'error', message: missing });
      return;
    }
    setBusy('preview');
    busyRef.current = 'preview';
    const revision = inputRevision.current;
    setNotice(null);
    try {
      const response = await call('importRecordsCsv', { type: type.id, mapping, rows: sentRows, dryRun: true });
      if (revision !== inputRevision.current) return;
      previewRevision.current = revision;
      setResult(response);
      setNotice({ tone: 'info', message: `Preview: ${summaryWords(response.summary)}. Nothing is saved yet.` });
    } catch (err) {
      if (revision !== inputRevision.current) return;
      setResult(null);
      setNotice({ tone: 'error', message: err?.message ?? 'The preview could not be made.' });
    } finally {
      busyRef.current = null;
      setBusy(null);
    }
  }

  async function runImport() {
    if (busyRef.current) return;
    if (!result?.dryRun || previewRevision.current !== inputRevision.current) {
      setResult(null);
      setNotice({ tone: 'caution', message: 'The file or columns changed. Preview the import again.' });
      return;
    }
    busyRef.current = 'import';
    setBusy('import');
    setNotice(null);
    try {
      const response = await call('importRecordsCsv', {
        type: type.id,
        mapping,
        rows: sentRows,
        dryRun: false,
        confirmDigest: result.digest,
      });
      setResult(response);
      setNotice({
        tone: response.summary.error > 0 ? 'caution' : 'ok',
        message: `Imported: ${summaryWords(response.summary)}. ${type.doneNote}`,
      });
    } catch (err) {
      setNotice({ tone: 'error', message: err?.message ?? 'The import could not be completed.' });
      // A refused confirm (the file changed) needs a new preview.
      if (err?.status === 409) setResult(null);
    } finally {
      busyRef.current = null;
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-md">
      <AdminPageHeader
        title="Import records"
        description="Add or update speakers, sessions, organizations and registrations from a CSV file. Speakers, sessions and organizations are saved as drafts only; registrations make tickets. The import publishes nothing and sends no email."
      />

      <fieldset disabled={busy === 'import'} className="flex min-w-0 flex-col gap-md">
      <legend className="sr-only">Import inputs</legend>
      <Panel
        title="File"
        description="Choose the record type, then the CSV file. The first row of the file names the columns."
      >
        <div className="flex flex-col gap-md">
          <div className="flex flex-wrap items-end gap-sm">
            <SelectField
              label="Record type"
              value={typeId}
              onChange={chooseType}
              options={RECORD_IMPORT_TYPES.map((t) => ({ value: t.id, label: t.label }))}
            />
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={() => saveTextFile(`${type.id}-import-template.csv`, templateCsv(type))}
            >
              Download the {type.noun} template
            </button>
          </div>
          <div className="flex flex-col gap-3xs">
            <label htmlFor="record-import-file" className={fieldLabelClass}>
              CSV file
            </label>
            <p id="record-import-file-hint" className={fieldHintClass}>
              Up to {MAX_ROWS} rows. Each row needs an external ID that stays the same each time you import it.
            </p>
            <input
              id="record-import-file"
              type="file"
              accept=".csv,text/csv"
              aria-describedby="record-import-file-hint"
              onChange={chooseFile}
              className={inputClass}
            />
            {parsed ? (
              <p className={rowMetaClass}>
                {parsed.fileName} · {parsed.rows.length} {parsed.rows.length === 1 ? 'row' : 'rows'}
              </p>
            ) : null}
          </div>
        </div>
      </Panel>

      {parsed ? (
        <Panel
          title="Columns"
          description={`Point each ${type.noun} field at a column of the file. A field set to "Not in this file" is not changed.`}
        >
          <div className="flex flex-col gap-md">
            <MappingFields type={type} headers={parsed.headers} mapping={mapping} onChange={changeMapping} />
            <div className="flex flex-wrap gap-xs">
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={preview}
                aria-busy={busy === 'preview' ? 'true' : undefined}
                aria-disabled={busy ? 'true' : undefined}
              >
                {busy === 'preview' ? 'Checking…' : 'Preview import'}
              </button>
            </div>
          </div>
        </Panel>
      ) : null}
      </fieldset>

      {notice ? <div ref={noticeRef} tabIndex={-1} className="admin-operation-result"><Notice tone={notice.tone} message={notice.message} /></div> : null}

      {result ? (
        <Panel
          title={result.dryRun ? 'Preview' : 'Result'}
          description={
            result.dryRun
              ? 'What the import will do to each row. Rows with an error are skipped.'
              : 'What the import did to each row.'
          }
        >
          <div className="flex flex-col gap-md">
            <div className="flex flex-wrap items-center gap-xs">
              {['create', 'update', 'unchanged', 'error'].map((verdict) => (
                <StatusBadge key={verdict} tone={VERDICT_TONES[verdict]}>
                  {result.summary[verdict] ?? 0} {VERDICT_WORDS[verdict]}
                </StatusBadge>
              ))}
            </div>
            <PreviewTable result={result} type={type} />
            {result.dryRun ? (
              writes > 0 ? (
                <div className="flex flex-col gap-xs">
                  <p className="text-admin-sm text-admin-ink-secondary">
                    {type.previewNote}
                  </p>
                  <div>
                    <button
                      type="button"
                      className={primaryButtonClass}
                      onClick={runImport}
                      aria-busy={busy === 'import' ? 'true' : undefined}
                      aria-disabled={busy ? 'true' : undefined}
                    >
                      {busy === 'import'
                        ? 'Importing…'
                        : `Import ${writes} ${writes === 1 ? type.noun : type.plural}${type.asDrafts === false ? '' : ' as drafts'}`}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-admin-sm text-admin-ink-secondary">
                  Nothing to import. Every row is unchanged or has an error.
                </p>
              )
            ) : (
              <p className="text-admin-sm">
                <Link to={LIST_PAGES[type.id]} className={linkButtonClass}>
                  Open {type.label.toLowerCase()}
                </Link>
              </p>
            )}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
