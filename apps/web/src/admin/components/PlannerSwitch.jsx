import { useId } from 'react';
import { fieldHintClass, fieldLabelClass } from './formControls.jsx';

export default function PlannerSwitch({ label, checked, onChange, hint, disabled, ...props }) {
  const id = useId();
  return <div className="flex min-w-0 flex-col gap-3xs">
    <label className={`flex min-h-admin-control cursor-pointer items-center gap-xs ${fieldLabelClass}`}>
      <input {...props} type="checkbox" role="switch" className="peer sr-only" checked={Boolean(checked)} disabled={disabled}
        aria-describedby={hint ? `${id}-hint` : undefined} onChange={(event) => onChange(event.target.checked)} />
      <span aria-hidden="true" className="relative h-6 w-11 shrink-0 rounded-admin border-admin-hairline border-admin-rule-control bg-admin-ground-soft after:absolute after:start-0.5 after:top-0.5 after:h-[18px] after:w-[18px] after:rounded-admin-small after:bg-admin-ink-secondary peer-checked:bg-admin-action peer-checked:after:translate-x-5 peer-checked:after:bg-admin-ink-inverse peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-admin-action peer-disabled:opacity-60" />
      <span>{label}</span>
    </label>
    {hint ? <p id={`${id}-hint`} className={fieldHintClass}>{hint}</p> : null}
  </div>;
}
