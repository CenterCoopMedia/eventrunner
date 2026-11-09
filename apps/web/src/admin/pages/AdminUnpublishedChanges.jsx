// Unpublished changes (issue #196): everything saved but not yet on the
// site, per collection, with the publish actions beside it and the publish
// runs under it.
//
// The page loads dirty draft rows only while it is open and derives its
// figure from those rows. The shell's count-document banner is hidden here.
// The publish runs (cmsPublishQueue) are a different thing:
// the progress and failure record of each cmsPublish call. They sit in
// their own panel and never count unpublished work.
//
// Every action is cmsPublish: Publish all ({ all: true }), one collection
// ({ collection, docIds }), or Resume on a failed run ({ queueId }). One
// call runs at a time; while it runs every publish control is unavailable
// and the pressed one says what it is doing. The result is stated in place
// beside its collection or run, and a toast repeats it without a second
// announcement.
//
// The design record's ruled table (§3.4), without its sort and bulk row:
// the order that matters is newest first, and the panel's own action is the
// bulk action.
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAdminApi } from '../adminApi.js';
import { useDirtyDrafts } from '../useDirtyDrafts.js';
import { subscribeFailedPublishRuns, subscribeRecentPublishRuns } from '../publishRunsSource.js';
import { countWords } from '../collectionWords.js';
import { summarizePublish } from '../publishResult.js';
import {
  editorPathFor,
  groupPending,
  mergeRuns,
  runSummary,
  summarizeAll,
  toMillis,
} from '../pendingChanges.js';
import { useAdminPages } from '../useAdminPages.js';
import { formatPublishedAt } from '../versionHistory.js';
import { versionAuthor, versionRecordName } from './versionDisplay.js';
import { useComingSoon } from '../../lib/launchSource.js';
import {
  Notice,
  Panel,
  primaryButtonClass,
  rowMetaClass,
  rowTitleLinkClass,
  secondaryButtonClass,
  unavailableButtonClass,
} from '../components/formControls.jsx';
import { ActionFeedback } from '../components/ActionFeedback.jsx';
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

export const COUNT_ERROR = 'The changes could not be counted. Check your connection and try again.';
const STALE_LIST =
  'This list is out of date. Check your connection, or use Publish all for the latest changes.';
const PART_WAY =
  'Some changes were not published. Resume the failed publish under Recent publishes.';
const STILL_RUNNING =
  'These changes are still publishing. Wait for the publish to finish, then try again.';

/** Give a recovery action without exposing server diagnostics. */
function errorText(err) {
  if (err?.queueId) return PART_WAY;
  if (err?.status === 409) return STILL_RUNNING;
  return 'The changes could not be published. Try again.';
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

function CollectionPanel({ group, pages, timeZone, busyKey, controlProps, notice, resultRef }) {
  const { choice, rows } = group;
  const key = `collection:${choice.id}`;
  // Past the server's cap the control stays, unavailable, and names why:
  // a removed control would leave the reader to guess.
  const tooMany = rows.length > MAX_COLLECTION_IDS;
  const whyId = useId();
  return (
    <Panel
      flush
      title={choice.label}
      actions={rows.length > 0 ? (
        <button
          type="button"
          {...controlProps(key, secondaryButtonClass, tooMany)}
          aria-describedby={tooMany ? whyId : undefined}
        >
          {busyKey === key ? 'Publishing…' : `Publish ${countWords(choice, rows.length)}`}
        </button>
      ) : null}
    >
      <div ref={resultRef} tabIndex={-1} className="admin-row-result">
        <ActionFeedback message={notice?.message} tone={notice?.tone} />
      </div>
      {tooMany ? (
        <p id={whyId} className="px-md pb-sm text-admin-sm text-admin-ink-secondary">
          Use Publish all to publish more than 2,000 changes at once.
        </p>
      ) : null}
      {/* A scrolling box has to take a tab stop to be scrolled by keyboard;
          the room's ring draws its focus. */}
      {rows.length > 0 ? <div role="region" aria-label={choice.label} tabIndex={0} className="max-h-[32rem] overflow-auto">
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
                    <span>{row.savedBy ? versionAuthor(row.savedBy) : '—'}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div> : null}
    </Panel>
  );
}

function RunWord({ summary }) {
  if (summary.tone === 'done') {
    return <span className="text-admin-sm font-semibold text-admin-ink-secondary">{summary.word}</span>;
  }
  return <StatusBadge tone={summary.tone}>{summary.word}</StatusBadge>;
}

function RunRow({ row, timeZone, busyKey, controlProps, notice, resultRef }) {
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
        {[typeof row.requestedBy === 'string' ? versionAuthor(row.requestedBy) : null, when].filter(Boolean).join(' · ')}
      </p>
      {failed ? (
        <div className="flex flex-col items-start gap-2xs">
          <p className="text-admin-sm text-admin-ink">Some changes were not published. Resume to finish publishing them.</p>
          <p className="text-admin-sm text-admin-ink-secondary">
            Resume publishes the latest saved changes that are still waiting.
          </p>
          <button type="button" {...controlProps(key, secondaryButtonClass)}>
            {busyKey === key ? 'Resuming…' : 'Resume publish'}
          </button>
        </div>
      ) : null}
      <div ref={resultRef} tabIndex={-1} className="empty:hidden">
        <ActionFeedback message={notice?.message} tone={notice?.tone} />
      </div>
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
  const { ready, error, docsByCollection, total, sentence } = useDirtyDrafts();
  const { rows: pages } = useAdminPages();
  const { eventConfig } = useEventConfig();
  const timeZone = typeof eventConfig?.timezone === 'string' && eventConfig.timezone ? eventConfig.timezone : undefined;
  const runs = usePublishRuns();
  // A new site shows visitors a coming-soon page until its first publish
  // (functions/src/cms/launch.cjs). With nothing pending there is no
  // Publish all, so the site gets its own control to open it.
  const comingSoon = useComingSoon();
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
  const resultShownRef = useRef(false);

  useEffect(() => {
    const pressed = pressedRef.current;
    // Wait for the answer while the call runs: the result is what focus
    // lands on, and until it arrives the result line is empty and hidden.
    if (!pressed || busyRef.current || !notice) return;
    if (pressed.isConnected) {
      if (!resultShownRef.current && document.activeElement === pressed) {
        resultRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'instant' });
      }
      resultShownRef.current = true;
      return;
    }
    pressedRef.current = null;
    const active = document.activeElement;
    if (!active || active === document.body) {
      resultRef.current?.focus({ preventScroll: true });
      resultRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'instant' });
    }
  });

  const resultKey = notice?.key ?? busyKey;
  const groups = groupPending(docsByCollection).map((group) => {
    const docs = new Map((docsByCollection[group.choice.id] ?? []).map((doc) => [doc.id, doc]));
    return {
      ...group,
      rows: group.rows.map((row) => ({
        ...row,
        name: versionRecordName(group.choice.id, docs.get(row.id)),
        fullName: versionRecordName(group.choice.id, docs.get(row.id), { full: true }),
      })),
    };
  }).filter((group) => group.rows.length > 0 || resultKey === `collection:${group.choice.id}`);
  const localResult = resultKey?.startsWith('collection:') || runs.runs.some((run) => resultKey === `resume:${run.id}`);

  async function publish(event, key, body, read) {
    if (busyRef.current) return;
    busyRef.current = true;
    pressedRef.current = event.currentTarget;
    resultShownRef.current = false;
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
    const message = result.ok && key !== 'open' ? 'Published.' : result.message;
    setNotice({ key, tone: result.ok ? 'ok' : 'error', message });
    showToast(message, result.ok ? { announce: false } : { tone: 'error', announce: false });
  }

  function onPress(key) {
    return (event) => {
      if (busyRef.current) return;
      if (key === 'all') {
        publish(event, key, { all: true }, summarizeAll);
      } else if (key === 'open') {
        publish(event, key, { all: true }, () => ({
          ok: true,
          message: 'The site is open. Visitors now see the full site.',
        }));
      } else if (key.startsWith('collection:')) {
        const group = groups.find((candidate) => `collection:${candidate.choice.id}` === key);
        // Past the server's cap the control refuses every press. So does a
        // stale list: cmsPublish publishes any draft it is sent, so an id
        // another admin has published since would go live a second time.
        if (!group || group.rows.length > MAX_COLLECTION_IDS || error) return;
        const ids = group.rows.map((row) => row.id);
        publish(event, key, { collection: group.choice.id, docIds: ids }, (response) =>
          summarizePublish(response, group.choice.id, ids, group.choice.plural),
        );
      } else if (key.startsWith('resume:')) {
        publish(event, key, { queueId: key.slice('resume:'.length) }, summarizeAll);
      }
    };
  }

  /**
   * Every publish control: one handler, unavailable while any call runs,
   * or always when `unavailable` (a collection past the server's cap). A
   * collection's control also waits while the list is stale; Publish all
   * and a resume do not, because the server reads what they publish.
   */
  function controlProps(key, className, unavailable = false) {
    const pressed = busyKey === key;
    const held = unavailable || busyKey !== null || (Boolean(error) && key.startsWith('collection:'));
    return {
      className: held && !pressed ? `${className} ${unavailableButtonClass}` : className,
      onClick: onPress(key),
      'aria-disabled': held ? 'true' : undefined,
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
          <>
            {ready && total > 0 ? (
              <button type="button" {...controlProps('all', primaryButtonClass)}>
                {busyKey === 'all' ? 'Publishing…' : `Publish all (${total})`}
              </button>
            ) : null}
            {ready && total === 0 && comingSoon ? (
              <button type="button" {...controlProps('open', primaryButtonClass)}>
                {busyKey === 'open' ? 'Opening…' : 'Open the site'}
              </button>
            ) : null}
            {!localResult ? <div ref={resultRef} tabIndex={-1} className="basis-full empty:hidden">
              <ActionFeedback message={notice?.message} tone={notice?.tone} />
            </div> : null}
          </>
        }
      />

      {!ready ? (
        error ? (
          <Notice tone="error" message={COUNT_ERROR} />
        ) : (
          <AdminLoadingState label="Loading unpublished changes…" />
        )
      ) : (
        <>
          {error ? <Notice tone="caution" message={STALE_LIST} /> : null}
          {total === 0 ? (
            <AdminEmptyState
              title="Nothing is waiting to be published"
              description="Edit your pages to add content or change what visitors see."
              action={
                <Link to="/admin/pages" className={secondaryButtonClass}>
                  Edit pages
                </Link>
              }
            />
          ) : (
            <p className="text-admin-base text-admin-ink" data-pending-total={total}>
              {sentence}
            </p>
          )}
          {groups.map((group) => (
            <CollectionPanel
              key={group.choice.id}
              group={group}
              pages={pages}
              timeZone={timeZone}
              busyKey={busyKey}
              controlProps={controlProps}
              notice={notice?.key === `collection:${group.choice.id}` ? notice : null}
              resultRef={resultKey === `collection:${group.choice.id}` ? resultRef : undefined}
            />
          ))}
        </>
      )}

      <Panel
        title="Recent publishes"
        description="Review recent publishes and resume any that stopped before they finished."
      >
        {runs.error ? (
          <Notice tone="caution" message="Recent publishes could not be refreshed. Check your connection and try again." />
        ) : null}
        {!runs.ready ? (
          runs.error ? null : <AdminLoadingState label="Loading recent publishes…" />
        ) : runs.runs.length === 0 ? (
          <p className="text-admin-sm text-admin-ink-secondary">No publish has run yet.</p>
        ) : (
          <ol aria-label="Publish runs">
            {runs.runs.map((row) => (
              <RunRow key={row.id} row={row} timeZone={timeZone} busyKey={busyKey} controlProps={controlProps}
                notice={notice?.key === `resume:${row.id}` ? notice : null}
                resultRef={resultKey === `resume:${row.id}` ? resultRef : undefined} />
            ))}
          </ol>
        )}
      </Panel>
    </div>
  );
}
