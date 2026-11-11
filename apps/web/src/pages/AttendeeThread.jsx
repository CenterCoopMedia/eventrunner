// One thread of the private attendee feed: /attendees/posts/:postId
// (issue #511; backend #510). The root post, its replies oldest first, a
// Report action on every active entry, and the reply composer.
//
// GATE. The page asks for nothing until hooks/useSocialFeed.js opens the
// feed for the current reader, exactly as the feed on /attendees does. A
// deep link is not a way around it: with the feature off or unresolved the
// page is the ordinary "not found" page, and it never names or titles the
// post. Post text never reaches the document title or other metadata.
//
// WHOSE DATA. Root, replies, how far they are loaded, author names and
// reports are stored with the reader's key, so an account switch, a
// sign-out, a revoked grant, or a flag turned off hides them in the same
// render, and a late callback for an old key is dropped.
//
// FAILURES. A listener error that is not a refusal keeps the last thread
// on screen with a notice while the listener retries, so the reply form and
// its draft stay mounted. A refusal (permission-denied) clears the thread.
//
// REMOVAL. A removed or missing root shows "Original post removed". Its
// replies stay readable and reportable, and the reply composer is gone. A
// removed reply is a placeholder with no text and no author.
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import EmptyState from '../components/EmptyState.jsx';
import LoadingState from '../components/LoadingState.jsx';
import SocialPostEntry, { RemovedEntry } from '../components/SocialPostEntry.jsx';
import SectionHead from '../components/editorial/SectionHead.jsx';
import { primaryActionClass, quietActionClass, textControlStateClass } from '../components/controlClasses.js';
import { own, useAuthorNames, useSocialAccess, useSocialReports } from '../hooks/useSocialFeed.js';
import { useDocumentTitle } from '../lib/useDocumentTitle.js';
import { THREAD_PAGE_SIZE, isPostId, subscribeReplies, subscribeThreadRoot } from '../lib/socialThreadSource.js';
import NotFound from './NotFound.jsx';

const PostComposer = lazy(() => import('../components/PostComposer.jsx'));

// `root`: undefined while loading, null when missing or removed.
const NO_ROOT = Object.freeze({ root: undefined, failed: false, denied: false });
// `pages`: the page count the shown entries were read for.
const NO_REPLIES = Object.freeze({ entries: null, size: 0, pages: 0, failed: false, denied: false });

/** The previous value for `key` with a failure marked, or a fresh failed value. */
function failedState(prev, key, empty, error) {
  const base = prev.key === key ? prev.value : empty;
  return { key, value: { ...base, failed: true, denied: error?.code === 'permission-denied' } };
}

const backLinkClass =
  `${textControlStateClass} touch-target inline-flex items-center font-data text-caption font-medium text-text-primary underline underline-offset-4`;

function BackToFeed() {
  return (
    <Link to="/attendees" className={backLinkClass}>
      Back to the attendee feed
    </Link>
  );
}

export default function AttendeeThread() {
  const { postId: rawId } = useParams();
  const postId = isPostId(rawId) ? rawId : null;
  const { access, compose, feedKey: readerKey, user } = useSocialAccess();
  // The thread is part of the key: a different post is a different thread.
  const feedKey = readerKey !== null && postId !== null ? `${readerKey}\u0000${postId}` : null;
  const activeKey = useRef(feedKey);
  useEffect(() => {
    activeKey.current = feedKey;
  }, [feedKey]);

  const [rootState, setRootState] = useState({ key: null, value: NO_ROOT });
  const [replyState, setReplyState] = useState({ key: null, value: NO_REPLIES });
  const [pageState, setPageState] = useState({ key: null, value: 1 });
  // The server refused a reply because the root is gone; the root listener
  // confirms it soon after, but the composer closes now.
  const [rootGone, setRootGone] = useState({ key: null, value: false });
  const root = own(rootState, feedKey, NO_ROOT);
  const thread = own(replyState, feedKey, NO_REPLIES);
  const pages = own(pageState, feedKey, 1);

  useDocumentTitle(access === 'closed' ? null : 'Attendee feed');

  useEffect(() => {
    if (feedKey === null) return undefined;
    let current = true;
    const unsubscribe = subscribeThreadRoot(
      postId,
      (entry) => {
        if (current) setRootState({ key: feedKey, value: { root: entry, failed: false, denied: false } });
      },
      (error) => {
        if (current) setRootState((prev) => failedState(prev, feedKey, NO_ROOT, error));
      },
    );
    return () => {
      current = false;
      unsubscribe();
    };
  }, [feedKey, postId]);

  useEffect(() => {
    if (feedKey === null) return undefined;
    let current = true;
    const unsubscribe = subscribeReplies(
      { rootId: postId, pages },
      (entries, size) => {
        if (current) setReplyState({ key: feedKey, value: { entries, size, pages, failed: false, denied: false } });
      },
      (error) => {
        if (current) setReplyState((prev) => failedState(prev, feedKey, NO_REPLIES, error));
      },
    );
    return () => {
      current = false;
      unsubscribe();
    };
  }, [feedKey, postId, pages]);

  const entries = thread.entries;
  const visible = root.root ? [root.root, ...(entries ?? [])] : entries;
  const authorMap = useAuthorNames(feedKey, activeKey, visible);
  const reports = useSocialReports(feedKey, activeKey, user);

  if (access === 'closed') {
    return <NotFound />;
  }

  let content;
  if (access === 'checking') {
    content = <LoadingState shape="rows" label="Loading the thread…" />;
  } else if (access === 'denied' || root.denied || thread.denied) {
    content = (
      <p className="max-w-prose text-body text-text-secondary">
        The attendee feed is open to approved attendees and speakers. It opens for you once your
        registration is approved.
      </p>
    );
  } else if (postId === null) {
    content = (
      <EmptyState
        title="This post link is not valid"
        description="Go back to the attendee feed to find the post."
        action={<Link to="/attendees" className={primaryActionClass}>Go to the attendee feed</Link>}
      />
    );
  } else if ((root.root === undefined && root.failed) || (entries === null && thread.failed)) {
    content = (
      <EmptyState
        title="The thread is unavailable right now"
        description="This is usually temporary. The page keeps trying in the background."
      />
    );
  } else if (root.root === undefined || entries === null) {
    content = <LoadingState shape="rows" label="Loading the thread…" />;
  } else {
    const rootActive = root.root !== null && !own(rootGone, feedKey, false);
    // Full for the pages it was read for: there may be more.
    const more = thread.size >= thread.pages * THREAD_PAGE_SIZE;
    const loading = thread.pages !== pages;
    const entryProps = (entry) => ({
      post: entry,
      author: entry.authorUid ? authorMap[entry.authorUid] : null,
      report: reports.reports[entry.id],
      onReport: () => reports.ask(entry.id),
      onConfirm: () => reports.send(entry.id),
      onCancel: () => reports.cancel(entry.id),
    });
    content = (
      <>
        {root.failed || thread.failed ? (
          <p role="status" className="mb-sm text-caption text-text-secondary">
            The thread stopped updating. The page keeps trying in the background.
          </p>
        ) : null}
        <ul aria-label="Original post">
          {root.root ? (
            <SocialPostEntry {...entryProps(root.root)} />
          ) : (
            <RemovedEntry>Original post removed</RemovedEntry>
          )}
        </ul>
        <section aria-labelledby="thread-replies-title" className="mt-lg">
          <SectionHead id="thread-replies-title" title="Replies" level={2} rule="hairline" />
          {entries.length === 0 ? (
            <p className="mt-sm text-body text-text-secondary">
              {rootActive ? 'No replies yet.' : 'There are no replies.'}
            </p>
          ) : (
            <ul className="mt-sm">
              {entries.map((entry) =>
                entry.removed ? (
                  <RemovedEntry key={entry.id}>Reply removed</RemovedEntry>
                ) : (
                  <SocialPostEntry key={entry.id} {...entryProps(entry)} />
                ),
              )}
            </ul>
          )}
          {more || loading ? (
            <button
              type="button"
              className={`${quietActionClass} mt-sm`}
              disabled={loading}
              aria-busy={loading || undefined}
              onClick={() => setPageState({ key: feedKey, value: pages + 1 })}
            >
              {loading ? 'Loading more replies…' : 'Show more replies'}
            </button>
          ) : null}
          <div className="mt-md">
            {!rootActive ? (
              <p className="max-w-prose text-body text-text-secondary">
                Replies are closed because the original post was removed.
              </p>
            ) : compose ? (
              <Suspense fallback={<LoadingState label="Loading the reply form…" />}>
                <PostComposer
                  key={feedKey}
                  user={user}
                  parentPostId={postId}
                  onRootGone={() => setRootGone({ key: feedKey, value: true })}
                />
              </Suspense>
            ) : (
              <p className="max-w-prose text-body text-text-secondary">
                Replies are open to approved attendees and speakers.
              </p>
            )}
          </div>
        </section>
      </>
    );
  }

  return (
    <div className="grid gap-xl lg:grid-cols-[2fr_1fr]">
      <article>
        <BackToFeed />
        <h1 className="mt-sm font-heading text-h1 font-semibold text-text-primary">Thread</h1>
        <div className="mt-md">{content}</div>
      </article>
    </div>
  );
}
