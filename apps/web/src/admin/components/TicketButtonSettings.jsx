import { useState } from 'react';
import { DEFAULT_TICKET_BUTTON_LABEL, MAX_TICKET_BUTTON_LABEL_LENGTH } from 'shared/registration';
import BusyLabel from '../../components/BusyLabel.jsx';
import { ticketButtonClass } from '../../components/controlClasses.js';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { plannerMessage } from '../plannerErrors.js';
import { settingsConflict } from '../settingsChanges.js';
import { Notice, Panel, SelectField, TextField, primaryButtonClass } from './formControls.jsx';

const STYLE_OPTIONS = [
  { value: 'primary', label: 'Primary' },
  { value: 'outline', label: 'Outline' },
];

export default function TicketButtonSettings({ call }) {
  const { eventConfig, liveEventConfig } = useEventConfig();
  const registration = eventConfig?.registration;
  const [draft, setDraft] = useState({});
  const [expected, setExpected] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const label = draft.ticketButtonLabel ?? registration?.ticketButtonLabel ?? '';
  const style = draft.ticketButtonStyle ?? registration?.ticketButtonStyle ?? 'primary';

  function edit(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
    const stored = (liveEventConfig ?? eventConfig)?.registration?.[field] ?? null;
    setExpected((current) => Object.hasOwn(current, field) ? current : { ...current, [field]: stored });
    setSaved(false);
    setError(null);
  }

  async function save(event) {
    event.preventDefault();
    if (saving || Object.keys(draft).length === 0) return;
    setSaving(true);
    setError(null);
    const patch = { ...draft };
    if ('ticketButtonLabel' in patch) patch.ticketButtonLabel = label.trim() || null;
    try {
      await call('updateEventConfig', {
        event: { changes: { registration: patch }, expected: { registration: expected } },
      });
      setSaved(true);
      setDraft({});
      setExpected({});
    } catch (err) {
      setError(settingsConflict(err)?.message
        ?? plannerMessage(err?.message ?? 'The ticket button could not be saved.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel title="Ticket button" description="Shown in the site header and on the home page after you publish tickets.">
      <form className="flex flex-col gap-sm" onSubmit={save}>
        <TextField label="Button label" value={label} placeholder={DEFAULT_TICKET_BUTTON_LABEL}
          maxLength={MAX_TICKET_BUTTON_LABEL_LENGTH} disabled={saving}
          hint="Leave blank to use Get tickets."
          help={`Enter up to ${MAX_TICKET_BUTTON_LABEL_LENGTH} characters for the ticket button.`}
          onChange={(value) => edit('ticketButtonLabel', value)} />
        <SelectField label="Button style" value={style} options={STYLE_OPTIONS} disabled={saving}
          help="Primary uses the site's accent color. Outline uses a border."
          onChange={(value) => edit('ticketButtonStyle', value)} />
        <div role="group" aria-label="Ticket button preview" className="flex flex-col items-start gap-2xs">
          <p className="text-admin-sm text-admin-ink-secondary">Preview</p>
          <span className={ticketButtonClass(style)}>
            {label.trim() || DEFAULT_TICKET_BUTTON_LABEL}
          </span>
        </div>
        <div>
          <button type="submit" className={primaryButtonClass} disabled={saving || Object.keys(draft).length === 0}>
            <BusyLabel busy={saving} pending="Saving ticket button…">Save ticket button</BusyLabel>
          </button>
        </div>
        {saved ? <Notice tone="ok" message="Ticket button saved." /> : null}
        {error ? <Notice tone="error" message={error} /> : null}
      </form>
    </Panel>
  );
}
