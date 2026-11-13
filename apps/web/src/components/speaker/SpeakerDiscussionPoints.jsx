import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_DISCUSSION_POINTS_LENGTH, validateDiscussionPoints } from 'shared/speakerDiscussion';
import { getSpeakerDiscussionPoints, saveSpeakerDiscussionPoints } from '../../lib/speakerDiscussionApi.js';
import { TextAreaField, focusFirstError } from '../forms/publicForm.jsx';
import { primaryActionClass, secondaryActionClass } from '../controlClasses.js';

const INITIAL = {
  phase: 'loading', draft: '', submission: null, revision: null,
  pending: null, error: '', fieldError: '', accessBlocked: false,
};

const NOTIFICATION_COPY = {
  accepted: 'The email provider accepted the notification. Organizer receipt is unconfirmed.',
  omitted: 'No organizer email was sent for this update.',
  failed: 'The organizer email failed.',
  unknown: 'The organizer email outcome is unconfirmed.',
};

function accessFailure(error) {
  return error?.status === 401 || error?.status === 403;
}

// Called above TabPanel: private state survives panel/session changes. The hub
// keys its owner by account UID and canonical speaker ID before rendering it.
export function useSpeakerDiscussion({ user, speakerId }) {
  const [state, setState] = useState(INITIAL);
  const latest = useRef(state);
  latest.current = state;
  const currentUser = useRef(user);
  currentUser.current = user;
  const active = useRef(false);
  const operation = useRef(0);
  const busy = useRef(false);

  const load = useCallback(async () => {
    if (busy.current) return;
    if (!currentUser.current?.uid || !speakerId) {
      setState((previous) => ({ ...previous, phase: 'blocked', accessBlocked: true }));
      return;
    }
    busy.current = true;
    const ticket = ++operation.current;
    setState((previous) => ({ ...previous, phase: 'loading', error: '', fieldError: '' }));
    try {
      const submission = await getSpeakerDiscussionPoints({ user: currentUser.current, speakerId });
      if (!active.current || ticket !== operation.current) return;
      setState((previous) => ({
        ...previous, phase: 'ready', submission, revision: submission?.revision ?? 0,
        // A reconciliation updates the revision, never the owner's local text.
        draft: previous.revision === null ? submission?.text ?? '' : previous.draft,
        pending: null, error: '', accessBlocked: false,
      }));
    } catch (error) {
      if (!active.current || ticket !== operation.current) return;
      setState((previous) => ({
        ...previous, phase: accessFailure(error) ? 'blocked' : 'load-error',
        accessBlocked: previous.accessBlocked || accessFailure(error),
        error: accessFailure(error)
          ? 'Access could not be confirmed. Sign in with your speaker account, then check access.'
          : 'Your saved discussion points could not be loaded. Your local text is kept. Try loading again.',
      }));
    } finally {
      if (ticket === operation.current) busy.current = false;
    }
  }, [speakerId]);

  useEffect(() => {
    active.current = true;
    load();
    return () => {
      active.current = false;
      operation.current += 1;
      busy.current = false;
    };
  }, [load]);

  async function save(event) {
    event.preventDefault();
    const previous = latest.current;
    if (busy.current || !['ready', 'saved', 'uncertain'].includes(previous.phase) || previous.accessBlocked) return;
    const validation = validateDiscussionPoints(previous.pending ?? {
      speakerId, text: previous.draft, expectedRevision: previous.revision, requestId: crypto.randomUUID(),
    });
    if (!validation.ok) {
      const form = event.currentTarget;
      setState((value) => ({ ...value, fieldError: validation.errors.map((message) => message.replace(/^text: /, '')).join(' ') }));
      // Focus after the field's aria-invalid state has rendered.
      requestAnimationFrame(() => focusFirstError(form));
      return;
    }
    const request = previous.pending ?? { speakerId, ...validation.fields };
    busy.current = true;
    const ticket = ++operation.current;
    setState((value) => ({ ...value, phase: 'saving', pending: request, error: '', fieldError: '' }));
    try {
      const submission = await saveSpeakerDiscussionPoints({ user: currentUser.current, ...request });
      if (!active.current || ticket !== operation.current) return;
      setState((value) => ({ ...value, phase: 'saved', submission, revision: submission.revision, pending: null }));
    } catch (error) {
      if (!active.current || ticket !== operation.current) return;
      if (error?.code === 'read-only-demo') {
        setState((value) => ({
          ...value, phase: 'read-only', pending: null,
          error: 'This historical demo is read-only. Your local text is kept, but discussion points cannot be saved.',
        }));
        return;
      }
      const denied = accessFailure(error);
      const conflict = error?.status === 409;
      const invalid = error?.status === 400;
      setState((value) => ({
        ...value, phase: denied ? 'blocked' : conflict ? 'conflict' : invalid ? 'ready' : 'uncertain',
        accessBlocked: denied,
        pending: invalid ? null : request,
        error: denied
          ? 'Access could not be confirmed. Sign in with your speaker account, then check access.'
          : conflict
            ? 'The saved submission changed. This request may already have saved. Load the current submission before you replace it. Your local text is kept.'
            : invalid
              ? 'The server refused this text. Check it before saving again.'
              : 'The save outcome is unconfirmed. Retry the previous save or load the current submission. Your local text is kept.',
      }));
    } finally {
      if (ticket === operation.current) busy.current = false;
    }
  }

  return {
    ...state, load, save,
    changeDraft: (draft) => setState((previous) => ({
      ...previous, draft, fieldError: '', phase: previous.phase === 'saved' ? 'ready' : previous.phase,
    })),
  };
}

export default function SpeakerDiscussionPoints({ discussion }) {
  const { phase, draft, submission, revision, pending, error, fieldError, accessBlocked, load, save, changeDraft } = discussion;
  if (accessBlocked) {
    return (
      <div>
        <p role="alert" className="text-body text-danger">{error || 'Sign in with your speaker account to access discussion points.'}</p>
        <button type="button" className={`${secondaryActionClass} mt-sm`} disabled={phase === 'loading'}
          aria-busy={phase === 'loading'} onClick={load}>
          {phase === 'loading' ? 'Checking access…' : 'Check access'}
        </button>
      </div>
    );
  }
  const waiting = phase === 'loading' || phase === 'saving';
  const canSave = ['ready', 'saved', 'uncertain'].includes(phase);
  const draftMatchesSaved = submission?.text === draft.replace(/\r\n?/g, '\n').trim();
  return (
    <form onSubmit={save} aria-label="Speaker discussion points" aria-busy={waiting} className="space-y-md">
      <p className="text-body text-text-secondary">
        These notes are private to you and the organizers. One submission covers all your sessions.
        Each save replaces your current saved discussion points. These notes do not appear on your public profile or site.
      </p>
      <TextAreaField
        label="Discussion points" value={draft} onChange={changeDraft} rows={8}
        hint={`Enter 1 to ${MAX_DISCUSSION_POINTS_LENGTH.toLocaleString('en-US')} characters. Line breaks are allowed.`}
        error={fieldError} disabled={revision === null}
      />
      {phase === 'loading' ? <p role="status" className="text-body text-text-secondary">Loading saved discussion points…</p> : null}
      {error ? <p role="alert" className="text-body text-danger">{error}</p> : null}
      {submission ? (
        <div className="space-y-xs">
          {['ready', 'saved'].includes(phase) ? (
            <p role="status" className="text-body text-text-secondary">
              {phase === 'saved' && draftMatchesSaved ? 'Your discussion points are saved. ' : 'Last confirmed submission: '}
              {NOTIFICATION_COPY[submission.notification.state]}
            </p>
          ) : null}
          <details>
            <summary className="public-text-control touch-target font-data text-caption">Last confirmed submission</summary>
            <p className="mt-xs whitespace-pre-wrap break-words text-body text-text-primary">{submission.text}</p>
          </details>
          {!draftMatchesSaved
            ? <p className="text-body text-text-secondary">Your current changes have not been saved.</p> : null}
        </div>
      ) : null}
      {pending && phase === 'uncertain' ? (
        <p className="text-body text-text-secondary">Retry sends the previous text. Your current edits stay in the field.</p>
      ) : null}
      <div className="flex flex-wrap gap-sm">
        <button type="submit" className={primaryActionClass} disabled={!canSave && phase !== 'saving'}
          aria-disabled={phase === 'saving' || undefined} aria-busy={phase === 'saving'}>
          {phase === 'saving' ? 'Saving…' : phase === 'uncertain' ? 'Retry previous save'
            : submission ? 'Replace saved discussion points' : 'Save discussion points'}
        </button>
        {['load-error', 'uncertain', 'conflict'].includes(phase) ? (
          <button type="button" className={secondaryActionClass} onClick={load}>Load current submission</button>
        ) : null}
      </div>
    </form>
  );
}
