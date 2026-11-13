import HelpTooltip from '../components/HelpTooltip.jsx';
// The email log (issue #183): every message the site sent, newest first,
// with search, two filters, and a preview of the stored body.
//
// `sent_emails` is server-only (firestore.rules denies every client, admins
// included), so this page reads it through two staff-tier endpoints and has
// no listener (functions/src/email/log.cjs): listSentEmails for the rows,
// which never carry a body, and getSentEmail for one row's bodies, which the
// server records in the admin log. A fetch on mount, on a search, on
// Refresh, and on Load more.
//
// PRIVACY. A recipient address is personal data. The search text lives in
// this component's state only: it never enters the URL, so it never reaches
// the browser history or a client error report, which carries
// window.location.href (lib/errorReporting.js). The field asks the browser
// not to remember it. Source and status carry nothing personal, so they
// live in the URL and a reload or a shared link keeps them. So does `send`
// (issue #497): the id of one announcement send, set by the link in the
// Announcements send history. It limits the rows to that send's recipients,
// a search keeps it, and "Show every message" drops it.
//
// THE PREVIEW. Stored HTML renders only inside <iframe sandbox="">, from
// admin/emailPreview.js buildPreviewDoc, under a content policy that blocks
// script and every fetch, with every link turned into its words. The frame
// has an opaque origin: it cannot reach this page, its storage, or the
// admin's token. Opening a preview sends no request but the getSentEmail
// call. HTML the builder refuses is not shown; the plain text is. The
// plain-text body, an address, a subject, and a bounce reason are React
// text, never HTML.
//
// THE FIGURE SENTENCE, NOT A TILE. One stated line under the form says what
// is shown and when it was read. It never states a total: a search reads a
// bounded window (500 messages a request), so it counts what the server
// examined, summed over the pages loaded.
//
// FOCUS. A new search, a filter change, or Refresh replaces the rows; Load
// more appends and moves focus to the first new row's Preview, so focus is
// never lost when the pager leaves. Clear and "Clear search" move focus to
// the search field. Opening a preview leaves focus on its button.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { useAdminApi } from '../adminApi.js';
import { communicationsError } from '../components/communicationsErrors.js';
import AdminIconControl from '../components/AdminIconControl.jsx';
import {
  Notice,
  SelectField,
  TextField,
  fieldLabelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import AdminPageHeader, {
  AdminEmptyState,
  AdminLoadingState,
} from '../components/adminChrome.jsx';
import EmailLogTable, { EmailLogFigure, SOURCE_LABELS, known, recentWindow } from '../components/EmailLogTable.jsx';

const PAGE_SIZE = 25;
const STATUS_WORDS = Object.freeze({ sent: 'Sent', failed: 'Failed' });

/** The id shape of an announcement send, as the server checks it. */
const SEND_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * The filters the URL holds: a source and a status this page offers, and an
 * announcement send id the server would accept, or nothing.
 */
function readFilters(searchParams) {
  const source = searchParams.get('source') ?? '';
  const status = searchParams.get('status') ?? '';
  const send = searchParams.get('send') ?? '';
  return {
    source: known(SOURCE_LABELS, source) ? source : '',
    status: known(STATUS_WORDS, status) ? status : '',
    send: SEND_ID_RE.test(send) ? send : '',
  };
}

/** The request body for one page of a search. Empty values are left out. */
function requestBody({ q, source, status, send }, cursor) {
  return {
    limit: PAGE_SIZE,
    ...(q ? { q } : {}),
    ...(source ? { source } : {}),
    ...(status ? { status } : {}),
    ...(send ? { sendId: send } : {}),
    ...(cursor ? { cursor } : {}),
  };
}

/** "“alex”, the source Sign-in code and the status Failed" */
function describeSearch({ q, source, status, send }) {
  const parts = [];
  if (q) parts.push(`“${q}”`);
  if (send) parts.push('one announcement send');
  if (source) parts.push(`the source ${known(SOURCE_LABELS, source) ? SOURCE_LABELS[source] : source}`);
  if (status) parts.push(`the status ${known(STATUS_WORDS, status) ? STATUS_WORDS[status] : status}`);
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

export default function AdminEmailLog() {
  const call = useAdminApi();
  const { eventConfig } = useEventConfig();
  const timeZone = typeof eventConfig?.timezone === 'string' && eventConfig.timezone ? eventConfig.timezone : undefined;
  const [searchParams, setSearchParams] = useSearchParams();
  const urlFilters = readFilters(searchParams);
  const urlKey = `${urlFilters.source}|${urlFilters.status}|${urlFilters.send}`;

  // The form as the reader is editing it.
  const [draft, setDraft] = useState(() => ({ q: '', ...urlFilters }));
  // The last answered read: rows, the pager cursor, the rows the server
  // examined over every page loaded, the search that produced them, and
  // when it answered. Null until the first read answers.
  const [result, setResult] = useState(null);
  const [pending, setPending] = useState(null); // 'search' | 'refresh' | 'more' | null
  const [error, setError] = useState(null);
  const [pageError, setPageError] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [details, setDetails] = useState({});
  const [focusTarget, setFocusTarget] = useState(null);

  const requestRef = useRef(0);
  // The search the page asked for last. While it runs, the rows on screen
  // belong to the one before it, so Refresh repeats this one.
  const latestSearchRef = useRef(null);
  // The filter pair this page last wrote to the URL, so a write of its own
  // does not read back as a navigation.
  const writtenKeyRef = useRef(null);
  const formRef = useRef(null);
  const pagerRef = useRef(null);
  const accessFeedbackRef = useRef(null);
  const previewRefs = useRef(new Map());
  const detailRequests = useRef(new Set());

  const focusSearchField = () => formRef.current?.querySelector('input[type="search"]')?.focus();

  const runSearch = useCallback(async (search, kind) => {
    const requestId = (requestRef.current += 1);
    latestSearchRef.current = search;
    setPending(kind);
    setPageError(null);
    try {
      const response = await call('listSentEmails', requestBody(search));
      if (requestId !== requestRef.current) return;
      const rows = Array.isArray(response?.rows) ? response.rows : [];
      setResult({
        rows,
        nextCursor: response?.nextCursor ?? null,
        scanned: Number.isFinite(response?.scanned) ? response.scanned : rows.length,
        applied: search,
        readAt: Date.now(),
      });
      setOpenId(null);
      setError(null);
    } catch (err) {
      if (requestId === requestRef.current) setError(err);
    } finally {
      if (requestId === requestRef.current) setPending(null);
    }
  }, [call]);

  // The first read, and a read whenever the URL's filters change under the
  // page (a docket click, a pasted link). A search is empty then: the URL
  // never holds one.
  useEffect(() => {
    if (writtenKeyRef.current === urlKey) return;
    writtenKeyRef.current = urlKey;
    const [source, status, send] = urlKey.split('|');
    const search = { q: '', source, status, send };
    setDraft(search);
    runSearch(search, 'search');
  }, [urlKey, runSearch]);

  useEffect(() => {
    if (!focusTarget) return;
    if (focusTarget.kind === 'access') accessFeedbackRef.current?.focus();
    else if (focusTarget.kind === 'row') previewRefs.current.get(focusTarget.id)?.focus();
    else if (pagerRef.current) pagerRef.current.focus();
    else focusSearchField();
    setFocusTarget(null);
  }, [focusTarget]);

  useEffect(() => {
    if (pageError && document.activeElement === pagerRef.current) {
      pagerRef.current.scrollIntoView?.({ block: 'nearest', behavior: 'instant' });
    }
  }, [pageError]);

  function writeFilters({ source, status, send }) {
    writtenKeyRef.current = `${source}|${status}|${send}`;
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries({ source, status, send })) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setSearchParams(next, { replace: true });
  }

  function submit(event) {
    event.preventDefault();
    const search = { q: draft.q.trim(), source: draft.source, status: draft.status, send: draft.send };
    writeFilters(search);
    runSearch(search, 'search');
  }

  /** Drop the one-send limit and keep the rest of the search. */
  function showEveryMessage() {
    const search = { q: draft.q.trim(), source: draft.source, status: draft.status, send: '' };
    setDraft(search);
    writeFilters(search);
    runSearch(search, 'search');
    focusSearchField();
  }

  function clearSearch() {
    const search = { q: '', source: '', status: '', send: '' };
    setDraft(search);
    writeFilters(search);
    runSearch(search, 'search');
    focusSearchField();
  }

  function refresh() {
    runSearch(latestSearchRef.current ?? { q: '', ...urlFilters }, 'refresh');
  }

  // Load more pages the rows on screen. While a search or a refresh runs,
  // those rows are about to be replaced, so the pager refuses: paging them
  // would take the newer request and drop the answer the page asked for.
  const pagerRefused = pending !== null;

  async function loadMore() {
    if (!result?.nextCursor || pending !== null) return;
    const requestId = (requestRef.current += 1);
    const { applied, nextCursor } = result;
    setPending('more');
    setPageError(null);
    try {
      const response = await call('listSentEmails', requestBody(applied, nextCursor));
      if (requestId !== requestRef.current) return;
      const more = Array.isArray(response?.rows) ? response.rows : [];
      setResult((current) => ({
        ...current,
        rows: [...current.rows, ...more],
        nextCursor: response?.nextCursor ?? null,
        scanned: current.scanned + (Number.isFinite(response?.scanned) ? response.scanned : more.length),
        readAt: Date.now(),
      }));
      setError(null);
      setFocusTarget(more.length > 0 ? { kind: 'row', id: more[0].id } : { kind: 'pager' });
    } catch (err) {
      if (requestId === requestRef.current) {
        if (err.status === 401 || err.status === 403) {
          setError(err);
          setFocusTarget({ kind: 'access' });
        }
        else setPageError(err);
      }
    } finally {
      if (requestId === requestRef.current) setPending(null);
    }
  }

  async function fetchDetail(id, retrying = false) {
    if (detailRequests.current.has(id)) return;
    detailRequests.current.add(id);
    const trigger = retrying ? document.activeElement : null;
    setDetails((current) => ({ ...current, [id]: { state: 'loading', retrying } }));
    try {
      const response = await call('getSentEmail', { id });
      setDetails((current) => ({ ...current, [id]: { state: 'ready', row: response.row } }));
      if (trigger?.isConnected && document.activeElement === trigger) setFocusTarget({ kind: 'row', id });
    } catch (err) {
      setDetails((current) => ({ ...current, [id]: { state: 'error', error: err } }));
    } finally {
      detailRequests.current.delete(id);
    }
  }

  function togglePreview(row) {
    if (openId === row.id) {
      setOpenId(null);
      return;
    }
    setOpenId(row.id);
    // One call per message: a body read once is kept, and a row whose body
    // was never stored has nothing to ask for.
    if (!row.bodyStored) return;
    const known = details[row.id];
    if (!known || known.state === 'error') fetchDetail(row.id);
  }

  const denied = error?.status === 403;
  const activeFilters = [draft.source, draft.status].filter(Boolean).length;
  // Only the sources this page names: readFilters drops any other, so the
  // select never has to hold a value it has no option for.
  const sourceOptions = [
    { value: '', label: 'Any' },
    ...Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label })),
  ];

  const rows = result?.rows ?? [];
  const applied = result?.applied ?? null;
  const searched = Boolean(applied?.q);
  const narrowed = Boolean(applied && (applied.q || applied.source || applied.status || applied.send));

  let notice = null;
  if (error && !denied) {
    if (error.status === 401) {
      // The link is the instruction, so a message that already ends with it
      // (adminApi's "Your session has expired. Sign in again.") drops it.
      notice = (
        <Notice tone="error" message={'Your session has expired.'}>
          {' '}
          <Link to="/signin" className="font-semibold underline underline-offset-2">
            Sign in again
          </Link>
        </Notice>
      );
    } else if (result) {
      notice = (
        <Notice
          tone="caution"
          message="We could not reach the email log; showing the last messages we received."
        />
      );
    } else {
      notice = <Notice tone="error" message={communicationsError(error, 'The email log could not be loaded. Refresh to try again.')} />;
    }
  }

  let body = null;
  if (!result) {
    body = error ? null : <AdminLoadingState label="Loading the email log…" />;
  } else if (rows.length === 0 && result.nextCursor) {
    body = (
      <AdminEmptyState
        title={`No match in ${recentWindow(result.scanned)}`}
        description="Search older messages to keep looking."
      />
    );
  } else if (rows.length === 0 && !narrowed) {
    body = (
      <AdminEmptyState
        title="No email sent yet"
        description="Send an announcement to keep attendees informed."
        action={<Link to="/admin/announcements" className={secondaryButtonClass}>Write announcement</Link>}
      />
    );
  } else if (rows.length === 0) {
    body = (
      <AdminEmptyState
        title="No matching messages"
        description={`Nothing in the log matches ${describeSearch(applied)}.`}
        action={
          <button type="button" className={secondaryButtonClass} onClick={clearSearch}>
            Clear search
          </button>
        }
      />
    );
  } else {
    body = (
      <EmailLogTable rows={rows} timeZone={timeZone} openId={openId} details={details}
        previewRefs={previewRefs} onToggle={togglePreview} onRetry={(id) => fetchDetail(id, true)} />
    );
  }

  return (
    <div className="flex flex-col gap-md">
      <AdminPageHeader help="Emails from the past 90 days, newest first. Sign-in codes and private invitation links are hidden."
        title="Email log"
        description="Emails from the past 90 days, newest first. Sign-in codes and private invitation links are hidden."
        actions={
          <AdminIconControl
            className={secondaryButtonClass}
            onClick={refresh}
            aria-busy={pending === 'refresh' ? 'true' : undefined}
            busy={pending === 'refresh'}
            label={pending === 'refresh' ? 'Refreshing…' : 'Refresh'}
            icon="refresh"
          />
        }
      />

      {denied ? (
        <div ref={accessFeedbackRef} tabIndex={-1}>
          <AdminEmptyState
            title="You don’t have access to the email log"
            description="The email log is open to operators and staff. Ask an operator to check your access."
          />
        </div>
      ) : (
        <>
          <form
            ref={formRef}
            role="search"
            aria-label="Search the email log"
            onSubmit={submit}
            className="flex flex-wrap items-end gap-sm"
          >
            <div className="min-w-0 grow basis-64">
              <TextField help="Find delivery records by recipient email address or message subject."
                label="Search recipient or subject"
                type="search"
                value={draft.q}
                onChange={(q) => setDraft((current) => ({ ...current, q }))}
                autoComplete="off"
                spellCheck={false}
                maxLength={200}
              />
            </div>
            <fieldset aria-label={[" ", (activeFilters ? `Filters, ${activeFilters} active` : 'Filters'), " "].join('').trim()} className="min-w-0 grow basis-80">
              <legend className={`${fieldLabelClass} mb-3xs`}>
                {activeFilters ? `Filters, ${activeFilters} active` : 'Filters'}
               <HelpTooltip label="Email log filters">Narrow the delivery records by message source and delivery status.</HelpTooltip></legend>
              <div className="grid grid-cols-1 gap-sm sm:grid-cols-2">
                <SelectField help="Show messages sent by a particular event feature."
                  label="Source"
                  value={draft.source}
                  onChange={(source) => setDraft((current) => ({ ...current, source }))}
                  options={sourceOptions}
                />
                <SelectField help="Choose which records to show in this list."
                  label="Status"
                  value={draft.status}
                  onChange={(status) => setDraft((current) => ({ ...current, status }))}
                  options={[
                    { value: '', label: 'Any' },
                    { value: 'sent', label: 'Sent' },
                    { value: 'failed', label: 'Failed' },
                  ]}
                />
              </div>
            </fieldset>
            <div className="flex flex-wrap items-center gap-xs">
              <button
                type="submit"
                className={primaryButtonClass}
                aria-busy={pending === 'search' ? 'true' : undefined}
              >
                {pending === 'search' ? 'Searching…' : 'Search'}
              </button>
              <AdminIconControl className={secondaryButtonClass} onClick={clearSearch} label="Clear" icon="close" />
            </div>
          </form>

          {draft.send ? (
            <Notice tone="info" message="This list shows only the messages of one announcement send.">
              {' '}
              <button type="button" className="font-semibold underline underline-offset-2" onClick={showEveryMessage}>
                Show every message
              </button>
            </Notice>
          ) : null}

          {notice ? <div ref={accessFeedbackRef} tabIndex={-1}>{notice}</div> : null}

          {result ? (
            <EmailLogFigure count={rows.length} scanned={result.scanned} searched={searched} readAt={result.readAt} timeZone={timeZone} />
          ) : null}

          {body}

          {result?.nextCursor ? (
            <div className="flex flex-col items-start gap-xs">
              {pageError ? <Notice tone="error" message="Older messages could not be loaded. Try again." /> : null}
              <button
                ref={pagerRef}
                type="button"
                className={`${secondaryButtonClass} aria-disabled:cursor-not-allowed aria-disabled:opacity-60`}
                onClick={loadMore}
                aria-busy={pending === 'more' ? 'true' : undefined}
                aria-disabled={pagerRefused ? 'true' : undefined}
              >
                {pending === 'more' ? 'Loading more…' : pageError ? 'Retry loading older messages' : rows.length === 0 ? 'Search older messages' : 'Load more'}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
