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
//
// Restyled onto the fixed admin identity (docs/plans/2026-08-27-admin-
// identity-story.md): the job line via AdminPageHeader, the galley for the
// row list (hairline rows, mono data, no zebra, no row cards), and every
// rejection — the row-level "not resolved" notices — rendered verbatim on
// the alarm ground via `Notice tone="error"`, the same query pattern
// `ServerErrorSummary` uses. The soft list-load failure stays a caution
// notice, not an alarm: it is not a rejection, it is a stale, non-blocking
// read (same contract AdminPagesList's listener failure follows).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAdminApi } from '../adminApi.js';
import AdminIconControl from '../components/AdminIconControl.jsx';
import { Notice, Panel, secondaryButtonClass } from '../components/formControls.jsx';
import AdminPageHeader, {
  AdminEmptyState,
  AdminLoadingState,
  StatusBadge,
} from '../components/adminChrome.jsx';
import OperationIcon from '../components/OperationIcon.jsx';

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
    <code className="rounded-admin-small bg-admin-ground-soft px-2xs py-3xs font-admin-data text-admin-xs text-admin-ink-data">
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
 *
 * The message is set in the data face: it is exactly the kind of text an
 * operator copies, pastes, and compares character by character to dedupe a
 * fault against a known one.
 */
function MessageText({ text }) {
  if (!text) {
    return <p className="mt-3xs font-admin-data text-admin-sm text-admin-ink-data">(no message)</p>;
  }
  if (text.length <= MESSAGE_PREVIEW_LEN) {
    return <p className="mt-3xs font-admin-data text-admin-sm text-admin-ink-data">{text}</p>;
  }
  return (
    <details className="mt-3xs font-admin-data text-admin-sm text-admin-ink-data">
      <summary className="admin-target inline cursor-pointer underline underline-offset-4">
        {text.slice(0, MESSAGE_PREVIEW_LEN)}…{' '}
        <span className="text-admin-ink-secondary">(show full message)</span>
      </summary>
      <p className="mt-2xs whitespace-pre-wrap break-words">{text}</p>
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
  const [moreError, setMoreError] = useState(null);
  const [resolvingId, setResolvingId] = useState(null);
  const [rowNotices, setRowNotices] = useState({});
  const [resolvedMessage, setResolvedMessage] = useState('');
  const readBusyRef = useRef(false);
  const resolveBusyRef = useRef(false);
  const resultRef = useRef(null);
  const refreshRef = useRef(null);
  const rowRefs = useRef(new Map());
  const [focusRow, setFocusRow] = useState(null);
  // Distinguishes the one-time initial fetch (full-page skeleton) from a
  // manual refresh or a post-resolve reload (keeps the current rows on
  // screen, just relabels the refresh control) — a ref so `load` does not
  // need `rows`/`loading` in its own dependency list.
  const hasLoadedRef = useRef(false);

  const load = useCallback(async () => {
    if (readBusyRef.current) return;
    readBusyRef.current = true;
    if (!hasLoadedRef.current) setLoading(true);
    else setRefreshing(true);
    try {
      const response = await call('listSystemErrors', { limit: PAGE_SIZE });
      setRows(Array.isArray(response?.rows) ? response.rows : []);
      setNextCursor(response?.nextCursor ?? null);
      setError(null);
      setMoreError(null);
      hasLoadedRef.current = true;
      return true;
    } catch (err) {
      // Fail soft: keep whatever rows we already have and surface a
      // non-blocking notice, the same contract AdminPagesList's listener
      // failure follows.
      setError(err);
      return false;
    } finally {
      readBusyRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, [call]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => { if (resolvedMessage) resultRef.current?.focus(); }, [resolvedMessage]);
  useEffect(() => {
    if (focusRow === null) return;
    (rowRefs.current.get(focusRow) ?? refreshRef.current)?.focus();
    setFocusRow(null);
  }, [focusRow]);

  async function loadMore() {
    if (!nextCursor || readBusyRef.current || resolveBusyRef.current) return;
    readBusyRef.current = true;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const response = await call('listSystemErrors', { limit: PAGE_SIZE, cursor: nextCursor });
      const more = Array.isArray(response?.rows) ? response.rows : [];
      setRows((current) => [...(current ?? []), ...more]);
      setNextCursor(response?.nextCursor ?? null);
      setError(null);
      setFocusRow(more.find((row) => !row.resolved)?.id ?? '');
    } catch (err) {
      setMoreError(err.message);
    } finally {
      readBusyRef.current = false;
      setLoadingMore(false);
    }
  }

  async function resolveRow(row) {
    if (resolveBusyRef.current || readBusyRef.current) return;
    resolveBusyRef.current = true;
    setResolvingId(row.id);
    setResolvedMessage('');
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
        const refreshed = await load();
        setResolvedMessage(refreshed ? 'Error resolved. The list has been checked again.' : 'Error resolved. Refresh to check the list again.');
      }
    } catch (err) {
      setRowNotices((current) => ({ ...current, [row.id]: err.message }));
    } finally {
      resolveBusyRef.current = false;
      setResolvingId(null);
    }
  }

  const visibleRows = (rows ?? []).filter((row) => !row.resolved);

  return (
    <div className="flex flex-col gap-md">
      <AdminPageHeader
        title="System errors"
        description="Unresolved server-side faults (telemetry/systemErrors.cjs). Resolving a row here is not permanent — the server reopens it automatically if the same fault happens again."
        actions={
          rows === null && error ? <button
            ref={refreshRef}
            type="button"
            className={secondaryButtonClass}
            onClick={load}
            disabled={loading || refreshing || loadingMore || Boolean(resolvingId)}
            aria-busy={loading || refreshing || undefined}
          >
            <OperationIcon name="refresh" />
            {refreshing ? 'Refreshing…' : rows === null && error ? 'Try again' : 'Refresh'}
          </button> : <AdminIconControl
            ref={refreshRef}
            className={secondaryButtonClass}
            onClick={load}
            disabled={loading || refreshing || loadingMore || Boolean(resolvingId)}
            aria-busy={loading || refreshing || undefined}
            busy={loading || refreshing}
            label={loading || refreshing ? 'Refreshing…' : 'Refresh'}
            icon="refresh"
          />
        }
      />

      {error ? (
        <Notice
          tone="caution"
          message={rows === null ? 'We could not load the error list. Try again to check for unresolved errors.' : 'We could not refresh the error list; showing the last values we received.'}
        />
      ) : null}
      {resolvedMessage ? <div ref={resultRef} tabIndex={-1}><Notice tone="ok" message={resolvedMessage} /></div> : null}

      {loading ? (
        <AdminLoadingState label="Loading system errors…" />
      ) : rows === null ? null : visibleRows.length === 0 && !nextCursor ? (
        <AdminEmptyState
          title="No unresolved errors"
          description="No unresolved errors were returned by the last check. Refresh to check for new errors."
        />
      ) : (
        <>
          <Panel flush>
            {/* The galley: hairline rows, no zebra striping and no row cards
                — the hairline already does that work, and striping is the
                tell of a default table. */}
            <ul>
              {visibleRows.map((row) => (
                <li
                  key={row.id}
                  className="border-admin-rule-hairline border-b-admin-hairline last:border-b-0"
                >
                  <div className="flex flex-col gap-2xs px-md py-sm">
                    <div className="flex flex-wrap items-center justify-between gap-sm">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-sm gap-y-3xs">
                          <KindLabel kind={row.kind} />
                          {/* alertedAt is stamped when a notify attempt is
                              CLAIMED (systemErrors.cjs's claimAlert), before the
                              notifier runs — a 'none' sink, a failed send, or a
                              deduped delivery all still stamp it. "attempted" is
                              the honest word; the row does not record whether
                              the notification was actually delivered. */}
                          {row.alertedAt ? (
                            <StatusBadge tone="info">Alert attempted</StatusBadge>
                          ) : (
                            <StatusBadge tone="neutral">No alert attempted</StatusBadge>
                          )}
                        </div>
                        <MessageText text={row.message || (row.errors ?? []).join('; ') || null} />
                        <p className="mt-3xs font-admin-data text-admin-xs text-admin-ink-secondary">
                          Last seen {formatWhen(row.lastSeenAt ?? row.createdAt)}
                        </p>
                      </div>
                      <button
                        ref={(node) => { if (node) rowRefs.current.set(row.id, node); else rowRefs.current.delete(row.id); }}
                        type="button"
                        className={secondaryButtonClass}
                        onClick={() => resolveRow(row)}
                        disabled={Boolean(resolvingId) || refreshing || loadingMore}
                        aria-busy={resolvingId === row.id || undefined}
                      >
                        {resolvingId === row.id ? 'Resolving…' : 'Resolve'}
                      </button>
                    </div>
                    {rowNotices[row.id] ? (
                      <Notice tone="error" message={rowNotices[row.id]} />
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
          {nextCursor ? (
            <div className="flex flex-col gap-xs">
              {moreError ? <Notice tone="error" message={`The next page could not be loaded. ${moreError}`} /> : null}
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={loadMore}
                disabled={loadingMore || refreshing || Boolean(resolvingId)}
                aria-busy={loadingMore || undefined}
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
