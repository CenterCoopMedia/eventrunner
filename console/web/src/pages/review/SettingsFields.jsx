import { SETTING_FIELDS } from '../../reviewText.js';

/**
 * Text fields for build settings, each with a label, a hint and its own
 * error. `fieldRefs` collects the inputs, so the form can focus the field
 * an error is about.
 */
export default function SettingsFields({ fields, values, onChange, error, fieldRefs, idPrefix, disabled = false }) {
  return fields.map((field) => {
    const spec = SETTING_FIELDS[field];
    const id = `${idPrefix}-${field}`;
    const invalid = error?.field === field;
    const described = [`${id}-hint`, invalid ? `${id}-error` : null].filter(Boolean).join(' ');
    return (
      <div className="field" key={field}>
        <label htmlFor={id}>{spec.label}</label>
        <p id={`${id}-hint`} className="hint">{spec.hint}</p>
        <input
          id={id}
          ref={(node) => { fieldRefs.current[field] = node; }}
          type="text"
          autoComplete="off"
          spellCheck="false"
          value={values[field] ?? ''}
          disabled={disabled}
          onChange={(e) => onChange(field, e.target.value)}
          aria-invalid={invalid ? 'true' : undefined}
          aria-describedby={described}
        />
        {invalid ? <p id={`${id}-error`} className="field-error">{error.message}</p> : null}
      </div>
    );
  });
}
