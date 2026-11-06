// Form fields for the guided setup. Each field has a visible label, an
// optional hint, and its error under it, tied to the control with
// aria-describedby and aria-invalid, so a screen reader reads both.

/** A DOM id from a field path, for example 'event.days.0.date' -> 'f-event-days-0-date'. */
export function fieldId(path) {
  return `f-${path.replace(/[^a-zA-Z0-9]+/g, '-')}`;
}

function describedBy(id, hint, error) {
  const ids = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean);
  return ids.length > 0 ? ids.join(' ') : undefined;
}

/**
 * @param {{ path: string, label: string, value: string, onChange: (value: string) => void,
 *   onBlur?: () => void, error?: string, hint?: string, type?: string, multiline?: boolean,
 *   autoComplete?: string, inputMode?: string, maxLength?: number, children?: any }} props
 */
export function TextField({
  path, label, value, onChange, onBlur, error, hint, type = 'text', multiline = false,
  autoComplete = 'off', inputMode, maxLength = 1000, className = '',
}) {
  const id = fieldId(path);
  const common = {
    id,
    name: path,
    value: value ?? '',
    onChange: (e) => onChange(e.target.value),
    onBlur,
    autoComplete,
    maxLength,
    'aria-invalid': error ? 'true' : undefined,
    'aria-describedby': describedBy(id, hint, error),
  };
  return (
    <div className={`field ${className}`.trim()}>
      <label htmlFor={id}>{label}</label>
      {multiline ? <textarea rows={3} {...common} /> : <input type={type} inputMode={inputMode} {...common} />}
      {hint ? <p id={`${id}-hint`} className="hint">{hint}</p> : null}
      {error ? <p id={`${id}-error`} className="field-error">{error}</p> : null}
    </div>
  );
}

/** A select with the same label, hint and error pattern. */
export function SelectField({ path, label, value, onChange, onBlur, error, hint, options }) {
  const id = fieldId(path);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        name={path}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy(id, hint, error)}
      >
        <option value="">Choose one</option>
        {options.map((option) => {
          const value = typeof option === 'string' ? option : option.value;
          const label = typeof option === 'string' ? option.replaceAll('_', ' ') : option.label;
          return <option key={value} value={value}>{label}</option>;
        })}
      </select>
      {hint ? <p id={`${id}-hint`} className="hint">{hint}</p> : null}
      {error ? <p id={`${id}-error`} className="field-error">{error}</p> : null}
    </div>
  );
}

/** An error that belongs to a group of fields, for example "Add at least one day". */
export function GroupError({ path, error }) {
  if (!error) return null;
  return <p id={`${fieldId(path)}-error`} className="field-error" data-group-error={path}>{error}</p>;
}
