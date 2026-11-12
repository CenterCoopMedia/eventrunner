import HelpTooltip from '../components/HelpTooltip.jsx';
// Speaker mail wording (issue #204): staff change the words of the speaker
// invitation and the acceptance confirmation
// (functions/src/speakers/mailTemplates.cjs, one staff endpoint with
// actions).
//
// Each message has its own editor. The server checks every save against the
// tokens the message may use and the link it must keep, and refuses an
// unknown token. Preview renders, on the server, the exact subject, HTML and
// plain text with sample values: the wording in the form, saved or not. The
// next invitation or acceptance uses the saved wording, because the send
// reads it fresh each time. "Use the shipped wording" deletes the saved
// wording.
//
// The layout follows the reminder wording editor in AdminSpeakerReminders.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { useAdminApi } from '../adminApi.js';
import { buildPreviewDoc } from '../emailPreview.js';
import { formatWhen } from '../speakerReminders.js';
import { focusFirstError } from '../../lib/focusFirstError.js';
import {
  DestructiveConfirm,
  Notice,
  Panel,
  TextAreaField,
  TextField,
  linkButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import AdminPageHeader, { AdminLoadingState } from '../components/adminChrome.jsx';

const ENDPOINT = 'speakerMailTemplates';

const MESSAGES = {
  'speaker.invite': {
    title: 'Invitation',
    description: 'The email a speaker gets when staff send or resend an invitation. It carries the private link that accepts it.',
    fields: [
      { name: 'subject', label: 'Subject', help: "Write the subject line speakers see in their inbox.", singleLine: true },
      { name: 'greeting', label: 'Greeting', help: "Write how the email greets the speaker. Keep the supported name placeholders." },
      { name: 'invitation', label: 'Invitation', help: "Explain why the speaker is invited and what they should do next." },
      { name: 'signInInstructions', label: 'Sign-in instructions', help: "Explain how the speaker uses the invitation link to sign in." },
      { name: 'buttonLabel', label: 'Button label', help: "Write the short action label on the email’s button.", singleLine: true },
      { name: 'backupLinkInstructions', label: 'Backup-link instructions', help: "Explain how to use the backup link if the button does not work." },
      { name: 'contactInstructions', label: 'Contact instructions', help: "Tell the speaker how to ask the event team for help." },
    ],
  },
  'speaker.accepted': {
    title: 'Acceptance confirmation',
    description: 'The email a speaker gets once, after they accept the invitation. It links to their speaker profile.',
    fields: [
      { name: 'subject', label: 'Subject', help: "Write the subject line speakers see in their inbox.", singleLine: true },
      { name: 'greeting', label: 'Greeting', help: "Write how the email greets the speaker. Keep the supported name placeholders." },
      { name: 'confirmation', label: 'Confirmation', help: "Confirm that the speaker has accepted the invitation." },
      { name: 'profileInstructions', label: 'Profile instructions', help: "Ask the speaker to open their profile and complete the required details." },
      { name: 'buttonLabel', label: 'Button label', help: "Write the short action label on the email’s button.", singleLine: true },
      { name: 'reviewNote', label: 'Review note', help: "Explain what staff will review before the speaker’s profile is published." },
    ],
  },
};

const SOURCE_WORDS = {
  draft: 'The wording in the form, not saved',
  saved: 'The saved wording',
  shipped: 'The shipped wording',
};

function sameFields(a, b, fields) {
  return fields.every(({ name }) => a?.[name] === b?.[name]);
}

/** The server's per-field refusals ("greeting: unknown token {{x}}"), by field. */
function fieldErrorMap(err, fields) {
  const names = new Set(fields.map(({ name }) => name));
  const map = {};
  for (const { field, message } of err?.fieldErrors ?? []) {
    if (!names.has(field)) continue;
    map[field] = map[field] ? `${map[field]}; ${message}` : message;
  }
  return map;
}

function tokenList(names) {
  return names.map((name) => `{{${name}}}`).join(' ');
}

function MessagePreview({ preview, title }) {
  const srcDoc = useMemo(() => (preview.html ? buildPreviewDoc(preview.html) : null), [preview.html]);
  return (
    <section aria-label={`${title} preview`} className="flex flex-col gap-xs border-admin-hairline border-t-admin-rule-hairline pt-md">
      <div className="flex items-center gap-2xs"><h3 className="text-admin-base font-semibold text-admin-ink">Preview</h3><HelpTooltip label="Preview">Review what the recipient or attendee will see before continuing.</HelpTooltip></div>
      {preview.usedFallback ? (
        <Notice tone="caution" message="The saved wording fails its check, so speakers get the shipped wording, shown here." />
      ) : null}
      {preview.problems.map((problem) => <Notice key={problem} tone="caution" message={problem} />)}
      <dl className="grid grid-cols-[auto_1fr] gap-x-sm gap-y-3xs text-admin-sm">
        <dt className="font-semibold text-admin-ink">Wording</dt>
        <dd className="text-admin-ink">{SOURCE_WORDS[preview.source]}</dd>
        <dt className="font-semibold text-admin-ink">Subject</dt>
        <dd data-testid="mail-preview-subject" className="wrap-anywhere text-admin-ink">{preview.subject}</dd>
      </dl>
      <p className="text-admin-xs text-admin-ink-secondary">
        Sample values fill the tokens. A real invitation has a private link in place of the sample one.
      </p>
      {srcDoc ? (
        <>
          <iframe
            sandbox=""
            srcDoc={srcDoc}
            referrerPolicy="no-referrer"
            title={`${title} preview, HTML version`}
            className="block h-[24rem] w-full rounded-admin border-admin-hairline border-admin-rule-hairline [color-scheme:light]"
          />
          <p className="text-admin-xs text-admin-ink-secondary">Links and remote images are turned off in this preview.</p>
        </>
      ) : (
        <p className="text-admin-sm text-admin-ink">This message’s HTML cannot be shown safely. The plain text version is below.</p>
      )}
      <details open={!srcDoc} className="text-admin-sm">
        <summary className="admin-target cursor-pointer font-semibold text-admin-ink">Plain text version <HelpTooltip label="Plain text version">Read the wording people receive when their email app displays plain text.</HelpTooltip></summary>
        <pre
          data-testid="mail-preview-text"
          className="mt-2xs max-h-[24rem] overflow-auto whitespace-pre-wrap break-words font-admin-data text-admin-sm text-admin-ink-data"
        >
          {preview.text}
        </pre>
      </details>
      <details className="text-admin-sm">
        <summary className="admin-target cursor-pointer font-semibold text-admin-ink">HTML source <HelpTooltip label="HTML source">Review the saved email markup if you need to check its formatting.</HelpTooltip></summary>
        <pre className="mt-2xs max-h-[24rem] overflow-auto whitespace-pre-wrap break-words font-admin-data text-admin-sm text-admin-ink-data">
          {preview.html}
        </pre>
      </details>
    </section>
  );
}

function MessageEditor({ entry, call, timeZone, onChange }) {
  const { id } = entry;
  const { title, description, fields } = MESSAGES[id];
  const supported = entry.editor?.kind === 'plain';
  const [draft, setDraft] = useState(() => (supported ? entry.editor.fields : null));
  const [busy, setBusy] = useState(null); // 'save' | 'preview' | 'reset'
  const [result, setResult] = useState(null);
  const [preview, setPreview] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [focusRequest, setFocusRequest] = useState(0);
  const formRef = useRef(null);

  useEffect(() => {
    if (focusRequest > 0) focusFirstError(formRef.current);
  }, [focusRequest]);

  const changed = supported && !sameFields(draft, entry.editor.fields, fields);

  function edit(field, value) {
    setDraft((previous) => ({ ...previous, [field]: value }));
    setFieldErrors((previous) => ({ ...previous, [field]: undefined }));
    // A preview of other words would mislead.
    setPreview(null);
  }

  async function run(kind, body, onDone) {
    if (busy) return;
    setBusy(kind);
    setResult(null);
    setFieldErrors({});
    try {
      await onDone(await call(ENDPOINT, { templateId: id, ...body }));
    } catch (err) {
      setResult({ tone: 'error', message: err.message });
      const map = fieldErrorMap(err, fields);
      setFieldErrors(map);
      if (Object.keys(map).length > 0) setFocusRequest((n) => n + 1);
    } finally {
      setBusy(null);
    }
  }

  function save(event) {
    event.preventDefault();
    if (!supported) return;
    run('save', { action: 'saveTemplate', fields: draft }, (data) => {
      onChange(data.template);
      setDraft(data.template.editor.fields);
      setPreview(null);
      setResult({ tone: 'ok', message: `${title} wording saved. The next email uses it.` });
    });
  }

  function runPreview() {
    // Unchanged words preview what the next email sends: the saved wording,
    // or the shipped wording, as the server reads it now.
    run('preview', changed ? { action: 'preview', fields: draft } : { action: 'preview' }, (data) => {
      setPreview(data.preview);
      setResult({ tone: 'ok', message: `Preview ready. It shows ${SOURCE_WORDS[data.preview.source].toLowerCase()}.` });
    });
  }

  function reset() {
    run('reset', { action: 'resetTemplate' }, (data) => {
      onChange(data.template);
      setDraft(data.template.editor.fields);
      setPreview(null);
      setResult({ tone: 'ok', message: `${title} uses the shipped wording again.` });
    });
  }

  const savedLine = entry.saved
    ? `Saved wording is in use, last changed ${formatWhen(entry.saved.updatedAt, timeZone) || 'at an unknown time'} by ${entry.saved.updatedBy ?? 'an admin'}.`
    : 'The shipped wording is in use.';

  return (
    <Panel help="Edit this speaker email and review a preview before saving its wording." title={title} description={description}>
      <form ref={formRef} className="flex flex-col gap-md" onSubmit={save} noValidate aria-label={`${title} wording`}>
        <fieldset  disabled={Boolean(busy)} className="flex min-w-0 flex-col gap-md">
        <legend className="sr-only">{title} wording </legend>
        <p className="text-admin-sm text-admin-ink">
          {savedLine}
          {changed ? ' The form has changes that are not saved.' : ''}
        </p>
        {entry.savedErrors.length > 0 ? (
          <Notice
            tone="caution"
            message={`The saved wording fails its check, so speakers get the shipped wording: ${entry.savedErrors.join('; ')}. ${supported ? 'Fix the fields below or use the shipped wording.' : 'Use the shipped wording to return to plain editing.'}`}
          />
        ) : null}
        {!supported ? <Notice tone="caution" message={entry.editor.reason} /> : null}
        {supported ? <div className="text-admin-sm text-admin-ink-secondary">
          <p>
            Message tokens: <span className="font-admin-data text-admin-ink-data">{tokenList(entry.tokens)}</span>
          </p>
          <p className="mt-3xs">
            Event tokens such as <span className="font-admin-data">{'{{event_name}}'}</span> work in these fields.
            Links, layout, buttons and the branded footer stay fixed.
          </p>
        </div> : null}
        {supported ? fields.map(({ name, label, help, singleLine }) => (singleLine ? (
          <TextField help={help}
            key={name}
            label={label}
            value={draft[name]}
            error={fieldErrors[name]}
            onChange={(value) => edit(name, value)}
          />
        ) : (
          <TextAreaField help={help}
            key={name}
            label={label}
            rows={3}
            value={draft[name]}
            error={fieldErrors[name]}
            onChange={(value) => edit(name, value)}
          />
        ))) : null}
        {result ? <Notice tone={result.tone} message={result.message} /> : null}
        <div className="flex flex-wrap items-center gap-xs">
          {supported ? (
            <button type="submit" className={primaryButtonClass} aria-busy={busy === 'save'}>
              {busy === 'save' ? 'Saving…' : 'Save wording'}
            </button>
          ) : null}
          <button type="button" className={secondaryButtonClass} onClick={runPreview} aria-busy={busy === 'preview'}>
            {busy === 'preview' ? 'Preparing the preview…' : 'Preview'}
          </button>
          {entry.saved ? (
            <DestructiveConfirm
              trigger="Use the shipped wording"
              title={`Use the shipped ${title.toLowerCase()} wording`}
              confirmLabel="Delete the saved wording"
              consequence={`The saved wording is deleted and every later ${title.toLowerCase()} email uses the shipped wording.`}
              permanence="This cannot be undone."
              busy={busy === 'reset'}
              busyLabel="Deleting…"
              onConfirm={reset}
            />
          ) : null}
        </div>
        </fieldset>
      </form>
      {preview ? <MessagePreview preview={preview} title={title} /> : null}
    </Panel>
  );
}

export default function AdminSpeakerMail() {
  const call = useAdminApi();
  const { eventConfig } = useEventConfig();
  const timeZone = typeof eventConfig?.timezone === 'string' && eventConfig.timezone ? eventConfig.timezone : undefined;
  const [state, setState] = useState({ status: 'loading', templates: [], error: null });

  const load = useCallback(async () => {
    try {
      const data = await call(ENDPOINT, { action: 'templates' });
      setState({ status: 'ready', templates: data.templates ?? [], error: null });
    } catch (err) {
      setState({ status: 'error', templates: [], error: err.message });
    }
  }, [call]);

  useEffect(() => { load(); }, [load]);

  function replace(template) {
    setState((previous) => ({
      ...previous,
      templates: previous.templates.map((entry) => (entry.id === template.id ? template : entry)),
    }));
  }

  return (
    <div className="flex flex-col gap-md">
      <AdminPageHeader help="Change the words of the invitation and of the acceptance confirmation. The links, and the tokens each message may use, stay fixed. The next email uses the saved wording."
        title="Speaker email wording"
        description="Change the words of the invitation and of the acceptance confirmation. The links, and the tokens each message may use, stay fixed. The next email uses the saved wording."
        actions={<Link to="/admin/speakers" className={linkButtonClass}>Back to speakers</Link>}
      />
      {state.status === 'loading' ? <AdminLoadingState label="Loading the wording…" /> : null}
      {state.status === 'error' ? <Notice tone="error" message={state.error} /> : null}
      {state.templates.filter((entry) => MESSAGES[entry.id]).map((entry) => (
        <MessageEditor key={entry.id} entry={entry} call={call} timeZone={timeZone} onChange={replace} />
      ))}
    </div>
  );
}
