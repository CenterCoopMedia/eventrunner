// Session pitch emails (issue #324): the operator's receipt mode and
// wording, and the delivery state and send controls on one pitch.
//
// A decision email goes only after staff preview it and confirm. Saving a
// decision sends nothing. The server refuses an email that was already sent,
// so a second click or a repeated decision cannot send it twice. An email
// whose delivery is unknown (the email service did not answer) is retried
// only after staff confirm that they checked the Email log.
import { useEffect, useRef, useState } from 'react';
import {
  PITCH_NOTICE_TEMPLATE_IDS, PITCH_NOTICE_DEFAULTS, DECISION_TEMPLATE_IDS,
  MAX_NOTICE_SUBJECT_LENGTH, MAX_NOTICE_WORDING_LENGTH, MAX_SUBMITTER_FEEDBACK_LENGTH,
} from 'shared/pitch';
import { StatusBadge } from './adminChrome.jsx';
import { Panel, Notice, SaveStatus, TextField, TextAreaField, SelectField, CheckboxField,
  ServerErrorSummary, primaryButtonClass, secondaryButtonClass } from './formControls.jsx';
import { toMillis } from '../versionHistory.js';

const templateNames = {
  'pitch.receipt': 'Receipt',
  'pitch.accepted': 'Acceptance email',
  'pitch.declined': 'Decline email',
};
const slotNames = { receipt: 'Receipt', accepted: 'Acceptance email', rejected: 'Decline email' };
const stateLabels = { queued: 'Sending', sent: 'Sent', failed: 'Not sent', unknown: 'May have been sent' };
const stateTones = { queued: 'info', sent: 'ok', failed: 'caution', unknown: 'caution' };
const otherDecisionNotes = {
  accepted: 'An acceptance was already sent to this person.',
  rejected: 'A decline was already sent to this person.',
};
// The server treats a queued email as in progress for this long
// (functions/src/sessions/pitchNotices.cjs QUEUED_STALE_MS).
const QUEUED_STALE_MS = 10 * 60 * 1000;

function isSending(record) {
  if (record?.state !== 'queued') return false;
  const queuedAt = toMillis(record.queuedAt);
  return queuedAt === null || Date.now() - queuedAt < QUEUED_STALE_MS;
}
const receiptModes = [
  { value: 'automatic', label: 'Send automatically when a person pitches through this site’s form' },
  { value: 'manual', label: 'Staff send each receipt from the pitch' },
];
const WORDING_HINT = 'Plain text. A blank line starts a new paragraph. You can use {{pitch_title}}, {{event_name}}, {{site_url}} and {{support_email}}. Private review notes are never sent.';

function entriesFrom(settings) {
  return Object.fromEntries(PITCH_NOTICE_TEMPLATE_IDS.map((id) => [id, {
    subject: settings.templates[id].subject,
    wording: settings.templates[id].wording,
  }]));
}

/**
 * Operators choose the receipt mode and edit the wording of each email.
 * `settings` is the live document. A save names the revision it edited. When
 * another operator saves first, the edits stay and a conflict notice offers
 * the current settings, as the review panel does.
 */
export function PitchEmailSettings({ settings, call }) {
  const [baseRevision, setBaseRevision] = useState(settings.revision);
  const [receiptMode, setReceiptMode] = useState(settings.receiptMode);
  const [entries, setEntries] = useState(() => entriesFrom(settings));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const errorRef = useRef(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const edit = (id, field) => (value) => {
    setEntries((previous) => ({ ...previous, [id]: { ...previous[id], [field]: value } }));
    setResult('');
  };
  const conflict = settings.revision !== baseRevision;
  async function save(e) {
    e.preventDefault();
    if (busy || conflict) return;
    setBusy(true); setError(null); setResult('');
    try {
      const response = await call('savePitchNoticeSettings', { expectedRevision: baseRevision, receiptMode, templates: entries });
      setBaseRevision(response.revision);
      setResult('Email settings saved.');
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }
  function loadCurrent() {
    setBaseRevision(settings.revision); setReceiptMode(settings.receiptMode); setEntries(entriesFrom(settings));
    setError(null); setResult('Current settings loaded.');
  }
  return <Panel title="Pitch emails" description="Only operators can change these settings. Imported pitches never get an automatic email.">
    <form onSubmit={save} className="space-y-sm">
      {conflict ? <><Notice tone="caution" message="Another operator saved the email settings. Your unsaved edits remain below. Copy them before you load the current settings." /><button type="button" className={secondaryButtonClass} onClick={loadCurrent} disabled={busy}>Load current settings</button></> : null}
      <ServerErrorSummary error={error} errorRef={errorRef} />
      <fieldset disabled={busy} className="space-y-md">
        <SelectField label="Receipts" value={receiptMode} onChange={setReceiptMode} options={receiptModes} hint="Staff always send acceptance and decline emails from the pitch, after a preview." />
        {PITCH_NOTICE_TEMPLATE_IDS.map((id) => <fieldset key={id} className="space-y-sm border-t-admin-hairline border-admin-rule-hairline pt-sm">
          <legend className="font-semibold">{templateNames[id]}</legend>
          <TextField label={`${templateNames[id]} subject`} value={entries[id].subject} onChange={edit(id, 'subject')} required maxLength={MAX_NOTICE_SUBJECT_LENGTH} />
          <TextAreaField label={`${templateNames[id]} wording`} value={entries[id].wording} onChange={edit(id, 'wording')} required rows={6} maxLength={MAX_NOTICE_WORDING_LENGTH}
            hint={id === 'pitch.receipt' ? WORDING_HINT : `${WORDING_HINT} A note that staff write when they send the email appears after this wording.`} />
          <button type="button" className={secondaryButtonClass} onClick={() => { setEntries((previous) => ({ ...previous, [id]: { ...PITCH_NOTICE_DEFAULTS[id] } })); setResult(''); }}>
            Use the shipped {templateNames[id].toLowerCase()} wording
          </button>
        </fieldset>)}
      </fieldset>
      <button className={primaryButtonClass} disabled={busy || conflict}>{busy ? 'Saving…' : 'Save email settings'}</button>
      {result ? <SaveStatus message={result} /> : null}
    </form>
  </Panel>;
}

function DeliveryState({ slot, record }) {
  const at = toMillis(record.sentAt || record.updatedAt || record.queuedAt);
  return <li className="flex flex-wrap items-center gap-sm text-admin-sm">
    <span className="font-semibold">{slotNames[slot]}</span>
    <StatusBadge tone={stateTones[record.state] || 'neutral'}>{stateLabels[record.state] || record.state}</StatusBadge>
    <span className="text-admin-ink-secondary">
      {record.mode === 'automatic' ? 'Automatic' : `By ${record.queuedBy || 'staff'}`}
      {at !== null ? ` · ${new Date(at).toLocaleString()}` : ''}
      {record.attempt > 1 ? ` · Attempt ${record.attempt}` : ''}
    </span>
    {record.state === 'unknown' || (record.state === 'queued' && !isSending(record))
      ? <span className="basis-full break-words font-semibold">May have been sent. Check the Email log before you retry.</span> : null}
    {(record.state === 'failed' || record.state === 'unknown') && record.error ? <span className="basis-full break-words text-admin-ink-secondary">Reason: {record.error}</span> : null}
  </li>;
}

/** Preview, confirm and send one pitch email. */
function SendEmail({ pitch, kind, slot, disabled, call, onSent }) {
  const [feedback, setFeedback] = useState('');
  const [preview, setPreview] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [checkedLog, setCheckedLog] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const errorRef = useRef(null);
  const previewRef = useRef(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => { if (preview) previewRef.current?.focus(); }, [preview]);
  const request = { id: pitch.id, kind, expectedStatus: pitch.status, expectedRevision: pitch.reviewRevision ?? 0, ...(kind === 'decision' ? { feedback } : {}) };
  async function showPreview() {
    if (busy || disabled) return;
    setBusy(true); setError(null); setConfirmed(false); setCheckedLog(false);
    try { setPreview((await call('sendSessionPitchNotice', { ...request, preview: true })).preview); }
    catch (err) { setError(err); setPreview(null); }
    finally { setBusy(false); }
  }
  async function send(e) {
    e.preventDefault();
    const ready = confirmed && (!preview?.mayHaveBeenSent || checkedLog);
    if (busy || disabled || !preview || !ready) return;
    setBusy(true); setError(null);
    try {
      // The send names the settings revision of this preview, so the server
      // refuses it if an operator changed the wording in between.
      await call('sendSessionPitchNotice', {
        ...request,
        expectedSettingsRevision: preview.settingsRevision,
        ...(preview.mayHaveBeenSent ? { confirmUnknown: true } : {}),
      });
      // The sent record removes this form, so the parent states the result.
      onSent(`${slotNames[slot]} sent to ${preview.to}.`);
      setPreview(null); setFeedback('');
    } catch (err) {
      setError(err);
      // A refused send needs a fresh preview: the wording or the record changed.
      if (err?.code === 'settings-changed' || err?.code === 'delivery-unknown') setPreview(null);
    }
    finally { setConfirmed(false); setCheckedLog(false); setBusy(false); }
  }
  const name = slotNames[slot].toLowerCase();
  return <form onSubmit={send} className="mt-sm space-y-sm">
    <ServerErrorSummary error={error} errorRef={errorRef} title="The email was not sent" />
    <fieldset disabled={busy || disabled} className="space-y-sm">
      {kind === 'decision' ? <TextAreaField label="Note to the submitter (optional)" value={feedback} onChange={(value) => { setFeedback(value); setPreview(null); setConfirmed(false); }} rows={3} maxLength={MAX_SUBMITTER_FEEDBACK_LENGTH} hint="The submitter reads this note. Private review notes are never sent." /> : null}
      <button type="button" className={secondaryButtonClass} onClick={showPreview}>Preview the {name}</button>
      {preview ? <section ref={previewRef} tabIndex={-1} aria-label={`Preview of the ${name}`} className="space-y-xs border-admin-hairline border-admin-rule-hairline p-sm">
        {preview.addressVerified ? null : <Notice tone="caution" message="This address came from an imported CSV. Nobody verified it. Check it before you send." />}
        {otherDecisionNotes[preview.otherDecisionSent] ? <Notice tone="caution" message={otherDecisionNotes[preview.otherDecisionSent]} /> : null}
        {preview.mayHaveBeenSent ? <Notice tone="caution" message="The earlier attempt may have been sent. Check the Email log before you retry." /> : null}
        <p className="break-all text-admin-sm">To: {preview.to}</p>
        <p className="text-admin-sm font-semibold">Subject: {preview.subject}</p>
        <pre className="whitespace-pre-wrap break-words font-admin-ui text-admin-sm">{preview.text}</pre>
      </section> : null}
      {preview?.mayHaveBeenSent ? <CheckboxField label="I checked the Email log. The earlier email was not delivered." checked={checkedLog} onChange={setCheckedLog} /> : null}
      {preview ? <CheckboxField label={`I reviewed this email. Send it to ${preview.to}.`} checked={confirmed} onChange={setConfirmed} /> : null}
    </fieldset>
    {preview ? <button className={primaryButtonClass} disabled={busy || disabled || !confirmed || (preview.mayHaveBeenSent && !checkedLog)}>{busy ? 'Sending…' : `Send the ${name}`}</button> : null}
  </form>;
}

/**
 * Delivery state for one pitch, and the controls to send its receipt or its
 * decision email. `pitch` is the saved review the staff member sees; the
 * server checks its status and revision again before it sends.
 */
export function PitchEmailDelivery({ pitch, notices, disabled, call }) {
  const [result, setResult] = useState('');
  const records = Object.entries(notices || {}).filter(([slot]) => slotNames[slot]);
  const decisionSlot = DECISION_TEMPLATE_IDS[pitch.status] ? pitch.status : null;
  // No retry is offered while an email is still being sent.
  const canSend = (record) => record?.state !== 'sent' && !isSending(record);
  const canSendReceipt = Boolean(pitch.uid) && canSend(notices?.receipt);
  const canSendDecision = decisionSlot && canSend(notices?.[decisionSlot]);
  return <section aria-label="Emails to the submitter" className="space-y-sm border-t-admin-hairline border-admin-rule-hairline pt-md">
    <h3 className="font-semibold">Emails to the submitter</h3>
    {records.length ? <ul className="space-y-xs">{records.map(([slot, record]) => <DeliveryState key={slot} slot={slot} record={record} />)}</ul>
      : <p className="text-admin-sm text-admin-ink-secondary">No email was sent for this pitch.</p>}
    {canSendDecision ? <details>
      <summary className="min-h-admin-control cursor-pointer font-semibold">Prepare the {slotNames[decisionSlot].toLowerCase()}</summary>
      <SendEmail key={`${decisionSlot}-${pitch.reviewRevision ?? 0}`} pitch={pitch} kind="decision" slot={decisionSlot} disabled={disabled} call={call} onSent={setResult} />
    </details> : null}
    {canSendReceipt ? <details>
      <summary className="min-h-admin-control cursor-pointer font-semibold">{notices?.receipt ? 'Retry the receipt' : 'Prepare a receipt'}</summary>
      <SendEmail key={`receipt-${pitch.reviewRevision ?? 0}`} pitch={pitch} kind="receipt" slot="receipt" disabled={disabled} call={call} onSent={setResult} />
    </details> : null}
    {result ? <SaveStatus message={result} /> : null}
  </section>;
}
