import { useId } from 'react';
import HelpTooltip from './HelpTooltip.jsx';
import './featureSwitch.css';

export default function ReminderScheduleSwitch({ label, checked, disabled, onChange, help }) {
  const id = useId();
  return (
    <div className="flex min-h-admin-control items-center gap-xs">
      <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} className="admin-feature-switch" onChange={(event) => onChange(event.target.checked)} aria-describedby={help ? `${id}-help` : undefined} />
      <label htmlFor={id} className="text-admin-sm font-semibold text-admin-ink">{label}</label>
      <HelpTooltip label={label} id={`${id}-help`}>{help}</HelpTooltip>
    </div>
  );
}
