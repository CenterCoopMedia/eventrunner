// Unpublished changes (issue #196): everything saved but not yet on the
// site, per collection, with the publish actions beside it and the publish
// runs under it.
//
// TWO RECORDS, KEPT APART. The rows are the dirty drafts of each publishable
// collection, read from the shell's one count (PendingChangesContext), so
// this page's figure, its rows and the banner on every other screen are the
// same number. The publish runs (cmsPublishQueue) are a different thing:
// the progress and failure record of each cmsPublish call. They sit in
// their own panel and never count unpublished work.
//
// Every action is cmsPublish: Publish all ({ all: true }), one collection
// ({ collection, docIds }), or Resume on a failed run ({ queueId }). One
// call runs at a time; while it runs every publish control is unavailable
// and the pressed one says what it is doing. The result is stated in place
// under the title band, and a toast repeats it without a second
// announcement.
//
// The design record's ruled table (§3.4), without its sort and bulk row:
// the order that matters is newest first, and the panel's own action is the
// bulk action.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAdminApi } from '../adminApi.js';
import { usePendingChanges } from '../PendingChangesContext.jsx';
import { subscribeFailedPublishRuns, subscribeRecentPublishRuns } from '../pendingChangesSource.js';
import { countWords } from '../collectionWords.js';
import { summarizePublish } from '../publishResult.js';
import {
  editorPathFor,
  formatPublishedAt,
  groupPending,
  mergeRuns,
  runSummary,
  summarizeAll,
  toMillis,
} from '../pendingChanges.js';
import { useAdminPages } from '../useAdminPages.js';
import {
  Notice,
  Panel,
  primaryButtonClass,
  rowMetaClass,
  rowTitleLinkClass,
  secondaryButtonClass,
  unavailableButtonClass,
} from '../components/formControls.jsx';
import AdminPageHeader, {
  AdminEmptyState,
  AdminLoadingState,
  RecordState,
  StatusBadge,
  proofRowClass,
} from '../components/adminChrome.jsx';

/** cmsPublish takes at most this many ids for one collection (publish.cjs MAX_DOC_IDS). */
const MAX_COLLECTION_IDS = 2000;
const RECENT_RUNS = 10;
const FAILED_RUNS = 20;

export const COUNT_ERROR = 'We could not count the unpublished changes. We will try again.';
const PART_WAY =
  'The publish stopped part-way. Its run is marked Failed under Recent publishes. Resume it there.';
const STILL_RUNNING =
  'That run is still publishing. Wait for it to finish. A run with no progress for 90 minutes is marked Failed and can then be resumed.';

/** What a refused or failed call says: our words for the two we can explain, the server's for the rest. */
function errorText(err) {
  if (err?.queueId) return PART_WAY;
  if (err?.status === 409) return STILL_RUNNING;
  return err?.message || 'Something went wrong. Try again.';
}

/** The galley head the ticketing tables draw, copied: sticky in its own box. */
function Head({ children }) {
  return (
    <th
      scope="col"
      className="sticky top-0 z-10 border-b-admin-strong border-admin-rule-strong bg-admin-ground-soft px-sm py-xs text-start text-admin-xs font-semibold text-admin-ink-secondary"
    >
      {children}
    </th>
  );
}

/**
 * A row's name. A name cut at 80 characters keeps its whole text in reach:
 * as the cut text's title for a pointer, and as a visually hidden copy that
 * is what a screen reader reads (and a link's name).
 */
function RecordName({ row }) {
  if (row.name === row.fullName) return row.name;
  return (
    <>
      <span aria-hidden="true" title={row.fullName}>
        {row.name}
      </span>
      <span className="sr-only">{row.fullName}</span>
    </>
  );
}

function CollectionPanel({ group, pages, timeZone, busyKey, controlProps }) {
  const { choice, rows } = group;
  const key = `collection:${choice.id}`;
  const tooMany = rows.length > MAX_COLLECTION_IDS;
  return (
    <Panel
      flush
      title={choice.label}
      actions={
        tooMany ? null : (
          <button type="button" {...controlProps(key, secondaryButtonClass)}>
            {busyKey === key ? 'Publishing…' : `Publish ${countWords(choice, rows.length)}`}
          </button>
        )
      }
    >
      {tooMany ? (
        <p className="px-md pb-sm text-admin-sm text-admin-ink-secondary">
          Use Publish all. One collection publish takes at most 2,000 changes.
        </p>
      ) : null}
      {/* A scrolling box has to take a tab stop to be scrolled by keyboard;
          the room's ring draws its focus. */}
      <div role="region" aria-label={choice.label} tabIndex={0} className="max-h-[32rem] overflow-auto">
        <table className="w-full min-w-[40rem] border-collapse text-admin-sm" data-collection={choice.id}>
          <caption className="sr-only">{`${choice.label} with unpublished changes, newest first`}</caption>
          <thead>
            <tr>
              <Head>Record</Head>
              <Head>State</Head>
              <Head>Saved</Head>
              <Head>By</Head>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const href = editorPathFor(choice.id, row, pages);
              // The proof tint rides on each cell, not the row: its layer is
              // a positioned pseudo-element, and Chromium lays one out on a
              // <tr> as an extra cell, pushing every cell one column over.
              // The layer paints over bare text, so every cell's content
              // sits in an element (the tint lifts element children only).
              const cell = `px-sm py-xs align-top ${proofRowClass(row.state.id)}`;
              return (
                <tr key={row.id} className="border-b-admin-hairline border-admin-rule-hairline last:border-b-0">
                  <td className={cell}>
                    {href ? (
                      <Link to={href} className={rowTitleLinkClass}>
                        <RecordName row={row} />
                      </Link>
                    ) : (
                      <span className="text-admin-base font-bold text-admin-ink">
                        <RecordName row={row} />
                      </span>
                    )}
                    <p className={`mt-3xs break-all ${rowMetaClass}`}>{row.id}</p>
                  </td>
                  <td className={cell}>
                    <div className="flex flex-wrap items-center gap-2xs">
                      <RecordState state={row.state} />
                      {row.hidden ? <StatusBadge tone="neutral">Hidden</StatusBadge> : null}
                    </div>
                  </td>
                  <td className={`${cell} font-admin-data text-admin-ink-data`}>
                    <span>{formatPublishedAt(row.savedAt, timeZone) ?? '—'}</span>
                  </td>
                  <td className={`${cell} break-all font-admin-data text-admin-ink-data`}>
                    <span>{row.savedBy ?? '—'}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function RunWord({ summary }) {
  if (summary.tone === 'done') {
    return <span className="text-admin-sm font-semibold text-admin-ink-secondary">{summary.word}</span>;
  }
  return <StatusBadge tone={summary.tone}>{summary.word}</StatusBadge>;
}

function RunRow({ row, timeZone, busyKey, controlProps }) {
  const summary = runSummary(row);
  const key = `resume:${row.id}`;
  const failed = row.status === 'failed';
  const when = formatPublishedAt(toMillis(row.requestedAt), timeZone);
  return (
    <li className="flex flex-col gap-2xs border-b-admin-hairline border-admin-rule-hairline py-sm last:border-b-0" data-run={row.id}>
      <div className="flex flex-wrap items-center gap-x-sm gap-y-2xs">
        <RunWord summary={summary} />
        {summary.sentence ? <span className="text-admin-sm text-admin-ink">{summary.sentence}</span> : null}
      </div>
      <p className={`break-all ${rowMetaClass}`}>
        {[typeof row.requestedBy === 'string' ? row.requestedBy : null, when].filter(Boolean).join(' · ')}
      </p>
      {failed ? (
        <div className="flex flex-col items-start gap-2xs">
          {typeof row.error === 'string' && row.error ? (
            <p className="text-admin-sm text-admin-ink">{row.error}</p>
          ) : null}
          {typeof row.note === 'string' && row.note ? (
            <p className="text-admin-sm text-admin-ink">{row.note}</p>
          ) : null}
          <p className="text-admin-sm text-admin-ink-secondary">
            Resume publishes the current saved version of each record this run did not reach.
          </p>
          <button type="button" {...controlProps(key, secondaryButtonClass)}>
            {busyKey === key ? 'Resuming…' : 'Resume publish'}
          </button>
        </div>
      ) : null}
    </li>
  );
}

function usePublishRuns() {
  const [recent, setRecent] = useState(null);
  const [failed, setFailed] = useState(null);
  const [errors, setErrors] = useState({ recent: null, failed: null });

  useEffect(() => {
    const unsubscribers = [
      subscribeRecentPublishRuns(
        RECENT_RUNS,
        (rows) => {
          setRecent(rows);
          setErrors((current) => ({ ...current, recent: null }));
        },
        (error) => setErrors((current) => ({ ...current, recent: error ?? true })),
      ),
      subscribeFailedPublishRuns(
        FAILED_RUNS,
        (rows) => {
          setFailed(rows);
          setErrors((current) => ({ ...current, failed: null }));
        },
        (error) => setErrors((current) => ({ ...current, failed: error ?? true })),
      ),
    ];
    return () => {
      for (const unsubscribe of unsubscribers) {
        if (typeof unsubscribe === 'function') unsubscribe();
      }
    };
  }, []);

  return {
    ready: recent !== null && failed !== null,
    error: errors.recent || errors.failed || null,
    runs: mergeRuns(recent, failed),
  };
}

export default function AdminUnpublishedChanges() {
  const { ready, error, docsByCollection, total, sentence } = usePendingChanges();
  const { rows: pages } = useAdminPages();
  const { eventConfig } = useEventConfig();
  const timeZone = typeof eventConfig?.timezone === 'string' && eventConfig.timezone ? eventConfig.timezone : undefined;
  const runs = usePublishRuns();
  const call = useAdminApi();
  const { showToast } = useToast();

  const [busyKey, setBusyKey] = useState(null);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState(null);
  const resultRef = useRef(null);
  // The control the last press came from. When it leaves the page with its
  // panel (the panel's rows were all published), focus would fall to the
  // document; it goes to the result instead.
  const pressedRef = useRef(null);

  useEffect(() => {
    const pressed = pressedRef.current;
    // Wait for the answer while the call runs: the result is what focus
    // lands on, and until it arrives the result line is empty and hidden.
    if (!pressed || pressed.isConnected || busyRef.current) return;
    pressedRef.current = null;
    const active = document.activeElement;
    if (!active || active === document.body) resultRef.current?.focus();
  });

  const groups = groupPending(docsByCollection).filter((group) => group.rows.length > 0);

  async function publish(event, key, body, read) {
    if (busyRef.current) return;
    busyRef.current = true;
    pressedRef.current = event.currentTarget;
    setBusyKey(key);
    setNotice(null);
    let result;
    try {
      const response = await call('cmsPublish', body);
      result = read(response);
    } catch (err) {
      result = { ok: false, message: errorText(err) };
    } finally {
      busyRef.current = false;
      setBusyKey(null);
    }
    setNotice({ tone: result.ok ? 'ok' : 'error', message: result.message });
    showToast(result.message, result.ok ? { announce: false } : { tone: 'error', announce: false });
  }

  function onPress(key) {
    return (event) => {
      if (busyRef.current) return;
      if (key === 'all') {
        publish(event, key, { all: true }, summarizeAll);
      } else if (key.startsWith('collection:')) {
        const group = groups.find((candidate) => `collection:${candidate.choice.id}` === key);
        if (!group) return;
        const ids = group.rows.map((row) => row.id);
        publish(event, key, { collection: group.choice.id, docIds: ids }, (response) =>
          summarizePublish(response, group.choice.id, ids, group.choice.plural),
        );
      } else if (key.startsWith('resume:')) {
        publish(event, key, { queueId: key.slice('resume:'.length) }, summarizeAll);
      }
    };
  }

  /** Every publish control: one handler, unavailable while any call runs. */
  function controlProps(key, className) {
    const busy = busyKey !== null;
    const pressed = busyKey === key;
    return {
      className: pressed || !busy ? className : `${className} ${unavailableButtonClass}`,
      onClick: onPress(key),
      'aria-disabled': busy ? 'true' : undefined,
      'aria-busy': pressed ? 'true' : undefined,
      'data-publish-control': key,
    };
  }

  return (
    <div className="flex flex-col gap-md">
      <AdminPageHeader
        title="Unpublished changes"
        description="Pages, content blocks, sessions, organizations, updates, and timeline entries that are saved but not yet on the site. Publish here or in each editor."
        actions={
          ready && total > 0 ? (
            <button type="button" {...controlProps('all', primaryButtonClass)}>
              {busyKey === 'all' ? 'Publishing…' : `Publish all (${total})`}
            </button>
          ) : null
        }
      />

      {/* The result of the last press, stated in place. Focus comes here
          when the pressed control has left the page. */}
      <div ref={resultRef} tabIndex={-1} className="flex flex-col gap-sm empty:hidden">
        {notice ? <Notice tone={notice.tone} message={notice.message} /> : null}
      </div>

      {!ready ? (
        error ? (
          <Notice tone="error" message={COUNT_ERROR} />
        ) : (
          <AdminLoadingState label="Loading unpublished changes…" />
        )
      ) : (
        <>
          {error ? <Notice tone="caution" message="The list could not be refreshed. It will try again." /> : null}
          {total === 0 ? (
            <AdminEmptyState
              title="Nothing is waiting to be published"
              description="Saved changes to pages, content blocks, sessions, organizations, updates, and timeline entries appear here. Speaker edits are reviewed on each speaker’s page."
              action={
                <Link to="/admin/pages" className={secondaryButtonClass}>
                  Open the pages list
                </Link>
              }
            />
          ) : (
            <>
              <p className="text-admin-base text-admin-ink" data-pending-total={total}>
                {sentence}
              </p>
              {groups.map((group) => (
                <CollectionPanel
                  key={group.choice.id}
                  group={group}
                  pages={pages}
                  timeZone={timeZone}
                  busyKey={busyKey}
                  controlProps={controlProps}
                />
              ))}
            </>
          )}
        </>
      )}

      <Panel
        title="Recent publishes"
        description="The last 10 publish runs, and the 20 newest runs still marked Failed, newest first. Running: Still publishing. Done: Finished. Failed: Stopped part-way. A run with no progress for 90 minutes is marked Failed."
      >
        {runs.error ? (
          <Notice tone="caution" message="The publish runs could not be refreshed. The list will try again." />
        ) : null}
        {!runs.ready ? (
          runs.error ? null : <AdminLoadingState label="Loading recent publishes…" />
        ) : runs.runs.length === 0 ? (
          <p className="text-admin-sm text-admin-ink-secondary">No publish has run yet.</p>
        ) : (
          <ol aria-label="Publish runs">
            {runs.runs.map((row) => (
              <RunRow key={row.id} row={row} timeZone={timeZone} busyKey={busyKey} controlProps={controlProps} />
            ))}
          </ol>
        )}
      </Panel>
    </div>
  );
}
