import { plannerMessage } from '../plannerErrors.js';
// Speaker mail wording (issue #204): staff change the words of the speaker
// invitation and the acceptance confirmation
// (functions/src/speakers/mailTemplates.cjs, one staff endpoint with
// actions).
//
// Each message has its own text editor. Body edits regenerate HTML; an
// unchanged body keeps its existing HTML. Readable details map to the stored
// template variables at the API boundary. The server checks every save against the
// tokens the message may use and the link it must keep, and refuses an
// unknown token. Preview renders, on the server, the exact subject, HTML and
// plain text with sample values: the wording in the form, saved or not. The
// next invitation or acceptance uses the saved wording, because the send
// reads it fresh each time. "Use the default message" deletes the saved
// wording.
//
// The layout follows the reminder wording editor in AdminSpeakerReminders.
import { TemplateTextField, TemplateMessageField, emailHtmlFromText, templateProblem } from '../components/EmailTemplateField.jsx';
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
  },
  'speaker.accepted': {
    title: 'Acceptance confirmation',
    description: 'The email a speaker gets once, after they accept the invitation. It links to their speaker profile.',
  },
};

const SOURCE_WORDS = {
  draft: 'The wording in the form, not saved',
  saved: 'The saved wording',
  shipped: 'The default message',
};

function wordingOf(source) {
  return { subject: source.subject, html: source.html, text: source.text };
}

function sameWording(a, b) {
  return a.subject === b.subject && a.html === b.html && a.text === b.text;
}

const FIELDS = ['subject', 'html', 'text'];

/** The server's per-field refusals ("text: unknown token {{x}}"), by field. */
function fieldErrorMap(err) {
  const map = {};
  for (const { field, message } of err?.fieldErrors ?? []) {
    if (!FIELDS.includes(field)) continue;
    map[field] = map[field] ? `${map[field]}; ${templateProblem(message)}` : templateProblem(message);
  }
  return map;
}

function MessagePreview({ preview, title }) {
  const srcDoc = useMemo(() => (preview.html ? buildPreviewDoc(preview.html) : null), [preview.html]);
  return (
    <section aria-label={`${title} preview`} className="flex flex-col gap-xs border-admin-hairline border-t-admin-rule-hairline pt-md">
      <h3 className="text-admin-base font-semibold text-admin-ink">Preview</h3>
      {preview.usedFallback ? (
        <Notice tone="caution" message="The saved message could not be used. This preview shows the default message." />
      ) : null}
      {preview.problems.map((problem) => <Notice key={problem} tone="caution" message={templateProblem(problem)} />)}
      <dl className="grid grid-cols-[auto_1fr] gap-x-sm gap-y-3xs text-admin-sm">
        <dt className="font-semibold text-admin-ink">Wording</dt>
        <dd className="text-admin-ink">{SOURCE_WORDS[preview.source]}</dd>
        <dt className="font-semibold text-admin-ink">Subject</dt>
        <dd data-testid="mail-preview-subject" className="wrap-anywhere text-admin-ink">{preview.subject}</dd>
      </dl>
      <p className="text-admin-xs text-admin-ink-secondary">
        This preview uses sample speaker details.
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
        <summary className="admin-target cursor-pointer font-semibold text-admin-ink">Plain text version</summary>
        <pre
          data-testid="mail-preview-text"
          className="mt-2xs max-h-[24rem] overflow-auto whitespace-pre-wrap break-words font-admin-data text-admin-sm text-admin-ink-data"
        >
          {preview.text}
        </pre>
      </details>
    </section>
  );
}

function MessageEditor({ entry, call, timeZone, onChange }) {
  const { id } = entry;
  const { title, description } = MESSAGES[id];
  const [draft, setDraft] = useState(() => wordingOf(entry.saved ?? entry.shipped));
  const [busy, setBusy] = useState(null); // 'save' | 'preview' | 'reset'
  const [result, setResult] = useState(null);
  const [preview, setPreview] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [focusRequest, setFocusRequest] = useState(0);
  const formRef = useRef(null);

  useEffect(() => {
    if (focusRequest > 0) focusFirstError(formRef.current);
  }, [focusRequest]);

  const changed = !sameWording(draft, entry.saved ? wordingOf(entry.saved) : entry.shipped);

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
      setResult({ tone: 'error', message: templateProblem(plannerMessage(err.message)) });
      const map = fieldErrorMap(err);
      setFieldErrors(map);
      if (Object.keys(map).length > 0) setFocusRequest((n) => n + 1);
    } finally {
      setBusy(null);
    }
  }

  function save(event) {
    event.preventDefault();
    run('save', { action: 'saveTemplate', ...draft }, (data) => {
      onChange(data.template);
      setDraft(wordingOf(data.template.saved ?? data.template.shipped));
      setPreview(null);
      setResult({ tone: 'ok', message: `${title} wording saved. The next email uses it.` });
    });
  }

  function runPreview() {
    // Unchanged words preview what the next email sends: the saved wording,
    // or the default message, as the server reads it now.
    run('preview', changed ? { action: 'preview', ...draft } : { action: 'preview' }, (data) => {
      setPreview(data.preview);
      setResult({ tone: 'ok', message: `Preview ready. It shows ${SOURCE_WORDS[data.preview.source].toLowerCase()}.` });
    });
  }

  function reset() {
    run('reset', { action: 'resetTemplate' }, (data) => {
      onChange(data.template);
      setDraft(wordingOf(data.template.shipped));
      setPreview(null);
      setResult({ tone: 'ok', message: `${title} uses the default message again.` });
    });
  }

  const savedLine = entry.saved
    ? `Saved wording is in use, last changed ${formatWhen(entry.saved.updatedAt, timeZone) || 'at an unknown time'}.`
    : 'The default message is in use.';

  return (
    <Panel title={title} description={description}>
      <form ref={formRef} className="flex flex-col gap-md" onSubmit={save} noValidate aria-label={`${title} wording`}>
        <p className="text-admin-sm text-admin-ink">
          {savedLine}
          {changed ? ' The form has changes that are not saved.' : ''}
        </p>
        {entry.savedErrors.length > 0 ? (
          <Notice
            tone="caution"
            message={`The saved wording fails its check, so speakers get the default message: ${entry.savedErrors.map(templateProblem).join('; ')}. Fix the wording below, or use the default message.`}
          />
        ) : null}
        <TemplateTextField label="Subject" value={draft.subject} error={fieldErrors.subject} onChange={(value) => edit('subject', value)} tokens={[...entry.tokens, ...(entry.globalTokens ?? [])]} />
        <TemplateMessageField label="Message" rows={12} value={draft.text} error={fieldErrors.text || fieldErrors.html}
          tokens={[...entry.tokens, ...(entry.globalTokens ?? [])]}
          onChange={(value) => {
            setDraft((previous) => ({ ...previous, text: value, html: emailHtmlFromText(value) }));
            setFieldErrors((previous) => ({ ...previous, text: undefined, html: undefined }));
            setPreview(null);
          }} />
        <details className="text-admin-sm">
          <summary className="admin-target cursor-pointer font-semibold text-admin-ink">Default message</summary>
          <div className="mt-2xs flex flex-col gap-xs">
            <p className="text-admin-ink-secondary">Start again with the default message.</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-sm gap-y-3xs">
              <dt className="font-semibold text-admin-ink">Subject</dt>
              <dd className="wrap-anywhere font-admin-data text-admin-ink-data">{entry.shipped.subject}</dd>
            </dl>
            <div>
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={() => {
                  setDraft(wordingOf(entry.shipped));
                  setPreview(null);
                  setResult({ tone: 'ok', message: 'The form holds the default message. Save to use it, or keep editing.' });
                }}
              >
                Use default message
              </button>
            </div>
          </div>
        </details>
        {result ? <Notice tone={result.tone} message={result.message} /> : null}
        <div className="flex flex-wrap items-center gap-xs">
          <button type="submit" className={primaryButtonClass} aria-busy={busy === 'save'}>
            {busy === 'save' ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className={secondaryButtonClass} onClick={runPreview} aria-busy={busy === 'preview'}>
            {busy === 'preview' ? 'Preparing the preview…' : 'Preview'}
          </button>
          {entry.saved ? (
            <DestructiveConfirm
              trigger="Use the default message"
              title={`Use the shipped ${title.toLowerCase()} wording`}
              confirmLabel="Delete the saved wording"
              consequence={`The saved wording is deleted and every later ${title.toLowerCase()} email uses the default message.`}
              permanence="This cannot be undone."
              busy={busy === 'reset'}
              busyLabel="Deleting…"
              onConfirm={reset}
            />
          ) : null}
        </div>
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
      setState({ status: 'error', templates: [], error: plannerMessage(err.message) });
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
      <AdminPageHeader
        title="Speaker email wording"
        description="Edit invitation and acceptance emails. Saved changes apply to future emails."
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
