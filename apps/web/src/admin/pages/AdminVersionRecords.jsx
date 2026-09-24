// Version history, the record list (issue #195): pick a collection, then a
// record, to read what changed in each publish.
//
// cmsGetVersionHistory answers for one record at a time (a docPath), so this
// page lists the records a collection holds now, from the live collection
// and its drafts (the rules admit both tiers to both), and each name links
// to that record's versions. A record deleted since it was published has
// neither document, so it is not listed; its versions are kept, and its
// route still opens them.
//
// ONE COLLECTION AT A TIME. The collection is a required choice, kept in the
// URL with the search text and the order, so a reload or a shared link
// opens the same view. Record names and ids are not personal data, so the
// search may sit in the URL; it is written with `replace`, so typing adds no
// history entries.
//
// THE FIGURE SENTENCE, NOT A TILE. One stated line says how many records
// are shown and in what order.
import { useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
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
  rowMetaClass,
  rowTitleLinkClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import RuledTable from '../components/RuledTable.jsx';
import { useAdminRecords } from '../useAdminRecords.js';
import {
  COLLECTION_CHOICES,
  DEFAULT_COLLECTION,
  collectionChoice,
  formatPublishedAt,
  recordNameOf,
  toMillis,
} from '../versionHistory.js';

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

  const all = useMemo(
    () =>
      records.rows
        .filter((row) => row.current)
        .map((row) => ({
          id: row.id,
          name: recordNameOf(collection, row.current),
          state: row.state,
          live: row.live,
          publishedMs: toMillis(row.live?.publishedAt),
        })),
    [records.rows, collection],
  );
  const shown = useMemo(() => {
    const matching = needle
      ? all.filter((row) => row.name.toLowerCase().includes(needle) || row.id.toLowerCase().includes(needle))
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
        title={`No ${choice.plural} yet`}
        description="A record shows here once it is saved. A version is added each time it is published."
      />
    );
  } else if (shown.length === 0) {
    body = (
      <AdminEmptyState
        title={`No ${choice.plural} match “${query.trim()}”`}
        description="The search looks at each record’s name and id."
        action={
          <button type="button" className={secondaryButtonClass} onClick={clearSearch}>
            Clear search
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
                  <span className={rowMetaClass}>{row.id}</span>
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
        description="Every publish keeps a version. Pick a collection, then a record, to see what changed, when, and who published it. Saving a draft adds no version."
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
            label="Collection"
            value={collection}
            onChange={(id) => writeParam('collection', id === DEFAULT_COLLECTION ? '' : id)}
            options={COLLECTION_CHOICES.map((option) => ({ value: option.id, label: option.label }))}
          />
        </div>
        <div className="min-w-0 grow basis-64">
          <TextField
            label="Search by name or id"
            type="search"
            value={query}
            onChange={(q) => writeParam('q', q, { replace: true })}
            autoComplete="off"
            spellCheck={false}
            maxLength={200}
          />
        </div>
        <button type="button" className={secondaryButtonClass} onClick={clearSearch}>
          Clear
        </button>
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
    </div>
  );
}
