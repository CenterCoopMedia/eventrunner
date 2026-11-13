import HelpTooltip from '../components/HelpTooltip.jsx';
import { plannerError, plannerMessage } from '../plannerErrors.js';
import '../plannerFields.css';
import PlannerFeatureControls from '../components/PlannerFeatureControls.jsx';
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
import { Link } from 'react-router';
import { useAuth } from '../../contexts/AuthContext.jsx';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { useToast } from '../../contexts/ToastContext.jsx';
import { downloadSessionMaterialFile } from '../../lib/materialsSource.js';
import { focusFirstError } from '../../lib/focusFirstError.js';
import { useAdminApi } from '../adminApi.js';
import AdminIconControl from '../components/AdminIconControl.jsx';
import MaterialsTable, { MaterialRowView, MaterialsFilters, REVIEW_LABEL, SORTS, DEFAULT_SORT, fileCount, filterMaterials } from '../components/MaterialsTable.jsx';
import { useAdminSessions } from '../useAdminSessions.js';
import { useAdminSpeakers } from '../useAdminSpeakers.js';
import { liveSessions, materialsCoverage } from '../materialsCoverage.js';
import { MAX_ARCHIVE_FILES, downloadMaterialsArchive } from '../materialsArchive.js';
import {
  Panel,
  ServerErrorSummary,
  TextField,
  Notice,
  primaryButtonClass,
  rowMetaClass,
  rowTitleLinkClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import AdminPageHeader, {
  AdminEmptyState,
  AdminLoadingState,
} from '../components/adminChrome.jsx';

const RULED_ITEM_CLASS = 'border-b-admin-hairline border-admin-rule-hairline py-xs last:border-b-0';

/** "2:02 PM EDT" on the event's clock; the browser's clock if the zone is unreadable. */
function formatReadAt(date, timeZone) {
  const options = { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' };
  try {
    return new Intl.DateTimeFormat('en-US', { ...options, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-US', options).format(date);
  }
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
      setError(plannerError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form ref={formRef} className="flex flex-col gap-sm" onSubmit={submit}>
      <ServerErrorSummary error={error} />
      <TextField help="Add the full address of the material attendees should open." label="Link" value={url} onChange={setUrl} type="url" required />
      <TextField help="Optional. Leave empty to show “External link”."
        label="Link text"
        value={label}
        onChange={setLabel}
        
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

function MaterialRow({ material, sessionTitle, selected, onToggle, onChanged }) {
  const call = useAdminApi();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const downloadingRef = useRef(false);
  const filename = material.filename || 'Untitled';

  async function review(reviewStatus) {
    setActionError(null);
    setBusy(true);
    try {
      await call('setMaterialReviewStatus', { materialId: material.id, reviewStatus });
      showToast(`Marked ${REVIEW_LABEL[reviewStatus].toLowerCase()}.`);
      onChanged();
    } catch (err) {
      setActionError(plannerMessage(err.message || 'The review status was not updated. Try again.'));
      showToast(plannerMessage(err.message || 'Could not update the review status.'), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setActionError(null);
    setBusy(true);
    try {
      await call('deleteSessionMaterial', { materialId: material.id });
      showToast('Material deleted.');
      onChanged();
    } catch (err) {
      setActionError(plannerMessage(err.message || 'The material was not deleted. Try again.'));
      showToast(plannerMessage(err.message || 'Could not delete the material.'), { tone: 'error' });
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
      setDownloadError(plannerMessage(err.message || 'The file did not download. Try again.'));
    } finally {
      downloadingRef.current = false;
      setDownloading(false);
    }
  }


  return <MaterialRowView material={material} sessionTitle={sessionTitle} selected={selected} onToggle={onToggle}
    busy={busy} downloading={downloading} downloadError={downloadError} actionError={actionError}
    onReview={review} onRemove={remove} onDownload={download} />;
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
            <div className="flex items-center gap-2xs"><h3 id={`${headingId}-sessions`} className="text-admin-base font-bold text-admin-ink">
              Sessions with no materials</h3><HelpTooltip label="Sessions with no materials">Review sessions that still need slides, handouts or other materials.</HelpTooltip></div>
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
            <div className="flex items-center gap-2xs"><h3 id={`${headingId}-speakers`} className="text-admin-base font-bold text-admin-ink">
              Speakers with no materials</h3><HelpTooltip label="Speakers with no materials">Review speakers who have not yet supplied materials for their sessions.</HelpTooltip></div>
            <ul className="flex flex-col">
              {coverage.uncoveredSpeakers.map((speaker) => (
                <li key={speaker.id} className={RULED_ITEM_CLASS}>
                  {speaker.known ? (
                    <Link to={`/admin/speakers/${encodeURIComponent(speaker.id)}`} className={rowTitleLinkClass}>
                      {speaker.name}
                    </Link>
                  ) : (
                    <span className={`break-all ${rowMetaClass}`}>{'Speaker unavailable'}</span>
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
    <Panel help="Find sessions or speakers that still need materials. Pending or approved files count as supplied; rejected files do not."
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

  const [result, setResult] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [sessionFilter, setSessionFilter] = useState('');
  const [reviewFilter, setReviewFilter] = useState('');
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [selected, setSelected] = useState(() => new Set());
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveResult, setArchiveResult] = useState(null);
  const archiveBusyRef = useRef(false);
  // A list request is out. Refresh and Try again state it and ignore a
  // press while it lasts; the ref answers a press in the same tick.
  const [listing, setListing] = useState(false);
  const listingRef = useRef(false);
  // A first load failed (not a refusal), so the error state and its Try
  // again stay in place until a list arrives, through each retry.
  const [retryShown, setRetryShown] = useState(false);
  const focusListRef = useRef(false);
  const listBodyRef = useRef(null);
  // Guards against an out-of-order response: every row action and every
  // Refresh calls load() again while an earlier request may still be in
  // flight. Each call bumps this ref and keeps its own value; a response
  // applies only if it is still the newest request when it lands.
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = (requestIdRef.current += 1);
    listingRef.current = true;
    setListing(true);
    // The old error goes when the new request starts, so a second failure
    // mounts a fresh alert rather than leaving the first one in place.
    setLoadError(null);
    try {
      const response = await call('listAllSessionMaterials', {});
      if (requestIdRef.current !== requestId) return; // superseded by a newer request
      setResult({
        materials: Array.isArray(response.materials) ? response.materials : [],
        truncated: response.truncated === true,
        readAt: new Date(),
      });
    } catch (err) {
      if (requestIdRef.current !== requestId) return;
      setLoadError(err);
      if (err?.status !== 403) setRetryShown(true);
    } finally {
      if (requestIdRef.current === requestId) {
        listingRef.current = false;
        setListing(false);
      }
    }
  }, [call]);

  useEffect(() => {
    load();
  }, [load]);

  /** Refresh and Try again: one request at a time. */
  function refresh({ fromRetry = false } = {}) {
    if (listingRef.current) return;
    focusListRef.current = fromRetry;
    load();
  }

  // Try again leaves the page when the list arrives, so focus goes to what
  // replaced it: the table, or the empty state's action.
  useEffect(() => {
    if (!result || !focusListRef.current) return;
    focusListRef.current = false;
    const body = listBodyRef.current;
    (body?.querySelector('[role="region"]') ?? body?.querySelector('button'))?.focus();
  }, [result]);

  const sessions = useMemo(
    () => liveSessions(sessionsState.rows, eventConfig?.days ?? [], eventConfig?.timezone),
    [sessionsState.rows, eventConfig?.days, eventConfig?.timezone],
  );
  const sessionById = useMemo(
    () => new Map(sessions.map((session, index) => [session.id, { ...session, index }])),
    [sessions],
  );

  const materials = useMemo(() => result?.materials ?? [], [result]);
  const shown = useMemo(
    () => filterMaterials(materials, { sessionFilter, reviewFilter, sort, sessionById }),
    [materials, sessionFilter, reviewFilter, sort, sessionById],
  );

  const shownFiles = useMemo(() => shown.filter((material) => material.type === 'file'), [shown]);
  // The selection is read against the file rows on screen, in table order,
  // so a file a reload removed, or a review change filtered out, leaves it.
  const selectedIds = useMemo(
    () => shownFiles.filter((material) => selected.has(material.id)).map((material) => material.id),
    [shownFiles, selected],
  );
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  // A file that leaves the rows on screen leaves the selection for good, so
  // a later list that brings it back cannot put it in an archive unasked.
  useEffect(() => {
    setSelected((current) => (current.size === selectedIds.length ? current : new Set(selectedIds)));
  }, [selectedIds]);
  const allShownSelected = shownFiles.length > 0 && selectedIds.length === shownFiles.length;
  const someShownSelected = selectedIds.length > 0 && !allShownSelected;

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
      setArchiveResult({ tone: 'error', message: plannerMessage(err.message) });
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
  } else if (!result && (loadError || retryShown)) {
    // The button keeps its place through the retry, so focus stays on it.
    tableBody = (
      <div className="flex flex-col items-start gap-sm px-md pb-md">
        {loadError ? <ServerErrorSummary error={loadError} title="The materials did not load" /> : null}
        <button
          type="button"
          className={secondaryButtonClass}
          onClick={() => refresh({ fromRetry: true })}
          aria-busy={listing ? 'true' : undefined}
          aria-disabled={listing ? 'true' : undefined}
        >
          {listing ? 'Loading…' : 'Try again'}
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
    tableBody = (
      <MaterialsTable shown={shown} sort={sort} onSort={onSort}
        selectedIds={selectedIds} shownFiles={shownFiles} allShownSelected={allShownSelected} someShownSelected={someShownSelected}
        archiveBusy={archiveBusy} archiveResult={archiveResult} onArchive={downloadArchive}
        onClear={() => changeSelection(new Set())} onToggleAll={toggleAll}
        renderRow={(material) => <MaterialRow key={material.id} material={material}
          sessionTitle={sessionById.get(material.sessionId)?.title ?? null} selected={selectedSet.has(material.id)}
          onToggle={toggle} onChanged={load} />} />
    );
  }

  return (
    <div className="flex flex-col gap-md">
      <AdminPageHeader help="Every session’s files and links. Download files one at a time or together as one archive, and see which sessions have nothing yet."
        title="Materials"
        description="Every session’s files and links. Download files one at a time or together as one archive, and see which sessions have nothing yet."
      />
      <PlannerFeatureControls choices={[{ key: 'sessionMaterials', label: 'Session materials' }]} />

      <MaterialsFilters sessionFilter={sessionFilter} reviewFilter={reviewFilter} sessionOptions={sessionOptions}
        changeSessionFilter={changeSessionFilter} changeReviewFilter={changeReviewFilter} sessionFieldRef={sessionFieldRef} />

      {sessionFilter ? (
        <Panel help="Share an external resource with attendees of the selected session." title="Add a link">
          <AddLinkForm sessionId={sessionFilter} onAdded={load} />
        </Panel>
      ) : null}

      <Panel help="Review uploaded files and links before making them available to attendees."
        title="Materials"
        flush
        actions={
          <AdminIconControl
            className={secondaryButtonClass}
            onClick={() => refresh()}
            aria-busy={listing ? 'true' : undefined}
            aria-disabled={listing ? 'true' : undefined}
            busy={listing}
            label={listing ? 'Refreshing…' : 'Refresh'}
            icon="refresh"
          />
        }
      >
        {/* The list is cut at 2,000 rows, so the table says so before an
            empty filter can read as "nothing exists". */}
        {result?.truncated && !refused ? (
          <div className="px-md pb-sm">
            <Notice tone="caution" message="The list stops at 2,000 materials. Some materials are not shown." />
          </div>
        ) : null}
        {/* A refresh that fails keeps the last list on screen and says so. */}
        {result && loadError && !refused ? (
          <div className="px-md pb-sm">
            <ServerErrorSummary error={loadError} title="The materials did not load" />
          </div>
        ) : null}
        <div ref={listBodyRef}>{tableBody}</div>
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
