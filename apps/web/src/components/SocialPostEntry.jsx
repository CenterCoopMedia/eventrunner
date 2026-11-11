// One entry in the attendee feed or a thread (issues #788, #511): the
// author, the time, the text, and the Report action with its confirmation.
//
// TEXT. A post is plain text. It is rendered as React text nodes, never
// through the CMS rich-text renderer, so markup in a post stays text. Only
// a whitespace-separated token that is an absolute http(s) URL becomes a
// link, and only when shared/urlSafety's safeUrlHref accepts it; the link
// goes to that canonical href through ExternalLink (new-tab notice,
// rel="noreferrer"). Every other token, a `javascript:` or `mailto:` one
// included, stays text.
//
// AUTHORS. A name comes only from the users_public projection the caller
// read (hooks/useSocialFeed.js useAuthorNames). Without one the entry shows
// a neutral, unlinked "An attendee".
import { useEffect, useId, useRef } from 'react';
import { Link } from 'react-router';
import { safeUrlHref } from 'shared/urlSafety';
import ExternalLink from './ExternalLink.jsx';
import { primaryActionClass, secondaryActionClass, textControlStateClass } from './controlClasses.js';

const AUTHOR_FALLBACK = 'An attendee';
const ABSOLUTE_HTTP = /^https?:\/\//i;
// Sentence punctuation after a URL belongs to the sentence, not the link.
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;
const linkClass = `${textControlStateClass} text-text-primary underline underline-offset-4`;

/** Firestore Timestamp, Date, or epoch millis; anything else is null. */
export function toDate(value) {
  if (!value) return null;
  const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
  return date instanceof Date && Number.isFinite(date.getTime()) ? date : null;
}

/**
 * Split post text into text and link parts.
 *
 * @param {string} text
 * @returns {Array<{ text: string, href?: string }>}
 */
export function postTextParts(text) {
  const parts = [];
  for (const token of String(text).split(/(\s+)/)) {
    if (!token) continue;
    if (ABSOLUTE_HTTP.test(token)) {
      const tail = token.match(TRAILING_PUNCTUATION)?.[0] ?? '';
      const candidate = tail ? token.slice(0, -tail.length) : token;
      const href = safeUrlHref(candidate);
      if (href) {
        parts.push({ text: candidate, href });
        if (tail) parts.push({ text: tail });
        continue;
      }
    }
    const last = parts.at(-1);
    if (last && !last.href) last.text += token;
    else parts.push({ text: token });
  }
  return parts;
}

function PostText({ text }) {
  return (
    <p className="mt-2xs max-w-prose whitespace-pre-wrap text-body [overflow-wrap:anywhere] text-text-primary">
      {postTextParts(text).map((part, index) =>
        part.href ? (
          <ExternalLink key={index} href={part.href} className={linkClass}>
            {part.text}
          </ExternalLink>
        ) : (
          part.text
        ),
      )}
    </p>
  );
}

/** A removed or missing entry: no text and no author, only what happened. */
export function RemovedEntry({ children }) {
  return (
    <li className="border-t-hairline border-t-rule-hairline py-sm">
      <p className="text-body italic text-text-secondary">{children}</p>
    </li>
  );
}

/**
 * @param {object} props
 * @param {{ id: string, authorUid: string|null, text: string, createdAt: unknown }} props.post
 * @param {{ displayName: string }|null|undefined} props.author
 * @param {{ phase: string, error?: string }|undefined} props.report
 * @param {string} [props.threadHref] where "View replies" goes; omitted inside a thread
 * @param {'li'|'div'} [props.as]
 */
export default function SocialPostEntry({
  post, author, report, threadHref, onReport, onConfirm, onCancel, as: Element = 'li',
}) {
  const headId = useId();
  const confirmRef = useRef(null);
  const doneRef = useRef(null);
  const triggerRef = useRef(null);
  const asked = useRef(false);
  const phase = report?.phase ?? 'idle';
  const name = typeof author?.displayName === 'string' ? author.displayName.trim() : '';
  const posted = toDate(post.createdAt);

  useEffect(() => {
    // Keep focus in the post: on the send button when the question opens,
    // and on the confirmation once the buttons are gone.
    // A cancel returns focus to the Report button it came from.
    if (phase === 'confirm') confirmRef.current?.focus();
    if (phase === 'done') doneRef.current?.focus();
    if (phase === 'idle' && asked.current) triggerRef.current?.focus();
    asked.current = phase === 'confirm' || phase === 'failed';
  }, [phase]);

  return (
    <Element className="border-t-hairline border-t-rule-hairline py-sm">
      <div id={headId} className="flex flex-wrap items-baseline gap-x-sm gap-y-2xs">
        {name && post.authorUid ? (
          <Link
            to={`/attendees/${post.authorUid}`}
            className="font-heading text-body font-semibold text-text-primary hover:underline"
          >
            {name}
          </Link>
        ) : (
          <span className="font-heading text-body font-semibold text-text-primary">{AUTHOR_FALLBACK}</span>
        )}
        {posted ? (
          <time dateTime={posted.toISOString()} className="font-mono text-caption text-text-secondary">
            {posted.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
          </time>
        ) : null}
      </div>
      <PostText text={post.text} />
      <div className="mt-2xs flex flex-wrap items-center gap-x-md">
        {threadHref ? (
          <Link
            to={threadHref}
            className={`${textControlStateClass} touch-target inline-flex items-center font-data text-caption font-medium text-text-primary underline underline-offset-4`}
            aria-describedby={headId}
          >
            View replies
          </Link>
        ) : null}
        {phase === 'idle' ? (
          <button
            ref={triggerRef}
            type="button"
            className={`${textControlStateClass} touch-target inline-flex items-center font-data text-caption font-medium text-text-secondary underline underline-offset-4`}
            aria-describedby={headId}
            onClick={onReport}
          >
            Report post
          </button>
        ) : null}
        {phase === 'confirm' || phase === 'sending' || phase === 'failed' ? (
          <div role="group" aria-labelledby={`${headId}-ask`} className="flex flex-col gap-xs">
            <p id={`${headId}-ask`} className="text-caption text-text-secondary">
              Report this post to the event staff? Staff review every report. Other attendees do not see
              who reported it.
            </p>
            {phase === 'failed' ? (
              <p role="alert" className="text-caption text-danger">
                {report.error}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-xs">
              <button
                ref={confirmRef}
                type="button"
                className={primaryActionClass}
                disabled={phase === 'sending'}
                aria-busy={phase === 'sending' || undefined}
                onClick={onConfirm}
              >
                {phase === 'sending' ? 'Sending report…' : phase === 'failed' ? 'Try again' : 'Send report'}
              </button>
              <button
                type="button"
                className={secondaryActionClass}
                disabled={phase === 'sending'}
                onClick={onCancel}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
        {phase === 'done' ? (
          <p ref={doneRef} tabIndex={-1} role="status" className="text-caption text-text-secondary">
            Reported. Staff will review this post.
          </p>
        ) : null}
      </div>
    </Element>
  );
}
