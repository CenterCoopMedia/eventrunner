// Session materials (issue #23, spec §4.4; bulk download and coverage,
// issue #189). `session_materials` is fully server-only, even for an admin's
// direct read, so every operation here goes through Cloud Functions
// (functions/src/materials/*).
//
// ONE LIST FOR THE WHOLE EVENT. The page reads every material at once
// (`listAllSessionMaterials`, staff tier) and filters it here by session and
// review state, so the table, the selection and the coverage panel all read
// the same array. The sessions come from the admin listeners, live documents
// only: a material needs a live session, and a hidden session still has
// materials to review.
//
// THE ARCHIVE. A file row carries a checkbox; a link row does not, because a
// link has no bytes to put in an archive. "Download as archive" posts the
// selected ids to `downloadSessionMaterialsArchive`, which streams one zip
// through the function (no signed URL; see functions/src/materials/bulk.cjs)
// and records one admin_logs row per file before the first byte. The button
// never takes `disabled`: with nothing or too much selected it says why, and
// while the archive builds it carries aria-busy and aria-disabled and ignores
// a press, so focus stays where the admin left it.
//
// COVERAGE. The panel reads the same material array the table renders,
// before any filter (admin/materialsCoverage.js holds the rule).
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { isSafeUrl } from 'shared/urlSafety';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import ExternalLink from '../../components/ExternalLink.jsx';
import { downloadSessionMaterialFile } from '../../lib/materialsSource.js';
import { focusFirstError } from '../../lib/focusFirstError.js';
import { useAdminApi } from '../adminApi.js';
import { useAdminSessions } from '../useAdminSessions.js';
import { useAdminSpeakers } from '../useAdminSpeakers.js';
import { liveSessions, materialsCoverage } from '../materialsCoverage.js';
import { MAX_ARCHIVE_FILES, downloadMaterialsArchive } from '../materialsArchive.js';
import {
  Panel,
  SaveStatus,
  ServerErrorSummary,
  SelectField,
  TextField,
  DestructiveConfirm,
  FieldError,
  Notice,
  linkButtonClass,
  primaryButtonClass,
  rowMetaClass,
  rowTitleLinkClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import AdminPageHeader, {
  AdminEmptyState,
  AdminLoadingState,
  StatusBadge,
} from '../components/adminChrome.jsx';

const REVIEW_LABEL = { pending: 'Pending review', approved: 'Approved', rejected: 'Rejected' };

// The verdict's tone. The word is always rendered and is the first signal;
// the tint is the second one, never the only one (§8.1).
const REVIEW_TONE = { pending: 'caution', approved: 'ok', rejected: 'error' };

const REVIEW_FILTERS = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending review' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

/**
 * The three sortable columns: the words each button says for each direction,
 * and the direction a first press takes. The order is stated in words, never
 * by an ink change alone.
 */
const SORTS = {
  material: { label: 'Material', first: 'ascending', words: { ascending: 'A to Z', descending: 'Z to A' } },
  session: {
    label: 'Session',
    first: 'ascending',
    words: { ascending: 'Schedule order', descending: 'Reverse schedule order' },
  },
  changed: { label: 'Changed', first: 'descending', words: { descending: 'Newest first', ascending: 'Oldest first' } },
};

const DEFAULT_SORT = { column: 'session', direction: 'ascending' };

// The galley head the ruled tables in this room draw (AdminTicketing.jsx).
// The checkbox head drops the padding: its label is the whole target.
const HEAD_BASE_CLASS =
  'sticky top-0 z-10 border-b-admin-strong border-admin-rule-strong bg-admin-ground-soft ' +
  'text-start align-bottom text-admin-xs font-semibold text-admin-ink-secondary';
const HEAD_CLASS = `${HEAD_BASE_CLASS} px-sm py-xs`;
const CELL_CLASS = 'px-sm py-xs align-top';
const SORT_BUTTON_CLASS =
  'admin-target inline-flex flex-col items-start rounded-admin-small text-start font-semibold ' +
  'underline-offset-2 hover:text-admin-ink-link hover:underline';
// A 44px target around each checkbox: the label fills the cell.
const CHECK_LABEL_CLASS = 'flex min-h-11 min-w-11 cursor-pointer items-center justify-center';
const CHECKBOX_CLASS = 'h-5 w-5 shrink-0 accent-admin-action';
const RULED_ITEM_CLASS = 'border-b-admin-hairline border-admin-rule-hairline py-xs last:border-b-0';

function fileCount(count) {
  return `${count} ${count === 1 ? 'file' : 'files'}`;
}

function selectionSentence(count) {
  return count === 0 ? 'No files selected' : `${fileCount(count)} selected`;
}

/** The format AdminSystemErrors.jsx gives a stored time. */
function formatWhen(ms) {
  if (!Number.isFinite(ms)) return 'Unknown';
  return new Date(ms).toLocaleString();
}

/** "2:02 PM EDT" on the event's clock; the browser's clock if the zone is unreadable. */
function formatReadAt(date, timeZone) {
  const options = { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' };
  try {
    return new Intl.DateTimeFormat('en-US', { ...options, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-US', options).format(date);
  }
}

function compareText(a, b) {
  return String(a ?? '').localeCompare(String(b ?? ''));
}

function AddLinkForm({ sessionId, onAdded }) {
  const call = useAdminApi();
  const { showToast } = useToast();
  const formRef = useRef(null);
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    // The control stays enabled while the URL is missing (#219): a disabled
    // control says nothing, so pressing Add with an empty field now moves
    // the operator to that field instead of doing nothing.
    if (!url) {
      focusFirstError(formRef.current);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await call('addSessionMaterialLink', { sessionId, url, label });
      setUrl('');
      setLabel('');
      showToast('Material added.');
      onAdded();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form ref={formRef} className="flex flex-col gap-sm" onSubmit={submit}>
      <ServerErrorSummary error={error} />
      <TextField label="Link URL" value={url} onChange={setUrl} type="url" required />
      <TextField
        label="Display label"
        value={label}
        onChange={setLabel}
        hint="Leave blank to use the default label. A blank or URL-shaped label is stored as “External link” — it is never shown as the raw URL."
      />
      <div>
        <button
          type="submit"
          className={primaryButtonClass}
          disabled={saving}
          aria-busy={saving || undefined}
        >
          {saving ? 'Adding…' : 'Add link'}
        </button>
      </div>
    </form>
  );
}

function SortHead({ column, sort, onSort }) {
  const spec = SORTS[column];
  const active = sort.column === column;
  return (
    <th scope="col" aria-sort={active ? sort.direction : undefined} className={HEAD_CLASS}>
      <button
        type="button"
        className={`${SORT_BUTTON_CLASS} ${active ? 'text-admin-ink' : ''}`}
        onClick={() => onSort(column)}
      >
        {spec.label}
        {active ? <span className="font-normal">{spec.words[sort.direction]}</span> : null}
      </button>
    </th>
  );
}

function MaterialRow({ material, sessionTitle, selected, onToggle, onChanged }) {
  const call = useAdminApi();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(null);
  const downloadingRef = useRef(false);
  const errorId = useId();
  const isFile = material.type === 'file';
  const isLink = material.type === 'link';
  const filename = material.filename || 'Untitled';

  async function review(reviewStatus) {
    setBusy(true);
    try {
      await call('setMaterialReviewStatus', { materialId: material.id, reviewStatus });
      showToast(`Marked ${REVIEW_LABEL[reviewStatus].toLowerCase()}.`);
      onChanged();
    } catch (err) {
      showToast(err.message || 'Could not update the review status.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await call('deleteSessionMaterial', { materialId: material.id });
      showToast('Material deleted.');
      onChanged();
    } catch (err) {
      showToast(err.message || 'Could not delete the material.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    if (downloadingRef.current) return;
    downloadingRef.current = true;
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadSessionMaterialFile({ user, materialId: material.id, filename });
    } catch (err) {
      setDownloadError(err.message || 'The file did not download. Try again.');
    } finally {
      downloadingRef.current = false;
      setDownloading(false);
    }
  }

  const address = isFile ? material.storagePath : isLink ? material.url : null;

  return (
    <tr
      className={`border-b-admin-hairline border-admin-rule-hairline last:border-b-0 ${
        selected ? 'bg-admin-action-soft' : ''
      }`}
    >
      <td className="p-0 align-top">
        {isFile ? (
          <label className={CHECK_LABEL_CLASS}>
            <input
              type="checkbox"
              className={CHECKBOX_CLASS}
              checked={selected}
              onChange={() => onToggle(material.id)}
            />
            <span className="sr-only">Select {filename}</span>
          </label>
        ) : null}
      </td>
      <td className={CELL_CLASS}>
        <p className="break-words text-admin-base font-bold text-admin-ink">{filename}</p>
        <p className="text-admin-xs text-admin-ink-secondary">{isFile ? 'File' : 'Link'}</p>
        {address ? <p className={`break-all ${rowMetaClass}`}>{address}</p> : null}
      </td>
      <td className={`${CELL_CLASS} break-words text-admin-ink`}>
        {sessionTitle ?? <span className={`break-all ${rowMetaClass}`}>{material.sessionId ?? 'No session'}</span>}
      </td>
      <td className={CELL_CLASS}>
        <StatusBadge tone={REVIEW_TONE[material.reviewStatus] ?? 'neutral'}>
          {REVIEW_LABEL[material.reviewStatus] ?? material.reviewStatus ?? 'Unknown'}
        </StatusBadge>
      </td>
      <td className={`${CELL_CLASS} whitespace-nowrap font-admin-data text-admin-xs text-admin-ink-data`}>
        {formatWhen(material.updatedAt)}
      </td>
      <td className={CELL_CLASS}>
        <div className="flex flex-wrap items-center gap-xs">
          {isFile ? (
            <button
              type="button"
              className={linkButtonClass}
              onClick={download}
              aria-busy={downloading ? 'true' : undefined}
              aria-disabled={downloading ? 'true' : undefined}
              aria-describedby={downloadError ? errorId : undefined}
            >
              {downloading ? 'Downloading…' : 'Download'}
            </button>
          ) : null}
          {isLink && isSafeUrl(material.url) ? (
            <ExternalLink href={material.url} className={linkButtonClass}>
              Open link
            </ExternalLink>
          ) : null}
          {isLink && !isSafeUrl(material.url) ? (
            <span className="text-admin-sm text-admin-ink-secondary">This address is not a web link.</span>
          ) : null}
          {material.reviewStatus !== 'approved' ? (
            <button type="button" className={linkButtonClass} disabled={busy} onClick={() => review('approved')}>
              Approve
            </button>
          ) : null}
          {material.reviewStatus !== 'rejected' ? (
            <button type="button" className={linkButtonClass} disabled={busy} onClick={() => review('rejected')}>
              Reject
            </button>
          ) : null}
          <DestructiveConfirm
            trigger="Delete"
            title={`Delete ${filename}`}
            confirmLabel="Delete this material"
            busy={busy}
            disabled={busy}
            consequence="The file is removed from the session’s materials list, and anyone holding its link gets nothing."
            permanence="This cannot be undone."
            onConfirm={remove}
          />
        </div>
        <FieldError id={errorId} role="alert" message={downloadError} />
      </td>
    </tr>
  );
}

/** A figure in the coverage sentence: the data face, bold. */
function Figure({ children }) {
  return <span className="font-admin-data font-bold">{children}</span>;
}

function CoverageSummary({ coverage, readAt, timeZone }) {
  const { consideredCount, coveredCount } = coverage;
  const uncovered = coverage.uncoveredSessions.length;
  const speakers = coverage.uncoveredSpeakers.length;
  return (
    <p className="text-admin-base text-admin-ink">
      <Figure>{coveredCount}</Figure> of <Figure>{consideredCount}</Figure>{' '}
      {consideredCount === 1 ? 'session' : 'sessions'} with speakers {coveredCount === 1 ? 'has' : 'have'} materials.{' '}
      <Figure>{uncovered}</Figure> {uncovered === 1 ? 'has' : 'have'} none.{' '}
      <Figure>{speakers}</Figure> {speakers === 1 ? 'speaker has' : 'speakers have'} no materials on any of their
      sessions. Read at <Figure>{formatReadAt(readAt, timeZone)}</Figure>.
    </p>
  );
}

function CoveragePanel({ materials, truncated, readAt, sessions, sessionsState, speakersState, timeZone }) {
  const headingId = useId();
  const coverage = useMemo(
    () => materialsCoverage({ sessions, speakers: speakersState.speakers, materials }),
    [sessions, speakersState.speakers, materials],
  );

  let body;
  if (truncated) {
    body = <Notice tone="caution" message="The list stops at 2,000 materials, so coverage is not shown." />;
  } else if (sessionsState.error || speakersState.error) {
    body = <Notice tone="error" message="Coverage needs the session and speaker lists, and they did not load." />;
  } else if (sessionsState.loading || speakersState.loading) {
    body = <AdminLoadingState label="Loading coverage…" />;
  } else if (coverage.consideredCount === 0) {
    body = (
      <p className="text-admin-sm text-admin-ink-secondary">
        No session has a speaker yet, so there is nothing to cover.
      </p>
    );
  } else {
    body = (
      <div className="flex flex-col gap-md">
        <CoverageSummary coverage={coverage} readAt={readAt} timeZone={timeZone} />
        {coverage.uncoveredSessions.length === 0 ? (
          <p className="text-admin-sm text-admin-ink-secondary">
            Every session with a speaker has at least one material.
          </p>
        ) : (
          <section aria-labelledby={`${headingId}-sessions`} className="flex flex-col gap-2xs">
            <h3 id={`${headingId}-sessions`} className="text-admin-base font-bold text-admin-ink">
              Sessions with no materials
            </h3>
            <ul className="flex flex-col">
              {coverage.uncoveredSessions.map((session) => (
                <li key={session.id} className={RULED_ITEM_CLASS}>
                  <Link to={`/admin/sessions/${encodeURIComponent(session.id)}`} className={rowTitleLinkClass}>
                    {session.title}
                  </Link>
                  <p className="text-admin-sm text-admin-ink-secondary">
                    {session.dayLabel}. Speakers: {session.speakers.map((speaker) => speaker.name).join(', ')}.
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}
        {coverage.uncoveredSpeakers.length > 0 ? (
          <section aria-labelledby={`${headingId}-speakers`} className="flex flex-col gap-2xs">
            <h3 id={`${headingId}-speakers`} className="text-admin-base font-bold text-admin-ink">
              Speakers with no materials
            </h3>
            <ul className="flex flex-col">
              {coverage.uncoveredSpeakers.map((speaker) => (
                <li key={speaker.id} className={RULED_ITEM_CLASS}>
                  {speaker.known ? (
                    <Link to={`/admin/speakers/${encodeURIComponent(speaker.id)}`} className={rowTitleLinkClass}>
                      {speaker.name}
                    </Link>
                  ) : (
                    <span className={`break-all ${rowMetaClass}`}>{speaker.id}</span>
                  )}
                  <p className="text-admin-sm text-admin-ink-secondary">
                    Sessions: {speaker.sessions.map((session) => session.title).join(', ')}.
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    );
  }

  return (
    <Panel
      title="Coverage"
      description="A pending or approved material counts. A rejected one does not. Sessions with no speaker are left out."
    >
      {body}
    </Panel>
  );
}

export default function AdminMaterialsTab() {
  const call = useAdminApi();
  const { user } = useAuth();
  const { eventConfig } = useEventConfig();
  const sessionsState = useAdminSessions();
  const speakersState = useAdminSpeakers();
  const sessionFieldRef = useRef(null);
  const headCheckboxRef = useRef(null);

  const [result, setResult] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [sessionFilter, setSessionFilter] = useState('');
  const [reviewFilter, setReviewFilter] = useState('');
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [selected, setSelected] = useState(() => new Set());
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveResult, setArchiveResult] = useState(null);
  const archiveBusyRef = useRef(false);
  // Guards against an out-of-order response: every row action and every
  // Reload calls load() again while an earlier request may still be in
  // flight. Each call bumps this ref and keeps its own value; a response
  // applies only if it is still the newest request when it lands.
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = (requestIdRef.current += 1);
    try {
      const response = await call('listAllSessionMaterials', {});
      if (requestIdRef.current !== requestId) return; // superseded by a newer request
      setResult({
        materials: Array.isArray(response.materials) ? response.materials : [],
        truncated: response.truncated === true,
        readAt: new Date(),
      });
      setLoadError(null);
    } catch (err) {
      if (requestIdRef.current !== requestId) return;
      setLoadError(err);
    }
  }, [call]);

  useEffect(() => {
    load();
  }, [load]);

  const sessions = useMemo(
    () => liveSessions(sessionsState.rows, eventConfig?.days ?? [], eventConfig?.timezone),
    [sessionsState.rows, eventConfig?.days, eventConfig?.timezone],
  );
  const sessionById = useMemo(
    () => new Map(sessions.map((session, index) => [session.id, { ...session, index }])),
    [sessions],
  );

  const materials = useMemo(() => result?.materials ?? [], [result]);
  const shown = useMemo(() => {
    const rows = materials.filter(
      (material) =>
        (!sessionFilter || material.sessionId === sessionFilter) &&
        (!reviewFilter || material.reviewStatus === reviewFilter),
    );
    const byName = (a, b) => compareText(a.filename, b.filename) || compareText(a.id, b.id);
    const bySession = (a, b) => {
      const left = sessionById.get(a.sessionId)?.index ?? Number.MAX_SAFE_INTEGER;
      const right = sessionById.get(b.sessionId)?.index ?? Number.MAX_SAFE_INTEGER;
      return left - right || compareText(a.sessionId, b.sessionId);
    };
    const byChanged = (a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0);
    const primary = { material: byName, session: bySession, changed: byChanged }[sort.column];
    const sign = sort.direction === 'descending' ? -1 : 1;
    return [...rows].sort((a, b) => sign * primary(a, b) || byName(a, b));
  }, [materials, sessionFilter, reviewFilter, sort, sessionById]);

  const shownFiles = useMemo(() => shown.filter((material) => material.type === 'file'), [shown]);
  // The selection is read against the file rows on screen, in table order,
  // so a file a reload removed, or a review change filtered out, leaves it.
  const selectedIds = useMemo(
    () => shownFiles.filter((material) => selected.has(material.id)).map((material) => material.id),
    [shownFiles, selected],
  );
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allShownSelected = shownFiles.length > 0 && selectedIds.length === shownFiles.length;
  const someShownSelected = selectedIds.length > 0 && !allShownSelected;

  useEffect(() => {
    if (headCheckboxRef.current) headCheckboxRef.current.indeterminate = someShownSelected;
  });

  function changeSelection(next) {
    setSelected(next);
    setArchiveResult(null);
  }

  function toggle(id) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    changeSelection(next);
  }

  function toggleAll() {
    changeSelection(allShownSelected ? new Set() : new Set(shownFiles.map((material) => material.id)));
  }

  function changeSessionFilter(value) {
    setSessionFilter(value);
    changeSelection(new Set());
  }

  function changeReviewFilter(value) {
    setReviewFilter(value);
    changeSelection(new Set());
  }

  function showAll() {
    setSessionFilter('');
    setReviewFilter('');
    changeSelection(new Set());
  }

  function onSort(column) {
    setSort((current) =>
      current.column === column
        ? { column, direction: current.direction === 'ascending' ? 'descending' : 'ascending' }
        : { column, direction: SORTS[column].first },
    );
  }

  async function downloadArchive() {
    if (archiveBusyRef.current) return;
    const ids = selectedIds;
    if (ids.length === 0) {
      setArchiveResult({ tone: 'caution', message: 'Select at least one file.' });
      return;
    }
    if (ids.length > MAX_ARCHIVE_FILES) {
      setArchiveResult({
        tone: 'caution',
        message: `An archive holds at most ${MAX_ARCHIVE_FILES} files. ${ids.length} are selected.`,
      });
      return;
    }
    archiveBusyRef.current = true;
    setArchiveBusy(true);
    setArchiveResult(null);
    try {
      await downloadMaterialsArchive({
        getIdToken: () =>
          user && typeof user.getIdToken === 'function'
            ? user.getIdToken()
            : Promise.reject(new Error('not signed in')),
        materialIds: ids,
      });
      setArchiveResult({ tone: 'ok', message: `Downloaded an archive of ${fileCount(ids.length)}.` });
    } catch (err) {
      setArchiveResult({ tone: 'error', message: err.message });
    } finally {
      archiveBusyRef.current = false;
      setArchiveBusy(false);
    }
  }

  // SelectField forwards no ref, so the wrapper finds its select.
  function chooseSession() {
    sessionFieldRef.current?.querySelector('select')?.focus();
  }

  const refused = loadError?.status === 403;
  const sessionOptions = [
    { value: '', label: 'All sessions' },
    ...sessions.map((session) => ({ value: session.id, label: session.title })),
  ];

  let tableBody;
  if (refused) {
    tableBody = (
      <div className="px-md pb-md">
        <Notice tone="error" message={loadError.message} />
      </div>
    );
  } else if (!result && loadError) {
    tableBody = (
      <div className="flex flex-col items-start gap-sm px-md pb-md">
        <ServerErrorSummary error={loadError} title="The materials did not load" />
        <button type="button" className={secondaryButtonClass} onClick={load}>
          Try again
        </button>
      </div>
    );
  } else if (!result) {
    tableBody = (
      <div className="px-md pb-md">
        <AdminLoadingState label="Loading materials…" />
      </div>
    );
  } else if (materials.length === 0) {
    tableBody = (
      <div className="px-md pb-md">
        <AdminEmptyState
          title="No session has materials yet."
          action={
            <button type="button" className={secondaryButtonClass} onClick={chooseSession}>
              Choose a session to add a link
            </button>
          }
        />
      </div>
    );
  } else if (shown.length === 0) {
    tableBody = (
      <div className="px-md pb-md">
        <AdminEmptyState
          title="No materials match these filters."
          action={
            <button type="button" className={secondaryButtonClass} onClick={showAll}>
              Show all materials
            </button>
          }
        />
      </div>
    );
  } else {
    const sortSpec = SORTS[sort.column];
    tableBody = (
      <>
        <div className="flex flex-col gap-sm px-md pb-sm">
          <div className="flex flex-wrap items-center gap-sm">
            <p role="status" className="text-admin-sm font-semibold text-admin-ink">
              {selectionSentence(selectedIds.length)}
            </p>
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={downloadArchive}
              aria-busy={archiveBusy ? 'true' : undefined}
              aria-disabled={archiveBusy ? 'true' : undefined}
            >
              {archiveBusy ? 'Preparing archive…' : 'Download as archive'}
            </button>
            <button type="button" className={linkButtonClass} onClick={() => changeSelection(new Set())}>
              Clear selection
            </button>
          </div>
          {archiveResult?.tone === 'ok' ? <SaveStatus message={archiveResult.message} /> : null}
          {archiveResult && archiveResult.tone !== 'ok' ? (
            <Notice tone={archiveResult.tone} message={archiveResult.message} />
          ) : null}
        </div>
        <div
          role="region"
          aria-label="Materials"
          tabIndex={0}
          className="max-h-[40rem] overflow-auto rounded-b-admin-panel border-t-admin-hairline border-admin-rule-hairline"
        >
          <table className="w-full min-w-[52rem] border-collapse text-admin-sm">
            <caption className="sr-only">
              {`Materials, sorted by ${sortSpec.label.toLowerCase()}: ${sortSpec.words[sort.direction]}`}
            </caption>
            <thead>
              <tr>
                <th scope="col" className={`${HEAD_BASE_CLASS} w-11`}>
                  <label className={CHECK_LABEL_CLASS}>
                    <input
                      ref={headCheckboxRef}
                      type="checkbox"
                      className={CHECKBOX_CLASS}
                      checked={allShownSelected}
                      disabled={shownFiles.length === 0}
                      onChange={toggleAll}
                    />
                    <span className="sr-only">Select all files shown</span>
                  </label>
                </th>
                <SortHead column="material" sort={sort} onSort={onSort} />
                <SortHead column="session" sort={sort} onSort={onSort} />
                <th scope="col" className={HEAD_CLASS}>
                  Review
                </th>
                <SortHead column="changed" sort={sort} onSort={onSort} />
                <th scope="col" className={HEAD_CLASS}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((material) => (
                <MaterialRow
                  key={material.id}
                  material={material}
                  sessionTitle={sessionById.get(material.sessionId)?.title ?? null}
                  selected={selectedSet.has(material.id)}
                  onToggle={toggle}
                  onChanged={load}
                />
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-md">
      <AdminPageHeader
        title="Materials"
        description="Every session’s files and links. Download files one at a time or together as one archive, and see which sessions have nothing yet."
      />

      <Panel title="Show">
        <div className="grid gap-sm sm:grid-cols-2">
          <div ref={sessionFieldRef}>
            <SelectField
              label="Session"
              value={sessionFilter}
              onChange={changeSessionFilter}
              options={sessionOptions}
            />
          </div>
          <SelectField label="Review" value={reviewFilter} onChange={changeReviewFilter} options={REVIEW_FILTERS} />
        </div>
      </Panel>

      {sessionFilter ? (
        <Panel title="Add a link">
          <AddLinkForm sessionId={sessionFilter} onAdded={load} />
        </Panel>
      ) : null}

      <Panel
        title="Materials"
        flush
        actions={
          <button type="button" className={secondaryButtonClass} onClick={load}>
            Reload
          </button>
        }
      >
        {/* A reload that fails keeps the last list on screen and says so. */}
        {result && loadError && !refused ? (
          <div className="px-md pb-sm">
            <ServerErrorSummary error={loadError} title="The materials did not load" />
          </div>
        ) : null}
        {tableBody}
      </Panel>

      {result && !refused ? (
        <CoveragePanel
          materials={materials}
          truncated={result.truncated}
          readAt={result.readAt}
          sessions={sessions}
          sessionsState={sessionsState}
          speakersState={speakersState}
          timeZone={eventConfig?.timezone}
        />
      ) : null}
    </div>
  );
}
