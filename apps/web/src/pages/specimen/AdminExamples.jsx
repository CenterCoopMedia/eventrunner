import { useMemo, useRef, useState } from 'react';
import AdminAccessList from '../../admin/components/AdminAccessList.jsx';
import AdminInvoiceTable from '../../admin/components/AdminInvoiceTable.jsx';
import EmailLogTable, { EmailLogFigure } from '../../admin/components/EmailLogTable.jsx';
import InvoiceDetailsFields from '../../admin/components/InvoiceDetailsFields.jsx';
import MaterialsTable, { DEFAULT_SORT, SORTS, MaterialRowView, MaterialsFilters, filterMaterials } from '../../admin/components/MaterialsTable.jsx';
import PendingChangesNotice from '../../admin/components/PendingChangesNotice.jsx';
import PublishRunRow from '../../admin/components/PublishRunRow.jsx';
import RichTextEditor from '../../admin/components/RichTextEditor.jsx';
import VersionEntry from '../../admin/components/VersionEntry.jsx';
import { AdminEmptyState, AdminLoadingState } from '../../admin/components/adminChrome.jsx';
import { Notice, Panel, SelectField, secondaryButtonClass } from '../../admin/components/formControls.jsx';
import { INVOICE_LIMITS, blankAdjustment, blankInvoiceForm, blankLine, prefillFromOrganization, previewTotals } from '../../admin/invoiceDoc.js';
import { EXAMPLE_ACCOUNTS, EXAMPLE_INVOICES, EXAMPLE_MATERIALS, EXAMPLE_MESSAGES, EXAMPLE_MESSAGE_BODY, EXAMPLE_RUNS, EXAMPLE_SESSIONS, EXAMPLE_TIME, EXAMPLE_VERSIONS } from './adminExampleData.js';

const STATES = ['ready', 'loading', 'empty', 'error', 'busy', 'result'];
const RICH_TEXT = '<p>An example <strong>reporting workshop</strong> with a short introduction.</p>';
const sessionById = new Map(EXAMPLE_SESSIONS.map((session, index) => [session.id, { ...session, index }]));

function Example({ id, title, files, children }) {
  return (
    <section aria-labelledby={`admin-example-${id}`} data-admin-specimen={id} className="flex min-w-0 flex-col gap-md border-t-admin-strong border-admin-rule-strong pt-lg">
      <h2 id={`admin-example-${id}`} className="font-admin-ui text-admin-xl font-bold text-admin-ink">{title}</h2>
      {children}
      <p className="text-admin-xs text-admin-ink-secondary">{files.map((file, index) => <span key={file}>{index ? ' · ' : ''}<code data-specimen-file={file} className="break-all font-admin-data">{file}</code></span>)}</p>
    </section>
  );
}

function StateChoice({ name, value, onChange, choices = STATES }) {
  return <SelectField label={`${name} example state`} value={value} onChange={onChange}
    hint="Review an example state. No record is read or changed."
    options={choices.map((choice) => ({ value: choice, label: choice[0].toUpperCase() + choice.slice(1) }))} />;
}

function Retry({ onRetry, children }) {
  return <div className="flex flex-col items-start gap-xs"><Notice tone="error" message={children} /><button type="button" className={secondaryButtonClass} onClick={onRetry}>Try again</button></div>;
}

function MaterialsExample() {
  const [state, setState] = useState('ready');
  const [materials, setMaterials] = useState(EXAMPLE_MATERIALS);
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [sessionFilter, setSessionFilter] = useState('');
  const [reviewFilter, setReviewFilter] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [result, setResult] = useState(null);
  const shown = filterMaterials(materials, { sessionFilter, reviewFilter, sort, sessionById });
  const files = shown.filter((material) => material.type === 'file');
  const ids = files.filter((material) => selected.has(material.id)).map((material) => material.id);
  const all = files.length > 0 && ids.length === files.length;
  const toggle = (id) => setSelected((previous) => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const changeFilter = (setter) => (value) => { setter(value); setSelected(new Set()); setResult(null); };
  const archive = () => {
    if (state === 'busy') return;
    if (!ids.length) { setResult({ tone: 'caution', message: 'Select at least one file.' }); return; }
    setState('busy');
  };
  let body;
  if (state === 'loading') body = (
    <AdminLoadingState label="Loading materials…" />
  );
  else if (state === 'error') body = (
    <Retry onRetry={() => setState('ready')}>The materials could not be loaded. Try again.</Retry>
  );
  else if (state === 'empty' || !shown.length) body = (
    <AdminEmptyState title="No materials match these filters." action={<button type="button" className={secondaryButtonClass} onClick={() => { setSessionFilter(''); setReviewFilter(''); setState('ready'); }}>Show all materials</button>} />
  );
  else body = (
    <Panel flush><MaterialsTable shown={shown} sort={sort}
              onSort={(column) => setSort((current) => ({ column, direction: current.column === column ? (current.direction === 'ascending' ? 'descending' : 'ascending') : SORTS[column].first }))}
              selectedIds={ids} shownFiles={files} allShownSelected={all} someShownSelected={ids.length > 0 && !all}
              archiveBusy={state === 'busy'} archiveResult={result ?? (state === 'result' ? { tone: 'ok', message: 'The example archive is ready.' } : null)}
              onArchive={archive} onClear={() => setSelected(new Set())} onToggleAll={() => setSelected(all ? new Set() : new Set(files.map((material) => material.id)))}
              renderRow={(material) => <MaterialRowView key={material.id} material={material} sessionTitle={sessionById.get(material.sessionId)?.title} selected={selected.has(material.id)} onToggle={toggle}
                busy={state === 'busy'} downloading={false} onDownload={() => setResult({ tone: 'ok', message: 'The example file is ready.' })}
                onReview={(reviewStatus) => { setSelected(new Set()); setMaterials((rows) => rows.map((row) => row.id === material.id ? { ...row, reviewStatus } : row)); }}
                onRemove={() => { setSelected(new Set()); setMaterials((rows) => rows.filter((row) => row.id !== material.id)); }} />} /></Panel>
  );
  return (
    <Example id="materials" title="Materials table" files={['admin/components/MaterialsTable.jsx']}>
      <StateChoice name="Materials" value={state} onChange={(value) => { setState(value); setResult(null); }} />
      <MaterialsFilters sessionFilter={sessionFilter} reviewFilter={reviewFilter}
        sessionOptions={[{ value: '', label: 'All sessions' }, ...EXAMPLE_SESSIONS.map(({ id, title }) => ({ value: id, label: title }))]}
        changeSessionFilter={changeFilter(setSessionFilter)} changeReviewFilter={changeFilter(setReviewFilter)} />
      {body}
      {state === 'busy' ? <button type="button" className={secondaryButtonClass} onClick={() => setState('result')}>Finish archive example</button> : null}
    </Example>
  );
}

function QueueExample() {
  const [state, setState] = useState('ready');
  const [busyKey, setBusyKey] = useState(null);
  const [notice, setNotice] = useState(null);
  const [failed, setFailed] = useState(true);
  let body;
  if (state === 'loading') body = (
    <AdminLoadingState label="Loading publish runs…" />
  );
  else if (state === 'empty') body = (
    <AdminEmptyState title="No recent publishes" />
  );
  else if (state === 'error') body = (
    <Retry onRetry={() => setState('ready')}>Publish runs could not be loaded. Try again.</Retry>
  );
  else body = (
    <ol aria-label="Example publish runs">
        {EXAMPLE_RUNS.map((source) => {
          const row = source.status === 'failed' && !failed
            ? { ...source, status: 'done', progress: { cmsPages: { published: [...source.request.cmsPages], skipped: [] } } } : source;
          return <PublishRunRow key={row.id} row={row} timeZone="UTC" busyKey={busyKey} notice={row.id === 'example-failed' ? notice : null}
            controlProps={(key, className) => ({ className, 'aria-disabled': busyKey !== null || undefined, 'aria-busy': busyKey === key || undefined,
              onClick: () => { if (busyKey === null) { setNotice(null); setBusyKey(key); } } })} />;
        })}
      </ol>
  );
  return (
    <Example id="queue" title="Publish queue rows" files={['admin/components/PublishRunRow.jsx']}>
      <StateChoice name="Publish queue" value={state} choices={['ready', 'loading', 'empty', 'error']} onChange={(value) => { setState(value); setBusyKey(null); }} />
      {body}
      {state === 'ready' && busyKey ? <div className="flex flex-wrap gap-xs">
        <button type="button" className={secondaryButtonClass} onClick={() => { setBusyKey(null); setFailed(false); setNotice({ tone: 'ok', message: 'The example publish finished.' }); }}>Finish publish example</button>
        <button type="button" className={secondaryButtonClass} onClick={() => { setBusyKey(null); setNotice({ tone: 'error', message: 'The example publish stopped. Try again.' }); }}>Show publish error</button>
      </div> : state === 'ready' ? <button type="button" className={secondaryButtonClass} onClick={() => { setFailed(true); setNotice(null); }}>Reset publish example</button> : null}
    </Example>
  );
}

function FigureExample() {
  return (
    <Example id="figures" title="Email figure sentences" files={['admin/components/EmailLogTable.jsx']}>
      <EmailLogFigure count={25} scanned={25} searched={false} readAt={EXAMPLE_TIME} timeZone="UTC" />
      <EmailLogFigure count={3} scanned={500} searched readAt={EXAMPLE_TIME} timeZone="UTC" />
      <EmailLogFigure count={0} scanned={500} searched readAt={EXAMPLE_TIME} timeZone="UTC" />
    </Example>
  );
}

function EmailExample() {
  const [state, setState] = useState('ready');
  const [openId, setOpenId] = useState('example-message');
  const previewRefs = useRef(new Map());
  const rows = EXAMPLE_MESSAGES;
  const details = Object.fromEntries(rows.map((row) => [row.id, state === 'error' ? { state: 'error', error: new Error('Example preview error') }
    : state === 'loading' || state === 'retrying' ? { state: 'loading', retrying: state === 'retrying' }
      : { state: 'ready', row: { ...EXAMPLE_MESSAGE_BODY, to: row.to, html: state === 'text' ? null : EXAMPLE_MESSAGE_BODY.html, bodyTruncated: state === 'truncated' } }]));
  return (
    <Example id="email" title="Email log and preview" files={['admin/components/EmailLogTable.jsx']}>
      <StateChoice name="Email preview" value={state} choices={['ready', 'loading', 'error', 'retrying', 'private', 'text', 'truncated']}
        onChange={(value) => { setState(value); setOpenId(value === 'private' ? 'example-private' : 'example-message'); }} />
      <EmailLogTable rows={rows} timeZone="UTC" openId={openId} details={details} previewRefs={previewRefs}
        onToggle={(row) => setOpenId((current) => current === row.id ? null : row.id)} onRetry={() => setState('ready')} />
    </Example>
  );
}

function VersionsExample() {
  const [state, setState] = useState('ready');
  const [notice, setNotice] = useState('');
  let body;
  if (state === 'loading') body = (
    <AdminLoadingState label="Loading version history…" />
  );
  else if (state === 'empty') body = (
    <AdminEmptyState title="No published versions yet" description="This record has not been published. A version appears here each time it is published." />
  );
  else if (state === 'error') body = (
    <Retry onRetry={() => setState('ready')}>Version history could not be loaded. Try again.</Retry>
  );
  else body = (
    <Panel flush><ol aria-label="Example versions">{EXAMPLE_VERSIONS.map((entry) => <VersionEntry key={entry.revision} entry={state === 'omitted' ? { ...entry, changeValuesOmitted: true } : entry} current={entry.revision === 3} liveVisible timeZone="UTC">
              {entry.revision !== 3 ? <button type="button" className={secondaryButtonClass} onClick={() => setNotice('This example version is selected. No draft was changed.')}>Review example version {entry.revision}</button> : null}
            </VersionEntry>)}</ol></Panel>
  );
  return (
    <Example id="versions" title="Version history" files={['admin/components/VersionEntry.jsx']}>
      <StateChoice name="Versions" value={state} choices={['ready', 'loading', 'empty', 'error', 'omitted']} onChange={setState} />
      {body}
      {notice ? <Notice message={notice} /> : null}
    </Example>
  );
}

function PendingExample() {
  const [state, setState] = useState('ready');
  return (
    <Example id="pending" title="Pending changes banner" files={['admin/components/PendingChangesNotice.jsx']}>
      <StateChoice name="Pending count" value={state} choices={['ready', 'single', 'error']} onChange={setState} />
      <PendingChangesNotice failed={state === 'error'} total={state === 'single' ? 1 : 3}
        sentence={state === 'single' ? '1 change is saved but not published.' : '3 changes are saved but not published.'} />
    </Example>
  );
}

function AccessExample() {
  const [state, setState] = useState('ready');
  const [notice, setNotice] = useState('');
  let body;
  if (state === 'loading') body = (
    <AdminLoadingState label="Loading admin access…" />
  );
  else if (state === 'empty') body = (
    <AdminEmptyState title="No admin accounts" description="Nobody is listed. Grant access above." />
  );
  else if (state === 'error') body = (
    <Retry onRetry={() => setState('ready')}>The access list could not be loaded. Try again.</Retry>
  );
  else body = (
    <AdminAccessList accounts={EXAMPLE_ACCOUNTS} callerEmail="operator@example.test" busy={state === 'busy'}
              onOpen={(change) => setNotice(`Example request for ${change.email}: ${change.action === 'resend' ? 'Send sign-in instructions' : change.tier === 'none' ? 'Remove access' : `Change to ${change.tier}`}. No access or email changed.`)} />
  );
  return (
    <Example id="access" title="Account, tier and actions" files={['admin/components/AdminAccessList.jsx']}>
      <StateChoice name="Access list" value={state} onChange={setState} />
      {body}
      {notice || state === 'result' ? <Notice message={notice || 'The example access request is complete.'} /> : null}
    </Example>
  );
}

function invoiceForm() {
  return { ...blankInvoiceForm(), billTo: { name: 'Example newsroom', contactName: 'Example contact', email: 'billing@example.test', address: '1 Example Street\nExample City' },
    lines: [{ ...blankLine(), description: 'Workshop support', quantity: '2', unitPrice: '125.00' }],
    adjustments: [{ ...blankAdjustment('discount'), label: 'Example support discount', amount: '10.00' }, { ...blankAdjustment('tax'), label: 'Example tax', amount: '5.00' }], dueDate: '2030-06-01' };
}

function InvoicesExample() {
  const [state, setState] = useState('ready');
  const [form, setForm] = useState(invoiceForm);
  const [prefillStatus, setPrefillStatus] = useState('');
  const preview = useMemo(() => previewTotals(form, 'usd'), [form]);
  const organizations = { loading: false, rows: [{ id: 'example-organization', current: { name: 'Example foundation' } }] };
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));
  const setRows = (field, index, patch) => setForm((current) => ({ ...current, [field]: current[field].map((row, at) => at === index ? { ...row, ...patch } : row) }));
  let body;
  if (state === 'loading') body = (
    <AdminLoadingState label="Loading invoices…" />
  );
  else if (state === 'empty') body = (
    <AdminEmptyState title="No invoices yet" description="Create a draft to prepare an invoice." />
  );
  else if (state === 'error') body = (
    <Retry onRetry={() => setState('ready')}>The invoices could not be loaded. Try again.</Retry>
  );
  else body = (
    <><AdminInvoiceTable rows={EXAMPLE_INVOICES} /><InvoiceDetailsFields form={form} currency="usd" organizations={organizations} prefillStatus={prefillStatus}
              busy={state === 'busy' ? 'example' : null} preview={preview} errorFor={(path) => state === 'invalid' && path === 'billTo.name' && !form.billTo.name ? 'Enter the name to bill.' : null}
              chooseOrganization={(id) => { const next = prefillFromOrganization(form, organizations.rows.find((row) => row.id === id), [], 'usd'); setForm(next.form); setPrefillStatus(next.filled); }}
              set={set} setBillTo={(patch) => setForm((current) => ({ ...current, billTo: { ...current.billTo, ...patch } }))}
              setLine={(index, patch) => setRows('lines', index, patch)} removeLine={(index) => setForm((current) => ({ ...current, lines: current.lines.filter((_, at) => at !== index) }))}
              addLine={() => setForm((current) => current.lines.length >= INVOICE_LIMITS.lines ? current : { ...current, lines: [...current.lines, blankLine()] })}
              setAdjustment={(index, patch) => setRows('adjustments', index, patch)} removeAdjustment={(index) => setForm((current) => ({ ...current, adjustments: current.adjustments.filter((_, at) => at !== index) }))}
              addAdjustment={(kind) => setForm((current) => current.adjustments.length >= INVOICE_LIMITS.adjustments ? current : { ...current, adjustments: [...current.adjustments, blankAdjustment(kind)] })} /></>
  );
  return (
    <Example id="invoices" title="Invoice form and list" files={['admin/components/InvoiceDetailsFields.jsx', 'admin/components/AdminInvoiceTable.jsx']}>
      <StateChoice name="Invoices" value={state} choices={['ready', 'loading', 'empty', 'error', 'busy', 'invalid']}
        onChange={(next) => { setState(next); if (next === 'invalid') setForm((current) => ({ ...current, billTo: { ...current.billTo, name: '' } })); }} />
      {body}
    </Example>
  );
}

function RichTextExample() {
  const [state, setState] = useState('ready');
  const [value, setValue] = useState(RICH_TEXT);
  return (
    <Example id="rich-text" title="Limited rich-text toolbar" files={['admin/components/RichTextEditor.jsx']}>
      <StateChoice name="Rich text" value={state} choices={['ready', 'empty', 'error']} onChange={(next) => { setState(next); setValue(next === 'empty' ? '' : RICH_TEXT); }} />
      <RichTextEditor label="Example introduction" value={value} onChange={setValue}
        error={state === 'error' ? 'Add an introduction before saving.' : null} help="Write a short introduction. Formatting stays within the example." />
    </Example>
  );
}

export default function AdminExamples() {
  return <><MaterialsExample /><QueueExample /><FigureExample /><EmailExample /><VersionsExample /><PendingExample /><AccessExample /><InvoicesExample /><RichTextExample /></>;
}
