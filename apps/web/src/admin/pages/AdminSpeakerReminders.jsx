// Speaker reminders: email accepted speakers about the items they still owe
// (functions/src/speakers/reminders.cjs, one staff endpoint with actions).
//
// The path is select → preview → confirm → send:
//   1. The list shows each accepted speaker, what they still owe (the rule
//      in shared/speakerReadiness, the same one the speaker's own "Your next
//      steps" list reads), and when they were last reminded.
//   2. Preview renders, on the server, the exact message each chosen
//      speaker gets, and names who gets none and why.
//   3. Send opens a dialog that states the recipient count. The request
//      carries that count, the preview's batch id and its wording version,
//      so the server sends what the preview showed, once per speaker, and
//      refuses when another staff member saved new wording in between.
// A change to the selection or the items clears the preview, so a send
// never reaches a speaker or an item the preview did not show.
//
// The wording editor saves an email_templates/speaker.reminder override
// that the server checks against the template's tokens.
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { READINESS_ITEMS, READINESS_ITEM_LABELS } from 'shared/speakerReadiness';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { useAdminApi } from '../adminApi.js';
import { buildPreviewDoc } from '../emailPreview.js';
import { saveTextFile } from '../downloadFile.js';
import {
  REMINDER_GROUPS,
  describeMissing,
  formatWhen,
  itemLabels,
  newBatchId,
  readGroup,
  rowsInGroup,
  sendLabel,
  sendSummary,
  speakerCount,
} from '../speakerReminders.js';
import {
  CheckboxField,
  DestructiveConfirm,
  Notice,
  Panel,
  SelectField,
  TextAreaField,
  TextField,
  linkButtonClass,
  primaryButtonClass,
  rowMetaClass,
  rowTitleLinkClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import AdminPageHeader, { AdminEmptyState, AdminLoadingState, StatusBadge } from '../components/adminChrome.jsx';
import TicketingConfirmation from '../components/TicketingConfirmation.jsx';

const STATUS_WORDS = { accepted: 'Accepted', approved: 'Approved' };

/** The sandboxed frame for a rendered message (admin/emailPreview.js). */
function PreviewFrame({ srcDoc, to }) {
  return (
    <>
      <iframe
        sandbox=""
        srcDoc={srcDoc}
        referrerPolicy="no-referrer"
        title={`Reminder to ${to}`}
        className="block h-[24rem] w-full rounded-admin border-admin-hairline border-admin-rule-hairline [color-scheme:light]"
      />
      <p className="text-admin-xs text-admin-ink-secondary">Links and remote images are turned off in this preview.</p>
    </>
  );
}

function RecipientMessage({ message }) {
  const srcDoc = useMemo(() => (message.html ? buildPreviewDoc(message.html) : null), [message.html]);
  return (
    <div className="flex flex-col gap-xs">
      <dl className="grid grid-cols-[auto_1fr] gap-x-sm gap-y-3xs text-admin-sm">
        <dt className="font-semibold text-admin-ink">To</dt>
        <dd className="wrap-anywhere font-admin-data text-admin-ink-data">{message.to}</dd>
        <dt className="font-semibold text-admin-ink">Subject</dt>
        <dd className="wrap-anywhere text-admin-ink">{message.subject}</dd>
        <dt className="font-semibold text-admin-ink">Items</dt>
        <dd className="text-admin-ink">{itemLabels(message.items)}</dd>
      </dl>
      {srcDoc ? <PreviewFrame srcDoc={srcDoc} to={message.to} /> : (
        <p className="text-admin-sm text-admin-ink">This message’s HTML cannot be shown safely. The plain text version is below.</p>
      )}
      <details open={!srcDoc} className="text-admin-sm">
        <summary className="admin-target cursor-pointer font-semibold text-admin-ink">Plain text version</summary>
        <pre
          data-testid="reminder-preview-text"
          className="mt-2xs max-h-[24rem] overflow-auto whitespace-pre-wrap break-words font-admin-data text-admin-sm text-admin-ink-data"
        >
          {message.text}
        </pre>
      </details>
    </div>
  );
}

function PreviewPanel({ preview, onSend }) {
  const [shownId, setShownId] = useState(preview.recipients[0]?.speakerId ?? '');
  const shown = preview.recipients.find((row) => row.speakerId === shownId) ?? preview.recipients[0] ?? null;
  const count = preview.recipients.length;
  return (
    <Panel
      title="Preview"
      description="Each speaker gets the message shown for them. Choose a recipient to read their copy."
    >
      <div className="flex flex-col gap-md">
        <p role="status" className="text-admin-base text-admin-ink">
          {count === 0
            ? 'No chosen speaker can get a reminder.'
            : `${speakerCount(count)} ${count === 1 ? 'gets' : 'get'} a reminder.`}
          {preview.skipped.length > 0 ? ` ${speakerCount(preview.skipped.length)} ${preview.skipped.length === 1 ? 'gets' : 'get'} none.` : ''}
        </p>
        {preview.usedFallback ? (
          <Notice tone="caution" message="The saved wording failed its check, so these messages use the shipped wording. Fix the wording below." />
        ) : null}
        {preview.skipped.length > 0 ? (
          <section aria-label="Speakers who get no reminder" className="flex flex-col gap-2xs">
            <h3 className="text-admin-base font-bold text-admin-ink">No reminder</h3>
            <ul className="flex flex-col gap-3xs text-admin-sm text-admin-ink">
              {preview.skipped.map((row) => (
                <li key={row.speakerId}>
                  <span className="font-semibold">{row.name}</span>: {row.message}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {shown ? (
          <>
            <SelectField
              label="Recipient"
              value={shown.speakerId}
              onChange={setShownId}
              options={preview.recipients.map((row) => ({ value: row.speakerId, label: `${row.name} (${row.to})` }))}
            />
            <RecipientMessage message={shown} />
            <div>
              <button type="button" className={primaryButtonClass} onClick={onSend}>
                {sendLabel(count)}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </Panel>
  );
}

function SpeakerRow({ row, checked, onToggle, timeZone }) {
  const last = row.lastRemindedAt
    ? `Last reminded ${formatWhen(row.lastRemindedAt, timeZone)}${row.lastRemindedItems.length ? ` about ${itemLabels(row.lastRemindedItems)}` : ''}.`
    : 'Not reminded yet.';
  return (
    <li className="flex flex-wrap items-start justify-between gap-sm border-admin-rule-hairline border-b-admin-hairline px-md py-sm last:border-b-0">
      <div className="flex min-w-0 flex-col gap-3xs">
        <CheckboxField label={row.name} checked={checked} onChange={() => onToggle(row.id)} />
        <div className="flex flex-wrap items-center gap-x-sm gap-y-2xs ps-lg">
          <StatusBadge tone="ok">{STATUS_WORDS[row.status] ?? row.status}</StatusBadge>
          {!row.hasEmail ? <StatusBadge tone="caution">No email address</StatusBadge> : null}
          <Link
            to={`/admin/speakers/${encodeURIComponent(row.id)}`}
            aria-label={`Open the record for ${row.name}`}
            className={rowTitleLinkClass}
          >
            Open record
          </Link>
        </div>
        <p className="wrap-anywhere ps-lg text-admin-sm text-admin-ink">Missing: {describeMissing(row.readiness)}.</p>
        <p className={`ps-lg ${rowMetaClass}`} data-testid={`last-reminded-${row.id}`}>
          {last}
          {row.canRemindAfter ? ` Can be reminded again after ${formatWhen(row.canRemindAfter, timeZone)}.` : ''}
        </p>
      </div>
    </li>
  );
}

function WordingEditor({ call, timeZone }) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await call('speakerReminders', { action: 'template' });
      setState({ status: 'ready', data, error: null });
      setDraft(data.saved ?? data.shipped);
    } catch (err) {
      setState({ status: 'error', data: null, error: err.message });
    }
  }, [call]);

  useEffect(() => { load(); }, [load]);

  async function save(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      const data = await call('speakerReminders', { action: 'saveTemplate', ...draft });
      setState({ status: 'ready', data, error: null });
      setDraft(data.saved ?? data.shipped);
      setResult({ tone: 'ok', message: 'Wording saved. The next preview and send use it.' });
    } catch (err) {
      setResult({ tone: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    setResult(null);
    try {
      const data = await call('speakerReminders', { action: 'resetTemplate' });
      setState({ status: 'ready', data, error: null });
      setDraft(data.shipped);
      setResult({ tone: 'ok', message: 'The shipped wording applies again.' });
    } catch (err) {
      setResult({ tone: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  }

  let body;
  if (state.status === 'loading') body = <AdminLoadingState label="Loading the wording…" />;
  else if (state.status === 'error') body = <Notice tone="error" message={state.error} />;
  else {
    const { data } = state;
    body = (
      <form className="flex flex-col gap-md" onSubmit={save} noValidate>
        <p className="text-admin-sm text-admin-ink">
          {data.saved
            ? `Saved wording, last changed ${formatWhen(data.saved.updatedAt, timeZone)} by ${data.saved.updatedBy ?? 'an admin'}.`
            : 'The shipped wording is in use.'}
        </p>
        <div className="text-admin-sm text-admin-ink-secondary">
          <p>
            Reminder tokens:{' '}
            <span className="font-admin-data text-admin-ink-data">
              {data.reminderTokens.map((name) => `{{${name}}}`).join(' ')}
            </span>
          </p>
          <p className="mt-3xs">
            Both bodies must keep <span className="font-admin-data">{'{{dashboard_url}}'}</span>.
            Use <span className="font-admin-data">{'{{#if materials_sessions}}…{{/if}}'}</span> to show a line only when the speaker owes that item.
            Event tokens such as <span className="font-admin-data">{'{{event_name}}'}</span> also work. The server refuses any other token.
          </p>
        </div>
        <TextField label="Subject" value={draft.subject} onChange={(value) => setDraft({ ...draft, subject: value })} />
        <TextAreaField
          label="HTML body"
          rows={10}
          className="font-admin-data"
          value={draft.html}
          onChange={(value) => setDraft({ ...draft, html: value })}
        />
        <TextAreaField
          label="Plain text body"
          rows={10}
          className="font-admin-data"
          value={draft.text}
          onChange={(value) => setDraft({ ...draft, text: value })}
        />
        {result ? <Notice tone={result.tone} message={result.message} /> : null}
        <div className="flex flex-wrap items-center gap-xs">
          <button type="submit" className={primaryButtonClass} aria-busy={busy}>
            {busy ? 'Saving…' : 'Save wording'}
          </button>
          {data.saved ? (
            <DestructiveConfirm
              trigger="Use the shipped wording"
              title="Use the shipped wording"
              confirmLabel="Delete the saved wording"
              consequence="The saved wording is deleted and every later reminder uses the shipped wording."
              permanence="This cannot be undone."
              busy={busy}
              busyLabel="Deleting…"
              onConfirm={reset}
            />
          ) : null}
        </div>
      </form>
    );
  }

  return (
    <Panel
      title="Reminder wording"
      description="Staff can change every sentence. Save, then preview to read the message each speaker gets."
    >
      {body}
    </Panel>
  );
}

export default function AdminSpeakerReminders() {
  const call = useAdminApi();
  const { eventConfig } = useEventConfig();
  const timeZone = typeof eventConfig?.timezone === 'string' && eventConfig.timezone ? eventConfig.timezone : undefined;
  const [searchParams, setSearchParams] = useSearchParams();
  const group = readGroup(searchParams.get('show'));
  const requestedSpeaker = searchParams.get('speaker');
  const topicsId = useId();

  const [list, setList] = useState({ status: 'loading', rows: [], error: null });
  const [selected, setSelected] = useState(() => new Set(requestedSpeaker ? [requestedSpeaker] : []));
  const [topics, setTopics] = useState(() => new Set(READINESS_ITEMS));
  const [preview, setPreview] = useState(null); // { batchId, topics, recipients, skipped, usedFallback, wordingVersion }
  const [busy, setBusy] = useState(null); // 'preview' | 'send' | 'export'
  const [notice, setNotice] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [sendError, setSendError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const result = await call('speakerReminders', { action: 'list' });
      setList({ status: 'ready', rows: result.speakers ?? [], error: null });
    } catch (err) {
      setList((current) => ({ ...current, status: current.rows.length ? 'ready' : 'error', error: err.message }));
    }
  }, [call]);

  useEffect(() => { refresh(); }, [refresh]);

  const shown = useMemo(() => {
    const rows = rowsInGroup(list.rows, group);
    // A speaker named in the address stays on screen whatever the filter.
    if (requestedSpeaker && !rows.some((row) => row.id === requestedSpeaker)) {
      const extra = list.rows.find((row) => row.id === requestedSpeaker);
      if (extra) return [extra, ...rows];
    }
    return rows;
  }, [list.rows, group, requestedSpeaker]);

  const selectedShown = shown.filter((row) => selected.has(row.id));

  function changeSelection(next) {
    setSelected(next);
    setPreview(null);
  }

  function toggle(id) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    changeSelection(next);
  }

  function changeGroup(value) {
    const next = new URLSearchParams(searchParams);
    next.set('show', value);
    next.delete('speaker');
    setSearchParams(next, { replace: true });
    // A filter change clears the selection, so an action never reaches a
    // speaker who is not on screen.
    changeSelection(new Set());
  }

  function toggleTopic(item) {
    const next = new Set(topics);
    if (next.has(item)) next.delete(item);
    else next.add(item);
    setTopics(next);
    setPreview(null);
  }

  async function runPreview() {
    setNotice(null);
    if (selectedShown.length === 0) {
      setNotice({ tone: 'error', message: 'Select at least one speaker to preview.' });
      return;
    }
    if (topics.size === 0) {
      setNotice({ tone: 'error', message: 'Choose at least one item to include.' });
      return;
    }
    setBusy('preview');
    try {
      const chosenTopics = READINESS_ITEMS.filter((item) => topics.has(item));
      const result = await call('speakerReminders', {
        action: 'preview',
        speakerIds: selectedShown.map((row) => row.id),
        topics: chosenTopics,
      });
      setPreview({ ...result, topics: chosenTopics, batchId: newBatchId() });
    } catch (err) {
      setNotice({ tone: 'error', message: err.message });
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    if (!preview || busy === 'send') return;
    setBusy('send');
    setSendError(null);
    try {
      const result = await call('speakerReminders', {
        action: 'send',
        speakerIds: preview.recipients.map((row) => row.speakerId),
        topics: preview.topics,
        batchId: preview.batchId,
        confirmCount: preview.recipients.length,
        wordingVersion: preview.wordingVersion,
      });
      setConfirming(false);
      setPreview(null);
      setSelected(new Set());
      setNotice({ tone: result.failed?.length ? 'caution' : 'ok', message: sendSummary(result) });
      await refresh();
    } catch (err) {
      setSendError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function exportList() {
    if (busy) return;
    setBusy('export');
    setNotice(null);
    try {
      const result = await call('speakerReminders', { action: 'export', group });
      saveTextFile(result.filename, result.csv);
      setNotice({
        tone: 'ok',
        message: `Exported ${speakerCount(result.rowCount)} to ${result.filename}. The export is in the admin log.`,
      });
    } catch (err) {
      setNotice({ tone: 'error', message: err.message });
    } finally {
      setBusy(null);
    }
  }

  const groupLabel = REMINDER_GROUPS.find((option) => option.value === group)?.label ?? '';

  return (
    <div className="flex flex-col gap-md">
      <AdminPageHeader
        title="Speaker reminders"
        identifiers={`${speakerCount(list.rows.length)} accepted`}
        description="Email accepted speakers about the items they still owe: biography, headshot, session description, and materials. A speaker gets at most one reminder in 24 hours."
        actions={
          <>
            <button type="button" className={secondaryButtonClass} onClick={exportList} aria-busy={busy === 'export'}>
              {busy === 'export' ? 'Exporting…' : 'Export this list as CSV'}
            </button>
            <Link to="/admin/speakers" className={linkButtonClass}>Back to speakers</Link>
          </>
        }
      />

      {notice ? <Notice tone={notice.tone} message={notice.message} /> : null}
      {list.error && list.status === 'ready' ? (
        <Notice tone="caution" message={`The list did not refresh: ${list.error}`} />
      ) : null}

      <Panel title="Choose speakers" description="The list shows speakers who accepted an invitation. Published sessions count. A pending or approved material counts, and a rejected one does not.">
        {list.status === 'loading' ? (
          <AdminLoadingState label="Loading speakers…" />
        ) : list.status === 'error' ? (
          <Notice tone="error" message={list.error} />
        ) : (
          <div className="flex flex-col gap-md">
            <SelectField
              label="Show"
              value={group}
              onChange={changeGroup}
              options={REMINDER_GROUPS}
            />
            <div className="flex flex-wrap items-center gap-sm">
              <p role="status" className="text-admin-sm text-admin-ink">
                {selectedShown.length === 0 ? 'No speakers selected' : `${speakerCount(selectedShown.length)} selected`}
              </p>
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={() => changeSelection(new Set(shown.map((row) => row.id)))}
              >
                Select all shown
              </button>
              <button type="button" className={linkButtonClass} onClick={() => changeSelection(new Set())}>
                Clear selection
              </button>
            </div>
            {shown.length === 0 ? (
              <AdminEmptyState
                title="No speaker matches"
                description={`No accepted speaker is in “${groupLabel}”.`}
                action={group === 'all' ? null : (
                  <button type="button" className={secondaryButtonClass} onClick={() => changeGroup('all')}>
                    Show every accepted speaker
                  </button>
                )}
              />
            ) : (
              <ul aria-label="Accepted speakers" className="rounded-admin border-admin-hairline border-admin-rule-hairline">
                {shown.map((row) => (
                  <SpeakerRow key={row.id} row={row} checked={selected.has(row.id)} onToggle={toggle} timeZone={timeZone} />
                ))}
              </ul>
            )}
            <fieldset aria-describedby={`${topicsId}-hint`} className="flex flex-col gap-xs">
              <legend className="text-admin-base font-semibold text-admin-ink">Items to include</legend>
              <p id={`${topicsId}-hint`} className="text-admin-sm text-admin-ink-secondary">
                Each speaker’s message names only the chosen items that speaker still owes.
              </p>
              {READINESS_ITEMS.map((item) => (
                <CheckboxField
                  key={item}
                  label={READINESS_ITEM_LABELS[item]}
                  checked={topics.has(item)}
                  onChange={() => toggleTopic(item)}
                />
              ))}
            </fieldset>
            <div>
              <button type="button" className={primaryButtonClass} onClick={runPreview} aria-busy={busy === 'preview'}>
                {busy === 'preview' ? 'Preparing the preview…' : 'Preview reminders'}
              </button>
            </div>
          </div>
        )}
      </Panel>

      {preview ? (
        <PreviewPanel
          key={preview.batchId}
          preview={preview}
          onSend={() => { setSendError(null); setConfirming(true); }}
        />
      ) : null}

      {confirming && preview ? (
        <TicketingConfirmation
          title={`${sendLabel(preview.recipients.length)}?`}
          confirmLabel={sendLabel(preview.recipients.length)}
          busyLabel="Sending…"
          busy={busy === 'send'}
          error={sendError}
          onConfirm={send}
          onClose={() => setConfirming(false)}
        >
          <p>
            {preview.recipients.length === 1 ? 'This speaker gets' : `These ${preview.recipients.length} speakers each get`} one
            email now, with the wording the preview showed: {preview.recipients.map((row) => row.name).join(', ')}.
          </p>
          <p>An email cannot be recalled after it is sent.</p>
        </TicketingConfirmation>
      ) : null}

      <WordingEditor call={call} timeZone={timeZone} />
    </div>
  );
}
