// The private attendee feed on the directory page (issue #788, the
// attendee half of #507; backend #506), with the root composer (#511).
//
// WHO SEES IT, AND WHOSE DATA. hooks/useSocialFeed.js decides when the
// feed may be asked for, and keys every piece of state to the reader and
// access session it was read for. This component renders only what matches
// the current key. The composer appears only for a reader who may post
// (an approved or speaker account, never a staff grant alone). It is a lazy
// chunk keyed to the reader, so it loads only for such a reader and an
// account switch drops its draft.
//
// AUTHORS AND REPORTS. Names come only from users_public, read from the
// server (useAuthorNames). Each post has a Report action with a
// confirmation step that sends only the post id (useSocialReports,
// components/SocialPostEntry.jsx).
import { Suspense, lazy, useEffect, useState } from 'react';
import { own, useAuthorNames, useSocialAccess, useSocialReports } from '../hooks/useSocialFeed.js';
import { FEED_PAGE_SIZE, fetchOlderPage, subscribeRootFeed } from '../lib/socialFeedSource.js';
import EmptyState from './EmptyState.jsx';
import LoadingState from './LoadingState.jsx';
import SocialPostEntry from './SocialPostEntry.jsx';
import SectionHead from './editorial/SectionHead.jsx';
import { quietActionClass } from './controlClasses.js';

const PostComposer = lazy(() => import('./PostComposer.jsx'));

const NO_OLDER = Object.freeze({ through: null, more: false, loading: false, failed: false });
const NO_FEED = Object.freeze({ posts: null, last: null, size: 0, range: null, failed: false, denied: false });

export default function AttendeeFeed() {
  const { access, compose, feedKey, user, activeKey } = useSocialAccess();

  // How far back the feed is loaded: `through` is the oldest loaded document
  // (null = the newest page only), `more` whether the last older fetch was
  // a full page, `loading` and `failed` the state of "Show older posts".
  const [older, setOlder] = useState({ key: null, value: NO_OLDER });
  const [snapshot, setSnapshot] = useState({ key: null, value: NO_FEED });
  const loaded = own(older, feedKey, NO_OLDER);
  const through = loaded.through;
  const feed = own(snapshot, feedKey, NO_FEED);

  useEffect(() => {
    if (feedKey === null) return undefined;
    let current = true;
    const unsubscribe = subscribeRootFeed(
      { through },
      (posts, page) => {
        if (current) {
          setSnapshot({ key: feedKey, value: { posts, last: page.last, size: page.size, range: through, failed: false, denied: false } });
        }
      },
      (error) => {
        if (!current) return;
        setSnapshot((prev) => ({
          key: feedKey,
          value: { ...NO_FEED, failed: true, denied: error?.code === 'permission-denied' || own(prev, feedKey, NO_FEED).denied },
        }));
      },
    );
    return () => {
      current = false;
      unsubscribe();
    };
  }, [feedKey, through]);

  const posts = feed.posts;
  const authorMap = useAuthorNames(feedKey, activeKey, posts);
  const reports = useSocialReports(feedKey, activeKey, user);

  // One bounded fetch past the oldest loaded post; the listener then
  // re-attaches through the new oldest post, so every loaded post stays live.
  async function loadOlder() {
    const key = feedKey;
    // An empty loaded range (every post in it removed) pages on from the
    // retained cursor.
    // The listener's own oldest document only once it reports the current
    // range: right after a fetch the old range's snapshot is still shown,
    // and paging from it would fetch the same page again.
    const after = (feed.range === through ? feed.last : null) ?? through;
    if (key === null || !after || loaded.loading) return;
    const base = { ...loaded, loading: false, failed: false };
    setOlder({ key, value: { ...base, loading: true } });
    const result = await fetchOlderPage(after);
    if (activeKey.current !== key) return;
    if (!result.ok) {
      setOlder({ key, value: { ...base, failed: true } });
    } else if (!result.last) {
      setOlder({ key, value: { ...base, through: through ?? after, more: false } });
    } else {
      setOlder({ key, value: { through: result.last, more: result.size >= FEED_PAGE_SIZE, loading: false, failed: false } });
    }
  }

  if (access === 'closed') return null;

  let body;
  if (access === 'checking') {
    body = <LoadingState shape="rows" label="Loading the attendee feed…" />;
  } else if (access === 'denied' || feed.denied) {
    body = (
      <p className="max-w-prose text-body text-text-secondary">
        The attendee feed is open to approved attendees and speakers. It opens for you once your
        registration is approved.
      </p>
    );
  } else if (feed.failed) {
    body = (
      <EmptyState
        title="The feed is unavailable right now"
        description="This is usually temporary. The page keeps trying in the background."
      />
    );
  } else if (posts === null) {
    body = <LoadingState shape="rows" label="Loading the attendee feed…" />;
  } else if (posts.length === 0 && !(through !== null && loaded.more)) {
    body = <EmptyState title="No posts yet" description="Posts from attendees appear here." />;
  } else {
    const more = through === null ? feed.size >= FEED_PAGE_SIZE : loaded.more;
    body = (
      <>
        <ul>
          {posts.map((post) => (
            <SocialPostEntry
              key={post.id}
              post={post}
              author={post.authorUid ? authorMap[post.authorUid] : null}
              report={reports.reports[post.id]}
              threadHref={`/attendees/posts/${encodeURIComponent(post.id)}`}
              onReport={() => reports.ask(post.id)}
              onConfirm={() => reports.send(post.id)}
              onCancel={() => reports.cancel(post.id)}
            />
          ))}
        </ul>
        {loaded.failed ? (
          <p role="alert" className="mt-sm text-caption text-danger">
            Older posts could not be loaded. Try again.
          </p>
        ) : null}
        {more ? (
          <button
            type="button"
            className={`${quietActionClass} mt-sm`}
            disabled={loaded.loading}
            aria-busy={loaded.loading || undefined}
            onClick={loadOlder}
          >
            {loaded.loading ? 'Loading older posts…' : 'Show older posts'}
          </button>
        ) : null}
      </>
    );
  }

  return (
    <section aria-labelledby="attendee-feed-title" className="mt-lg">
      <SectionHead id="attendee-feed-title" title="Attendee feed" level={2} rule="hairline" />
      {compose && !feed.denied && feedKey !== null ? (
        <div className="mt-sm">
          <Suspense fallback={<LoadingState label="Loading the post form…" />}>
            <PostComposer key={feedKey} user={user} />
          </Suspense>
        </div>
      ) : null}
      <div className="mt-sm">{body}</div>
    </section>
  );
}
