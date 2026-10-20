// Scheduled reminders (issue #518, ADR 0006): reminders that go out on
// their own, on a schedule staff set, with wording staff approved.
// functions/src/reminders/schedules.cjs is the one staff endpoint.
//
// The path is settings → save → preview → approve:
//   1. Settings: the days before the due date, the due date on the event
//      clock (EventDateTimeField), the send time and the items.
//   2. Preview renders, on the server, one sample message per offset.
//   3. "Approve and turn on" sends the wording version and the settings
//      version the preview showed. The server refuses when either changed.
// The schedule is off by default. A change to the wording (the speaker
// reminders page) or to the settings while it is on pauses it until staff
// approve again. The state, the pause and every result are stated in words.
//
// Only the speaker section exists. The attendee section (#518, the third
// pull request) joins this page as its own Panel.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { READINESS_ITEMS, READINESS_ITEM_LABELS } from 'shared/speakerReadiness';
import { useAdminApi } from '../adminApi.js';
import { buildPreviewDoc } from '../emailPreview.js';
import { itemLabels } from '../speakerReminders.js';
import {
  eventTime,
  lastRunWords,
  nextRunWords,
  readOffsetInputs,
  speakerWord,
  stateWords,
} from '../reminderSchedules.js';
import { describeTimeZone } from '../../lib/eventDateTime.js';
import EventDateTimeField from '../components/EventDateTimeField.jsx';
import {
  CheckboxField,
  FieldError,
  Notice,
  Panel,
  TextField,
  linkButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import AdminPageHeader, { AdminLoadingState, StatusBadge } from '../components/adminChrome.jsx';

const STATE_TONES = { on: 'ok', paused: 'caution', off: 'dead' };
const STATE_LABELS = { on: 'On', paused: 'Paused', off: 'Off' };

function formFrom(data) {
  return {
    offsets: data.settings.offsetsDays.map(String),
    sendTime: data.settings.sendTime,
    dueAt: data.settings.dueAt,
    topics: new Set(data.settings.topics),
  };
}

function sameForm(form, data) {
  const offsets = readOffsetInputs(form.offsets).days;
  return JSON.stringify([offsets, form.sendTime, form.dueAt, READINESS_ITEMS.filter((item) => form.topics.has(item))])
    === JSON.stringify([data.settings.offsetsDays, data.settings.sendTime, data.settings.dueAt, data.settings.topics]);
}

function SampleMessage({ sample, timeZone }) {
  const srcDoc = useMemo(() => (sample.html ? buildPreviewDoc(sample.html) : null), [sample.html]);
  return (
    <section aria-label={`${sample.offsetDays}-day reminder`} className="flex flex-col gap-xs border-admin-rule-hairline border-t-admin-hairline pt-sm">
      <h4 className="text-admin-base font-bold text-admin-ink">
        {sample.offsetDays}-day reminder
      </h4>
      <p className="text-admin-sm text-admin-ink">
        Sends from {eventTime(sample.opensAt, timeZone)}.
        {sample.state === 'closed' ? ' This reminder date has passed, so it will not send.' : ''}
        {sample.state === 'empty' ? ' Quiet hours cover this whole reminder, so it will not send.' : ''}
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-sm gap-y-3xs text-admin-sm">
        <dt className="font-semibold text-admin-ink">Sample</dt>
        <dd className="text-admin-ink">{sample.sample ? 'A sample speaker. Nobody owes an item now.' : `${sample.speakerName} (${sample.to})`}</dd>
        <dt className="font-semibold text-admin-ink">Subject</dt>
        <dd className="wrap-anywhere text-admin-ink">{sample.subject}</dd>
        <dt className="font-semibold text-admin-ink">Items</dt>
        <dd className="text-admin-ink">{itemLabels(sample.items)}</dd>
      </dl>
      {srcDoc ? (
        <iframe
          sandbox=""
          srcDoc={srcDoc}
          referrerPolicy="no-referrer"
          title={`${sample.offsetDays}-day reminder preview`}
          className="block h-[20rem] w-full rounded-admin border-admin-hairline border-admin-rule-hairline [color-scheme:light]"
        />
      ) : null}
      <details open={!srcDoc} className="text-admin-sm">
        <summary className="admin-target cursor-pointer font-semibold text-admin-ink">Plain text version</summary>
        <pre data-testid={`schedule-preview-text-${sample.offsetDays}`} className="mt-2xs max-h-[20rem] overflow-auto whitespace-pre-wrap break-words font-admin-data text-admin-sm text-admin-ink-data">
          {sample.text}
        </pre>
      </details>
    </section>
  );
}

function NextRunPanel({ data }) {
  const { nextRun, timeZone, state } = data;
  const reach = nextRun?.reach;
  return (
    <section aria-labelledby="next-run-heading" className="flex flex-col gap-xs">
      <h3 id="next-run-heading" className="text-admin-base font-bold text-admin-ink">Next run</h3>
      {state !== 'on' ? (
        <p className="text-admin-sm text-admin-ink">Nothing sends while the schedule is {state === 'paused' ? 'paused' : 'off'}. This is what it would do when on.</p>
      ) : null}
      <p className="text-admin-sm text-admin-ink" data-testid="next-run">{nextRunWords(nextRun, timeZone)}</p>
      {reach ? (
        <>
          <p className="text-admin-sm text-admin-ink">
            It would reach {speakerWord(reach.count)}{reach.count ? `: ${reach.names.join(', ')}${reach.count > reach.names.length ? ', and others' : ''}` : ''}.
          </p>
          {reach.waitingCount ? (
            <div className="text-admin-sm text-admin-ink">
              <p>{speakerWord(reach.waitingCount)} {reach.waitingCount === 1 ? 'waits' : 'wait'} on the 24-hour limit after a recent reminder:</p>
              <ul className="list-disc ps-5">
                {reach.waiting.map((row) => (
                  <li key={`${row.name}-${row.until}`}>{row.name}, from {eventTime(row.until, timeZone)}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}
      <p className="text-admin-sm text-admin-ink" data-testid="last-run">{lastRunWords(data.lastRun, timeZone)}</p>
    </section>
  );
}

function SpeakerSchedule({ call }) {
  const offsetsId = useId();
  const topicsId = useId();
  const resultRef = useRef(null);
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [form, setForm] = useState(null);
  const [dueProblem, setDueProblem] = useState(null);
  const [offsetsProblem, setOffsetsProblem] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(null); // 'save' | 'preview' | 'approve' | 'disable'
  const [result, setResult] = useState(null); // { tone, message, seq }

  const show = useCallback((tone, message) => {
    setResult((current) => ({ tone, message, seq: (current?.seq ?? 0) + 1 }));
  }, []);

  const load = useCallback(async () => {
    try {
      const next = await call('reminderSchedules', { action: 'get', schedule: 'speakers' });
      setData(next);
      setForm(formFrom(next));
      setLoadError(null);
    } catch (err) {
      setLoadError(err.message);
    }
  }, [call]);

  useEffect(() => { load(); }, [load]);

  // Every result moves focus to its heading, so a keyboard or screen reader
  // user hears what happened.
  useEffect(() => {
    if (result) resultRef.current?.focus();
  }, [result]);

  if (loadError && !data) return <Notice tone="error" message={loadError} />;
  if (!data || !form) return <AdminLoadingState label="Loading the schedule…" />;

  const { timeZone } = data;
  const dirty = !sameForm(form, data);

  function update(patch) {
    setForm({ ...form, ...patch });
    setPreview(null);
  }

  function apply(next) {
    setData(next);
    setForm(formFrom(next));
  }

  async function run(kind, body, onDone) {
    if (busy) return;
    setBusy(kind);
    try {
      const next = await call('reminderSchedules', { schedule: 'speakers', ...body });
      onDone(next);
    } catch (err) {
      show('error', err.message);
    } finally {
      setBusy(null);
    }
  }

  function save(event) {
    event.preventDefault();
    const offsets = readOffsetInputs(form.offsets, data.limits);
    setOffsetsProblem(offsets.problem);
    if (offsets.problem || dueProblem) {
      show('error', offsets.problem ?? dueProblem);
      return;
    }
    run('save', {
      action: 'save',
      offsetsDays: offsets.days,
      sendTime: form.sendTime,
      dueAt: form.dueAt || null,
      topics: READINESS_ITEMS.filter((item) => form.topics.has(item)),
    }, (next) => {
      apply(next);
      setPreview(null);
      show(next.state === 'paused' && data.state === 'on' ? 'caution' : 'ok', next.state === 'paused' && data.state === 'on'
        ? 'Settings saved. The schedule is paused until you preview and approve it again.'
        : 'Settings saved.');
    });
  }

  function runPreview() {
    if (dirty) {
      show('error', 'Save the settings first, then preview.');
      return;
    }
    run('preview', { action: 'preview' }, (next) => {
      setPreview(next);
      show('ok', `Preview ready: ${next.samples.length} ${next.samples.length === 1 ? 'reminder' : 'reminders'}. ${speakerWord(next.audienceCount)} ${next.audienceCount === 1 ? 'owes' : 'owe'} a chosen item now.`);
    });
  }

  function approve() {
    run('approve', { action: 'approve', wordingVersion: preview.wordingVersion, settingsVersion: preview.settingsVersion }, (next) => {
      apply(next);
      setPreview(null);
      show('ok', 'Approved. Scheduled speaker reminders are on.');
    });
  }

  function turnOff() {
    run('disable', { action: 'disable' }, (next) => {
      apply(next);
      show('ok', 'Scheduled speaker reminders are off.');
    });
  }

  const zone = timeZone ? describeTimeZone(timeZone) : 'the event’s time zone';

  return (
    <Panel
      title="Speakers"
      description="Remind accepted speakers who still owe items before a due date. Only speakers who owe a chosen item get one. A speaker gets at most one reminder in 24 hours, from the schedule or from staff."
      actions={<StatusBadge tone={STATE_TONES[data.state]}>{STATE_LABELS[data.state]}</StatusBadge>}
    >
      <div className="flex flex-col gap-md">
        <p className="text-admin-base font-semibold text-admin-ink" data-testid="schedule-state">
          {stateWords(data.state)}
          {data.state !== 'off' && data.approval?.at ? ` Approved ${eventTime(data.approval.at, timeZone)} by ${data.approval.by ?? 'an admin'}.` : ''}
        </p>
        {data.paused ? (
          <Notice tone="caution" message={`Paused: ${data.paused.message}`} />
        ) : null}
        {data.state === 'on' && !data.wording.matchesApproval ? (
          <Notice tone="caution" message="The reminder wording is not the wording you approved. The next run sends nothing and pauses the schedule. Preview, then approve again." />
        ) : null}
        {data.eventEnded ? <Notice tone="info" message="The event has ended. Scheduled reminders do not send." /> : null}

        <form className="flex flex-col gap-md" onSubmit={save} noValidate>
          <fieldset aria-describedby={`${offsetsId}-hint`} className="flex flex-col gap-xs">
            <legend className="text-admin-base font-semibold text-admin-ink">Days before the due date</legend>
            <p id={`${offsetsId}-hint`} className="text-admin-sm text-admin-ink-secondary">
              One reminder for each number. The default is 14, 7 and 2 days.
            </p>
            {form.offsets.map((value, index) => (
              <div key={index} className="flex flex-wrap items-end gap-xs">
                <TextField
                  label={`Reminder ${index + 1}, days before`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={data.limits.maxOffsetDays}
                  value={value}
                  onChange={(next) => update({ offsets: form.offsets.map((old, i) => (i === index ? next : old)) })}
                />
                {form.offsets.length > 1 ? (
                  <button
                    type="button"
                    className={linkButtonClass}
                    onClick={() => update({ offsets: form.offsets.filter((_, i) => i !== index) })}
                  >
                    Remove reminder {index + 1}
                  </button>
                ) : null}
              </div>
            ))}
            {form.offsets.length < data.limits.maxOffsets ? (
              <div>
                <button type="button" className={secondaryButtonClass} onClick={() => update({ offsets: [...form.offsets, ''] })}>
                  Add a reminder
                </button>
              </div>
            ) : null}
            <FieldError message={offsetsProblem} />
          </fieldset>

          <EventDateTimeField
            label="Due date"
            value={form.dueAt}
            timeZone={timeZone}
            onChange={(value) => update({ dueAt: value })}
            onProblemChange={setDueProblem}
            hint="The date and time the items are due. Approving needs a due date."
            summaryPrefix="Due"
            emptySummary="No due date is set."
            clearable
          />

          <TextField
            label="Send time"
            type="time"
            value={form.sendTime}
            onChange={(value) => update({ sendTime: value })}
            hint={`On the event clock, ${zone}. Nothing sends from 8:00 PM to 8:00 AM; a reminder due then waits for 8:00 AM.`}
          />

          <fieldset aria-describedby={`${topicsId}-hint`} className="flex flex-col gap-xs">
            <legend className="text-admin-base font-semibold text-admin-ink">Items to remind about</legend>
            <p id={`${topicsId}-hint`} className="text-admin-sm text-admin-ink-secondary">
              Each speaker’s message names only the chosen items that speaker still owes.
            </p>
            {READINESS_ITEMS.map((item) => (
              <CheckboxField
                key={item}
                label={READINESS_ITEM_LABELS[item]}
                checked={form.topics.has(item)}
                onChange={() => {
                  const next = new Set(form.topics);
                  if (next.has(item)) next.delete(item);
                  else next.add(item);
                  update({ topics: next });
                }}
              />
            ))}
          </fieldset>

          <div className="flex flex-wrap items-center gap-xs">
            <button type="submit" className={primaryButtonClass} aria-busy={busy === 'save'}>
              {busy === 'save' ? 'Saving…' : 'Save settings'}
            </button>
            <button type="button" className={secondaryButtonClass} onClick={runPreview} aria-busy={busy === 'preview'}>
              {busy === 'preview' ? 'Preparing the preview…' : 'Preview'}
            </button>
            {data.state !== 'off' ? (
              <button type="button" className={secondaryButtonClass} onClick={turnOff} aria-busy={busy === 'disable'}>
                {busy === 'disable' ? 'Turning off…' : 'Turn off'}
              </button>
            ) : null}
          </div>
        </form>

        {result ? (
          <section aria-labelledby="schedule-result-heading" className="flex flex-col gap-2xs">
            <h3 id="schedule-result-heading" ref={resultRef} tabIndex={-1} className="text-admin-base font-bold text-admin-ink">
              Result
            </h3>
            <Notice tone={result.tone} message={result.message} />
          </section>
        ) : null}

        {preview ? (
          <section aria-labelledby="schedule-preview-heading" className="flex flex-col gap-sm">
            <h3 id="schedule-preview-heading" className="text-admin-base font-bold text-admin-ink">Preview</h3>
            {preview.usedFallback ? (
              <Notice tone="caution" message="The saved reminder wording failed its check, so these messages use the shipped wording. Approving approves the shipped wording." />
            ) : null}
            {preview.samples.map((sample) => (
              <SampleMessage key={sample.windowKey} sample={sample} timeZone={timeZone} />
            ))}
            <div>
              <button type="button" className={primaryButtonClass} onClick={approve} aria-busy={busy === 'approve'}>
                {busy === 'approve' ? 'Approving…' : 'Approve and turn on'}
              </button>
            </div>
          </section>
        ) : null}

        <NextRunPanel data={data} />
      </div>
    </Panel>
  );
}

export default function AdminReminderSchedules() {
  const call = useAdminApi();
  return (
    <div className="flex flex-col gap-md">
      <AdminPageHeader
        title="Scheduled reminders"
        description="Reminders that go out on their own, once an hour when one is due, with the wording you approved. Every schedule is off until you preview it and approve it."
        actions={<Link to="/admin/speakers/reminders/send" className={linkButtonClass}>Speaker reminders</Link>}
      />
      <SpeakerSchedule call={call} />
    </div>
  );
}
