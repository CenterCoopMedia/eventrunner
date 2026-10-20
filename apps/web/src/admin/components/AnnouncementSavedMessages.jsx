// Saved announcement messages (issue #496), listed beside the email
// composer on the Announcements page.
//
// A saved message is reusable content: a name, a subject, a message and an
// optional link. The server keeps it in a private store and checks it with
// the composer's own draft check (functions/src/announcements/messages.cjs).
// Each message has its own id; the name is a label, so two may share one,
// and the list says when each changed.
//
// LOAD copies the content into the composer as a new, unsent draft. The
// audience stays as it is, and any preview or confirmation is dropped, so
// the next send needs a new preview. When the draft has edits, a
// confirmation asks first; "Keep my draft" changes nothing. A later change
// to the saved message does not change the copy, and the copy does not
// change the saved message until staff select Update.
//
// Nothing here previews, sends, or changes the site.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAdminApi } from '../adminApi.js';
import {
  Notice,
  Panel,
  ServerErrorSummary,
  TextField,
  dangerButtonClass,
  linkButtonClass,
  secondaryButtonClass,
} from './formControls.jsx';
import { AdminLoadingState } from './adminChrome.jsx';

const MAX_NAME_LENGTH = 80;

/** One open question in a row: replace the draft, rename, or remove. */
function RowQuestion({ title, children, headingRef }) {
  return (
    <section
      aria-label={title}
      className="mt-xs flex flex-col gap-xs rounded-admin-panel border-admin-strong border-admin-rule-strong px-md py-sm"
    >
      <h3 ref={headingRef} tabIndex={-1} className="text-admin-base font-bold text-admin-ink focus:outline-none">
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * @param {{
 *   draft: { subject: string, message: string, linkUrl: string, linkLabel: string },
 *   dirty: boolean,
 *   loaded: { id: string, name: string } | null,
 *   onLoad: (message: { id: string, name: string, draft: object }) => void,
 *   onSaved: (message: { id: string, name: string }) => void,
 *   onRenamed: (message: { id: string, name: string }) => void,
 *   onRemoved: (id: string) => void,
 *   formatTime: (ms: number) => string | null,
 *   draftBody: (draft: object) => object,
 * }} props
 */
export default function AnnouncementSavedMessages({
  draft, dirty, loaded, onLoad, onSaved, onRenamed, onRemoved, formatTime, draftBody,
}) {
  const call = useAdminApi();
  const { showToast } = useToast();
  const [list, setList] = useState(null); // { messages, max }
  const [listError, setListError] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(null); // 'save' | 'update' | `load:${id}` | `rename:${id}` | `remove:${id}`
  const [error, setError] = useState(null);
  // The one open question: { kind: 'replace'|'rename'|'remove', id, name }.
  const [question, setQuestion] = useState(null);
  const [newName, setNewName] = useState('');
  const [focus, setFocus] = useState(null); // { id, control } or { heading: true }

  const wrapRef = useRef(null);
  const errorRef = useRef(null);
  const questionRef = useRef(null);
  const renameRef = useRef(null);
  const controls = useRef(new Map());

  const loadList = useCallback(async () => {
    try {
      const response = await call('announcementMessages', { action: 'list' });
      setList({
        messages: Array.isArray(response?.messages) ? response.messages : [],
        max: Number.isInteger(response?.max) ? response.max : null,
      });
      setListError(null);
    } catch (err) {
      setListError(err);
    }
  }, [call]);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => {
    if (question?.kind === 'rename') renameRef.current?.querySelector('input')?.focus();
    else if (question) questionRef.current?.focus();
  }, [question]);
  useEffect(() => {
    if (!focus) return;
    if (focus.heading) {
      const heading = wrapRef.current?.querySelector('h2');
      if (heading) {
        heading.setAttribute('tabindex', '-1');
        heading.focus();
      }
    } else {
      controls.current.get(`${focus.control}:${focus.id}`)?.focus();
    }
    setFocus(null);
  }, [focus, list]);

  const controlRef = (control, id) => (node) => {
    const key = `${control}:${id}`;
    if (node) controls.current.set(key, node);
    else controls.current.delete(key);
  };

  async function save(id) {
    if (busy) return;
    setBusy(id ? 'update' : 'save');
    setError(null);
    try {
      const response = await call('announcementMessages', {
        action: 'save',
        ...(id ? { id } : {}),
        name,
        draft: draftBody(draft),
      });
      const saved = response.message;
      setName(saved.name);
      onSaved({ id: saved.id, name: saved.name });
      showToast(`Saved "${saved.name}".`);
      await loadList();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  async function load(message) {
    setQuestion(null);
    setBusy(`load:${message.id}`);
    setError(null);
    try {
      const response = await call('announcementMessages', { action: 'load', id: message.id });
      setName(response.message.name);
      onLoad(response.message);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  function askLoad(message) {
    if (busy) return;
    if (dirty) setQuestion({ kind: 'replace', id: message.id, name: message.name });
    else load(message);
  }

  function closeQuestion(control) {
    const { id } = question;
    setQuestion(null);
    setFocus({ id, control });
  }

  function askRename(message) {
    if (busy) return;
    setNewName(message.name);
    setQuestion({ kind: 'rename', id: message.id, name: message.name });
  }

  async function rename(event) {
    event.preventDefault();
    if (busy) return;
    const { id } = question;
    setBusy(`rename:${id}`);
    setError(null);
    try {
      const response = await call('announcementMessages', { action: 'rename', id, name: newName });
      const renamed = response.message;
      setList((current) => ({
        ...current,
        messages: current.messages.map((m) => (m.id === id ? { ...m, ...renamed } : m)),
      }));
      if (loaded?.id === id) setName(renamed.name);
      onRenamed({ id, name: renamed.name });
      setQuestion(null);
      setFocus({ id, control: 'rename' });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (busy) return;
    const { id, name: removedName } = question;
    setBusy(`remove:${id}`);
    setError(null);
    try {
      await call('announcementMessages', { action: 'remove', id });
      setList((current) => ({ ...current, messages: current.messages.filter((m) => m.id !== id) }));
      onRemoved(id);
      setQuestion(null);
      showToast(`Removed "${removedName}".`);
      setFocus({ heading: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  const messages = list?.messages ?? [];
  const full = list?.max != null && messages.length >= list.max;

  return (
    <div ref={wrapRef}>
      <Panel
        title="Saved messages"
        description="Save a message you send often, then load it into a new email. Loading changes the subject, the message and the link. The audience stays as it is. Saved messages stay until you remove them."
      >
        <div className="flex flex-col gap-sm">
          <ServerErrorSummary error={error} errorRef={errorRef} title="The server refused this request" />
          {loaded ? (
            <p className="text-admin-sm text-admin-ink">
              {`Loaded from "${loaded.name}". Changes here do not change the saved message until you update it.`}
            </p>
          ) : null}
          <TextField
            label="Name for this message"
            hint="A label for you. Two saved messages can have the same name."
            value={name}
            maxLength={MAX_NAME_LENGTH}
            onChange={setName}
          />
          <div className="flex flex-wrap gap-xs">
            <button
              type="button"
              className={secondaryButtonClass}
              aria-busy={busy === 'save' ? 'true' : undefined}
              aria-disabled={busy || full ? 'true' : undefined}
              onClick={() => { if (!full) save(null); }}
            >
              {busy === 'save' ? 'Saving…' : 'Save as a new message'}
            </button>
            {loaded ? (
              <button
                type="button"
                className={secondaryButtonClass}
                aria-busy={busy === 'update' ? 'true' : undefined}
                aria-disabled={busy ? 'true' : undefined}
                onClick={() => save(loaded.id)}
              >
                {busy === 'update' ? 'Saving…' : `Update "${loaded.name}"`}
              </button>
            ) : null}
          </div>
          {full ? (
            <Notice
              tone="caution"
              message={`You have ${list.max} saved messages, the most the site keeps. Remove one before you save a new one.`}
            />
          ) : null}

          {list === null && !listError ? <AdminLoadingState label="Loading the saved messages…" /> : null}
          {listError ? <Notice tone="error" message={listError.message} /> : null}
          {list && messages.length === 0 ? (
            <p className="text-admin-sm text-admin-ink-secondary">No saved messages yet. Write a message, name it, then save it.</p>
          ) : null}
          {messages.length > 0 ? (
            <ul className="flex flex-col border-t-admin-hairline border-admin-rule-hairline">
              {messages.map((message) => {
                const when = formatTime(message.updatedAt);
                const open = question?.id === message.id ? question : null;
                return (
                  <li key={message.id} className="flex flex-col gap-3xs border-b-admin-hairline border-admin-rule-hairline py-sm last:border-b-0">
                    <span className="font-semibold text-admin-ink">{message.name}</span>
                    <span className="text-admin-sm text-admin-ink">{message.subject}</span>
                    {when ? <span className="font-admin-data text-admin-xs text-admin-ink-data">{`Changed ${when}`}</span> : null}
                    <div className="flex flex-wrap gap-xs">
                      <button
                        type="button"
                        ref={controlRef('load', message.id)}
                        className={linkButtonClass}
                        aria-busy={busy === `load:${message.id}` ? 'true' : undefined}
                        onClick={() => askLoad(message)}
                      >
                        Load
                      </button>
                      <button
                        type="button"
                        ref={controlRef('rename', message.id)}
                        className={linkButtonClass}
                        onClick={() => askRename(message)}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        ref={controlRef('remove', message.id)}
                        className={linkButtonClass}
                        onClick={() => { if (!busy) setQuestion({ kind: 'remove', id: message.id, name: message.name }); }}
                      >
                        Remove
                      </button>
                    </div>
                    {open?.kind === 'replace' ? (
                      <RowQuestion title={`Replace your draft with "${open.name}"?`} headingRef={questionRef}>
                        <p className="max-w-[65ch] text-admin-sm text-admin-ink">
                          Your draft has changes that are not saved. Loading replaces its subject, message and link, and drops its preview.
                        </p>
                        <div className="flex flex-wrap gap-xs">
                          <button type="button" className={secondaryButtonClass} onClick={() => load(message)}>
                            Replace draft
                          </button>
                          <button type="button" className={secondaryButtonClass} onClick={() => closeQuestion('load')}>
                            Keep my draft
                          </button>
                        </div>
                      </RowQuestion>
                    ) : null}
                    {open?.kind === 'rename' ? (
                      <form ref={renameRef} className="mt-xs flex flex-col gap-xs" onSubmit={rename}>
                        <TextField label="New name" value={newName} maxLength={MAX_NAME_LENGTH} onChange={setNewName} />
                        <div className="flex flex-wrap gap-xs">
                          <button type="submit" className={secondaryButtonClass} aria-busy={busy === `rename:${message.id}` ? 'true' : undefined}>
                            {busy === `rename:${message.id}` ? 'Saving…' : 'Save name'}
                          </button>
                          <button type="button" className={secondaryButtonClass} onClick={() => closeQuestion('rename')}>
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : null}
                    {open?.kind === 'remove' ? (
                      <RowQuestion title={`Remove "${open.name}"?`} headingRef={questionRef}>
                        <p className="max-w-[65ch] text-admin-sm text-admin-ink">
                          The saved message is deleted. A draft you loaded from it and past sends keep their own copy. This cannot be undone.
                        </p>
                        <div className="flex flex-wrap gap-xs">
                          <button
                            type="button"
                            className={dangerButtonClass}
                            aria-busy={busy === `remove:${message.id}` ? 'true' : undefined}
                            onClick={remove}
                          >
                            {`Remove "${open.name}"`}
                          </button>
                          <button type="button" className={secondaryButtonClass} onClick={() => closeQuestion('remove')}>
                            Keep it
                          </button>
                        </div>
                      </RowQuestion>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}
