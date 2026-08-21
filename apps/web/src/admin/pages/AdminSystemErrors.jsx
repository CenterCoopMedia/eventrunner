// System errors admin surface (issue #58): unresolved `system_errors` rows
// (functions/src/telemetry/systemErrors.cjs, functions/src/auth/otp.cjs's
// template-override-invalid fallback), with a resolve action per row.
//
// `system_errors` is server-only (firestore.rules: allow read, write: if
// false) — listSystemErrors/resolveSystemErrors (functions/src/telemetry/
// systemErrorsAdmin.cjs) are the only way this page ever sees or changes a
// row, so there is no live listener here (unlike AdminPagesList): a plain
// fetch on mount and after every resolve, same shape as any other admin
// POST call.
//
// Resolving is not monotonic: auth/otp.cjs reopens a row (resolved: false,
// fresh lastSeenAt) when the same fault class recurs. Each row's `resolve`
// button sends back the `lastSeenAt` this page last displayed for it
// (`expectedLastSeenAt`) — if the row was reopened since this list loaded,
// the server treats that as stale and skips the write rather than silently
// re-hiding an active fault, and this page reports that instead of a
// generic success.
import { useCallback, useEffect, useState } from 'react';
import EmptyState from '../../components/EmptyState.jsx';
import LoadingState from '../../components/LoadingState.jsx';
import { useAdminApi } from '../adminApi.js';
import { Panel, secondaryButtonClass } from '../components/formControls.jsx';

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

export default function AdminSystemErrors() {
  const call = useAdminApi();
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [resolvingId, setResolvingId] = useState(null);
  const [rowNotices, setRowNotices] = useState({});

  const load = useCallback(async () => {
    try {
      const response = await call('listSystemErrors', { limit: 100 });
      setRows(Array.isArray(response?.rows) ? response.rows : []);
      setError(null);
    } catch (err) {
      // Fail soft: keep whatever rows we already have and surface a
      // non-blocking notice, the same contract AdminPagesList's listener
      // failure follows.
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [call]);

  useEffect(() => {
    load();
  }, [load]);

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
        // Reflect the resolve immediately rather than waiting on a refetch —
        // there is no live listener to do it for us.
        setRows((current) =>
          (current ?? []).map((r) => (r.id === row.id ? { ...r, resolved: true } : r)),
        );
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
      <div>
        <h1 className="font-heading text-2xl font-semibold text-brand-ink">System errors</h1>
        <p className="text-sm text-brand-ink-muted">
          Unresolved server-side faults (telemetry/systemErrors.cjs). Resolving
          a row here is not permanent — the server reopens it automatically if
          the same fault happens again.
        </p>
      </div>

      {error ? (
        <p role="status" className="rounded-brand border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          We could not refresh the error list; showing the last values we
          received.
        </p>
      ) : null}

      {loading ? (
        <LoadingState label="Loading system errors…" />
      ) : visibleRows.length === 0 ? (
        <EmptyState
          title="No unresolved errors"
          description="Nothing is currently flagged. New system errors appear here as soon as they are logged."
        />
      ) : (
        <Panel>
          <ul className="divide-y divide-brand-ink/10">
            {visibleRows.map((row) => (
              <li key={row.id} className="flex flex-col gap-2 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <KindLabel kind={row.kind} />
                      {row.alertedAt ? (
                        <span className="rounded-brand border border-brand-ink/20 px-2 py-1 text-xs text-brand-ink-muted">
                          Alerted
                        </span>
                      ) : (
                        <span className="rounded-brand border border-brand-ink/20 px-2 py-1 text-xs text-brand-ink-muted">
                          Not alerted
                        </span>
                      )}
                    </div>
                    <p className="mt-1 truncate text-sm text-brand-ink">
                      {row.message || (row.errors ?? []).join('; ') || '(no message)'}
                    </p>
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
      )}
    </div>
  );
}
