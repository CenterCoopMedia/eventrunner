// The post and reply form of the private attendee feed (issue #511). It is
// loaded lazily, only for a reader who may compose (hooks/useSocialFeed.js
// composeAccess), so it adds nothing to the first page or the demo.
//
// DRAFT. The text lives in React state only, never in browser storage. It
// is cleared after a confirmed post or a deliberate discard, and kept after
// every refusal. The caller mounts one composer per reader and access
// session (`key`), so an account switch or a closed feed unmounts it and
// the draft with it; a request that completes after that is ignored.
//
// RETRIES. lib/submissionKey.js binds one key to one payload: the same
// account, text and parent resend the same key, so a retry after a lost
// answer stores one post. Changed text or a new post takes a new key. A
// terminal answer (removed, conflict) drops the key: the next send is a new
// post, and only on the reader's own action.
//
// VALIDATION. The shared contract (shared/socialPost) counts the trimmed
// text in UTF-16 code units. A refused send marks the field and moves focus
// to it; a refusal that is not about the text moves focus to its message.
// The button stays enabled until a request starts, and is disabled while it
// runs, so a second press cannot send twice.
import { useEffect, useRef, useState } from 'react';
import {
  MAX_SOCIAL_REQUEST_BYTES,
  MAX_SOCIAL_TEXT_LENGTH,
  socialRequestBytes,
  socialTextLength,
} from 'shared/socialPost';
import { createSubmissionKey } from '../lib/submissionKey.js';
import { createSocialPost } from '../lib/socialPostSource.js';
import { TextAreaField, focusFirstError } from './forms/publicForm.jsx';
import { primaryActionClass, secondaryActionClass } from './controlClasses.js';

const LIMIT_TEXT = MAX_SOCIAL_TEXT_LENGTH.toLocaleString('en-US');

/** The field error for `text`, or null when it may be sent. */
export function draftError(text, parentPostId) {
  const length = socialTextLength(text);
  if (length === 0) return 'Write something before you send.';
  if (length > MAX_SOCIAL_TEXT_LENGTH) {
    return `Shorten the text to ${LIMIT_TEXT} characters or fewer. It has ${length.toLocaleString('en-US')}.`;
  }
  const body = { text: text.trim(), submissionKey: 'x'.repeat(128) };
  if (parentPostId !== null) body.parentPostId = parentPostId;
  if (socialRequestBytes(body) > MAX_SOCIAL_REQUEST_BYTES) return 'This text is too large to send. Shorten it.';
  return null;
}

/**
 * @param {object} props
 * @param {{ uid: string, getIdToken: () => Promise<string> }} props.user
 * @param {string|null} [props.parentPostId] null for a root post
 * @param {(postId: string) => void} [props.onPosted]
 * @param {() => void} [props.onRootGone] the server says the root is no longer active
 */
export default function PostComposer({ user, parentPostId = null, onPosted, onRootGone }) {
  const reply = parentPostId !== null;
  const formRef = useRef(null);
  const messageRef = useRef(null);
  const alive = useRef(true);
  const keys = useRef(null);
  if (keys.current === null) keys.current = createSubmissionKey();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  // { field: string|null, message: string|null, focus: number }
  const [refusal, setRefusal] = useState({ field: null, message: null, focus: 0 });
  const [status, setStatus] = useState('');

  useEffect(() => () => {
    alive.current = false;
  }, []);

  useEffect(() => {
    if (refusal.focus === 0) return;
    if (refusal.field) focusFirstError(formRef.current);
    else messageRef.current?.focus();
  }, [refusal]);

  function refuse(field, message) {
    setRefusal((prev) => ({ field, message, focus: prev.focus + 1 }));
  }

  async function submit(event) {
    event.preventDefault();
    if (sending) return;
    setStatus('');
    const invalid = draftError(text, parentPostId);
    if (invalid) {
      refuse(invalid, null);
      return;
    }
    const payload = { text: text.trim(), parentPostId };
    const submissionKey = keys.current.keyFor({ uid: user.uid, ...payload });
    setRefusal((prev) => ({ ...prev, field: null, message: null }));
    setSending(true);
    const result = await createSocialPost({ user, submissionKey, ...payload });
    if (!alive.current) return;
    setSending(false);
    if (result.ok) {
      keys.current.reset();
      setText('');
      setStatus(reply ? 'Reply posted.' : 'Posted. Your post is at the top of the feed.');
      onPosted?.(result.postId);
      return;
    }
    if (result.kind === 'removed' || result.kind === 'conflict') keys.current.reset();
    if (result.kind === 'no-root') onRootGone?.();
    if (result.kind === 'invalid') refuse(result.error, null);
    else refuse(null, result.error);
  }

  function discard() {
    keys.current.reset();
    setText('');
    setRefusal((prev) => ({ field: null, message: null, focus: prev.focus }));
    setStatus('Draft discarded.');
    formRef.current?.querySelector('textarea')?.focus();
  }

  const length = socialTextLength(text);
  const action = reply ? 'Post reply' : 'Post';
  return (
    <form ref={formRef} noValidate onSubmit={submit} className="flex flex-col gap-xs">
      <TextAreaField
        label={reply ? 'Your reply' : 'Write a post'}
        hint={`Plain text. Up to ${LIMIT_TEXT} characters; ${length.toLocaleString('en-US')} used. Links that start with http:// or https:// open in a new tab.`}
        value={text}
        onChange={(next) => {
          setText(next);
          if (refusal.field) setRefusal((prev) => ({ ...prev, field: null }));
        }}
        error={refusal.field}
        rows={reply ? 3 : 4}
        readOnly={sending}
      />
      {refusal.message ? (
        <p ref={messageRef} tabIndex={-1} role="alert" className="text-caption text-danger">
          {refusal.message}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-xs">
        <button type="submit" className={primaryActionClass} disabled={sending} aria-busy={sending || undefined}>
          {sending ? 'Sending…' : action}
        </button>
        {text && !sending ? (
          <button type="button" className={secondaryActionClass} onClick={discard}>
            Discard draft
          </button>
        ) : null}
      </div>
      <p role="status" className="text-caption text-text-secondary">
        {status}
      </p>
    </form>
  );
}
