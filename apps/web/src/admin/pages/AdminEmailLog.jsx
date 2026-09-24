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
// live in the URL and a reload or a shared link keeps them.
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
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { zoneLabel } from '../../lib/eventTime.js';
import { useAdminApi } from '../adminApi.js';
import { buildPreviewDoc } from '../emailPreview.js';
import {
  Notice,
  SelectField,
  TextField,
  fieldLabelClass,
  linkButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import AdminPageHeader, {
  AdminEmptyState,
  AdminLoadingState,
  StatusBadge,
} from '../components/adminChrome.jsx';

const PAGE_SIZE = 25;
const STATUS_WORDS = Object.freeze({ sent: 'Sent', failed: 'Failed' });

/** Every `source` a sender stamps on its row, in the words staff read. */
export const SOURCE_LABELS = Object.freeze({
  'auth-otp': 'Sign-in code',
  'speaker-invite': 'Speaker invitation',
  'speaker-accept': 'Speaker acceptance',
  'speaker-confirmation': 'Speaker confirmation',
  feedback: 'Feedback receipt',
  'operator-notify': 'Operator alert',
  'ticketing-registration-prompt': 'Ticket prompt',
});

/** A delivery event the provider reported, as a word and the tone that agrees with it. */
const DELIVERY_WORDS = Object.freeze({
  delivered: { label: 'Delivered', tone: 'ok' },
  bounced: { label: 'Bounced', tone: 'error' },
  complained: { label: 'Complained', tone: 'caution' },
  suppressed: { label: 'Suppressed', tone: 'caution' },
});

/**
 * Whether `key` names an entry of one of the maps above. An own-key check,
 * because a URL or a stored field can say "constructor" or "__proto__", and
 * a plain lookup would find the object's prototype instead of nothing.
 */
const known = (map, key) => typeof key === 'string' && Object.hasOwn(map, key);

/** The filters the URL holds: a source and a status this page offers, or nothing. */
function readFilters(searchParams) {
  const source = searchParams.get('source') ?? '';
  const status = searchParams.get('status') ?? '';
  return {
    source: known(SOURCE_LABELS, source) ? source : '',
    status: known(STATUS_WORDS, status) ? status : '',
  };
}

/** The request body for one page of a search. Empty values are left out. */
function requestBody({ q, source, status }, cursor) {
  return {
    limit: PAGE_SIZE,
    ...(q ? { q } : {}),
    ...(source ? { source } : {}),
    ...(status ? { status } : {}),
    ...(cursor ? { cursor } : {}),
  };
}

/**
 * Intl in the event's zone, or in the reader's own when the event states
 * none or states one Intl does not know. Returns the zone it used.
 */
function formatIn(timeZone, instant, options) {
  try {
    return { text: new Intl.DateTimeFormat('en-US', { timeZone, ...options }).format(instant), zone: timeZone };
  } catch {
    return { text: new Intl.DateTimeFormat('en-US', options).format(instant), zone: undefined };
  }
}

function withZone({ text, zone }, instant) {
  const label = zoneLabel(zone, instant);
  return label ? `${text} ${label}` : text;
}

/** "Nov 14, 2023, 10:13 PM UTC" on the event clock. */
function formatSent(ms, timeZone) {
  if (!Number.isFinite(ms)) return null;
  const instant = new Date(ms);
  const formatted = formatIn(timeZone, instant, {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  return { text: withZone(formatted, instant), iso: instant.toISOString() };
}

/** "10:13 PM UTC" on the event clock. */
function formatClock(ms, timeZone) {
  const instant = new Date(ms);
  return withZone(formatIn(timeZone, instant, { hour: 'numeric', minute: '2-digit' }), instant);
}

const plural = (n, one, many) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** "the 500 most recent messages", or "the most recent message" for one. */
const recentWindow = (n) => (n === 1 ? 'the most recent message' : `the ${n.toLocaleString('en-US')} most recent messages`);

/** The figure sentence: what is shown, over what window, read when. */
export function figureSentence({ count, scanned, searched, readAt }) {
  if (searched) {
    const found = count === 0 ? 'No matches' : plural(count, 'match', 'matches');
    return `${found} in ${recentWindow(scanned)}, read at ${readAt}.`;
  }
  const shown = count === 0 ? 'No messages' : plural(count, 'message', 'messages');
  return `${shown} shown, newest first, read at ${readAt}.`;
}

/** "“alex”, the source Sign-in code and the status Failed" */
function describeSearch({ q, source, status }) {
  const parts = [];
  if (q) parts.push(`“${q}”`);
  if (source) parts.push(`the source ${known(SOURCE_LABELS, source) ? SOURCE_LABELS[source] : source}`);
  if (status) parts.push(`the status ${known(STATUS_WORDS, status) ? STATUS_WORDS[status] : status}`);
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/**
 * A ruled table head cell, the one AdminTicketing draws. The table scrolls
 * inside its own box, so the head holds the top of that box.
 */
function GalleyHead({ children }) {
  return (
    <th
      scope="col"
      className="sticky top-0 z-10 border-b-admin-strong border-admin-rule-strong bg-admin-ground-soft px-sm py-xs text-start text-admin-xs font-semibold text-admin-ink-secondary"
    >
      {children}
    </th>
  );
}

const cellClass = 'px-sm py-xs align-top';
const quietWordClass = 'text-admin-ink-secondary';

function SourceCell({ source }) {
  if (!source) return <span className={quietWordClass}>None</span>;
  if (known(SOURCE_LABELS, source)) return SOURCE_LABELS[source];
  return <span className="font-admin-data text-admin-ink-data">{source}</span>;
}

/**
 * The state is a word. A plain send with no delivery event is the quiet
 * word "Sent"; an exception is a word in a badge whose tint agrees with it.
 * The reason, when the row stores one, sits under the word as text.
 */
function StatusCell({ row }) {
  const delivery = known(DELIVERY_WORDS, row.deliveryStatus) ? DELIVERY_WORDS[row.deliveryStatus] : null;
  let word;
  if (row.status === 'failed') word = <StatusBadge tone="error">Failed</StatusBadge>;
  else if (delivery) word = <StatusBadge tone={delivery.tone}>{delivery.label}</StatusBadge>;
  else if (row.status === 'sent') word = <span className={quietWordClass}>Sent</span>;
  else word = <span className="font-admin-data text-admin-ink-data">{row.status ?? 'Unknown'}</span>;
  const reason = row.status === 'failed' ? row.error : row.bounceReason;
  return (
    <>
      {word}
      {reason ? (
        <p className="mt-3xs max-w-[28ch] break-words text-admin-xs text-admin-ink-secondary">{reason}</p>
      ) : null}
    </>
  );
}

/** The sandboxed frame, over a document emailPreview.js has already built. */
function PreviewFrame({ srcDoc, to }) {
  return (
    <>
      <iframe
        sandbox=""
        srcDoc={srcDoc}
        referrerPolicy="no-referrer"
        title={to ? `Message to ${to}` : 'Message with no recipient'}
        className="block h-[24rem] w-full rounded-admin border-admin-hairline border-admin-rule-hairline [color-scheme:light]"
      />
      <p className="text-admin-xs text-admin-ink-secondary">
        Links and remote images are turned off in this preview.
      </p>
    </>
  );
}

/**
 * A stored body: the frame when the HTML can be shown safely, the plain
 * text beside it or instead of it. The document is built once per body; a
 * body buildPreviewDoc refuses gets the plain text, open, and a line that
 * says why.
 */
function StoredBody({ message }) {
  const { html, text, bodyTruncated, to } = message;
  const srcDoc = useMemo(() => (html ? buildPreviewDoc(html) : null), [html]);
  const refused = Boolean(html) && srcDoc === null;
  return (
    <div className="flex flex-col gap-xs">
      {srcDoc ? <PreviewFrame srcDoc={srcDoc} to={to} /> : null}
      {refused ? (
        <p className="text-admin-sm text-admin-ink">
          {text
            ? 'This message’s HTML cannot be shown safely, so its plain text version is shown instead.'
            : 'This message’s HTML cannot be shown safely, and it has no plain text version.'}
        </p>
      ) : null}
      {text ? (
        <details open={!srcDoc} className="text-admin-sm">
          <summary className="admin-target cursor-pointer font-semibold text-admin-ink">Plain text version</summary>
          <pre className="mt-2xs max-h-[24rem] overflow-auto whitespace-pre-wrap break-words font-admin-data text-admin-sm text-admin-ink-data">
            {text}
          </pre>
        </details>
      ) : null}
      {!html && !text ? <p className="text-admin-sm text-admin-ink">This message has no stored body.</p> : null}
      {bodyTruncated ? (
        <p className="text-admin-sm text-admin-ink-secondary">The stored body stops at 100 KB.</p>
      ) : null}
    </div>
  );
}

/** What an open row shows: the frame, the plain text, or the reason there is neither. */
function PreviewBody({ row, detail }) {
  if (!row.bodyStored) {
    return (
      <p className="text-admin-sm text-admin-ink">
        This message’s body was not stored because it held a sign-in code or an invitation link.
      </p>
    );
  }
  if (!detail || detail.state === 'loading') {
    return (
      <p aria-busy="true" className="text-admin-sm text-admin-ink-secondary">
        Loading the message…
      </p>
    );
  }
  if (detail.state === 'error') return <Notice tone="error" message={detail.error.message} />;
  return <StoredBody message={detail.row} />;
}

export default function AdminEmailLog() {
  const call = useAdminApi();
  const { eventConfig } = useEventConfig();
  const timeZone = typeof eventConfig?.timezone === 'string' && eventConfig.timezone ? eventConfig.timezone : undefined;
  const [searchParams, setSearchParams] = useSearchParams();
  const urlFilters = readFilters(searchParams);
  const urlKey = `${urlFilters.source}|${urlFilters.status}`;
  const baseId = useId();

  // The form as the reader is editing it.
  const [draft, setDraft] = useState(() => ({ q: '', ...urlFilters }));
  // The last answered read: rows, the pager cursor, the rows the server
  // examined over every page loaded, the search that produced them, and
  // when it answered. Null until the first read answers.
  const [result, setResult] = useState(null);
  const [pending, setPending] = useState(null); // 'search' | 'refresh' | 'more' | null
  const [error, setError] = useState(null);
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
  const previewRefs = useRef(new Map());

  const focusSearchField = () => formRef.current?.querySelector('input[type="search"]')?.focus();

  const runSearch = useCallback(async (search, kind) => {
    const requestId = (requestRef.current += 1);
    latestSearchRef.current = search;
    setPending(kind);
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
    const [source, status] = urlKey.split('|');
    const search = { q: '', source, status };
    setDraft(search);
    runSearch(search, 'search');
  }, [urlKey, runSearch]);

  useEffect(() => {
    if (!focusTarget) return;
    if (focusTarget.kind === 'row') previewRefs.current.get(focusTarget.id)?.focus();
    else if (pagerRef.current) pagerRef.current.focus();
    else focusSearchField();
    setFocusTarget(null);
  }, [focusTarget]);

  function writeFilters({ source, status }) {
    writtenKeyRef.current = `${source}|${status}`;
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries({ source, status })) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setSearchParams(next, { replace: true });
  }

  function submit(event) {
    event.preventDefault();
    const search = { q: draft.q.trim(), source: draft.source, status: draft.status };
    writeFilters(search);
    runSearch(search, 'search');
  }

  function clearSearch() {
    const search = { q: '', source: '', status: '' };
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
  const pagerRefused = pending === 'search' || pending === 'refresh';

  async function loadMore() {
    if (!result?.nextCursor || pending !== null) return;
    const requestId = (requestRef.current += 1);
    const { applied, nextCursor } = result;
    setPending('more');
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
      if (requestId === requestRef.current) setError(err);
    } finally {
      if (requestId === requestRef.current) setPending(null);
    }
  }

  async function fetchDetail(id) {
    setDetails((current) => ({ ...current, [id]: { state: 'loading' } }));
    try {
      const response = await call('getSentEmail', { id });
      setDetails((current) => ({ ...current, [id]: { state: 'ready', row: response.row } }));
    } catch (err) {
      setDetails((current) => ({ ...current, [id]: { state: 'error', error: err } }));
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
  const narrowed = Boolean(applied && (applied.q || applied.source || applied.status));

  let notice = null;
  if (error && !denied) {
    if (error.status === 401) {
      // The link is the instruction, so a message that already ends with it
      // (adminApi's "Your session has expired. Sign in again.") drops it.
      notice = (
        <Notice tone="error" message={error.message.replace(/\s*Sign in again\.?\s*$/i, '')}>
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
      notice = <Notice tone="error" message={error.message} />;
    }
  }

  let body = null;
  if (!result) {
    body = error ? null : <AdminLoadingState label="Loading the email log…" />;
  } else if (rows.length === 0 && result.nextCursor) {
    body = (
      <AdminEmptyState
        title={`No match in ${recentWindow(result.scanned)}`}
        description="Each search reads 500 messages at a time. Search older messages to keep looking."
      />
    );
  } else if (rows.length === 0 && !narrowed) {
    body = (
      <AdminEmptyState
        title="No email sent yet"
        description="A message shows here as soon as the site sends one."
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
      <div
        role="region"
        aria-label="Sent messages"
        tabIndex={0}
        className="max-h-[40rem] overflow-auto rounded-admin border-admin-hairline border-admin-rule-hairline bg-admin-ground-raised"
      >
        <table className="w-full min-w-[52rem] border-collapse text-admin-sm">
          <caption className="sr-only">Sent messages, newest first</caption>
          <thead>
            <tr>
              <GalleyHead>Sent</GalleyHead>
              <GalleyHead>To</GalleyHead>
              <GalleyHead>Subject</GalleyHead>
              <GalleyHead>Source</GalleyHead>
              <GalleyHead>Status</GalleyHead>
              <GalleyHead>Preview</GalleyHead>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const open = openId === row.id;
              const previewId = `${baseId}-preview-${index}`;
              const sent = formatSent(row.sentAt, timeZone);
              return (
                <Fragment key={row.id}>
                  <tr className="border-b-admin-hairline border-admin-rule-hairline">
                    <td className={`${cellClass} whitespace-nowrap font-admin-data text-admin-ink-data`}>
                      {sent ? <time dateTime={sent.iso}>{sent.text}</time> : <span className={quietWordClass}>Unknown</span>}
                    </td>
                    <td className={`${cellClass} break-all font-admin-data text-admin-ink-data`}>
                      {row.to ?? <span className={`font-admin-ui ${quietWordClass}`}>No recipient</span>}
                    </td>
                    <td className={`${cellClass} break-words text-admin-ink`}>
                      {row.subject ?? (
                        <span className={quietWordClass}>{row.bodyStored ? 'No subject' : 'Not stored'}</span>
                      )}
                    </td>
                    <td className={`${cellClass} text-admin-ink`}>
                      <SourceCell source={row.source} />
                    </td>
                    <td className={cellClass}>
                      <StatusCell row={row} />
                    </td>
                    <td className={cellClass}>
                      <button
                        type="button"
                        ref={(node) => {
                          if (node) previewRefs.current.set(row.id, node);
                          else previewRefs.current.delete(row.id);
                        }}
                        className={linkButtonClass}
                        aria-expanded={open ? 'true' : 'false'}
                        aria-controls={previewId}
                        onClick={() => togglePreview(row)}
                      >
                        {open ? 'Hide preview' : 'Preview'}
                      </button>
                    </td>
                  </tr>
                  {open ? (
                    <tr id={previewId} className="border-b-admin-hairline border-admin-rule-hairline">
                      <td colSpan={6} className="bg-admin-ground-soft px-sm py-sm">
                        <PreviewBody row={row} detail={details[row.id]} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-md">
      <AdminPageHeader
        title="Email log"
        description="Every message this site sent, newest first. Sign-in codes and speaker invitations never store their body."
        actions={
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={refresh}
            aria-busy={pending === 'refresh' ? 'true' : undefined}
          >
            {pending === 'refresh' ? 'Refreshing…' : 'Refresh'}
          </button>
        }
      />

      {denied ? (
        <AdminEmptyState
          title="You don’t have access to the email log"
          description="The email log is open to operators and staff. Ask an operator to check your access."
        />
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
              <TextField
                label="Search recipient or subject"
                type="search"
                value={draft.q}
                onChange={(q) => setDraft((current) => ({ ...current, q }))}
                autoComplete="off"
                spellCheck={false}
                maxLength={200}
              />
            </div>
            <fieldset className="min-w-0 grow basis-80">
              <legend className={`${fieldLabelClass} mb-3xs`}>
                {activeFilters ? `Filters, ${activeFilters} active` : 'Filters'}
              </legend>
              <div className="grid grid-cols-1 gap-sm sm:grid-cols-2">
                <SelectField
                  label="Source"
                  value={draft.source}
                  onChange={(source) => setDraft((current) => ({ ...current, source }))}
                  options={sourceOptions}
                />
                <SelectField
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
              <button type="button" className={secondaryButtonClass} onClick={clearSearch}>
                Clear
              </button>
            </div>
          </form>

          {notice}

          {result ? (
            <p role="status" className="text-admin-sm text-admin-ink-secondary">
              {figureSentence({
                count: rows.length,
                scanned: result.scanned,
                searched,
                readAt: formatClock(result.readAt, timeZone),
              })}
            </p>
          ) : null}

          {body}

          {result?.nextCursor ? (
            <div>
              <button
                ref={pagerRef}
                type="button"
                className={`${secondaryButtonClass} aria-disabled:cursor-not-allowed aria-disabled:opacity-60`}
                onClick={loadMore}
                aria-busy={pending === 'more' ? 'true' : undefined}
                aria-disabled={pagerRefused ? 'true' : undefined}
              >
                {pending === 'more' ? 'Loading more…' : rows.length === 0 ? 'Search older messages' : 'Load more'}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
