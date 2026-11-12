// Version history, the record list (issue #195): pick a collection, then a
// record, to read what changed in each publish.
//
// Current records render from live and draft listeners first. A separate
// history read then finds removed records, named from their newest version.
// The existing rules admit both admin tiers to all three collections.
//
// ONE COLLECTION AT A TIME. The collection is a required choice, kept in the
// URL with the search text and the order, so a reload or a shared link
// opens the same view. Record names and ids are not personal data, so the
// search may sit in the URL; it is written with `replace`, so typing adds no
// history entries.
//
// THE FIGURE SENTENCE, NOT A TILE. One stated line says how many records
// are shown and in what order.
import { useId, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import AdminPageHeader, {
  AdminEmptyState,
  AdminLoadingState,
  RecordState,
  StatusBadge,
} from '../components/adminChrome.jsx';
import {
  Notice,
  SelectField,
  TextField,
  rowTitleLinkClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import RuledTable from '../components/RuledTable.jsx';
import { useAdminRecords } from '../useAdminRecords.js';
import { useAdminVersions } from '../useAdminVersions.js';
import {
  COLLECTION_CHOICES,
  DEFAULT_COLLECTION,
  collectionChoice,
  formatPublishedAt,
  removedVersionRecords,
  toMillis,
} from '../versionHistory.js';

import AdminIconControl from '../components/AdminIconControl.jsx';
import { versionRecordName } from './versionDisplay.js';

const SORTS = Object.freeze({ published: 'Most recently published', name: 'Name, A to Z' });

const count = (n) => n.toLocaleString('en-US');
const nounFor = (choice, n) => (n === 1 ? choice.singular : choice.plural);

const byName = (a, b) =>
  a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.id.localeCompare(b.id, 'en');

/** Newest live publish first; records never published after them, by name. */
function byPublished(a, b) {
  if (a.publishedMs !== b.publishedMs) {
    if (a.publishedMs === null) return 1;
    if (b.publishedMs === null) return -1;
    return b.publishedMs - a.publishedMs;
  }
  return byName(a, b);
}

/** The figure sentence: how many records are shown, and in what order. */
export function figureSentence({ choice, shown, total, query, sort }) {
  if (query) {
    return `${count(shown)} of ${count(total)} ${nounFor(choice, total)} ${shown === 1 ? 'matches' : 'match'} “${query}”.`;
  }
  const order = sort === 'name' ? 'by name' : 'most recently published first';
  return `${count(total)} ${nounFor(choice, total)}, ${order}.`;
}

export default function AdminVersionRecords() {
  const { eventConfig } = useEventConfig();
  const timeZone = typeof eventConfig?.timezone === 'string' && eventConfig.timezone ? eventConfig.timezone : undefined;
  const [searchParams, setSearchParams] = useSearchParams();
  const choice = collectionChoice(searchParams.get('collection')) ?? collectionChoice(DEFAULT_COLLECTION);
  const collection = choice.id;
  const query = searchParams.get('q') ?? '';
  const sort = searchParams.get('sort') === 'name' ? 'name' : 'published';
  const needle = query.trim().toLowerCase();
  const formRef = useRef(null);

  const records = useAdminRecords(collection);
  const removedHeadingId = useId();
  const removedHeadingRef = useRef(null);
  const history = useAdminVersions(collection, records.ready);
  const removed = useMemo(() => removedVersionRecords(collection, history.entries ?? [], records.rows)
    .map((entry) => ({ ...entry, name: versionRecordName(collection, entry.fields), publishedMs: toMillis(entry.publishedAt) }))
    .filter((entry) => !needle || entry.name.toLowerCase().includes(needle))
    .sort(sort === 'name' ? byName : byPublished), [collection, history.entries, records.rows, needle, sort]);
  const removedCount = `${count(removed.length)} removed ${removed.length === 1 ? 'record' : 'records'}`;
  const matchWord = removed.length === 1 ? 'matches' : 'match';
  const removedSummary = needle ? `${removedCount} ${matchWord} this search.` : `${removedCount} with published versions${history.nextCursor ? ' found so far' : ''}.`;

  const all = useMemo(
    () =>
      records.rows
        .filter((row) => row.current)
        .map((row) => ({
          id: row.id,
          name: versionRecordName(collection, row.current),
          state: row.state,
          live: row.live,
          publishedMs: toMillis(row.live?.publishedAt),
        })),
    [records.rows, collection],
  );
  const shown = useMemo(() => {
    const matching = needle
      ? all.filter((row) => row.name.toLowerCase().includes(needle))
      : all;
    return [...matching].sort(sort === 'name' ? byName : byPublished);
  }, [all, needle, sort]);

  /** Write one URL key; an empty value or the default removes it. */
  function writeParam(key, value, { replace = false } = {}) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace });
  }

  function clearSearch() {
    writeParam('q', '', { replace: true });
    formRef.current?.querySelector('input[type="search"]')?.focus();
  }

  let body;
  if (records.error && !records.ready) {
    // Half a list would show wrong states (a draft-only record as absent),
    // so an error before both listeners report draws no table at all.
    body = <Notice tone="error" message="The records did not load. The page tries again on its own." />;
  } else if (!records.ready) {
    body = <AdminLoadingState label="Loading the records…" />;
  } else if (all.length === 0) {
    body = (
      <AdminEmptyState
        title={`No current ${choice.plural}`}
        description="Removed records with published versions appear below."
        action={<Link to={choice.id === 'cmsContent' ? '/admin/content' : ({ cmsPages: '/admin/pages', cmsSchedule: '/admin/sessions', cmsOrganizations: '/admin/organizations', cmsUpdates: '/admin/updates', cmsTimeline: '/admin/timeline' })[choice.id]} className={secondaryButtonClass}>Manage {choice.plural}</Link>}
      />
    );
  } else if (shown.length === 0) {
    body = (
      <AdminEmptyState
        title={`No ${choice.plural} match “${query.trim()}”`}
        description="Try another name or clear the search."
        action={
          <button type="button" className={secondaryButtonClass} onClick={clearSearch}>
            Show all
          </button>
        }
      />
    );
  } else {
    body = (
      <RuledTable
        caption="Records"
        hideCaption
        className="max-h-[40rem] bg-admin-ground-raised"
        tableClassName="min-w-[40rem]"
        sort={sort === 'name' ? { column: 'record', direction: 'ascending' } : { column: 'published', direction: 'descending' }}
        columns={[
          { id: 'record', label: 'Record' },
          { id: 'state', label: 'State' },
          { id: 'version', label: 'Live version', numeric: true },
          { id: 'published', label: 'Last published' },
        ]}
        rows={shown.map((row) => {
          const published = row.publishedMs === null ? null : formatPublishedAt(row.publishedMs, timeZone);
          return {
            id: row.id,
            cells: {
              record: (
                <div className="flex min-w-0 flex-col items-start gap-3xs wrap-anywhere">
                  <Link
                    to={`/admin/versions/${collection}/${encodeURIComponent(row.id)}`}
                    className={rowTitleLinkClass}
                  >
                    {row.name}
                  </Link>
                </div>
              ),
              // A hidden live version is on no public page, so the list says
              // so beside the state, as the Pages list does.
              state: (
                <div className="flex flex-wrap items-center gap-2xs">
                  <RecordState state={row.state} />
                  {row.live?.visible === false ? <StatusBadge tone="neutral">Hidden</StatusBadge> : null}
                </div>
              ),
              version:
                typeof row.live?.revision === 'number' ? (
                  row.live.revision
                ) : (
                  <span className="font-admin-ui text-admin-ink-secondary">Not published</span>
                ),
              published: published ? (
                <time dateTime={new Date(row.publishedMs).toISOString()} className="font-admin-data text-admin-ink-data">
                  {published}
                </time>
              ) : (
                <span className="text-admin-ink-secondary">Never</span>
              ),
            },
          };
        })}
      />
    );
  }

  return (
    <div className="flex flex-col gap-md">
      <AdminPageHeader
        title="Version history"
        description="Choose an item to see its published versions and restore past content."
      />

      <form
        ref={formRef}
        role="search"
        aria-label="Find a record"
        onSubmit={(event) => event.preventDefault()}
        className="flex flex-wrap items-end gap-sm"
      >
        <div className="min-w-0 grow basis-48">
          <SelectField
            label="Content type"
            value={collection}
            onChange={(id) => writeParam('collection', id === DEFAULT_COLLECTION ? '' : id)}
            options={COLLECTION_CHOICES.map((option) => ({ value: option.id, label: option.label }))}
          />
        </div>
        <div className="min-w-0 grow basis-64">
          <TextField
            label="Search by name"
            type="search"
            value={query}
            onChange={(q) => writeParam('q', q, { replace: true })}
            autoComplete="off"
            spellCheck={false}
            maxLength={200}
          />
        </div>
        <AdminIconControl icon="close" label="Clear search" className={secondaryButtonClass} onClick={clearSearch} />
        <div className="min-w-0 grow basis-48">
          <SelectField
            label="Order records by"
            value={sort}
            onChange={(value) => writeParam('sort', value === 'name' ? 'name' : '')}
            options={Object.entries(SORTS).map(([value, label]) => ({ value, label }))}
          />
        </div>
      </form>

      {records.error && records.ready ? (
        <Notice tone="caution" message="The list did not refresh. The page tries again on its own." />
      ) : null}

      {records.ready && all.length > 0 ? (
        <p role="status" className="text-admin-sm text-admin-ink-secondary">
          {figureSentence({ choice, shown: shown.length, total: all.length, query: query.trim(), sort })}
        </p>
      ) : null}

      {body}

      {records.ready ? (
        <section aria-labelledby={removedHeadingId} className="flex flex-col gap-sm">
          <h2 id={removedHeadingId} ref={removedHeadingRef} tabIndex={-1} className="font-admin-ui text-admin-lg font-bold text-admin-ink">Removed records</h2>
          {history.error ? <Notice tone="error" message="Removed records did not load. Current records remain available." /> : null}
          {!history.entries && history.loading ? <AdminLoadingState label="Loading removed records…" /> : null}
          {history.entries ? (
            <>
              <p role="status" className="text-admin-sm text-admin-ink-secondary">
                {`${removedSummary} Open a record to restore a version as a draft.`}
              </p>
              <ul className="divide-y divide-admin-rule-hairline">
                {removed.map((entry) => (
                  <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-xs py-sm">
                    <Link to={`/admin/versions/${collection}/${encodeURIComponent(entry.id)}`} className={`${rowTitleLinkClass} min-w-0 wrap-anywhere`}>{entry.name}</Link>
                    <span className="text-admin-sm text-admin-ink-secondary">{`Version ${entry.revision} · ${formatPublishedAt(entry.publishedMs, timeZone) ?? 'Publish time not recorded'}`}</span>
                  </li>
                ))}
              </ul>
              {history.nextCursor ? <p className="text-admin-sm text-admin-ink-secondary">More published versions remain to check. Search includes the removed records loaded so far.</p> : null}
            </>
          ) : null}
          {history.nextCursor || history.error ? (
            <button type="button" className={`${secondaryButtonClass} self-start`} disabled={history.loading} aria-busy={history.loading || undefined} onClick={async () => {
              if (await history.loadMore()) removedHeadingRef.current?.focus();
            }}>
              {history.loading ? 'Checking…' : history.error ? 'Try again' : 'Check more history'}
            </button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
