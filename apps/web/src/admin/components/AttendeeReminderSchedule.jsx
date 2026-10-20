// The attendee panel of the Scheduled reminders page (issue #518, ADR
// 0006): "the event is in N days", with the time, the place and the ticket
// link, to registered attendees before the event starts.
// functions/src/reminders/attendeeActions.cjs is the server side.
//
// The path is settings and wording → save → preview → approve, as in the
// speaker panel. The wording is plain text with one placeholder,
// {{days_until}}. The server adds the facts (start, venue, ticket link) and
// sends on the announcement stream, with the unsubscribe link. Approval
// binds the wording, the settings and the facts the preview showed. The
// next-run panel gives counts only: attendee addresses never reach it.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { buildPreviewDoc } from '../emailPreview.js';
import {
  attendeeLastRunWords,
  attendeeStateWords,
  attendeeWord,
  addressWord,
  draftProblems,
  eventTime,
  nextRunWords,
  reachWords,
  readOffsetInputs,
} from '../reminderSchedules.js';
import { describeTimeZone } from '../../lib/eventDateTime.js';
import {
  FieldError,
  Notice,
  Panel,
  TextAreaField,
  TextField,
  linkButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from './formControls.jsx';
import { AdminLoadingState, StatusBadge } from './adminChrome.jsx';

const STATE_TONES = { on: 'ok', paused: 'caution', off: 'dead' };
const STATE_LABELS = { on: 'On', paused: 'Paused', off: 'Off' };

function formFrom(data) {
  return {
    offsets: data.settings.offsetsDays.map(String),
    sendTime: data.settings.sendTime,
    subject: data.settings.draft.subject,
    message: data.settings.draft.message,
  };
}

function sameForm(form, data) {
  const offsets = readOffsetInputs(form.offsets).days;
  const { settings } = data;
  return JSON.stringify([offsets, form.sendTime, form.subject.trim(), form.message.trim()])
    === JSON.stringify([settings.offsetsDays, settings.sendTime, settings.draft.subject, settings.draft.message]);
}

function dayWords(days) {
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

function SampleMessage({ sample, timeZone }) {
  const srcDoc = useMemo(() => (sample.html ? buildPreviewDoc(sample.html) : null), [sample.html]);
  const name = `Attendee reminder, ${dayWords(sample.offsetDays)} before`;
  return (
    <section aria-label={name} className="flex flex-col gap-xs border-admin-rule-hairline border-t-admin-hairline pt-sm">
      <h4 className="text-admin-base font-bold text-admin-ink">{name}</h4>
      <p className="text-admin-sm text-admin-ink">
        Sends from {eventTime(sample.opensAt, timeZone)}.
        {sample.state === 'closed' ? ' This reminder date has passed, so it will not send.' : ''}
        {sample.state === 'empty' ? ' Quiet hours cover this whole reminder, so it will not send.' : ''}
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-sm gap-y-3xs text-admin-sm">
        <dt className="font-semibold text-admin-ink">Subject</dt>
        <dd className="wrap-anywhere text-admin-ink">{sample.subject}</dd>
      </dl>
      {srcDoc ? (
        <iframe
          sandbox=""
          srcDoc={srcDoc}
          referrerPolicy="no-referrer"
          title={`${name}, preview`}
          className="block h-[20rem] w-full rounded-admin border-admin-hairline border-admin-rule-hairline [color-scheme:light]"
        />
      ) : null}
      <details open={!srcDoc} className="text-admin-sm">
        <summary className="admin-target cursor-pointer font-semibold text-admin-ink">Plain text version</summary>
        <pre data-testid={`attendee-preview-text-${sample.offsetDays}`} className="mt-2xs max-h-[20rem] overflow-auto whitespace-pre-wrap break-words font-admin-data text-admin-sm text-admin-ink-data">
          {sample.text}
        </pre>
      </details>
    </section>
  );
}

function NextRun({ data, headingId }) {
  const { nextRun, timeZone, state } = data;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-xs">
      <h3 id={headingId} className="text-admin-base font-bold text-admin-ink">Next run</h3>
      {state !== 'on' ? (
        <p className="text-admin-sm text-admin-ink">Nothing sends while the schedule is {state === 'paused' ? 'paused' : 'off'}. This is what it would do when on.</p>
      ) : null}
      <p className="text-admin-sm text-admin-ink" data-testid="attendee-next-run">{nextRunWords(nextRun, timeZone)}</p>
      {nextRun?.reach ? <p className="text-admin-sm text-admin-ink">{reachWords(nextRun.reach)}</p> : null}
      <p className="text-admin-sm text-admin-ink" data-testid="attendee-last-run">{attendeeLastRunWords(data.lastRun, timeZone)}</p>
    </section>
  );
}

function Facts({ facts }) {
  if (!facts.ok) return <Notice tone="caution" message={`The reminder cannot be prepared: ${facts.problem}`} />;
  return (
    <section aria-label="What every attendee reminder states" className="flex flex-col gap-2xs">
      <p className="text-admin-sm text-admin-ink-secondary">
        The site adds these after your message, from Event settings. A change to any of them pauses the schedule.
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-sm gap-y-3xs text-admin-sm">
        <dt className="font-semibold text-admin-ink">Starts</dt>
        <dd className="text-admin-ink">{facts.when}</dd>
        <dt className="font-semibold text-admin-ink">Where</dt>
        <dd className="text-admin-ink">{facts.where || 'No venue is set. The reminder leaves the place out.'}</dd>
        <dt className="font-semibold text-admin-ink">Ticket link</dt>
        <dd className="wrap-anywhere font-admin-data text-admin-ink-data">{facts.ticketUrl}</dd>
      </dl>
    </section>
  );
}

export default function AttendeeReminderSchedule({ call }) {
  const offsetsId = useId();
  const nextRunId = useId();
  const resultId = useId();
  const previewId = useId();
  const resultRef = useRef(null);
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [form, setForm] = useState(null);
  const [offsetsProblem, setOffsetsProblem] = useState(null);
  const [wordingProblems, setWordingProblems] = useState({ subject: null, message: null });
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(null); // 'save' | 'preview' | 'approve' | 'disable'
  const [result, setResult] = useState(null); // { tone, message, seq }

  const show = useCallback((tone, message) => {
    setResult((current) => ({ tone, message, seq: (current?.seq ?? 0) + 1 }));
  }, []);

  const load = useCallback(async () => {
    try {
      const next = await call('reminderSchedules', { action: 'get', schedule: 'attendees' });
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

  const body = (() => {
    if (loadError && !data) return <Notice tone="error" message={loadError} />;
    if (!data || !form) return <AdminLoadingState label="Loading the attendee schedule…" />;
    return null;
  })();
  if (body) {
    return (
      <Panel title="Attendees" description="Email registered attendees before the event starts.">
        {body}
      </Panel>
    );
  }

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

  async function run(kind, request, onDone) {
    if (busy) return;
    setBusy(kind);
    try {
      const next = await call('reminderSchedules', { schedule: 'attendees', ...request });
      if (next?.refreshError) {
        // The change is stored; only the read after it failed.
        setPreview(null);
        show('caution', next.refreshError);
        await load();
        return;
      }
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
    const problems = draftProblems({ subject: form.subject, message: form.message }, data.limits);
    setOffsetsProblem(offsets.problem);
    setWordingProblems(problems);
    const first = offsets.problem ?? problems.subject ?? problems.message;
    if (first) {
      show('error', first);
      return;
    }
    run('save', {
      action: 'save',
      offsetsDays: offsets.days,
      sendTime: form.sendTime,
      draft: { subject: form.subject.trim(), message: form.message.trim() },
    }, (next) => {
      apply(next);
      setPreview(null);
      const paused = next.state === 'paused' && data.state === 'on';
      show(paused ? 'caution' : 'ok', paused
        ? 'Attendee settings saved. The schedule is paused until you preview and approve it again.'
        : 'Attendee settings saved.');
    });
  }

  function runPreview() {
    if (dirty) {
      show('error', 'Save the settings first, then preview.');
      return;
    }
    run('preview', { action: 'preview' }, (next) => {
      setPreview(next);
      show('ok', `Preview ready: ${next.samples.length} ${next.samples.length === 1 ? 'reminder' : 'reminders'}.`);
    });
  }

  function approve() {
    run('approve', {
      action: 'approve',
      wordingVersion: preview.wordingVersion,
      settingsVersion: preview.settingsVersion,
      factsVersion: preview.factsVersion,
    }, (next) => {
      apply(next);
      setPreview(null);
      show('ok', 'Approved. Scheduled attendee reminders are on.');
    });
  }

  function turnOff() {
    run('disable', { action: 'disable' }, (next) => {
      apply(next);
      show('ok', 'Scheduled attendee reminders are off.');
    });
  }

  const zone = timeZone ? describeTimeZone(timeZone) : 'the event’s time zone';

  return (
    <Panel
      title="Attendees"
      description="Email registered attendees before the event starts: the days left, the start time, the place and their ticket link. It goes as an announcement, with an unsubscribe link, and never to an address that unsubscribed."
      actions={<StatusBadge tone={STATE_TONES[data.state]}>{STATE_LABELS[data.state]}</StatusBadge>}
    >
      <div className="flex flex-col gap-md">
        <p className="text-admin-base font-semibold text-admin-ink" data-testid="attendee-schedule-state">
          {attendeeStateWords(data.state)}
          {data.state !== 'off' && data.approval?.at ? ` Approved ${eventTime(data.approval.at, timeZone)} by ${data.approval.by ?? 'an admin'}.` : ''}
        </p>
        {data.paused ? <Notice tone="caution" message={`Paused: ${data.paused.message}`} /> : null}
        {data.state === 'on' && !data.wording.matchesApproval ? (
          <Notice tone="caution" message="The attendee reminder wording is not the wording you approved. The next run sends nothing and pauses the schedule. Preview, then approve again." />
        ) : null}
        {data.state === 'on' && !data.facts.matchesApproval ? (
          <Notice tone="caution" message="The event start, the venue or the ticket link is not what you approved. The next run sends nothing and pauses the schedule. Preview, then approve again." />
        ) : null}
        {!data.channel.canSend ? (
          <Notice tone="caution" message={`Announcement email cannot be sent now: ${data.channel.blocker}`} />
        ) : null}
        {data.eventEnded ? <Notice tone="info" message="The event has ended. Scheduled reminders do not send." /> : null}

        <Facts facts={data.facts} />

        <form className="flex flex-col gap-md" onSubmit={save} noValidate>
          <fieldset aria-describedby={`${offsetsId}-hint`} className="flex flex-col gap-xs">
            <legend className="text-admin-base font-semibold text-admin-ink">Days before the event</legend>
            <p id={`${offsetsId}-hint`} className="text-admin-sm text-admin-ink-secondary">
              One reminder for each number, counted back from the start of the first event day. The default is 7 and 1 days.
            </p>
            {form.offsets.map((value, index) => (
              <div key={index} className="flex flex-wrap items-end gap-xs">
                <TextField
                  label={`Attendee reminder ${index + 1}, days before`}
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
                    Remove attendee reminder {index + 1}
                  </button>
                ) : null}
              </div>
            ))}
            {form.offsets.length < data.limits.maxOffsets ? (
              <div>
                <button type="button" className={secondaryButtonClass} onClick={() => update({ offsets: [...form.offsets, ''] })}>
                  Add an attendee reminder
                </button>
              </div>
            ) : null}
            <FieldError message={offsetsProblem} />
          </fieldset>

          <TextField
            label="Attendee send time"
            type="time"
            value={form.sendTime}
            onChange={(value) => update({ sendTime: value })}
            hint={`On the event clock, ${zone}. Nothing sends from 8:00 PM to 8:00 AM; a reminder due then waits for 8:00 AM.`}
          />

          <TextField
            label="Attendee reminder subject"
            value={form.subject}
            onChange={(value) => update({ subject: value })}
            maxLength={data.limits.maxSubjectLength}
            error={wordingProblems.subject}
            hint={`Plain text. ${data.placeholder} becomes the days left, for example “7 days” or “1 day”.`}
          />
          <TextAreaField
            label="Attendee reminder message"
            rows={5}
            value={form.message}
            onChange={(value) => update({ message: value })}
            maxLength={data.limits.maxMessageLength}
            error={wordingProblems.message}
            hint={`Plain text. A blank line starts a new paragraph. ${data.placeholder} is the only placeholder. The site adds the start, the place and the ticket link after your message.`}
          />

          <div className="flex flex-wrap items-center gap-xs">
            <button type="submit" className={primaryButtonClass} aria-busy={busy === 'save'}>
              {busy === 'save' ? 'Saving…' : 'Save attendee settings'}
            </button>
            <button type="button" className={secondaryButtonClass} onClick={runPreview} aria-busy={busy === 'preview'}>
              {busy === 'preview' ? 'Preparing the preview…' : 'Preview attendee reminders'}
            </button>
            {data.state !== 'off' ? (
              <button type="button" className={secondaryButtonClass} onClick={turnOff} aria-busy={busy === 'disable'}>
                {busy === 'disable' ? 'Turning off…' : 'Turn off attendee reminders'}
              </button>
            ) : null}
          </div>
        </form>

        {result ? (
          <section aria-labelledby={resultId} className="flex flex-col gap-2xs">
            <h3 id={resultId} ref={resultRef} tabIndex={-1} className="text-admin-base font-bold text-admin-ink">
              Result
            </h3>
            <Notice tone={result.tone} message={result.message} />
          </section>
        ) : null}

        {preview ? (
          <section aria-labelledby={previewId} className="flex flex-col gap-sm">
            <h3 id={previewId} className="text-admin-base font-bold text-admin-ink">Attendee reminder preview</h3>
            <p className="text-admin-sm text-admin-ink">
              {preview.recipientCount === null
                ? ''
                : `It would reach ${attendeeWord(preview.recipientCount)} now.`}
              {preview.suppressedCount
                ? ` ${addressWord(preview.suppressedCount)} unsubscribed and ${preview.suppressedCount === 1 ? 'is' : 'are'} left out.`
                : ''}
              {preview.from ? ` From ${preview.from}.` : ''}
            </p>
            <p className="text-admin-sm text-admin-ink-secondary">{preview.unsubscribeNote}</p>
            {preview.samples.map((sample) => (
              <SampleMessage key={sample.windowKey} sample={sample} timeZone={timeZone} />
            ))}
            {preview.canSend ? (
              <div>
                <button type="button" className={primaryButtonClass} onClick={approve} aria-busy={busy === 'approve'}>
                  {busy === 'approve' ? 'Approving…' : 'Approve and turn on attendee reminders'}
                </button>
              </div>
            ) : (
              <Notice tone="caution" message={`These reminders cannot be approved yet: ${preview.blocker}`} />
            )}
          </section>
        ) : null}

        <NextRun data={data} headingId={nextRunId} />
      </div>
    </Panel>
  );
}
