// System errors admin surface (issue #58): unresolved `system_errors` rows
// (functions/src/telemetry/systemErrors.cjs, functions/src/auth/otp.cjs's
// template-override-invalid fallback), with a resolve action per row.
//
// `system_errors` is server-only (firestore.rules: allow read, write: if
// false) — listSystemErrors/resolveSystemErrors (functions/src/telemetry/
// systemErrorsAdmin.cjs) are the only way this page ever sees or changes a
// row, so there is no live listener here (unlike AdminPagesList): a plain
// fetch on mount, on manual refresh, and after every successful resolve,
// same shape as any other admin POST call.
//
// Resolving is not monotonic: auth/otp.cjs reopens a row (resolved: false,
// fresh lastSeenAt) when the same fault class recurs. Each row's `resolve`
// button sends back the `lastSeenAt` this page last displayed for it
// (`expectedLastSeenAt`) — if the row was reopened since this list loaded,
// the server treats that as stale and skips the write rather than silently
// re-hiding an active fault, and this page reports that instead of a
// generic success.
//
// A resolve is followed by a full reload rather than a local patch (Codex
// review finding, P1): patching only the resolved row locally can leave
// this page showing "No unresolved errors" once the last VISIBLE row is
// resolved, even though more unresolved rows exist past this page's limit
// — reloading from the server is the only way to know that is not true.
import { useCallback, useEffect, useRef, useState } from 'react';
import EmptyState from '../../components/EmptyState.jsx';
import LoadingState from '../../components/LoadingState.jsx';
import { useAdminApi } from '../adminApi.js';
import { Panel, secondaryButtonClass } from '../components/formControls.jsx';

const PAGE_SIZE = 100;
// Long enough to show real signal (a stack's first line, a validation
// message) without a screenful of raw text; anything past this gets the
// <details> expansion below.
const MESSAGE_PREVIEW_LEN = 140;

function formatWhen(ms) {
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleString();
}

function KindLabel({ kind }) {
  return (
    <code className="rounded-brand border border-brand-ink/20 bg-brand-surface-alt px-2 py-1 text-xs">
      {kind}
    </code>
  );
}

/**
 * The row's message (or joined `errors`), truncated with a keyboard-
 * accessible expansion for anything long enough to need one. `<details>` is
 * used rather than a custom toggle button: it is natively focusable and
 * Enter/Space-activatable with no extra ARIA wiring, unlike a plain `<p>`
 * with a "show more" link.
 */
function MessageText({ text }) {
  if (!text) {
    return <p className="mt-1 text-sm text-brand-ink">(no message)</p>;
  }
  if (text.length <= MESSAGE_PREVIEW_LEN) {
    return <p className="mt-1 text-sm text-brand-ink">{text}</p>;
  }
  return (
    <details className="mt-1 text-sm text-brand-ink">
      <summary className="touch-target inline cursor-pointer underline underline-offset-4">
        {text.slice(0, MESSAGE_PREVIEW_LEN)}…{' '}
        <span className="text-brand-ink-muted">(show full message)</span>
      </summary>
      <p className="mt-2 whitespace-pre-wrap break-words">{text}</p>
    </details>
  );
}

export default function AdminSystemErrors() {
  const call = useAdminApi();
  const [rows, setRows] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [resolvingId, setResolvingId] = useState(null);
  const [rowNotices, setRowNotices] = useState({});
  // Distinguishes the one-time initial fetch (full-page skeleton) from a
  // manual refresh or a post-resolve reload (keeps the current rows on
  // screen, just relabels the refresh control) — a ref so `load` does not
  // need `rows`/`loading` in its own dependency list.
  const hasLoadedRef = useRef(false);

  const load = useCallback(async () => {
    if (!hasLoadedRef.current) setLoading(true);
    else setRefreshing(true);
    try {
      const response = await call('listSystemErrors', { limit: PAGE_SIZE });
      setRows(Array.isArray(response?.rows) ? response.rows : []);
      setNextCursor(response?.nextCursor ?? null);
      setError(null);
    } catch (err) {
      // Fail soft: keep whatever rows we already have and surface a
      // non-blocking notice, the same contract AdminPagesList's listener
      // failure follows.
      setError(err);
    } finally {
      hasLoadedRef.current = true;
      setLoading(false);
      setRefreshing(false);
    }
  }, [call]);

  useEffect(() => {
    load();
  }, [load]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const response = await call('listSystemErrors', { limit: PAGE_SIZE, cursor: nextCursor });
      const more = Array.isArray(response?.rows) ? response.rows : [];
      setRows((current) => [...(current ?? []), ...more]);
      setNextCursor(response?.nextCursor ?? null);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoadingMore(false);
    }
  }

  async function resolveRow(row) {
    setResolvingId(row.id);
    setRowNotices((current) => {
      const next = { ...current };
      delete next[row.id];
      return next;
    });
    try {
      const result = await call('resolveSystemErrors', {
        id: row.id,
        expectedLastSeenAt: row.lastSeenAt,
      });
      if (result?.reopened) {
        setRowNotices((current) => ({
          ...current,
          [row.id]: 'This error has recurred since the list loaded, so it was not resolved. Refresh to see the latest state.',
        }));
      } else {
        // Reload from the server rather than patching local state — see the
        // file-level note on why a local-only patch is not enough here.
        await load();
      }
    } catch (err) {
      setRowNotices((current) => ({ ...current, [row.id]: err.message }));
    } finally {
      setResolvingId(null);
    }
  }

  const visibleRows = (rows ?? []).filter((row) => !row.resolved);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-brand-ink">System errors</h1>
          <p className="text-sm text-brand-ink-muted">
            Unresolved server-side faults (telemetry/systemErrors.cjs). Resolving
            a row here is not permanent — the server reopens it automatically if
            the same fault happens again.
          </p>
        </div>
        <button
          type="button"
          className={secondaryButtonClass}
          onClick={load}
          disabled={loading || refreshing}
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error ? (
        <p role="status" className="rounded-brand border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          We could not refresh the error list; showing the last values we
          received.
        </p>
      ) : null}

      {loading ? (
        <LoadingState label="Loading system errors…" />
      ) : visibleRows.length === 0 && !nextCursor ? (
        <EmptyState
          title="No unresolved errors"
          description="Nothing is currently flagged. New system errors appear here as soon as they are logged."
        />
      ) : (
        <>
          <Panel>
            <ul className="divide-y divide-brand-ink/10">
              {visibleRows.map((row) => (
                <li key={row.id} className="flex flex-col gap-2 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <KindLabel kind={row.kind} />
                        {/* alertedAt is stamped when a notify attempt is
                            CLAIMED (systemErrors.cjs's claimAlert), before the
                            notifier runs — a 'none' sink, a failed send, or a
                            deduped delivery all still stamp it. "attempted" is
                            the honest word; the row does not record whether
                            the notification was actually delivered. */}
                        {row.alertedAt ? (
                          <span className="rounded-brand border border-brand-ink/20 px-2 py-1 text-xs text-brand-ink-muted">
                            Alert attempted
                          </span>
                        ) : (
                          <span className="rounded-brand border border-brand-ink/20 px-2 py-1 text-xs text-brand-ink-muted">
                            No alert attempted
                          </span>
                        )}
                      </div>
                      <MessageText text={row.message || (row.errors ?? []).join('; ') || null} />
                      <p className="mt-1 text-sm text-brand-ink-muted">
                        Last seen {formatWhen(row.lastSeenAt ?? row.createdAt)}
                      </p>
                    </div>
                    <button
                      type="button"
                      className={secondaryButtonClass}
                      onClick={() => resolveRow(row)}
                      disabled={resolvingId === row.id}
                    >
                      {resolvingId === row.id ? 'Resolving…' : 'Resolve'}
                    </button>
                  </div>
                  {rowNotices[row.id] ? (
                    <p role="alert" className="text-sm text-danger">
                      {rowNotices[row.id]}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </Panel>
          {nextCursor ? (
            <div>
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? 'Loading more…' : 'Load more'}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
