// Version history, one record (issue #195): every version the record has
// had, newest first, each with when it was published, by which account, and
// what changed from the version before it.
//
// The page reads cmsGetVersionHistory (functions/src/cms/versions.cjs) for
// one docPath, 20 versions a call, and renders what the server answers: the
// server compares each version with the one before it, so this page never
// diffs anything itself. It reads the record's live and draft documents too
// (useAdminRecords), for its name and its state.
//
// READ ONLY. A version cannot be changed or restored here: the page reads
// history and writes nothing.
//
// STORED VALUES ARE TEXT. Every value, path and account is a React text
// node. Rich text shows its tags; nothing is parsed, and a stored URL is
// never made a link, so a `javascript:` value cannot run here.
//
// LATE ANSWERS. Every call takes a sequence number. An answer from a call
// that Refresh, another record, or leaving the page has overtaken is
// dropped, so a late "older" page never lands on a fresh list or on another
// record.
//
// FOCUS. Load older versions moves focus to the first new version's
// heading.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { useAdminApi } from '../adminApi.js';
import AdminPageHeader, {
  AdminEmptyState,
  AdminLoadingState,
  RecordState,
} from '../components/adminChrome.jsx';
import {
  Notice,
  Panel,
  secondaryButtonClass,
  unavailableButtonClass,
} from '../components/formControls.jsx';
import { deadMatter } from '../recordState.js';
import { useAdminRecords } from '../useAdminRecords.js';
import {
  collectionChoice,
  formatClock,
  formatPublishedAt,
  pathText,
  recordNameOf,
  valueText,
} from '../versionHistory.js';

const PAGE_SIZE = 20;
/** A value longer than this shows its start, and the rest behind a disclosure. */
const SHOWN_CHARACTERS = 300;

const plural = (n, one, many) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

const headClass =
  'border-b-admin-strong border-admin-rule-strong bg-admin-ground-soft px-sm py-xs text-start text-admin-xs font-semibold text-admin-ink-secondary';
const cellClass = 'px-sm py-xs align-top wrap-anywhere';

/** A stored value as text, its start only when it is long. */
function ValueCell({ value, time, timeZone }) {
  const text = valueText(value, { time, timeZone });
  if (text.length <= SHOWN_CHARACTERS) return <span className="whitespace-pre-wrap">{text}</span>;
  return (
    <>
      <span className="whitespace-pre-wrap">{`${text.slice(0, SHOWN_CHARACTERS)}…`}</span>
      <details className="mt-3xs">
        <summary className="admin-target cursor-pointer font-semibold text-admin-ink-link">
          {`Show all ${text.length.toLocaleString('en-US')} characters`}
        </summary>
        <span className="mt-2xs block whitespace-pre-wrap">{text}</span>
      </details>
    </>
  );
}

/** The what-changed entry: a table that never scrolls sideways. */
function ChangeTable({ entry, timeZone }) {
  const first = entry.previousRevision === null;
  const changes = Array.isArray(entry.changes) ? entry.changes : [];
  const more = Number.isFinite(entry.moreChanges) ? entry.moreChanges : 0;
  return (
    <div className="flex flex-col gap-xs">
      {first ? (
        <p className="text-admin-sm text-admin-ink">
          {entry.revision === 1 ? 'First published.' : 'Earliest version on record.'}
        </p>
      ) : null}
      {changes.length === 0 ? (
        <p className="text-admin-sm text-admin-ink">No field changed in this publish.</p>
      ) : (
        <table className="w-full table-fixed border-collapse text-admin-sm">
          <caption className="sr-only">{`What changed in version ${entry.revision}`}</caption>
          <thead>
            <tr>
              <th scope="col" className={`${headClass} w-1/3 sm:w-1/4`}>Field</th>
              {first ? (
                <th scope="col" className={headClass}>Value</th>
              ) : (
                <>
                  <th scope="col" className={headClass}>Before</th>
                  <th scope="col" className={headClass}>After</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {changes.map((change) => (
              <tr key={change.path} className="border-b-admin-hairline border-admin-rule-hairline last:border-b-0">
                <th scope="row" className={`${cellClass} text-start font-admin-data font-normal text-admin-ink-data`}>
                  {pathText(change.path)}
                </th>
                {first ? null : (
                  <td className={`${cellClass} text-admin-ink`}>
                    <ValueCell value={change.before} time={change.time} timeZone={timeZone} />
                  </td>
                )}
                <td className={`${cellClass} text-admin-ink`}>
                  <ValueCell value={change.after} time={change.time} timeZone={timeZone} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {more > 0 ? (
        <p className="text-admin-sm text-admin-ink-secondary">
          {`${plural(more, 'more change is', 'more changes are')} not listed.`}
        </p>
      ) : null}
    </div>
  );
}

export default function AdminVersionHistory() {
  const { collection, docId } = useParams();
  const choice = collectionChoice(collection);
  const docPath = choice ? `${choice.id}/${docId}` : null;
  const call = useAdminApi();
  const { eventConfig } = useEventConfig();
  const timeZone = typeof eventConfig?.timezone === 'string' && eventConfig.timezone ? eventConfig.timezone : undefined;
  const records = useAdminRecords(choice ? choice.id : null);
  const row = records.ready ? records.findRow(docId) : null;

  const [result, setResult] = useState(null);
  const [pending, setPending] = useState(null); // 'load' | 'refresh' | 'more' | null
  const [error, setError] = useState(null);
  const [focusRevision, setFocusRevision] = useState(null);

  const requestRef = useRef(0);
  // The latest call, read when a read starts: a new token-bound callback
  // (useAdminApi follows the signed-in user) must not restart the reads.
  const callRef = useRef(call);
  callRef.current = call;
  const headingRefs = useRef(new Map());

  const load = useCallback(
    async (kind) => {
      const requestId = (requestRef.current += 1);
      setPending(kind);
      try {
        const response = await callRef.current('cmsGetVersionHistory', { docPath, limit: PAGE_SIZE });
        if (requestId !== requestRef.current) return;
        setResult({
          entries: Array.isArray(response?.entries) ? response.entries : [],
          nextCursor: Number.isFinite(response?.nextCursor) ? response.nextCursor : null,
          readAt: Date.now(),
        });
        setError(null);
      } catch (err) {
        if (requestId === requestRef.current) setError(err);
      } finally {
        if (requestId === requestRef.current) setPending(null);
      }
    },
    [docPath],
  );

  // The first read, and a fresh one for another record. Leaving the record
  // (or the page) overtakes every call still in flight.
  useEffect(() => {
    if (!docPath) return undefined;
    setResult(null);
    setError(null);
    load('load');
    return () => {
      requestRef.current += 1;
    };
  }, [docPath, load]);

  useEffect(() => {
    if (focusRevision === null) return;
    headingRefs.current.get(focusRevision)?.focus();
    setFocusRevision(null);
  }, [focusRevision]);

  function refresh() {
    load('refresh');
  }

  // While a first read or a refresh runs, the entries on screen are about
  // to be replaced, so the pager refuses, and says why: paging them would
  // drop the answer the page asked for. While the pager runs itself it is
  // busy, which is its own state and keeps its own look.
  const pagerRefused = pending === 'load' || pending === 'refresh';

  async function loadMore() {
    if (result?.nextCursor == null || pending !== null) return;
    const requestId = (requestRef.current += 1);
    const cursor = result.nextCursor;
    setPending('more');
    try {
      const response = await callRef.current('cmsGetVersionHistory', { docPath, limit: PAGE_SIZE, cursor });
      if (requestId !== requestRef.current) return;
      const more = Array.isArray(response?.entries) ? response.entries : [];
      setResult((current) => {
        const known = new Set(current.entries.map((entry) => entry.revision));
        return {
          entries: [...current.entries, ...more.filter((entry) => !known.has(entry.revision))],
          nextCursor: Number.isFinite(response?.nextCursor) ? response.nextCursor : null,
          readAt: Date.now(),
        };
      });
      setError(null);
      if (more.length > 0) setFocusRevision(more[0].revision);
    } catch (err) {
      if (requestId === requestRef.current) setError(err);
    } finally {
      if (requestId === requestRef.current) setPending(null);
    }
  }

  const backLink = (
    <Link to={`/admin/versions?collection=${choice?.id ?? ''}`} className={secondaryButtonClass}>
      Back to the list
    </Link>
  );

  if (!choice) {
    return (
      <div className="flex flex-col gap-md">
        <AdminEmptyState
          title="No such collection"
          description="Version history covers content blocks, pages, sessions, organizations, updates, and the timeline."
          action={
            <Link to="/admin/versions" className={secondaryButtonClass}>
              Back to the list
            </Link>
          }
        />
      </div>
    );
  }

  const entries = result?.entries ?? [];
  const denied = error?.status === 403;
  let recordState = null;
  if (records.ready && row) recordState = <RecordState state={row.state} />;
  else if (records.ready && entries.length > 0) recordState = <RecordState state={deadMatter('Removed')} />;

  let errorNotice = null;
  if (error && !denied) {
    if (error.status === 401) {
      errorNotice = (
        <Notice tone="error" message={error.message.replace(/\s*Sign in again\.?\s*$/i, '')}>
          {' '}
          <Link to="/signin" className="font-semibold underline underline-offset-2">
            Sign in again
          </Link>
        </Notice>
      );
    } else if (result) {
      errorNotice = (
        <Notice tone="caution" message="The version history did not load. The versions already loaded stay on screen." />
      );
    } else {
      errorNotice = (
        <div className="flex flex-col items-start gap-xs">
          <Notice tone="error" message={error.message} />
          <button
            type="button"
            className={secondaryButtonClass}
            aria-busy={pending === 'load' ? 'true' : undefined}
            onClick={() => load('load')}
          >
            {pending === 'load' ? 'Loading…' : 'Try again'}
          </button>
        </div>
      );
    }
  }

  const liveRevision = typeof row?.live?.revision === 'number' ? row.live.revision : null;

  let body = null;
  if (denied) {
    body = (
      <AdminEmptyState
        title="You don’t have access to version history"
        description="Version history is open to operators and staff. Ask an operator to check your access."
      />
    );
  } else if (!result) {
    body = error ? null : <AdminLoadingState label="Loading the version history…" />;
  } else if (entries.length === 0) {
    body = (
      <AdminEmptyState
        title="No published versions yet"
        description="This record has not been published. A version appears here each time it is published."
        action={backLink}
      />
    );
  } else {
    body = (
      <Panel flush>
        <ol aria-label="Versions">
          {entries.map((entry) => {
            const published = formatPublishedAt(entry.publishedAt, timeZone);
            return (
              <li
                key={entry.revision}
                className="flex flex-col gap-sm border-b-admin-hairline border-admin-rule-hairline px-md py-md last:border-b-0"
              >
                <div className="flex flex-col gap-3xs">
                  <h2
                    ref={(node) => {
                      if (node) headingRefs.current.set(entry.revision, node);
                      else headingRefs.current.delete(entry.revision);
                    }}
                    tabIndex={-1}
                    className="font-admin-ui text-admin-lg font-bold text-admin-ink"
                  >
                    Version <span className="font-admin-data">{entry.revision}</span>
                  </h2>
                  <p className="text-admin-sm text-admin-ink-secondary wrap-anywhere">
                    {'Published '}
                    {published ? (
                      <time dateTime={new Date(entry.publishedAt).toISOString()} className="font-admin-data text-admin-ink-data">
                        {published}
                      </time>
                    ) : (
                      'at a time not recorded'
                    )}
                    {entry.publishedBy ? (
                      <>
                        {' by '}
                        <span className="font-admin-data text-admin-ink-data">{entry.publishedBy}</span>
                      </>
                    ) : (
                      '. Account not recorded'
                    )}
                    .
                  </p>
                  {liveRevision === entry.revision ? (
                    <p className="text-admin-sm font-semibold text-admin-ink">This is the published version.</p>
                  ) : null}
                </div>
                <ChangeTable entry={entry} timeZone={timeZone} />
              </li>
            );
          })}
        </ol>
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-md">
      <AdminPageHeader
        title={recordNameOf(choice.id, row?.current ?? { id: docId })}
        state={recordState}
        identifiers={`${choice.id}/${docId}`}
        description="Newest first. A version is added each time this record is published."
        actions={
          <>
            {backLink}
            <button
              type="button"
              className={secondaryButtonClass}
              aria-busy={pending === 'refresh' ? 'true' : undefined}
              onClick={refresh}
            >
              {pending === 'refresh' ? 'Refreshing…' : 'Refresh'}
            </button>
          </>
        }
      />

      {errorNotice}

      {result && entries.length > 0 && !denied ? (
        <p role="status" className="text-admin-sm text-admin-ink-secondary">
          {`${plural(entries.length, 'version', 'versions')} shown, newest first, read at ${formatClock(result.readAt, timeZone)}.`}
        </p>
      ) : null}

      {body}

      {result?.nextCursor != null && !denied ? (
        <div>
          <button
            type="button"
            className={pagerRefused ? `${secondaryButtonClass} ${unavailableButtonClass}` : secondaryButtonClass}
            aria-busy={pending === 'more' ? 'true' : undefined}
            aria-disabled={pagerRefused ? 'true' : undefined}
            onClick={loadMore}
          >
            {pending === 'more' ? 'Loading…' : pagerRefused ? 'Load older versions after the refresh' : 'Load older versions'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
