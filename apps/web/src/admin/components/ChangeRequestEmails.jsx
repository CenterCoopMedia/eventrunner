// Change request emails and outcomes (issue #330) on the admin page.
//
//   EmailSettingsSummary      one sentence every staff member reads: which
//                             requester emails are on.
//   ChangeRequestEmailSettings the operator's control over both emails.
//   NoticeDelivery            the delivery record of each email a request
//                             has, with a retry where one is allowed.
//   OutcomeDetails            the reply and the result link staff write for
//                             the requester of a done or declined request.
//
// The server decides everything here again (functions/src/admin/
// changeRequestNotices.cjs and changeRequests.cjs): what may be retried,
// which link is on this site, and who may save the settings. This file only
// offers what the server would accept, and states its answer.
import { useEffect, useRef, useState } from 'react';
import { StatusBadge } from './adminChrome.jsx';
import {
  CheckboxField,
  Notice,
  SaveStatus,
  SelectField,
  ServerErrorSummary,
  TextAreaField,
  TextField,
  linkButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from './formControls.jsx';

/** The server's limit (functions/src/admin/changeRequests.cjs). */
const MAX_REPLY_LENGTH = 1000;
// The server treats a queued email as in progress for this long
// (changeRequestNotices.cjs QUEUED_STALE_MS).
const QUEUED_STALE_MS = 10 * 60 * 1000;

const MODES = ['off', 'automatic'];
const SLOT_NAMES = Object.freeze({ received: 'Acknowledgement', done: 'Done email', declined: 'Decline email' });
const STATE_LABELS = Object.freeze({
  queued: 'Sending', sent: 'Sent', failed: 'Not sent', unknown: 'May have been sent', suppressed: 'Not sent: unsubscribed',
});
const STATE_TONES = Object.freeze({ queued: 'info', sent: 'ok', failed: 'caution', unknown: 'caution', suppressed: 'neutral' });

function toMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The settings document as the page reads it; anything unknown is off. */
export function readEmailSettings(docs) {
  const stored = Array.isArray(docs) ? docs.find((doc) => doc.id === 'notices') : null;
  const mode = (value) => (MODES.includes(value) ? value : 'off');
  return {
    acknowledgement: mode(stored?.acknowledgement),
    outcome: mode(stored?.outcome),
    revision: Number.isSafeInteger(stored?.revision) ? stored.revision : 0,
  };
}

export function EmailSettingsSummary({ settings }) {
  const word = (mode) => (mode === 'automatic' ? 'on' : 'off');
  return (
    <p className="text-admin-sm text-admin-ink-secondary">
      {`The acknowledgement email is ${word(settings.acknowledgement)}. The outcome email is ${word(settings.outcome)}.`}
    </p>
  );
}

const ACKNOWLEDGEMENT_OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: 'automatic', label: 'Send when a request arrives' },
];
const OUTCOME_OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: 'automatic', label: 'Send when staff mark a request done or declined' },
];

/**
 * The operator's control. `settings` is the live document. A save names the
 * revision it edited; when another operator saves first, the edits stay and
 * the save is refused until the current settings are loaded.
 */
export function ChangeRequestEmailSettings({ settings, call }) {
  const [open, setOpen] = useState(false);
  const [baseRevision, setBaseRevision] = useState(settings.revision);
  const [acknowledgement, setAcknowledgement] = useState(settings.acknowledgement);
  const [outcome, setOutcome] = useState(settings.outcome);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const errorRef = useRef(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const conflict = settings.revision !== baseRevision;

  async function save(event) {
    event.preventDefault();
    if (busy || conflict) return;
    setBusy(true);
    setError(null);
    setResult('');
    try {
      const saved = await call('saveChangeRequestNoticeSettings', { acknowledgement, outcome, expectedRevision: baseRevision });
      setBaseRevision(saved.revision);
      setResult('Email settings saved.');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  function loadCurrent() {
    setBaseRevision(settings.revision);
    setAcknowledgement(settings.acknowledgement);
    setOutcome(settings.outcome);
    setError(null);
    setResult('Current settings loaded.');
  }

  return (
    <div>
      <button type="button" className={linkButtonClass} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        Manage requester emails
      </button>
      {open ? (
        <form onSubmit={save} className="mt-sm flex flex-col gap-sm">
          <p className="text-admin-sm text-admin-ink-secondary">
            Only operators can change these settings. The emails have fixed wording. They never quote the request or a reply. They link the requester to their own change requests page.
          </p>
          {conflict ? (
            <>
              <Notice tone="caution" message="Another operator saved the email settings. Load the current settings, then make your change again." />
              <div>
                <button type="button" className={secondaryButtonClass} onClick={loadCurrent} disabled={busy}>Load current settings</button>
              </div>
            </>
          ) : null}
          <ServerErrorSummary error={error} errorRef={errorRef} title="The email settings were not saved" />
          <SelectField label="Acknowledgement email" value={acknowledgement} onChange={(value) => { setAcknowledgement(value); setResult(''); }} options={ACKNOWLEDGEMENT_OPTIONS} />
          <SelectField
            label="Outcome email"
            value={outcome}
            onChange={(value) => { setOutcome(value); setResult(''); }}
            options={OUTCOME_OPTIONS}
            hint="One email for each outcome. Marking a request done again sends nothing more."
          />
          <div className="flex flex-wrap items-center gap-sm">
            <button type="submit" className={primaryButtonClass} disabled={busy || conflict} aria-busy={busy || undefined}>
              {busy ? 'Saving…' : 'Save email settings'}
            </button>
            {result ? <SaveStatus message={result} /> : null}
          </div>
        </form>
      ) : null}
    </div>
  );
}

/** Whether the server would treat this record as possibly delivered. */
function mayHaveBeenSent(record, nowMs) {
  if (record.state === 'unknown') return true;
  if (record.state !== 'queued') return false;
  const queuedAt = toMillis(record.queuedAt);
  return queuedAt !== null && nowMs - queuedAt >= QUEUED_STALE_MS;
}

/** Whether the server would accept a retry of this record now. */
function retryable(slot, record, row, settings, nowMs) {
  const setting = slot === 'received' ? settings.acknowledgement : settings.outcome;
  if (setting !== 'automatic') return false;
  const stillTrue = slot === 'received' ? !['done', 'declined'].includes(row.status) : row.status === slot;
  if (!stillTrue) return false;
  return record.state === 'failed' || record.state === 'suppressed' || mayHaveBeenSent(record, nowMs);
}

function DeliveryLine({ row, slot, record, settings, call }) {
  const [checkedLog, setCheckedLog] = useState(false);
  // A queued email turns stale while the page is open. Draw the line again
  // at that moment, so its retry appears without a reload (review finding 3
  // on #539). The timer goes with a new record or the line.
  const [, setTick] = useState(0);
  const queuedAt = record.state === 'queued' ? toMillis(record.queuedAt) : null;
  useEffect(() => {
    if (queuedAt === null) return undefined;
    const wait = queuedAt + QUEUED_STALE_MS - Date.now();
    if (wait < 0) return undefined;
    const timer = window.setTimeout(() => setTick((value) => value + 1), wait + 1);
    return () => window.clearTimeout(timer);
  }, [queuedAt]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const nowMs = Date.now();
  const unsure = mayHaveBeenSent(record, nowMs);
  const canRetry = retryable(slot, record, row, settings, nowMs);
  const at = toMillis(record.sentAt || record.updatedAt || record.queuedAt);
  const name = SLOT_NAMES[slot].toLowerCase();

  async function retry() {
    if (busy || (unsure && !checkedLog)) return;
    setBusy(true);
    setResult('');
    setError('');
    try {
      const answer = await call('retryChangeRequestNotice', { id: row.id, slot, ...(unsure ? { confirmUnknown: true } : {}) });
      setResult(answer?.state === 'sent' ? 'Email sent.' : 'The email was not sent. Its new state is on this line.');
    } catch (err) {
      setError(`The email was not sent. ${err.message}`);
    } finally {
      setBusy(false);
      setCheckedLog(false);
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-xs text-admin-sm">
      <span className="font-semibold">{SLOT_NAMES[slot]}</span>
      <StatusBadge tone={STATE_TONES[record.state] || 'neutral'}>{STATE_LABELS[record.state] || record.state}</StatusBadge>
      <span className="text-admin-ink-secondary">
        {at !== null ? new Date(at).toLocaleString() : ''}
        {record.attempt > 1 ? ` · Attempt ${record.attempt}` : ''}
      </span>
      {record.state !== 'sent' && record.error ? (
        <span className="basis-full break-words text-admin-ink-secondary">Reason: {record.error}</span>
      ) : null}
      {canRetry ? (
        <div className="flex basis-full flex-wrap items-center gap-xs">
          {unsure ? (
            <CheckboxField label="I checked the Email log. The earlier email was not delivered." checked={checkedLog} onChange={setCheckedLog} />
          ) : null}
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={retry}
            disabled={busy || (unsure && !checkedLog)}
            aria-busy={busy || undefined}
          >
            {busy ? 'Sending…' : `Retry the ${name}`}
          </button>
        </div>
      ) : null}
      {result ? <SaveStatus message={result} /> : null}
      {error ? <Notice tone="error" message={error} /> : null}
    </li>
  );
}

/** The delivery of each email this request has, in slot order. */
export function NoticeDelivery({ row, settings, call }) {
  const records = Object.keys(SLOT_NAMES)
    .filter((slot) => row.notices?.[slot] && typeof row.notices[slot] === 'object')
    .map((slot) => [slot, row.notices[slot]]);
  if (records.length === 0) return null;
  return (
    <ul aria-label="Emails to the requester" className="mt-2xs flex flex-col gap-3xs">
      {records.map(([slot, record]) => (
        <DeliveryLine key={slot} row={row} slot={slot} record={record} settings={settings} call={call} />
      ))}
    </ul>
  );
}

/**
 * The reply, and for a done request the result link, that the requester
 * reads on their own page. A new link needs the staff member to confirm
 * they opened it and saw the change; the server checks it is on this site.
 */
export function OutcomeDetails({ row, call }) {
  const done = row.status === 'done';
  const saved = row.outcome?.status === row.status ? row.outcome : null;
  // The outcome this form loaded. A save names it, and the server refuses
  // the save when the request's outcome changed since (review finding 5 on
  // #539). It follows the id the server answers after this form's own save.
  const [loadedOutcomeId, setLoadedOutcomeId] = useState(saved?.id ?? null);
  const [open, setOpen] = useState(false);
  const [reply, setReply] = useState(saved?.reply ?? '');
  const [link, setLink] = useState(saved?.resultUrl ?? '');
  const [checked, setChecked] = useState(false);
  const [checkError, setCheckError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState(null);
  const errorRef = useRef(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  const trimmedLink = link.trim();
  const needsCheck = done && trimmedLink !== '' && trimmedLink !== (saved?.resultUrl ?? '');
  const label = done ? 'Reply and result link' : 'Reply';

  async function save(event) {
    event.preventDefault();
    if (busy) return;
    setResult('');
    setError(null);
    if (needsCheck && !checked) {
      setCheckError('Open the link and confirm that it shows the change.');
      return;
    }
    setCheckError(null);
    setBusy(true);
    try {
      const answer = await call('saveChangeRequestOutcome', {
        id: row.id,
        expectedStatus: row.status,
        expectedOutcomeId: loadedOutcomeId,
        reply: reply.trim() || null,
        resultUrl: done && trimmedLink ? trimmedLink : null,
        ...(needsCheck ? { resultChecked: true } : {}),
      });
      if (typeof answer?.outcomeId === 'string') setLoadedOutcomeId(answer.outcomeId);
      setResult(done ? 'Reply and link saved.' : 'Reply saved.');
      setChecked(false);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2xs">
      <button type="button" className={linkButtonClass} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {label}
      </button>
      {open ? (
        <form onSubmit={save} className="mt-xs flex flex-col gap-sm" noValidate>
          <ServerErrorSummary error={error} errorRef={errorRef} title="This was not saved" />
          <TextAreaField
            label="Reply to the requester (optional)"
            value={reply}
            onChange={(value) => { setReply(value); setResult(''); }}
            rows={3}
            maxLength={MAX_REPLY_LENGTH}
            hint="The requester reads this on their change requests page. It is not emailed."
          />
          {done ? (
            <>
              <TextField
                label="Result link (optional)"
                value={link}
                onChange={(value) => { setLink(value); setChecked(false); setResult(''); }}
                inputMode="url"
                hint="A page on this site that shows the change."
              />
              {needsCheck ? (
                <CheckboxField
                  label="I opened this link and it shows the change."
                  checked={checked}
                  onChange={(value) => { setChecked(value); if (value) setCheckError(null); }}
                />
              ) : null}
              {checkError ? <Notice tone="error" message={checkError} /> : null}
            </>
          ) : null}
          <div className="flex flex-wrap items-center gap-sm">
            <button type="submit" className={secondaryButtonClass} aria-busy={busy || undefined}>
              {busy ? 'Saving…' : done ? 'Save the reply and link' : 'Save the reply'}
            </button>
            {result ? <SaveStatus message={result} /> : null}
          </div>
        </form>
      ) : null}
    </div>
  );
}
