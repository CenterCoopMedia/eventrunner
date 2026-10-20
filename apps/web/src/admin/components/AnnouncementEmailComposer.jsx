// Announcement email (issues #202, #203, #490, #496, #497): write, preview,
// test, confirm, send, saved messages, and the send history, on the
// Announcements page.
//
// THE FLOW. Staff write a subject, a message, and an optional link, and
// pick an audience. "Preview email" asks the server to resolve the audience
// and render the email; nothing is stored and nothing is sent. The preview
// names the recipient count, the sender, and where the unsubscribe link
// goes. "Send a test to me" mails one copy to the signed-in address.
// "Send to N recipients" opens a confirmation that repeats the count; only
// its own button sends. Any edit after the preview drops the preview, so a
// confirmation always matches what was shown. The server checks that too
// (functions/src/announcements/sends.cjs): its receipt binds the send to
// the previewed audience and content.
//
// SENDING IN CHUNKS. The server sends 200 recipients per call. This
// component calls again until the send record says it is done, and shows
// the progress in a status line. If the page closes part way, the send
// stays in the history as "Sending" with a "Continue sending" control;
// the send-once keys mean a continued send never mails anyone twice.
//
// RETRY. A send whose provider failed for a time (an outage or a rate
// limit) keeps those addresses. "Retry N failed addresses" loads the
// message and limits the next preview and send to them (`retryOf`). The
// server allows one retry per send, so the history offers it once.
//
// THE HISTORY (issue #497) is a summary: counts, the audience and the
// sender, never a recipient address or the message. It pages 20 at a time,
// newest first. "Show details" reads one send's frozen content and failed
// addresses from getAnnouncementSend, which writes an admin_logs row for
// the read; "Use this message" and a retry read the content the same way.
// The details link to that send's recipient rows in the email log. A send
// recorded before those rows carried its id has no such link; the details
// say its rows are in the email log under the source Announcement.
//
// SAVED MESSAGES (issue #496) live in AnnouncementSavedMessages. A load
// replaces the subject, message and link, keeps the audience, and drops
// any preview. A draft counts as edited when its content differs from the
// last content loaded or saved.
//
// THE PREVIEW renders the server's HTML only through buildPreviewDoc in an
// <iframe sandbox="">, as the email log does, with the plain text beside it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { zoneLabel } from '../../lib/eventTime.js';
import { useAdminApi } from '../adminApi.js';
import { buildPreviewDoc } from '../emailPreview.js';
import {
  Notice,
  Panel,
  SelectField,
  ServerErrorSummary,
  TextAreaField,
  TextField,
  linkButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from './formControls.jsx';
import { AdminLoadingState, StatusBadge } from './adminChrome.jsx';
import AnnouncementSavedMessages from './AnnouncementSavedMessages.jsx';

const EMPTY_DRAFT = { audience: '', subject: '', message: '', linkUrl: '', linkLabel: '' };
/** A safety bound on the continue loop: far above 5,000 / 200 calls. */
const MAX_CALLS = 60;
const BUSY_WAIT_MS = 3000;

const plural = (n, one, many) => `${Number(n).toLocaleString('en-US')} ${n === 1 ? one : many}`;
const recipients = (n) => plural(n, 'recipient', 'recipients');

const STATUS_WORDS = Object.freeze({
  sent: { label: 'Sent', tone: 'ok' },
  sending: { label: 'Sending', tone: 'caution' },
  // A scheduled attendee reminder that will send no more: its reminder day
  // ended, or staff approved new wording (functions/src/reminders).
  stopped: { label: 'Stopped', tone: 'caution' },
});

/** "Oct 19, 2026, 2:05 PM EDT" on the event clock, or the reader's own. */
function formatWhen(ms, timeZone) {
  if (!Number.isFinite(ms)) return null;
  const instant = new Date(ms);
  const options = { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  let text;
  let zone = timeZone;
  try {
    text = new Intl.DateTimeFormat('en-US', { timeZone, ...options }).format(instant);
  } catch {
    text = new Intl.DateTimeFormat('en-US', options).format(instant);
    zone = undefined;
  }
  const label = zoneLabel(zone, instant);
  return label ? `${text} ${label}` : text;
}

/** The counts of one send as sentences, omitting zeros after the first. */
export function countsSentence(send) {
  const { counts = {}, total = 0, processed = 0 } = send;
  const parts = [`Sent to ${plural(counts.sent ?? 0, 'recipient', 'recipients')} of ${plural(total, 'address', 'addresses')}.`];
  if (counts.failed) parts.push(`${plural(counts.failed, 'message', 'messages')} failed.`);
  if (counts.uncertain) parts.push(`${plural(counts.uncertain, 'message has', 'messages have')} an unknown result.`);
  if (counts.skipped) parts.push(`${plural(counts.skipped, 'recipient was', 'recipients were')} already handled by an earlier call.`);
  if (counts.suppressed) parts.push(`${plural(counts.suppressed, 'address', 'addresses')} unsubscribed during the send.`);
  if (send.status === 'sending') parts.push(`${plural(Math.max(0, total - processed), 'address is', 'addresses are')} still to send.`);
  if (send.status === 'stopped') parts.push(`${plural(Math.max(0, total - processed), 'address was', 'addresses were')} not sent.`);
  return parts.join(' ');
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const CONTENT_FIELDS = Object.freeze(['subject', 'message', 'linkUrl', 'linkLabel']);
const contentKey = (draft) => JSON.stringify(CONTENT_FIELDS.map((field) => draft[field]));
const hasContent = (draft) => CONTENT_FIELDS.some((field) => draft[field].trim() !== '');

function draftBody(draft) {
  return {
    subject: draft.subject,
    message: draft.message,
    ...(draft.linkUrl.trim() || draft.linkLabel.trim() ? { linkUrl: draft.linkUrl, linkLabel: draft.linkLabel } : {}),
  };
}

function PreviewFrame({ html, text }) {
  const srcDoc = useMemo(() => (html ? buildPreviewDoc(html) : null), [html]);
  return (
    <div className="flex flex-col gap-xs">
      {srcDoc ? (
        <>
          <iframe
            sandbox=""
            srcDoc={srcDoc}
            referrerPolicy="no-referrer"
            title="Email preview"
            className="block h-[28rem] w-full rounded-admin border-admin-hairline border-admin-rule-hairline [color-scheme:light]"
          />
          <p className="text-admin-xs text-admin-ink-secondary">Links and remote images are turned off in this preview.</p>
        </>
      ) : (
        <p className="text-admin-sm text-admin-ink">The HTML version cannot be shown safely, so the plain text version is shown.</p>
      )}
      <details open={!srcDoc} className="text-admin-sm">
        <summary className="admin-target cursor-pointer font-semibold text-admin-ink">Plain text version</summary>
        <pre className="mt-2xs max-h-[24rem] overflow-auto whitespace-pre-wrap break-words font-admin-data text-admin-sm text-admin-ink-data">
          {text}
        </pre>
      </details>
    </div>
  );
}

/** How many failures the record kept, and how many there were in all. */
function failureCounts(send) {
  const shown = send.failures.length;
  const all = (send.counts?.failed ?? 0) + (send.counts?.uncertain ?? 0);
  return { shown, all, cut: all > shown };
}

/** One send's frozen content and failed addresses, from getAnnouncementSend. */
function SendDetail({ send, state, regionId }) {
  let body;
  if (!state || state.status === 'loading') {
    body = <AdminLoadingState label="Loading the send…" />;
  } else if (state.status === 'error') {
    body = <Notice tone="error" message={state.error.message} />;
  } else {
    const detail = state.send;
    const failures = failureCounts(detail);
    body = (
      <>
        <p className="max-w-[65ch] text-admin-sm text-admin-ink">
          This is the message as the send started it, with a test unsubscribe link in place of each recipient&apos;s own link. It is not a copy of what each person received.
        </p>
        {send.recipientRowsLinked ? (
          <p className="text-admin-sm">
            <Link
              to={`/admin/email-log?send=${encodeURIComponent(send.id)}`}
              className="admin-target font-semibold text-admin-ink underline underline-offset-2"
            >
              Open the recipient messages in the email log
            </Link>
          </p>
        ) : (
          <p className="text-admin-sm text-admin-ink">
            This send is older than the email log filter for one send. Its messages are in the email log under the source Announcement.
          </p>
        )}
        <dl className="grid grid-cols-[max-content_1fr] gap-x-sm gap-y-3xs text-admin-sm">
          <dt className="font-semibold text-admin-ink">Subject</dt>
          <dd className="text-admin-ink">{detail.renderedSubject}</dd>
        </dl>
        <PreviewFrame html={detail.html} text={detail.text} />
        {detail.failures.length > 0 ? (
          <details className="text-admin-sm">
            <summary className="admin-target cursor-pointer font-semibold text-admin-ink">
              {failures.cut
                ? `Failed addresses (first ${failures.shown} of ${failures.all.toLocaleString('en-US')})`
                : `Failed addresses (${failures.shown})`}
            </summary>
            {failures.cut ? (
              <p className="mt-2xs text-admin-ink-secondary">
                {`This list keeps the first ${failures.shown} failures. The email log has every recipient message of this send.`}
              </p>
            ) : null}
            <ul className="mt-2xs flex flex-col gap-3xs">
              {detail.failures.map((failure, index) => (
                <li key={`${failure.email}-${index}`} className="break-words">
                  <span className="font-admin-data text-admin-ink-data">{failure.email}</span>
                  {`: ${failure.error}`}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </>
    );
  }
  return (
    <section id={regionId} aria-label={`${send.subject}: details`} className="mt-xs flex flex-col gap-xs">
      {body}
    </section>
  );
}

function SendHistory({
  sends, timeZone, onReuse, onRetry, onContinue, continuingId, openId, details, onToggle, rowRefs,
}) {
  if (sends.length === 0) {
    return <p className="text-admin-sm text-admin-ink-secondary">No announcement email has been sent yet.</p>;
  }
  return (
    <ul className="flex flex-col">
      {sends.map((send) => {
        const word = STATUS_WORDS[send.status] ?? { label: send.status, tone: 'neutral' };
        const when = formatWhen(send.createdAt, timeZone);
        const open = openId === send.id;
        const regionId = `announcement-send-${send.id}`;
        return (
          <li
            key={send.id}
            ref={(node) => { if (node) rowRefs.current.set(send.id, node); else rowRefs.current.delete(send.id); }}
            tabIndex={-1}
            className="flex flex-col gap-3xs border-b-admin-hairline border-admin-rule-hairline py-sm last:border-b-0 focus:outline-none"
          >
            <div className="flex flex-wrap items-center gap-x-sm gap-y-2xs">
              <StatusBadge tone={word.tone}>{word.label}</StatusBadge>
              <span className="font-semibold text-admin-ink">{send.subject}</span>
            </div>
            <p className="font-admin-data text-admin-xs text-admin-ink-data">
              {send.audienceLabel}
              {when ? ` · ${when}` : ''}
              {send.scheduled ? ' · Scheduled attendee reminder' : ''}
              {send.createdBy ? ` · ${send.createdBy}` : ''}
            </p>
            <p className="text-admin-sm text-admin-ink">{countsSentence(send)}</p>
            {send.scheduled && send.status === 'sending' ? (
              <p className="text-admin-sm text-admin-ink-secondary">
                The schedule sends the rest in its next hourly run. It does not send in quiet hours or after this reminder day.
              </p>
            ) : null}
            {send.auditGaps > 0 ? (
              <p className="text-admin-sm text-admin-state-caution">
                {`The email log could not record ${plural(send.auditGaps, 'message', 'messages')} of this send. The counts come from the email provider, and nobody gets a second copy.`}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-xs">
              <button
                type="button"
                className={linkButtonClass}
                aria-expanded={open ? 'true' : 'false'}
                aria-controls={open ? regionId : undefined}
                onClick={() => onToggle(send)}
              >
                {open ? 'Hide details' : 'Show details'}
              </button>
              <button type="button" className={linkButtonClass} onClick={() => onReuse(send)}>
                Use this message
              </button>
              {send.status === 'sent' && send.retryCount > 0 && !send.retriedBy ? (
                <button type="button" className={linkButtonClass} onClick={() => onRetry(send)}>
                  {`Retry ${plural(send.retryCount, 'failed address', 'failed addresses')}`}
                </button>
              ) : null}
              {send.status === 'sending' && !send.scheduled ? (
                <button
                  type="button"
                  className={linkButtonClass}
                  aria-disabled={continuingId !== null || send.busy ? 'true' : undefined}
                  onClick={() => { if (continuingId === null && !send.busy) onContinue(send); }}
                >
                  {continuingId === send.id ? 'Sending…' : 'Continue sending'}
                </button>
              ) : null}
            </div>
            {open ? <SendDetail send={send} state={details[send.id]} regionId={regionId} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

export default function AnnouncementEmailComposer() {
  const call = useAdminApi();
  const { showToast } = useToast();
  const { eventConfig } = useEventConfig();
  const timeZone = typeof eventConfig?.timezone === 'string' && eventConfig.timezone ? eventConfig.timezone : undefined;

  const [history, setHistory] = useState(null); // { sends, nextCursor, audiences, channel }
  const [historyError, setHistoryError] = useState(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [preview, setPreview] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(null); // 'preview' | 'test' | 'send' | null
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [continuingId, setContinuingId] = useState(null);
  const [retry, setRetry] = useState(null); // { id, count, subject } of the send to retry
  const [restoreEmail, setRestoreEmail] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [focusSendId, setFocusSendId] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [details, setDetails] = useState({}); // id -> { status, send?, error? }
  // The saved message the draft came from, and the content it had then.
  const [loaded, setLoaded] = useState(null); // { id, name }
  const [baseline, setBaseline] = useState(() => contentKey(EMPTY_DRAFT));

  const previewHeadingRef = useRef(null);
  const confirmHeadingRef = useRef(null);
  const resultRef = useRef(null);
  const errorRef = useRef(null);
  const sendButtonRef = useRef(null);
  const subjectRef = useRef(null);
  const rowRefs = useRef(new Map());
  const detailsRef = useRef({});

  const loadHistory = useCallback(async () => {
    try {
      const response = await call('listAnnouncementSends', {});
      setHistory({
        sends: Array.isArray(response.sends) ? response.sends : [],
        nextCursor: response.nextCursor ?? null,
        audiences: Array.isArray(response.audiences) ? response.audiences : [],
        channel: response.channel ?? null,
      });
      setHistoryError(null);
      // A send in progress changes its failures: read details again.
      detailsRef.current = {};
      setDetails({});
      setOpenId(null);
    } catch (err) {
      setHistoryError(err);
    }
  }, [call]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // The first audience the server lists is the default. It is worked out
  // while rendering, not stored by an effect, so the select, its hint and
  // the preview request agree from the first render that has the list.
  const audiences = history?.audiences ?? [];
  const selectedAudience = draft.audience || audiences[0]?.id || '';

  useEffect(() => { if (preview) previewHeadingRef.current?.focus(); }, [preview]);
  useEffect(() => { if (confirming) confirmHeadingRef.current?.focus(); }, [confirming]);
  useEffect(() => { if (result) resultRef.current?.focus(); }, [result]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => {
    if (!focusSendId) return;
    rowRefs.current.get(focusSendId)?.focus();
    setFocusSendId(null);
  }, [focusSendId, history]);

  // With content loaded or saved, any difference from it is an edit, an
  // emptied form included. With none, only typed content is.
  const dirty = baseline === contentKey(EMPTY_DRAFT) ? hasContent(draft) : contentKey(draft) !== baseline;

  /** The next page of the history, after the last send shown. */
  async function loadOlder() {
    if (loadingOlder || !history?.nextCursor) return;
    setLoadingOlder(true);
    try {
      const response = await call('listAnnouncementSends', { cursor: history.nextCursor });
      const more = Array.isArray(response.sends) ? response.sends : [];
      setHistory((current) => {
        const seen = new Set(current.sends.map((send) => send.id));
        return {
          ...current,
          sends: [...current.sends, ...more.filter((send) => !seen.has(send.id))],
          nextCursor: response.nextCursor ?? null,
        };
      });
      if (more[0]) setFocusSendId(more[0].id);
    } catch (err) {
      showToast(err.message, { tone: 'error' });
    } finally {
      setLoadingOlder(false);
    }
  }

  /** One send's detail, read once; each read is an audited read on the server. */
  async function readDetail(id) {
    const known = detailsRef.current[id];
    if (known?.status === 'ready') return known.send;
    const remember = (entry) => {
      detailsRef.current = { ...detailsRef.current, [id]: entry };
      setDetails(detailsRef.current);
    };
    remember({ status: 'loading' });
    try {
      const response = await call('getAnnouncementSend', { id });
      remember({ status: 'ready', send: response.send });
      return response.send;
    } catch (err) {
      remember({ status: 'error', error: err });
      throw err;
    }
  }

  async function toggleDetail(send) {
    if (openId === send.id) {
      setOpenId(null);
      return;
    }
    setOpenId(send.id);
    try {
      await readDetail(send.id);
    } catch {
      // The detail region states the error.
    }
  }

  /** Any edit drops the preview: a confirmation must match what was shown. */
  function edit(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
    // A retry goes to the earlier send's audience only.
    if (field === 'audience') setRetry(null);
    setPreview(null);
    setConfirming(false);
  }

  async function runPreview(event) {
    event.preventDefault();
    if (busy) return;
    setBusy('preview');
    setError(null);
    setResult(null);
    try {
      const chosen = { ...draft, audience: selectedAudience };
      const response = await call('previewAnnouncementEmail', {
        draft: draftBody(chosen),
        audience: chosen.audience,
        ...(retry ? { retryOf: retry.id } : {}),
      });
      setPreview({ ...response, draft: chosen, retryOf: retry?.id ?? null });
      setConfirming(false);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  async function sendTest() {
    if (busy || !preview) return;
    setBusy('test');
    setError(null);
    try {
      const response = await call('sendAnnouncementTest', { draft: draftBody(preview.draft) });
      showToast(`Test email sent to ${response.sentTo}.`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  /** Call until the record is done; returns the last summary. */
  async function drive(firstBody, sendId) {
    let response = await call('sendAnnouncementEmail', firstBody);
    for (let calls = 1; response.send?.status === 'sending' && calls < MAX_CALLS; calls += 1) {
      setProgress(response.send);
      if (response.send.busy) await sleep(BUSY_WAIT_MS);
      response = await call('sendAnnouncementEmail', { sendId });
    }
    return response.send;
  }

  async function confirmSend() {
    if (busy || !preview) return;
    setBusy('send');
    setError(null);
    setProgress({ processed: 0, total: preview.recipientCount, counts: {}, status: 'sending' });
    try {
      const send = await drive({
        sendId: preview.sendId,
        receipt: preview.receipt,
        draft: draftBody(preview.draft),
        audience: preview.audience,
        ...(preview.retryOf ? { retryOf: preview.retryOf } : {}),
      }, preview.sendId);
      setResult(send);
      setPreview(null);
      setConfirming(false);
      setRetry(null);
      if (send?.status === 'sent') {
        setDraft((current) => ({ ...EMPTY_DRAFT, audience: current.audience }));
        setLoaded(null);
        setBaseline(contentKey(EMPTY_DRAFT));
      }
    } catch (err) {
      setError(err);
      if (err?.code === 'preview-stale') setPreview(null);
      setConfirming(false);
    } finally {
      setBusy(null);
      setProgress(null);
      loadHistory();
    }
  }

  async function continueSend(send) {
    setContinuingId(send.id);
    setError(null);
    try {
      setResult(await drive({ sendId: send.id }, send.id));
    } catch (err) {
      setError(err);
    } finally {
      setContinuingId(null);
      loadHistory();
    }
  }

  /** Put content in the form as a new, unsent draft, and drop any preview. */
  function replaceDraft(content, audience) {
    const next = {
      audience,
      subject: content.subject ?? '',
      message: content.message ?? '',
      linkUrl: content.linkUrl ?? '',
      linkLabel: content.linkLabel ?? '',
    };
    setDraft(next);
    setBaseline(contentKey(next));
    setPreview(null);
    setConfirming(false);
    setResult(null);
    setRetry(null);
    setError(null);
    subjectRef.current?.querySelector('input')?.focus();
  }

  /** The frozen content of a past send, read through the audited detail. */
  async function reuse(send) {
    let detail;
    try {
      detail = await readDetail(send.id);
    } catch (err) {
      setError(err);
      return false;
    }
    replaceDraft(detail.draft, send.audience);
    setLoaded(null);
    return true;
  }

  async function retryFailed(send) {
    if (await reuse(send)) setRetry({ id: send.id, count: send.retryCount, subject: send.subject });
  }

  function loadSaved(message) {
    replaceDraft(message.draft, draft.audience);
    setLoaded({ id: message.id, name: message.name });
  }

  function savedMessageSaved(message) {
    setLoaded(message);
    setBaseline(contentKey(draft));
  }

  function cancelRetry() {
    setRetry(null);
    setPreview(null);
    setConfirming(false);
  }

  async function restore(event) {
    event.preventDefault();
    if (restoring) return;
    setRestoring(true);
    try {
      const response = await call('removeEmailSuppression', { email: restoreEmail });
      let message = 'This address was not unsubscribed. Nothing changed.';
      if (response.removed) {
        // With Postmark unsubscribe handling, Postmark keeps its own opt-out.
        message = providerManaged
          ? 'This site no longer leaves the address out. Reactivate it on the broadcast stream in Postmark too.'
          : 'This address gets announcement email again.';
      }
      showToast(message);
      if (response.removed) setRestoreEmail('');
    } catch (err) {
      showToast(err.message, { tone: 'error' });
    } finally {
      setRestoring(false);
    }
  }

  const channel = history?.channel;
  const providerManaged = channel?.mode === 'provider';
  const audienceOptions = audiences.map((audience) => ({ value: audience.id, label: audience.label }));
  const audienceHint = audiences.find((audience) => audience.id === selectedAudience)?.description;
  const count = preview?.recipientCount ?? 0;

  return (
    <div className="flex flex-col gap-md">
      <Panel
        title="Email an announcement"
        description="Write one email to an audience of registered people. Preview it, send a test to yourself, then confirm the send."
      >
        {history === null && !historyError ? <AdminLoadingState label="Loading the email settings…" /> : null}
        {historyError ? <Notice tone="error" message={historyError.message} /> : null}
        {channel && !channel.canSend ? <Notice tone="caution" message={channel.blocker} /> : null}
        {history ? (
          <form className="mt-sm flex flex-col gap-sm" onSubmit={runPreview} noValidate>
            <ServerErrorSummary error={error} errorRef={errorRef} title="The server refused this email" />
            {retry ? (
              <div className="flex flex-col gap-2xs">
                <Notice
                  tone="caution"
                  message={`This email goes only to the ${plural(retry.count, 'address', 'addresses')} that failed in "${retry.subject}".`}
                />
                <div>
                  <button type="button" className={linkButtonClass} onClick={cancelRetry}>
                    Send to the whole audience instead
                  </button>
                </div>
              </div>
            ) : null}
            <SelectField
              label="Audience"
              value={selectedAudience}
              options={audienceOptions}
              hint={audienceHint}
              onChange={(value) => edit('audience', value)}
            />
            <div ref={subjectRef}>
              <TextField
                label="Subject"
              value={draft.subject}
                maxLength={150}
                required
                onChange={(value) => edit('subject', value)}
              />
            </div>
            <TextAreaField
              label="Email message"
              hint="Plain text. A blank line starts a new paragraph."
              value={draft.message}
              rows={8}
              maxLength={10000}
              required
              onChange={(value) => edit('message', value)}
            />
            <div className="grid gap-sm md:grid-cols-2">
              <TextField
                label="Button link (optional)"
                type="url"
                value={draft.linkUrl}
                placeholder="https://example.org/schedule"
                onChange={(value) => edit('linkUrl', value)}
              />
              <TextField
                label="Button label (optional)"
                value={draft.linkLabel}
                maxLength={80}
                onChange={(value) => edit('linkLabel', value)}
              />
            </div>
            <div className="flex flex-wrap gap-xs">
              <button type="submit" className={primaryButtonClass} aria-busy={busy === 'preview' ? 'true' : undefined}>
                {busy === 'preview' ? 'Building the preview…' : 'Preview email'}
              </button>
            </div>
          </form>
        ) : null}
      </Panel>

      {preview ? (
        <Panel>
          <section aria-labelledby="announcement-email-preview" className="flex flex-col gap-sm">
            <h3 id="announcement-email-preview" ref={previewHeadingRef} tabIndex={-1} className="text-admin-lg font-bold text-admin-ink focus:outline-none">
              Preview
            </h3>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-sm gap-y-3xs text-admin-sm">
              <dt className="font-semibold text-admin-ink">To</dt>
              <dd className="text-admin-ink">{`${recipients(count)}: ${preview.audienceLabel}`}</dd>
              <dt className="font-semibold text-admin-ink">From</dt>
              <dd className="font-admin-data text-admin-ink-data">{preview.from ?? 'Not set'}</dd>
              {preview.replyTo ? (
                <>
                  <dt className="font-semibold text-admin-ink">Reply to</dt>
                  <dd className="font-admin-data text-admin-ink-data">{preview.replyTo}</dd>
                </>
              ) : null}
              <dt className="font-semibold text-admin-ink">Subject</dt>
              <dd className="text-admin-ink">{preview.subject}</dd>
            </dl>
            {preview.suppressedCount > 0 ? (
              <p className="text-admin-sm text-admin-ink">
                {`${plural(preview.suppressedCount, 'address is', 'addresses are')} left out because they unsubscribed.`}
              </p>
            ) : null}
            {preview.unusableCount > 0 ? (
              <p className="text-admin-sm text-admin-ink">
                {`${plural(preview.unusableCount, 'account has', 'accounts have')} no usable email address and ${preview.unusableCount === 1 ? 'is' : 'are'} left out.`}
              </p>
            ) : null}
            <p className="text-admin-sm text-admin-ink-secondary">{preview.unsubscribeNote}</p>
            <PreviewFrame html={preview.html} text={preview.text} />
            {preview.canSend ? null : <Notice tone="caution" message={preview.blocker} />}
            {preview.canSend && !confirming ? (
              <div className="flex flex-wrap gap-xs">
                <button
                  type="button"
                  ref={sendButtonRef}
                  className={primaryButtonClass}
                  onClick={() => setConfirming(true)}
                >
                  {`Send to ${recipients(count)}`}
                </button>
                <button
                  type="button"
                  className={secondaryButtonClass}
                  aria-busy={busy === 'test' ? 'true' : undefined}
                  aria-disabled={busy ? 'true' : undefined}
                  onClick={sendTest}
                >
                  {busy === 'test' ? 'Sending the test…' : 'Send a test to me'}
                </button>
              </div>
            ) : null}
            {preview.canSend && confirming ? (
              <section
                aria-labelledby="announcement-email-confirm"
                className="flex flex-col gap-xs rounded-admin-panel border-admin-strong border-admin-rule-strong px-md py-sm"
              >
                <h3 id="announcement-email-confirm" ref={confirmHeadingRef} tabIndex={-1} className="text-admin-base font-bold text-admin-ink focus:outline-none">
                  {`Send this email to ${recipients(count)}?`}
                </h3>
                <p className="max-w-[65ch] text-admin-sm text-admin-ink">
                  Each recipient gets one copy. A sent email cannot be recalled.
                </p>
                <div className="flex flex-wrap gap-xs">
                  <button
                    type="button"
                    className={primaryButtonClass}
                    aria-busy={busy === 'send' ? 'true' : undefined}
                    aria-disabled={busy ? 'true' : undefined}
                    onClick={confirmSend}
                  >
                    {busy === 'send' ? 'Sending…' : `Send to ${recipients(count)}`}
                  </button>
                  <button
                    type="button"
                    className={secondaryButtonClass}
                    aria-disabled={busy ? 'true' : undefined}
                    onClick={() => {
                      if (busy) return;
                      setConfirming(false);
                      requestAnimationFrame(() => sendButtonRef.current?.focus());
                    }}
                  >
                    Go back
                  </button>
                </div>
              </section>
            ) : null}
          </section>
        </Panel>
      ) : null}

      <p role="status" className="text-admin-sm text-admin-ink">
        {progress ? `Sending. ${plural(progress.processed ?? 0, 'address', 'addresses')} of ${(progress.total ?? 0).toLocaleString('en-US')} handled.` : ''}
      </p>

      {result ? (
        <div ref={resultRef} tabIndex={-1} className="focus:outline-none">
          <Notice
            tone={result.status === 'sent' && !result.counts?.failed && !result.counts?.uncertain ? 'ok' : 'caution'}
            message={result.status === 'sent'
              ? `The send is complete. ${countsSentence(result)}`
              : `The send stopped part way. ${countsSentence(result)} Use Continue sending in the history.`}
          />
        </div>
      ) : null}

      {history ? (
        <AnnouncementSavedMessages
          draft={draft}
          dirty={dirty}
          loaded={loaded}
          onLoad={loadSaved}
          onSaved={savedMessageSaved}
          onRenamed={(message) => setLoaded((current) => (current?.id === message.id ? message : current))}
          onRemoved={(id) => setLoaded((current) => (current?.id === id ? null : current))}
          formatTime={(ms) => formatWhen(ms, timeZone)}
          draftBody={draftBody}
        />
      ) : null}

      <Panel
        title="Email send history"
        description="Announcement emails, newest first. The history keeps each send for 90 days, as the email log does."
      >
        {history ? (
          <SendHistory
            sends={history.sends}
            timeZone={timeZone}
            onReuse={reuse}
            onRetry={retryFailed}
            onContinue={continueSend}
            continuingId={continuingId}
            openId={openId}
            details={details}
            onToggle={toggleDetail}
            rowRefs={rowRefs}
          />
        ) : null}
        {history?.nextCursor ? (
          <div className="mt-sm">
            <button
              type="button"
              className={secondaryButtonClass}
              aria-busy={loadingOlder ? 'true' : undefined}
              onClick={loadOlder}
            >
              {loadingOlder ? 'Loading older sends…' : 'Show older sends'}
            </button>
          </div>
        ) : null}
        <form className="mt-md flex flex-col gap-xs border-t-admin-hairline border-admin-rule-hairline pt-sm" onSubmit={restore}>
          <TextField
            label="Restore an unsubscribed address"
            hint={providerManaged
              ? 'Use this only when the person asks to get announcement email again. Postmark keeps its own list of addresses that unsubscribed: reactivate the address on the broadcast stream in Postmark too.'
              : 'Use this only when the person asks to get announcement email again.'}
            type="email"
            autoComplete="off"
            value={restoreEmail}
            onChange={setRestoreEmail}
          />
          <div>
            <button type="submit" className={secondaryButtonClass} aria-busy={restoring ? 'true' : undefined}>
              {restoring ? 'Restoring…' : 'Restore address'}
            </button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
