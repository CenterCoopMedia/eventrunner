import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useAdminApi } from '../adminApi.js';
import { REPORT_LIMIT, loadModerationPost, loadSocialReports } from '../socialModerationSource.js';
import { toDate } from '../versionHistory.js';
import AdminPageHeader, { AdminEmptyState, AdminLoadingState, StatusBadge } from '../components/adminChrome.jsx';
import { DestructiveConfirm, Notice, Panel, SaveStatus, rowMetaClass, secondaryButtonClass } from '../components/formControls.jsx';

function ReportedPost({ postId, reports, call, onAccessDenied }) {
  const [post, setPost] = useState(undefined);
  const [readError, setReadError] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const removed = useRef(false);
  const mounted = useRef(false);
  const heading = useRef(null);

  useEffect(() => {
    let live = true;
    mounted.current = true;
    loadModerationPost(postId).then((next) => {
      if (!live) return;
      // Removal is terminal. Neither an old read nor a delayed HTTP
      // answer may put text back after this tab observes the tombstone.
      if (next?.state === 'removed') removed.current = true;
      setPost(removed.current ? { state: 'removed' } : next);
      setReadError(false);
    }, (err) => {
      if (!live) return;
      setPost(undefined);
      setReadError(true);
      if (err?.code === 'permission-denied' || err?.code === 'unauthenticated') onAccessDenied();
    });
    return () => { live = false; mounted.current = false; };
  }, [postId, onAccessDenied]);

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await call('removeSocialPost', { postId });
      if (!mounted.current) return;
      removed.current = true;
      // Replace, never spread the active post into a removed row. The
      // already-removed response has the same privacy consequence.
      setPost({ state: 'removed' });
      setResult(response.alreadyRemoved ? 'This post was already removed.' : 'Post removed.');
      heading.current?.focus();
    } catch (err) {
      if (!mounted.current) return;
      if (err.status === 401 || err.status === 403) {
        onAccessDenied();
      }
      setError(`The removal did not complete. ${err.message} You can try again.`);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const received = toDate(reports[0].createdAt);
  return (
    <li className="border-b-admin-hairline border-admin-rule-hairline px-md py-md last:border-b-0">
      <div className="flex flex-col gap-sm">
        <div className="flex flex-wrap items-center gap-sm">
          <h2 ref={heading} tabIndex={-1} className="break-all font-admin-data text-admin-sm text-admin-ink">
            Post {postId}
          </h2>
          {post?.state === 'removed' ? <StatusBadge tone="dead">Removed</StatusBadge> : null}
          <span className={rowMetaClass}>{reports.length} {reports.length === 1 ? 'report' : 'reports'} in this list</span>
          {received ? <time dateTime={received.toISOString()} className={rowMetaClass}>{received.toLocaleString()}</time> : null}
        </div>
        {readError ? <Notice tone="error" message="We could not read this post. Refresh reports to try again." /> : post === undefined ? (
          <AdminLoadingState label="Loading reported post…" />
        ) : post === null ? (
          <p className="text-admin-sm text-admin-ink-secondary">This post is no longer available.</p>
        ) : post.state === 'removed' ? (
          <p className="text-admin-sm text-admin-ink-secondary">The post text and author have been removed. Reports remain private.</p>
        ) : (
          <p className="whitespace-pre-wrap break-words text-admin-base text-admin-ink">{post.text}</p>
        )}
        {error ? <Notice tone="error" message={error} /> : null}
        {result ? <SaveStatus message={result} /> : null}
        {post?.state === 'active' ? (
          <div>
            <DestructiveConfirm
              trigger="Remove post"
              title="Remove this post?"
              confirmLabel="Remove this post"
              consequence="The post text and author are permanently removed. The admin log records who removed it and when, without the post text or author."
              permanence="This cannot be undone."
              onConfirm={remove}
              busy={busy}
              busyLabel="Removing…"
            />
          </div>
        ) : null}
      </div>
    </li>
  );
}

function ModerationReports({ cursor, onOlder, onNewest }) {
  const call = useAdminApi();
  const [reports, setReports] = useState(null);
  const [error, setError] = useState(null);
  const denied = useRef(false);
  const denyAccess = useCallback(() => {
    // A denial invalidates every private row and any outstanding reads.
    denied.current = true;
    setReports(null);
    setError('Your staff access could not be confirmed. Reload the page or sign in again.');
  }, []);
  useEffect(() => {
    let live = true;
    loadSocialReports(cursor).then((next) => {
      if (!live || denied.current) return;
      setReports(next);
      setError(null);
    }, (err) => {
      if (!live) return;
      if (err?.code === 'permission-denied' || err?.code === 'unauthenticated') {
        denyAccess();
        return;
      }
      // A revoked live grant must not leave a private docket on screen.
      setReports(null);
      if (!denied.current) setError('We could not read the reports. Refresh reports to try again.');
    });
    return () => { live = false; };
  }, [cursor, denyAccess]);

  const grouped = new Map();
  for (const report of reports ?? []) {
    if (!grouped.has(report.postId)) grouped.set(report.postId, []);
    grouped.get(report.postId).push(report);
  }
  return (
    <div className="flex flex-col gap-md">
      <AdminPageHeader title="Feed moderation" description="Review private attendee reports and remove reported posts. Cleanup stays available when the attendee feed or directory is off." />
      <p className="text-admin-sm text-admin-ink-secondary">Showing up to {REPORT_LIMIT} {cursor ? 'older' : 'most recent'} reports, grouped by post. Reporter identities are not shown.</p>
      {error ? <Notice tone="error" message={error} /> : reports === null ? (
        <AdminLoadingState label="Loading private reports…" />
      ) : reports.length === 0 ? (
        <AdminEmptyState title="No reported posts" description="Attendee reports will appear here for staff review." />
      ) : (
        <Panel flush>
          <ul aria-label="Reported posts">
            {[...grouped].map(([postId, entries]) => <ReportedPost key={postId} postId={postId} reports={entries} call={call} onAccessDenied={denyAccess} />)}
          </ul>
        </Panel>
      )}
      <div className="flex flex-wrap gap-sm">
        <button type="button" className={secondaryButtonClass} onClick={onNewest}>{cursor ? 'Newest reports' : 'Refresh reports'}</button>
        {reports?.length === REPORT_LIMIT ? <button type="button" className={secondaryButtonClass} onClick={() => onOlder(reports.at(-1))}>Older reports</button> : null}
      </div>
    </div>
  );
}

function ModerationDocket() {
  const [page, setPage] = useState({ cursor: null, number: 0 });
  return <ModerationReports key={page.number} cursor={page.cursor}
    onOlder={(last) => setPage({ cursor: { id: last.id, createdAt: last.createdAt }, number: page.number + 1 })}
    onNewest={() => setPage({ cursor: null, number: page.number + 1 })} />;
}

export default function AdminFeedModeration() {
  const { user, adminStatus, adminTier } = useAuth();
  if (!user || adminStatus !== 'admin') return null;
  // A new identity gets fresh reads and empty state before paint.
  return <ModerationDocket key={`${user.uid}:${adminTier}`} />;
}
