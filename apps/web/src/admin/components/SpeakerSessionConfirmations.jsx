import HelpTooltip from './HelpTooltip.jsx';
// The Sessions panel on the speaker editor: the published sessions that
// name this speaker, and the confirmation email for each one (owner
// decision, 2026-11-08).
//
// Staff preview a confirmation, then send it. The server sends one
// confirmation per title, time and room. A new one can go only after the
// session's title, time or room changes. The send carries the preview's
// slot, so the server refuses it when the session changed in between. A
// confirmation whose delivery is unknown is sent again only after staff
// check the Email log.
//
// The panel sits inside the speaker form, so every control is a plain
// button (type="button") and nothing here submits that form.
import { deliveryStateOf } from 'shared/delivery';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { subscribeAdminCollection } from '../adminSource.js';
import { useAdminSessions } from '../useAdminSessions.js';
import { UNKNOWN_DAY_LABEL, resolveDayLabel } from '../sessionDoc.js';
import { toMillis } from '../versionHistory.js';
import { StatusBadge } from './adminChrome.jsx';
import {
  Notice, Panel, SaveStatus, ServerErrorSummary, primaryButtonClass, secondaryButtonClass,
} from './formControls.jsx';

const stateLabels = {
  none: 'Not sent',
  queued: 'Sending',
  sent: 'Confirmation sent',
  failed: 'Not sent',
  uncertain: 'May have been sent',
};
const stateTones = { none: 'neutral', queued: 'info', sent: 'ok', failed: 'caution', uncertain: 'caution' };

/** The published sessions whose live document names this speaker. */
export function speakerSessions(rows, speakerId, days = [], timeZone) {
  const dayLabels = new Map(days.map((day, index) => [day.id, resolveDayLabel(day, index, timeZone)]));
  return (rows ?? [])
    .filter((row) => row?.live && row.live.visible !== false)
    .filter((row) => Array.isArray(row.live.speakerIds) && row.live.speakerIds.includes(speakerId))
    .map((row) => {
      const { live } = row;
      const title = typeof live.title === 'string' && live.title.trim() ? live.title : 'Untitled session';
      const dayLabel = !live.dayId ? 'Unscheduled' : (dayLabels.get(live.dayId) ?? UNKNOWN_DAY_LABEL);
      const start = typeof live.startTime === 'string' ? live.startTime : '';
      const end = typeof live.endTime === 'string' ? live.endTime : '';
      const clock = start && end ? `${start}–${end}` : start;
      return {
        id: row.id,
        title,
        when: [dayLabel, clock].filter(Boolean).join(' · '),
        room: typeof live.location === 'string' && live.location.trim() ? live.location : 'No room',
      };
    });
}

function ConfirmationState({ record }) {
  const state = record ? deliveryStateOf(record.state) : 'none';
  const at = record ? toMillis(record.sentAt || record.updatedAt || record.queuedAt) : null;
  return (
    <p className="flex flex-wrap items-center gap-xs text-admin-sm">
      <StatusBadge tone={stateTones[state] || 'neutral'}>{stateLabels[state] || 'Unknown'}</StatusBadge>
      {at !== null ? <span className="text-admin-ink-secondary">{new Date(at).toLocaleString()}</span> : null}
      {record?.attempt > 1 ? <span className="text-admin-ink-secondary">Attempt {record.attempt}</span> : null}
      {state === 'failed' ? <span className="basis-full text-admin-ink-secondary">The email service refused it. The Email log has the details.</span> : null}
      {state === 'uncertain' ? <span className="basis-full font-semibold">We do not know if it went out. Check the Email log before you send it again.</span> : null}
    </p>
  );
}

/** One session row: its slot, its confirmation state, and Preview then Send. */
function SessionConfirmation({ session, speakerId, record, call, disabled }) {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const errorRef = useRef(null);
  const previewRef = useRef(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => { if (preview) previewRef.current?.focus(); }, [preview]);
  const request = { sessionId: session.id, speakerId };

  async function showPreview() {
    if (busy || disabled) return;
    setBusy(true); setError(null); setResult('');
    try { setPreview((await call('sendSessionConfirmation', { ...request, preview: true })).preview); }
    catch (err) { setError(err); setPreview(null); }
    finally { setBusy(false); }
  }

  async function send({ confirmUnknown = false } = {}) {
    if (busy || disabled || !preview || preview.blocked) return;
    setBusy(true); setError(null);
    try {
      await call('sendSessionConfirmation', {
        ...request,
        expectedNamed: preview.named,
        expectedContent: preview.contentHash,
        ...(confirmUnknown ? { confirmUnknown: true } : {}),
      });
      setResult(`Confirmation sent to ${preview.to}.`);
      setPreview(null);
    } catch (err) {
      setError(err);
      // The session or the record changed: the preview is out of date.
      if (['slot-changed', 'wording-changed', 'delivery-unknown', 'already-sent', 'in-progress'].includes(err?.code)) setPreview(null);
    } finally { setBusy(false); }
  }

  const name = `the confirmation for ${session.title}`;
  return (
    <li className="space-y-xs border-t-admin-hairline border-admin-rule-hairline pt-sm first:border-t-0 first:pt-0">
      <div className="flex items-center gap-2xs"><h3 className="font-semibold [overflow-wrap:anywhere]">{session.title}</h3><HelpTooltip label="this section">Review this speaker’s session and the confirmation email before sending it.</HelpTooltip></div>
      <p className="text-admin-sm text-admin-ink-secondary">{session.when} · {session.room}</p>
      <ConfirmationState record={record} />
      <ServerErrorSummary error={error} errorRef={errorRef} title="The confirmation was not sent" />
      <button type="button" className={secondaryButtonClass} onClick={showPreview} disabled={busy || disabled} aria-label={`Preview confirmation: ${session.title}`}>
        {busy && !preview ? 'Loading preview…' : 'Preview confirmation'}
      </button>
      {preview ? (
        <section ref={previewRef} tabIndex={-1} aria-label={`Preview of ${name}`} className="space-y-xs border-admin-hairline border-admin-rule-hairline p-sm">
          {preview.changedSinceLastSend ? <Notice tone="caution" message="The title, time or room changed since the last confirmation. This one gives the speaker the new details." /> : null}
          {preview.blocked?.code === 'already-sent' ? <Notice tone="ok" message="Confirmation sent. A new one can go after the title, time or room changes." /> : null}
          {preview.blocked && preview.blocked.code !== 'already-sent' ? <Notice tone="info" message={preview.blocked.message} /> : null}
          {preview.mayHaveBeenSent ? <Notice tone="caution" message="The last attempt may have been sent. Open the Email log and check before you send it again." /> : null}
          <p className="break-all text-admin-sm">To: {preview.to}</p>
          <p className="text-admin-sm font-semibold">Subject: {preview.subject}</p>
          <pre className="whitespace-pre-wrap break-words font-admin-ui text-admin-sm">{preview.text}</pre>
        </section>
      ) : null}
      {preview && preview.blocked?.code === 'already-sent' ? (
        <button type="button" className={primaryButtonClass} disabled>Confirmation sent</button>
      ) : null}
      {preview && !preview.blocked && !preview.mayHaveBeenSent ? (
        <button type="button" className={primaryButtonClass} onClick={() => send()} disabled={busy || disabled}>
          {busy ? 'Sending…' : 'Send confirmation'}
        </button>
      ) : null}
      {preview && !preview.blocked && preview.mayHaveBeenSent ? (
        <button type="button" className={primaryButtonClass} onClick={() => send({ confirmUnknown: true })} disabled={busy || disabled}>
          {busy ? 'Sending…' : 'I checked the Email log, send again'}
        </button>
      ) : null}
      {result ? <SaveStatus message={result} /> : null}
    </li>
  );
}

/**
 * @param {{ speakerId: string, call: Function, disabled?: boolean }} props
 */
export default function SpeakerSessionConfirmations({ speakerId, call, disabled = false }) {
  const { eventConfig } = useEventConfig();
  const { rows, loading, error: sessionsError } = useAdminSessions();
  const [records, setRecords] = useState(null);
  const [recordsError, setRecordsError] = useState(null);
  useEffect(() => subscribeAdminCollection(
    'session_confirmations',
    (docs) => { setRecords(docs); setRecordsError(null); },
    setRecordsError,
  ), []);

  const sessions = useMemo(
    () => speakerSessions(rows, speakerId, eventConfig?.days ?? [], eventConfig?.timezone),
    [rows, speakerId, eventConfig?.days, eventConfig?.timezone],
  );
  const recordFor = useMemo(() => {
    const map = new Map();
    for (const record of records ?? []) {
      if (record?.speakerId === speakerId && typeof record.sessionId === 'string') map.set(record.sessionId, record);
    }
    return map;
  }, [records, speakerId]);

  return (
    <Panel help="Review the sessions linked to this speaker and their confirmations." title="Sessions" description="Published sessions that name this speaker. Send each one a confirmation after you preview it.">
      {sessionsError || recordsError ? <Notice tone="caution" message="Cannot load the sessions or their confirmations. Reconnecting." /> : null}
      {loading ? <p className="text-admin-sm text-admin-ink-secondary">Loading sessions…</p> : null}
      {!loading && sessions.length === 0 ? (
        <p className="text-admin-sm text-admin-ink-secondary">This speaker is not on a published session yet.</p>
      ) : null}
      {sessions.length ? (
        <ul className="space-y-sm">
          {sessions.map((session) => (
            <SessionConfirmation
              key={session.id}
              session={session}
              speakerId={speakerId}
              record={recordFor.get(session.id) ?? null}
              call={call}
              disabled={disabled}
            />
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}
