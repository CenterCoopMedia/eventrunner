import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useSocialAccess } from '../../hooks/useSocialFeed.js';
import {
  loadSocialNotificationPage,
  markSocialNotificationRead,
  watchSocialNotifications,
} from '../../lib/socialNotificationSource.js';
import LoadingState from '../LoadingState.jsx';
import { quietActionClass, textControlStateClass } from '../controlClasses.js';

function notificationTime(value) {
  if (!value) return null;
  const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function accessFailure(error) {
  return error?.status === 401 || error?.status === 403 || error?.status === 404
    || error?.code === 'permission-denied' || error?.code === 'unauthenticated';
}

function mergeNotifications(first, second) {
  const rows = new Map(first.map((item) => [item.id, item]));
  for (const item of second) if (!rows.has(item.id)) rows.set(item.id, item);
  return [...rows.values()];
}

// Unmounting this owner-specific state is intentional. A staff grant may
// keep the shared feed open after the attendee's own grant has been revoked.
export default function NotificationInbox() {
  const { compose, uid, user } = useSocialAccess();
  if (!compose || !uid || user?.uid !== uid) return null;
  return <OwnerInbox key={uid} user={user} />;
}

function OwnerInbox({ user }) {
  const [page, setPage] = useState(null);
  const [paging, setPaging] = useState(false);
  const [writes, setWrites] = useState({});
  const [error, setError] = useState(null);
  const [closed, setClosed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState('');
  const active = useRef(false);
  const paged = useRef(false);
  const headIds = useRef(new Set());
  const pageEpoch = useRef(0);
  const pageFlight = useRef(null);
  const flights = useRef(new Set());
  const stop = useRef(null);
  const threadLinks = useRef(new Map());

  function fail(failure, message, kind = 'watch') {
    if (!active.current) return;
    if (accessFailure(failure)) {
      active.current = false;
      stop.current?.();
      setClosed(true);
      setPage(null);
      setWrites({});
      setNotice('');
      const signIn = failure.status === 401 || failure.code === 'unauthenticated';
      setError({ kind: 'access', signIn, message: signIn
        ? 'Sign in again to read your notifications.'
        : 'Your inbox is unavailable. Reload to check your access again.' });
      return;
    }
    setError({ kind, message });
  }

  useEffect(() => {
    active.current = true;
    stop.current = watchSocialNotifications({
      uid: user.uid,
      onData(next) {
        if (!active.current) return;
        // A reconnect can deliver a whole new page. Restart history rather
        // than retaining an old cursor that skips the intervening replies.
        if (paged.current && !next.items.some((item) => headIds.current.has(item.id))) {
          paged.current = false;
          pageEpoch.current += 1;
          pageFlight.current = null;
          setPaging(false);
          setNotice('New replies arrived. Load older notifications to continue.');
        }
        headIds.current = new Set(next.items.map((item) => item.id));
        const retainHistory = paged.current;
        // Once history is open, retain rows displaced by new arrivals.
        setPage((previous) => retainHistory && previous
          ? { ...previous, items: mergeNotifications(next.items, previous.items) }
          : next);
        setError((previous) => previous?.kind === 'watch' ? null : previous);
      },
      onError: (failure) => fail(failure, 'Your inbox could not load. Try again.'),
    });
    return () => {
      active.current = false;
      stop.current?.();
    };
  }, [user.uid, attempt]);

  async function showOlder() {
    if (!active.current || !page?.cursor || pageFlight.current !== null) return;
    const flight = Symbol();
    const epoch = pageEpoch.current;
    pageFlight.current = flight;
    setPaging(true);
    paged.current = true;
    try {
      const next = await loadSocialNotificationPage({ uid: user.uid, cursor: page.cursor });
      if (!active.current || pageEpoch.current !== epoch) return;
      setPage((previous) => ({ ...next, items: mergeNotifications(previous?.items ?? [], next.items) }));
      setError((previous) => previous?.kind === 'page' ? null : previous);
    } catch (failure) {
      if (pageEpoch.current === epoch) fail(failure, 'Older notifications could not load. Try “Show older notifications” again.', 'page');
    } finally {
      if (pageFlight.current === flight) {
        pageFlight.current = null;
        if (active.current) setPaging(false);
      }
    }
  }

  async function markRead(id) {
    if (!active.current || flights.current.has(id)) return;
    const focusedControl = document.activeElement;
    flights.current.add(id);
    setNotice('');
    setWrites((rows) => ({ ...rows, [id]: { pending: true } }));
    try {
      const result = await markSocialNotificationRead({ user, notificationId: id });
      if (!active.current) return;
      setWrites((rows) => ({ ...rows, [id]: { readAt: result.readAt } }));
      setNotice('Notification marked as read.');
      if (document.activeElement === focusedControl || document.activeElement === document.body) {
        threadLinks.current.get(id)?.focus();
      }
    } catch (failure) {
      if (accessFailure(failure)) fail(failure);
      else if (active.current) setWrites((rows) => ({ ...rows, [id]: {
        error: 'The read state was not confirmed. Try “Mark as read” again.',
      } }));
    } finally {
      flights.current.delete(id);
    }
  }

  const items = page?.items ?? [];
  return (
    <section aria-labelledby="notification-inbox-heading"
      className="rounded-brand-lg border-hairline border-rule-hairline bg-surface-alt p-md">
      <h2 id="notification-inbox-heading" className="font-heading text-h3 font-semibold text-text-primary">
        Reply notifications
      </h2>
      {error ? <p role="alert" className="mt-sm text-body text-text-secondary">{error.message}</p> : null}
      {closed ? (
        error?.signIn ? <Link to="/signin" className={`${quietActionClass} mt-sm`}>Sign in</Link>
          : <button type="button" className={`${quietActionClass} mt-sm`} onClick={() => window.location.reload()}>
            Reload inbox
          </button>
      ) : (
        <>
          {error?.kind === 'watch' ? (
            <button type="button" className={`${quietActionClass} mt-sm`} onClick={() => setAttempt((value) => value + 1)}>
              Try loading again
            </button>
          ) : null}
          {!page && !error ? <LoadingState label="Loading your reply notifications…" rows={2} /> : null}
          {page && items.length === 0 ? (
            <p className="mt-sm text-body text-text-secondary">No reply notifications yet. Replies to your posts appear here.</p>
          ) : null}
          {items.length > 0 ? (
            <ul className="mt-sm" aria-label="Reply notifications">
              {items.map((item) => {
                const date = notificationTime(item.createdAt);
                const read = Boolean(writes[item.id]?.readAt || item.readAt);
                const pending = writes[item.id]?.pending === true;
                return (
                  <li key={item.id} className="border-t-hairline border-t-rule-hairline py-sm first:border-t-0">
                    <p className="text-body text-text-primary">Someone replied to your post.</p>
                    <p className="mt-xs font-mono text-caption text-text-secondary">
                      {date ? <time dateTime={date.toISOString()}>{date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time> : 'Time unavailable'}
                      {' · '}{read ? 'Read' : 'Unread'}
                    </p>
                    <div className="mt-xs flex flex-wrap items-center gap-sm">
                      <Link to={`/attendees/posts/${item.rootPostId}`}
                        ref={(element) => { if (element) threadLinks.current.set(item.id, element); else threadLinks.current.delete(item.id); }}
                        className={`${textControlStateClass} touch-target inline-flex items-center font-medium text-accent underline`}>
                        Open thread
                      </Link>
                      {!read ? (
                        <button type="button" className={quietActionClass} aria-disabled={pending} aria-busy={pending}
                          onClick={() => markRead(item.id)}>
                          {pending ? 'Saving read state…' : 'Mark as read'}
                        </button>
                      ) : null}
                    </div>
                    {writes[item.id]?.error ? <p role="alert" className="mt-xs text-caption text-text-secondary">{writes[item.id].error}</p> : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
          {page ? (
            <div className="mt-sm">
              {page.hasMore ? (
                <button type="button" className={quietActionClass} aria-disabled={paging} aria-busy={paging} onClick={showOlder}>
                  {paging ? 'Loading older notifications…' : 'Show older notifications'}
                </button>
              ) : items.length > 0 ? <p className="text-caption text-text-secondary">No older notifications.</p> : null}
              {items.length > 0 ? <p className="mt-xs text-caption text-text-secondary">Removed or unavailable posts may no longer open.</p> : null}
            </div>
          ) : null}
          <p role="status" className="sr-only">{notice}</p>
        </>
      )}
    </section>
  );
}
