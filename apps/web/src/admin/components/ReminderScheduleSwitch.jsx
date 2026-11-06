import { useId } from 'react';
import './featureSwitch.css';

export default function ReminderScheduleSwitch({ label, checked, disabled, onChange }) {
  const id = useId();
  return (
    <div className="flex min-h-admin-control items-center gap-xs">
      <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} className="admin-feature-switch" onChange={(event) => onChange(event.target.checked)} />
      <label htmlFor={id} className="text-admin-sm font-semibold text-admin-ink">{label}</label>
    </div>
  );
}
