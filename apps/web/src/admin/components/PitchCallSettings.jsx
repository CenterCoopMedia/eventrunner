import { plannerError } from '../plannerErrors.js';
// The call for sessions: open or closed, its deadline, and where people
// pitch. Operator-only. Moved unchanged from the pitch page so the queue
// holds the queue alone (ADR 0008, admin review).
import PlannerSwitch from './PlannerSwitch.jsx';
import { useEffect, useId, useRef, useState } from 'react';
import { readPitchFormUrl } from 'shared/pitch';
import { focusFirstError } from '../../lib/focusFirstError.js';
import EventDateTimeField from './EventDateTimeField.jsx';
import { Radio } from '../../components/forms/Choice.jsx';
import { sameCallSettings } from '../pitchCallSettings.js';
import { Panel, Notice, SaveStatus, TextField, SelectField,
  ServerErrorSummary, fieldHintClass, fieldLabelClass, primaryButtonClass, secondaryButtonClass } from './formControls.jsx';

// A stored null deadline is "Open until I close it" (issue #476). A
// missing deadline (no saved call yet) starts on a set date and time.
const deadlineModeOf = (settings) => (settings?.closesAt === null ? 'open' : 'date');
const intakeOptions = [
  { value: 'native', label: 'This site’s pitch form' },
  { value: 'external', label: 'An external form, such as Airtable' },
];

export default function PitchCallSettings({ settings, call, timeZone }) {
  const [baseline, setBaseline] = useState(settings);
  const [enabled, setEnabled] = useState(settings.enabled === true);
  const [closesAt, setClosesAt] = useState(settings.closesAt || '');
  const [deadlineMode, setDeadlineMode] = useState(deadlineModeOf(settings));
  const deadlineModeId = useId();
  const [deadlineProblem, setDeadlineProblem] = useState(null);
  const [showDeadlineError, setShowDeadlineError] = useState(false);
  const [refused, setRefused] = useState(0);
  const [savedElsewhere, setSavedElsewhere] = useState(false);
  // The same reader as the server and /pitch, so the choice shown is the one in effect.
  const savedFormUrl = readPitchFormUrl(settings.externalFormUrl);
  const [intake, setIntake] = useState(savedFormUrl ? 'external' : 'native');
  const [formUrl, setFormUrl] = useState(savedFormUrl || '');
  const [formUrlError, setFormUrlError] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const errorRef = useRef(null);
  const formRef = useRef(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => { if (refused) focusFirstError(formRef.current); }, [refused]);
  function load(next) {
    const nextFormUrl = readPitchFormUrl(next.externalFormUrl);
    setBaseline(next); setEnabled(next.enabled === true); setClosesAt(next.closesAt || ''); setDeadlineMode(deadlineModeOf(next));
    setIntake(nextFormUrl ? 'external' : 'native'); setFormUrl(nextFormUrl || ''); setFormUrlError(''); setSavedElsewhere(false);
  }
  // The panel is not keyed on the saved values: a remount on this panel's own
  // save dropped "Call settings saved." and the focus with it (#476). A
  // snapshot that matches the form, or arrives while nothing is edited, is
  // taken in place. One that differs from unsaved edits keeps the edits.
  // The date stays in state while "Open until I close it" is chosen, so
  // going back to a set deadline brings the earlier date back.
  const effectiveClosesAt = deadlineMode === 'open' ? null : closesAt;
  const formNow = { enabled, closesAt: effectiveClosesAt, externalFormUrl: intake === 'external' ? formUrl.trim() : null };
  useEffect(() => {
    if (sameCallSettings(settings, baseline)) return;
    if (sameCallSettings(formNow, settings) || sameCallSettings(formNow, baseline)) load(settings);
    else { setBaseline(settings); setSavedElsewhere(true); }
  }, [settings]); // eslint-disable-line react-hooks/exhaustive-deps -- runs only when the saved settings change
  async function save(e) {
    e.preventDefault();
    if (busy) return;
    const externalFormUrl = intake === 'external' ? formUrl.trim() : null;
    // A blank address would save as "no external form" and silently reopen native intake.
    const formUrlProblem = intake !== 'external' ? ''
      : !externalFormUrl ? 'Enter the form address, or choose this site’s pitch form.'
        : !readPitchFormUrl(externalFormUrl) ? 'Use an address that starts with https://.' : '';
    // Mark every refused field at once. Focus goes to the first one, and an
    // earlier "Call settings saved." does not stay beside the new errors.
    const dateProblem = deadlineMode === 'date' ? deadlineProblem : null;
    if (dateProblem || formUrlProblem) {
      if (dateProblem) setShowDeadlineError(true);
      setFormUrlError(formUrlProblem);
      setResult('');
      setRefused((count) => count + 1);
      return;
    }
    setFormUrlError(''); setError(null); setResult(''); setBusy(true);
    try { await call('updatePitchCall', { enabled, closesAt: effectiveClosesAt, externalFormUrl }); setSavedElsewhere(false); setResult('Call settings saved.'); }
    catch (err) { setError(plannerError(err)); }
    finally { setBusy(false); }
  }
  return <Panel title="Call settings" description="Choose when and where people can submit proposals.">
    <form ref={formRef} onSubmit={save} className="space-y-sm">
      <ServerErrorSummary error={error} errorRef={errorRef} />
      {savedElsewhere ? <><Notice tone="caution" message="The saved call settings changed. Your unsaved edits are still here. Saving replaces the saved settings." /><button type="button" className={secondaryButtonClass} onClick={() => load(baseline)} disabled={busy}>Load saved settings</button></> : null}
      <fieldset disabled={busy} className="space-y-sm">
        <PlannerSwitch label="Accept session pitches" checked={enabled} onChange={setEnabled} />
        <fieldset className="flex min-w-0 flex-col gap-3xs">
          <legend className={`${fieldLabelClass} mb-3xs`}>When intake closes</legend>
          <Radio tone="admin" name={`${deadlineModeId}-mode`} value="date" checked={deadlineMode === 'date'} onChange={() => setDeadlineMode('date')} label="At a set date and time" />
          <Radio tone="admin" name={`${deadlineModeId}-mode`} value="open" checked={deadlineMode === 'open'} onChange={() => setDeadlineMode('open')} label="Open until I close it" aria-describedby={deadlineMode === 'open' ? `${deadlineModeId}-open-hint` : undefined} />
          {deadlineMode === 'open' ? <p id={`${deadlineModeId}-open-hint`} className={`${fieldHintClass} text-pretty`}>Turn off “Accept session pitches” to close the call.</p> : null}
        </fieldset>
        {deadlineMode === 'date' ? <EventDateTimeField label="Deadline" value={closesAt} timeZone={timeZone} onChange={(value) => setClosesAt(value || '')} onProblemChange={setDeadlineProblem} required showError={showDeadlineError} summaryPrefix="Intake closes" emptySummary="No deadline is set. Enter one, or choose “Open until I close it”." hint="Intake closes at this date and time." /> : null}
        <SelectField label="Where people pitch" value={intake} onChange={setIntake} options={intakeOptions} hint="With an external form, the site links to it. Pitches reach this queue through a refresh from Airtable or a CSV import." />
        {intake === 'external' ? <TextField name="externalFormUrl" label="External form address" type="url" value={formUrl} onChange={(v) => { setFormUrl(v); setFormUrlError(''); }} required maxLength={2048} error={formUrlError} hint="Use the form’s public https:// share link." /> : null}
      </fieldset>
      <button aria-label="Save call settings" className={primaryButtonClass} aria-disabled={busy} aria-busy={busy}>{busy ? 'Saving…' : 'Save'}</button>
      {result ? <SaveStatus message={result} /> : null}
    </form>
  </Panel>;
}

