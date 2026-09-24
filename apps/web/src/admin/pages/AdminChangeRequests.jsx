// Change requests (issue #188) — every request sent from the public footer
// or from the form on this page, newest first, with a status filter, status
// changes, and an outright removal. Reads `change_requests` directly
// (firestore.rules: isAdmin() read, either tier) the way AdminFeedback reads
// `feedback`; every write goes through an endpoint, because the rules deny
// every client write and each write must commit with its admin_logs row on
// the server (functions/src/admin/changeRequests.cjs).
//
// The flag gates SENDING only. With `changeRequests` off the form is absent
// and the server refuses every submission, but the list, the status changes,
// and the removal still work, so staff can clear the store after the flag
// goes off.
//
// A row is a queue row in the admin story's sense (§3.4): the status word,
// then the one next step as the row's action. Decline is the quieter second
// action, and Remove stands at the row's end behind the destructive moment.
// The request text is the requester's own words: it renders as text in a
// pre-wrapped paragraph, and the page field is text, never a link.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { focusFirstError } from '../../lib/focusFirstError.js';
import { useAdminApi } from '../adminApi.js';
import { subscribeAdminCollection } from '../adminSource.js';
import {
  DestructiveConfirm,
  Notice,
  Panel,
  SaveStatus,
  ServerErrorSummary,
  TextAreaField,
  TextField,
  inputClass,
  linkButtonClass,
  primaryButtonClass,
  rowMetaClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import AdminPageHeader, {
  AdminEmptyState,
  AdminLoadingState,
  StatusBadge,
} from '../components/adminChrome.jsx';

/** The server's limits (functions/src/admin/changeRequests.cjs). */
const MAX_MESSAGE_LENGTH = 2000;
const MAX_PAGE_LENGTH = 200;

/** One word per status, spelled the same everywhere it appears. */
export const STATUS_LABELS = Object.freeze({
  new: 'New',
  in_progress: 'In progress',
  done: 'Done',
  declined: 'Declined',
});

// The tone under each word. The word is always the first signal.
const STATUS_TONE = Object.freeze({
  new: 'caution',
  in_progress: 'info',
  done: 'ok',
  declined: 'dead',
});

/** The line a successful change states, by the status it set. */
const STATUS_RESULTS = Object.freeze({
  new: 'Request reopened.',
  in_progress: 'Request marked in progress.',
  done: 'Request marked done.',
  declined: 'Request declined.',
});

/** The row's one next step, by status. */
const NEXT_STEP = Object.freeze({
  new: { status: 'in_progress', label: 'Mark in progress' },
  in_progress: { status: 'done', label: 'Mark done' },
  done: { status: 'new', label: 'Reopen' },
  declined: { status: 'new', label: 'Reopen' },
});

const OPEN_STATUSES = Object.freeze(['new', 'in_progress']);

export const FILTERS = Object.freeze([
  { value: 'open', label: 'Open (new and in progress)', empty: 'open' },
  { value: 'all', label: 'All', empty: null },
  { value: 'new', label: 'New', empty: 'new' },
  { value: 'in_progress', label: 'In progress', empty: 'in progress' },
  { value: 'done', label: 'Done', empty: 'done' },
  { value: 'declined', label: 'Declined', empty: 'declined' },
]);
const DEFAULT_FILTER = 'open';

/** The filter the URL names; anything else reads as Open. */
export function readFilter(value) {
  return FILTERS.some((filter) => filter.value === value) ? value : DEFAULT_FILTER;
}

/** A stored status the page does not know reads as New. */
function statusOf(row) {
  return Object.hasOwn(STATUS_LABELS, row?.status) ? row.status : 'new';
}

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function matches(row, filter) {
  if (filter === 'all') return true;
  if (filter === 'open') return OPEN_STATUSES.includes(statusOf(row));
  return statusOf(row) === filter;
}

/** "Showing 3 of 12 requests." The noun agrees with the total. */
export function countLine(shown, total) {
  return `Showing ${shown} of ${total} ${total === 1 ? 'request' : 'requests'}.`;
}

function newSubmissionKey() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

/** The form a staff member sends a request from. Rendered only while the flag is on. */
function RequestForm({ call }) {
  const [message, setMessage] = useState('');
  const [page, setPage] = useState('');
  const [messageError, setMessageError] = useState(null);
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState('');
  // One key per form session, resent unchanged on a retry and replaced
  // after a success, so a retry after a dropped answer is stored once.
  const keyRef = useRef(newSubmissionKey());
  const formRef = useRef(null);
  const errorRef = useRef(null);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function submit(event) {
    event.preventDefault();
    if (sending) return;
    setStatus('');
    setError(null);
    if (!message.trim()) {
      setMessageError('Say what should change.');
      // After the render that marks the field; the send control stays
      // enabled, because a dead control announces nothing.
      window.setTimeout(() => focusFirstError(formRef.current), 0);
      return;
    }
    setMessageError(null);
    setSending(true);
    try {
      await call('submitChangeRequest', {
        message: message.trim(),
        page: page.trim() || null,
        submissionKey: keyRef.current,
      });
      keyRef.current = newSubmissionKey();
      setMessage('');
      setPage('');
      setStatus('Request sent.');
    } catch (err) {
      setError(err);
    } finally {
      setSending(false);
    }
  }

  return (
    <Panel title="Request a change" description="Staff requests join the same list as requests from the public site.">
      <form ref={formRef} className="flex flex-col gap-sm" onSubmit={submit} noValidate>
        <ServerErrorSummary error={error} errorRef={errorRef} title="The request was not sent" />
        <TextAreaField
          label="What should change?"
          value={message}
          onChange={(next) => {
            setMessage(next);
            if (messageError && next.trim()) setMessageError(null);
          }}
          error={messageError}
          rows={4}
          maxLength={MAX_MESSAGE_LENGTH}
          required
        />
        <TextField
          label="Page (optional)"
          value={page}
          onChange={setPage}
          maxLength={MAX_PAGE_LENGTH}
          hint="The page the change is about, such as /travel."
        />
        <div className="flex flex-wrap items-center gap-sm">
          <button
            type="submit"
            className={primaryButtonClass}
            aria-busy={sending || undefined}
          >
            {sending ? 'Sending…' : 'Send request'}
          </button>
          {status ? <SaveStatus message={status} /> : null}
        </div>
      </form>
    </Panel>
  );
}

export default function AdminChangeRequests() {
  const call = useAdminApi();
  const { features } = useEventConfig();
  const enabled = features?.changeRequests === true;
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = readFilter(searchParams.get('status'));
  const filterEntry = FILTERS.find((entry) => entry.value === filter);

  const [rows, setRows] = useState(null);
  const [listError, setListError] = useState(null);
  // The action in flight, keyed to the control that was pressed:
  // { id, control: 'next' | 'decline' | 'remove' }. The listener can deliver
  // the committed status before the HTTP answer, so the pressed control, not
  // the status it asked for, carries "Saving…" until the call settles.
  const [pending, setPending] = useState(null);
  // A failed action, stated on its row until the next try.
  const [rowError, setRowError] = useState(null);
  // The result of the last status change or removal, stated in place.
  const [result, setResult] = useState('');
  const headingRef = useRef(null);

  // When the control the reader pressed is gone, or its row has left the
  // filter, the keyboard goes to the list's own heading rather than to the
  // page body. Focus the reader has already moved elsewhere is left alone.
  const focusListFrom = useCallback((pressed) => {
    const active = typeof document === 'undefined' ? null : document.activeElement;
    if (!active || active === document.body || active === pressed || !active.isConnected) {
      headingRef.current?.focus();
    }
  }, []);

  useEffect(() => subscribeAdminCollection(
    'change_requests',
    (docs) => { setRows(docs); setListError(null); },
    setListError,
  ), []);

  const shown = useMemo(() => {
    if (!rows) return [];
    // The row an action is in flight on stays on screen until the call
    // settles, even when its new status leaves the filter, so the pressed
    // control does not vanish from under the keyboard.
    return rows
      .filter((row) => matches(row, filter) || row.id === pending?.id)
      .sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0));
  }, [rows, filter, pending]);

  const setFilter = useCallback((value) => {
    const next = new URLSearchParams(searchParams);
    if (value === DEFAULT_FILTER) next.delete('status');
    else next.set('status', value);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  async function changeStatus(row, status, control, pressed) {
    if (pending) return;
    setPending({ id: row.id, control });
    setRowError(null);
    setResult('');
    try {
      await call('updateChangeRequestStatus', { id: row.id, status });
      setResult(STATUS_RESULTS[status]);
      // The next-step control stays on the row with its new words; a
      // Decline goes, and a row whose new status the filter leaves out goes
      // with the settled call.
      if (control !== 'next' || !matches({ status }, filter)) focusListFrom(pressed);
    } catch (err) {
      setRowError({ id: row.id, message: `This did not save. ${err.message}` });
    } finally {
      setPending(null);
    }
  }

  async function remove(row) {
    if (pending) return;
    setPending({ id: row.id, control: 'remove' });
    setRowError(null);
    setResult('');
    try {
      await call('deleteChangeRequest', { id: row.id });
      setResult('Request removed.');
      // The row and its controls leave with the next snapshot, so the
      // keyboard goes to the list's own heading rather than to the page.
      headingRef.current?.focus();
    } catch (err) {
      setRowError({ id: row.id, message: `The request was not removed. ${err.message}` });
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-md">
      <AdminPageHeader
        title="Change requests"
        description="Requests from staff and signed-in visitors for a change to the site."
        actions={
          <label className="flex items-center gap-xs text-admin-sm font-semibold text-admin-ink">
            Show
            <select
              className={`${inputClass} w-auto min-w-[14rem]`}
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              {FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        }
      />

      {enabled ? (
        <RequestForm call={call} />
      ) : (
        <Notice tone="info" message="Change requests are off. An operator can turn them on under Features." />
      )}

      <section aria-labelledby="change-requests-heading" className="flex flex-col gap-sm">
        <h2
          id="change-requests-heading"
          ref={headingRef}
          tabIndex={-1}
          className="font-admin-ui text-admin-lg font-bold text-admin-ink"
        >
          Requests
        </h2>
        {rows !== null ? <p role="status" className="text-admin-sm text-admin-ink-secondary">{countLine(shown.length, rows.length)}</p> : null}
        {result ? <SaveStatus message={result} /> : null}

        {listError ? (
          <Notice
            tone="caution"
            message="We lost the connection to the change requests; showing the last values we received and retrying."
          />
        ) : null}

        {rows === null ? (
          <AdminLoadingState label="Loading change requests…" />
        ) : rows.length === 0 ? (
          <AdminEmptyState title="No change requests" description="No one has sent a change request yet." />
        ) : shown.length === 0 ? (
          <AdminEmptyState
            title={`No ${filterEntry.empty} requests`}
            description={`None of the ${rows.length} ${rows.length === 1 ? 'request is' : 'requests are'} ${filterEntry.empty}.`}
            action={
              <button type="button" className={secondaryButtonClass} onClick={() => setFilter('all')}>
                Show all requests
              </button>
            }
          />
        ) : (
          <Panel flush>
            <ul>
              {shown.map((row) => {
                const status = statusOf(row);
                const next = NEXT_STEP[status];
                const received = toDate(row.createdAt);
                const busy = pending?.id === row.id ? pending : null;
                const locked = Boolean(pending);
                return (
                  <li key={row.id} className="border-admin-rule-hairline border-b-admin-hairline last:border-b-0">
                    <div className="flex flex-wrap items-start justify-between gap-sm px-md py-sm">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-sm gap-y-2xs">
                          <StatusBadge tone={STATUS_TONE[status]}>{STATUS_LABELS[status]}</StatusBadge>
                          {received ? (
                            <time dateTime={received.toISOString()} className={rowMetaClass}>
                              {received.toLocaleString()}
                            </time>
                          ) : null}
                          {row.email ? (
                            <a href={`mailto:${row.email}`} className={`${linkButtonClass} font-admin-data`}>
                              {row.email}
                            </a>
                          ) : null}
                        </div>
                        {row.page ? (
                          <p className={`mt-3xs ${rowMetaClass}`}>
                            <span className="font-admin-ui">Page: </span>
                            {row.page}
                          </p>
                        ) : null}
                        <p className="mt-3xs whitespace-pre-wrap break-words text-admin-base text-admin-ink">
                          {row.message}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2xs">
                        {rowError?.id === row.id ? <Notice tone="error" message={rowError.message} /> : null}
                        <div className="flex flex-wrap items-center justify-end gap-xs">
                          <button
                            type="button"
                            className={secondaryButtonClass}
                            onClick={(event) => changeStatus(row, next.status, 'next', event.currentTarget)}
                            disabled={locked && busy?.control !== 'next'}
                            aria-busy={busy?.control === 'next' ? 'true' : undefined}
                          >
                            {busy?.control === 'next' ? 'Saving…' : next.label}
                          </button>
                          {OPEN_STATUSES.includes(status) || busy?.control === 'decline' ? (
                            <button
                              type="button"
                              className={linkButtonClass}
                              onClick={(event) => changeStatus(row, 'declined', 'decline', event.currentTarget)}
                              disabled={locked && busy?.control !== 'decline'}
                              aria-busy={busy?.control === 'decline' ? 'true' : undefined}
                            >
                              {busy?.control === 'decline' ? 'Saving…' : 'Decline'}
                            </button>
                          ) : null}
                          <DestructiveConfirm
                            trigger="Remove"
                            title="Remove this request"
                            confirmLabel="Remove this request"
                            consequence="The request and its text are deleted. The audit log keeps who sent it and when."
                            permanence="This cannot be undone."
                            busyLabel="Removing…"
                            busy={busy?.control === 'remove'}
                            disabled={locked && busy?.control !== 'remove'}
                            onConfirm={() => remove(row)}
                          />
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>
        )}
      </section>
    </div>
  );
}
