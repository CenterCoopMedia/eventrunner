import { useEffect, useId, useRef } from 'react';
import { isSafeUrl } from 'shared/urlSafety';
import ExternalLink from '../../components/ExternalLink.jsx';
import AdminIconControl from './AdminIconControl.jsx';
import AdminTableScroll from './AdminTableScroll.jsx';
import { StatusBadge } from './adminChrome.jsx';
import { Panel, SaveStatus, SelectField, DestructiveConfirm, FieldError, Notice, ghostButtonClass, linkButtonClass, secondaryButtonClass } from './formControls.jsx';

export const REVIEW_LABEL = { pending: 'Pending review', approved: 'Approved', rejected: 'Rejected' };

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
export const SORTS = {
  material: { label: 'Material', first: 'ascending', words: { ascending: 'A to Z', descending: 'Z to A' } },
  session: {
    label: 'Session',
    first: 'ascending',
    words: { ascending: 'Schedule order', descending: 'Reverse schedule order' },
  },
  changed: { label: 'Changed', first: 'descending', words: { descending: 'Newest first', ascending: 'Oldest first' } },
};

export const DEFAULT_SORT = { column: 'session', direction: 'ascending' };

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
export function fileCount(count) {
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

function compareText(a, b) {
  return String(a ?? '').localeCompare(String(b ?? ''));
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

/**
 * What delete does. A link stays on the web. The projection trigger deletes
 * a browser upload. A legacy file can share an operator-managed object, so
 * that object stays.
 */
function materialDeleteConsequence(material) {
  if (material?.type === 'link') {
    return 'This material leaves the session list, and the page at that address stays.';
  }
  if (material?.managedStorageObject === true) {
    return 'This material leaves the session list, and its stored file is deleted.';
  }
  return 'This material leaves the session list, and the stored file stays.';
}

/** One row; reads and mutations stay in its caller. */
export function MaterialRowView({ material, sessionTitle, selected, onToggle, busy, downloading, downloadError, actionError, onReview, onRemove, onDownload }) {
  const errorId = useId();
  const isFile = material.type === 'file';
  const isLink = material.type === 'link';
  const filename = material.filename || 'Untitled';
  return (
    <tr
      className={`border-b-admin-hairline border-admin-rule-hairline last:border-b-0 ${
        selected ? 'bg-admin-action-soft' : ''
      }`}
    >
      <td className="p-0 align-top">
        {isFile ? (
          <label className={CHECK_LABEL_CLASS}>
            <input data-help-skip="Row selection checkbox; its accessible name identifies the material."
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
      </td>
      <td className={`${CELL_CLASS} break-words text-admin-ink`}>
        {sessionTitle ?? 'Session unavailable'}
      </td>
      <td className={CELL_CLASS}>
        <StatusBadge tone={REVIEW_TONE[material.reviewStatus] ?? 'neutral'}>
          {REVIEW_LABEL[material.reviewStatus] ?? 'Unknown'}
        </StatusBadge>
      </td>
      <td className={`${CELL_CLASS} whitespace-nowrap font-admin-data text-admin-xs text-admin-ink-data`}>
        {formatWhen(material.updatedAt)}
      </td>
      <td className={CELL_CLASS}>
        <div className="flex flex-wrap items-center gap-xs">
          {isFile ? (
            <AdminIconControl
              className={ghostButtonClass}
              onClick={onDownload}
              aria-busy={downloading ? 'true' : undefined}
              aria-disabled={downloading ? 'true' : undefined}
              aria-describedby={downloadError ? errorId : undefined}
              busy={downloading}
              label={downloading ? 'Downloading…' : 'Download'}
              icon="download"
            />
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
            <button type="button" className={linkButtonClass} disabled={busy} onClick={() => onReview('approved')}>
              Approve
            </button>
          ) : null}
          {material.reviewStatus !== 'rejected' ? (
            <button type="button" className={linkButtonClass} disabled={busy} onClick={() => onReview('rejected')}>
              Reject
            </button>
          ) : null}
          <DestructiveConfirm
            trigger="Delete"
            triggerIcon="delete"
            title={`Delete ${filename}`}
            confirmLabel="Delete this material"
            busy={busy}
            disabled={busy}
            consequence={materialDeleteConsequence(material)}
            permanence="This cannot be undone."
            onConfirm={onRemove}
          />
        </div>
        <FieldError id={errorId} role="alert" message={downloadError} />
        <FieldError role="alert" message={actionError} />
      </td>
    </tr>
  );
}


/** The list's existing filter and stable ordering, shared with the specimen. */
export function filterMaterials(materials, { sessionFilter, reviewFilter, sort, sessionById }) {
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

}

export function MaterialsFilters({ sessionFilter, reviewFilter, sessionOptions, changeSessionFilter, changeReviewFilter, sessionFieldRef }) {
  return (
    <Panel help="Narrow the materials list by session and review status." title="Show">
      <div className="planner-fields grid gap-sm sm:grid-cols-2">
        <div ref={sessionFieldRef}>
          <SelectField help="Show materials attached to the selected session."
            label="Session"
            value={sessionFilter}
            onChange={changeSessionFilter}
            options={sessionOptions}
          />
        </div>
        <SelectField help="Show materials by whether staff have approved them for attendees." label="Review" value={reviewFilter} onChange={changeReviewFilter} options={REVIEW_FILTERS} />
      </div>
    </Panel>
  );
}

export default function MaterialsTable({ shown, sort, onSort, selectedIds, shownFiles, allShownSelected, someShownSelected, archiveBusy, archiveResult, onArchive, onClear, onToggleAll, renderRow }) {
  const headCheckboxRef = useRef(null);
  useEffect(() => {
    if (headCheckboxRef.current) headCheckboxRef.current.indeterminate = someShownSelected;
  });
  const sortSpec = SORTS[sort.column];
  return (
    <>
      <div className="flex flex-col gap-sm px-md pb-sm">
        <div className="flex flex-wrap items-center gap-sm">
          <p role="status" className="text-admin-sm font-semibold text-admin-ink">
            {selectionSentence(selectedIds.length)}
          </p>
          <AdminIconControl label={archiveBusy ? 'Preparing archive…' : 'Download as archive'} icon="download" className={secondaryButtonClass} onClick={onArchive} busy={archiveBusy} aria-busy={archiveBusy ? 'true' : undefined} aria-disabled={archiveBusy ? 'true' : undefined} />
          <button type="button" className={linkButtonClass} onClick={onClear}>
            Clear selection
          </button>
        </div>
        {archiveResult?.tone === 'ok' ? <SaveStatus message={archiveResult.message} /> : null}
        {archiveResult && archiveResult.tone !== 'ok' ? (
          <Notice tone={archiveResult.tone} message={archiveResult.message} />
        ) : null}
      </div>
      <AdminTableScroll
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
                  <input data-help-skip="Select-all checkbox; its accessible name describes the selection."
                    ref={headCheckboxRef}
                    type="checkbox"
                    className={CHECKBOX_CLASS}
                    checked={allShownSelected}
                    disabled={shownFiles.length === 0}
                    onChange={onToggleAll}
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
            {shown.map(renderRow)}
          </tbody>
        </table>
      </AdminTableScroll>
    </>
  );
}

