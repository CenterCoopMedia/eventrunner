// The reader's own change requests (issue #330), at /profile/change-requests.
//
// The list comes from listMyChangeRequests, which answers only the signed-in
// account's requests and only requester-safe fields: the words and page they
// sent, the status, the history of statuses with their times, and, once the
// request is done or declined, the reply and the result link the event team
// wrote for them. The page never reads change_requests itself; the rules
// keep that document to admins.
//
// The request text, the page and the reply are the requester's or the
// team's own words: each renders as text, never as markup or a link. The
// result link is a link only when it is on this site's own origin, checked
// again here after the server checked it.
//
// Every outcome email links here, so the page works while the flag is off:
// a reader can still see what they sent.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import SignInPanel from '../components/SignInPanel.jsx';
import { secondaryActionClass } from '../components/controlClasses.js';
import { listMyChangeRequests } from '../lib/changeRequestApi.js';
import { isReadOnlyDemo } from '../lib/readOnlyDemo.js';
import { useDocumentTitle } from '../lib/useDocumentTitle.js';

const STATUS_WORDS = Object.freeze({
  new: 'Received',
  in_progress: 'In progress',
  done: 'Done',
  declined: 'Declined',
});

/** The word a requester reads for a status. Anything unknown reads as Received. */
export function statusWord(status) {
  return STATUS_WORDS[status] ?? STATUS_WORDS.new;
}

/** The address as a link target, or null when it is not on this site's origin. */
function sameOriginHref(value) {
  if (typeof value !== 'string' || typeof window === 'undefined') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin === window.location.origin ? url.href : null;
  } catch {
    return null;
  }
}

function formatted(iso) {
  const date = iso ? new Date(iso) : null;
  return date && Number.isFinite(date.getTime()) ? date.toLocaleString() : null;
}

function Time({ iso }) {
  const text = formatted(iso);
  return text ? <time dateTime={iso}>{text}</time> : null;
}

/** One request, as its requester reads it. */
function RequestItem({ request }) {
  const outcome = request.outcome;
  const resultHref = sameOriginHref(outcome?.resultUrl);
  // A "new" after the first entry is the request opened again.
  const history = (request.history || []).map((entry, index) => ({
    ...entry,
    word: entry.status === 'new' && index > 0 ? 'Reopened' : statusWord(entry.status),
  }));
  return (
    <li className="space-y-sm border-t border-border-subtle pt-md first:border-t-0 first:pt-0">
      <h2 className="font-heading text-h3 font-semibold">
        Request sent {formatted(request.createdAt) ?? ''}
      </h2>
      <p>
        <span className="font-semibold">Status: </span>
        {statusWord(request.status)}
      </p>
      {request.page ? (
        <p className="text-text-secondary">
          <span className="font-semibold">Page: </span>
          {request.page}
        </p>
      ) : null}
      <div>
        <p className="font-semibold">Your request</p>
        <p className="whitespace-pre-wrap break-words">{request.message}</p>
      </div>
      {outcome?.reply ? (
        <div>
          <p className="font-semibold">Reply from the event team</p>
          <p className="whitespace-pre-wrap break-words">{outcome.reply}</p>
        </div>
      ) : null}
      {resultHref ? (
        <p>
          <a href={resultHref} className="underline">See the result</a>
        </p>
      ) : null}
      {history.length > 0 ? (
        <div>
          <p id={`history-${request.id}`} className="font-semibold">History</p>
          <ol aria-labelledby={`history-${request.id}`} className="space-y-3xs text-text-secondary">
            {history.map((entry, index) => (
              <li key={`${index}-${entry.status}-${entry.at}`}>
                <span>{entry.word}</span>
                {' · '}
                <Time iso={entry.at} />
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </li>
  );
}

export default function MyChangeRequests() {
  useDocumentTitle('Your change requests');
  const { user, loading } = useAuth();
  const { eventConfig, features } = useEventConfig();
  const demo = isReadOnlyDemo(eventConfig);
  // Answers are kept with the uid they belong to, so a sign-out or a switch
  // of account never shows the last reader's requests.
  const [loaded, setLoaded] = useState(null);
  const [busy, setBusy] = useState(false);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    if (!user?.emailVerified) return;
    const ticket = requestRef.current + 1;
    requestRef.current = ticket;
    setBusy(true);
    const result = await listMyChangeRequests({ user });
    if (requestRef.current !== ticket) return;
    setLoaded({ uid: user.uid, ...result });
    setBusy(false);
  }, [user]);

  useEffect(() => {
    if (demo || !user?.emailVerified) return undefined;
    load();
    return () => {
      // A late answer for an earlier reader is dropped.
      requestRef.current += 1;
    };
  }, [demo, user, load]);

  const heading = <h1 className="font-heading text-h1 font-semibold">Your change requests</h1>;
  if (demo) return <article className="space-y-md">{heading}<p>Change requests are off in this read-only demo.</p></article>;
  if (loading) return <p role="status">Checking your sign-in…</p>;
  if (!user) {
    return <article className="space-y-md">{heading}<p>Sign in to see the change requests you sent.</p><SignInPanel /></article>;
  }
  if (!user.emailVerified) {
    return (
      <article className="space-y-md">
        {heading}
        <p>Sign in with Google or an emailed code to see your change requests.</p>
        <Link to="/signin" className={secondaryActionClass}>Open sign-in</Link>
      </article>
    );
  }

  const mine = loaded && loaded.uid === user.uid ? loaded : null;
  return (
    <article className="min-w-0 space-y-lg text-body text-text-primary">
      {heading}
      <div className="space-y-sm">
        <p>Only you and the event team can see these requests.</p>
        <button
          type="button"
          className={secondaryActionClass}
          aria-busy={busy || undefined}
          onClick={() => { if (!busy) load(); }}
        >
          {busy ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      {mine && !mine.ok ? <p role="alert" className="text-danger">{mine.error}</p> : null}
      {!mine ? <p role="status">Loading your change requests…</p> : null}
      {mine?.ok && mine.requests.length === 0 ? (
        <section className="space-y-sm">
          <p>You have not sent a change request.</p>
          {features?.changeRequests === true ? <p>To send one, choose Request a change at the foot of any page.</p> : null}
        </section>
      ) : null}
      {mine?.ok && mine.requests.length > 0 ? (
        <ol className="space-y-md">
          {mine.requests.map((request) => <RequestItem key={request.id} request={request} />)}
        </ol>
      ) : null}
    </article>
  );
}
