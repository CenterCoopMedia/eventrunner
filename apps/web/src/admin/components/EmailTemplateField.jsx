import { useRef } from 'react';
import { SelectField, TextAreaField, TextField } from './formControls.jsx';

const DETAILS = Object.freeze({
  event_name: 'Event name', site_url: 'Event website', support_email: 'Support email',
  event_date: 'Event date', event_dates: 'Event dates', event_location: 'Event location',
  speaker_name: 'Speaker name', invite_url: 'Invitation link', invite_type: 'Invitation type',
  admin_contact_email: 'Organizer email', profile_wizard_url: 'Profile link', deadline: 'Deadline',
  dashboard_url: 'Speaker dashboard link', materials_sessions: 'Sessions needing materials',
  bio_missing: 'Missing biography', headshot_missing: 'Missing headshot',
  description_sessions: 'Sessions needing descriptions', session_description_sessions: 'Sessions needing a description',
  pitch_title: 'Pitch title', first_name: 'First name', last_name: 'Last name',
});

const detailLabel = (key) => DETAILS[key] ?? key.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());

// Keep the stored template format at the API boundary. The form uses names
// that people can read, including the optional sections in reminder emails.
export function displayTemplate(value = '') {
  return value.replace(/{{\s*([^{}]+?)\s*}}/g, (_, key) => {
    if (key === '/if') return '[End optional section]';
    if (key.startsWith('#if ')) return `[When ${detailLabel(key.slice(4)).toLowerCase()} is available]`;
    return `[${detailLabel(key)}]`;
  });
}

export function storedTemplate(value, tokens = []) {
  const keys = [...new Set([...Object.keys(DETAILS), ...tokens])];
  let next = value.replaceAll('[End optional section]', '{{/if}}');
  for (const key of keys) {
    next = next.replaceAll(`[${detailLabel(key)}]`, `{{${key}}}`)
      .replaceAll(`[When ${detailLabel(key).toLowerCase()} is available]`, `{{#if ${key}}}`);
  }
  return next;
}

export function emailHtmlFromText(text) {
  const escaped = text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const linked = escaped.replace(/{{(invite_url|profile_wizard_url|dashboard_url|site_url)}}/g,
    (_, key) => `<a href="{{${key}}}">${detailLabel(key)}</a>`);
  return linked.split(/\n\s*\n/).map((paragraph) => `<p>${paragraph.replaceAll('\n', '<br>')}</p>`).join('\n');
}

export function templateProblem(message = '') {
  if (/unknown token|missing required token|unsupported token/i.test(message)) {
    return /missing required/i.test(message)
      ? 'A required link is missing. Add it from the details menu and try again.'
      : 'A detail is not recognized. Remove it or choose one from the details menu, then try again.';
  }
  return displayTemplate(message).replace(/^(?:html|text|subject):\s*/i, '');
}

export function TemplateTextField({ value, onChange, tokens = [], ...props }) {
  return <TextField {...props} value={displayTemplate(value)} onChange={(next) => onChange(storedTemplate(next, tokens))} />;
}

export function TemplateMessageField({ value, onChange, tokens = [], ...props }) {
  const wrapper = useRef(null);
  function insert(key) {
    if (!key) return;
    const field = wrapper.current?.querySelector('textarea');
    const shown = displayTemplate(value);
    const start = field?.selectionStart ?? shown.length;
    const end = field?.selectionEnd ?? start;
    const detail = `[${detailLabel(key)}]`;
    onChange(storedTemplate(`${shown.slice(0, start)}${detail}${shown.slice(end)}`, tokens));
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(start + detail.length, start + detail.length);
    });
  }
  return <div ref={wrapper} className="flex min-w-0 flex-col gap-xs">
    <TextAreaField {...props} value={displayTemplate(value)} onChange={(next) => onChange(storedTemplate(next, tokens))} />
    {tokens.length ? <SelectField label={`Add a detail to ${props.label.toLowerCase()}`} value="" onChange={insert}
      options={[{ value: '', label: 'Choose a detail' }, ...tokens.map((key) => ({ value: key, label: detailLabel(key) }))]} /> : null}
  </div>;
}
