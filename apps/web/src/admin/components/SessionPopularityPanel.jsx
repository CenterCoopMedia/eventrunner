// The Most saved panel on the Sessions page (issue #182): sessions ordered
// by how many attendees saved them, each count a figure.
//
// The counts are the public `sessionBookmarks` aggregates, read through the
// same shared listener the schedule uses (hooks/useBookmarkCounts.js), so
// the admin and the site can never show two numbers for one session. The
// ordering is rankSessionsBySaves: most saved first, ties by title.
//
// A ruled table in a bounded region (about 20rem), so a long programme
// scrolls inside the panel rather than pushing the day groups off the page:
// Session (a link to its editor), Day (the heading the Sessions page draws,
// never a day id), and Saved, which carries aria-sort. Under the table, the
// sessions on the site that nobody has saved are counted in a sentence.
//
// Every state is stated: loading, none saved yet, a lost listener (the
// last counts stay, under a caution notice), and a saving feature that is
// switched off, which is why a count would not change.
import { Link } from 'react-router-dom';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { useBookmarkCounts } from '../../hooks/useBookmarkCounts.js';
import { rankSessionsBySaves } from '../sessionPopularity.js';
import { AdminLoadingState } from './adminChrome.jsx';
import { Notice, Panel } from './formControls.jsx';
import RuledTable from './RuledTable.jsx';

const COLUMNS = Object.freeze([
  { id: 'session', label: 'Session' },
  { id: 'day', label: 'Day' },
  { id: 'saved', label: 'Saved', numeric: true },
]);

const SORT = Object.freeze({ column: 'saved', direction: 'descending' });

const sessionLinkClass =
  'admin-target inline-flex items-center rounded-admin-small font-semibold text-admin-ink-link ' +
  'underline-offset-2 hover:underline';

/** @param {{ groups: Array<object> }} props the Sessions page's day groups */
export default function SessionPopularityPanel({ groups }) {
  const { features } = useEventConfig();
  const { countsById, ready, error } = useBookmarkCounts();
  const { ranked, unsaved } = rankSessionsBySaves(groups, countsById);
  const savingOff = features?.sessionBookmarks !== true;

  let body;
  if (!ready) {
    body = error
      ? <Notice tone="caution" message="We could not load the saves. We keep trying." />
      : <AdminLoadingState label="Loading saves…" />;
  } else {
    body = (
      <div className="flex flex-col gap-sm">
        {error ? (
          <Notice
            tone="caution"
            message="We lost the connection to the saves. These are the last counts we received, and we keep trying."
          />
        ) : null}
        {ranked.length === 0 ? (
          <p className="text-admin-base text-admin-ink">No session has been saved yet.</p>
        ) : (
          <RuledTable
            caption="Sessions by saves, most first."
            columns={COLUMNS}
            sort={SORT}
            className="max-h-[20rem]"
            tableClassName="min-w-[28rem]"
            rows={ranked.map((row) => ({
              id: row.id,
              cells: {
                session: (
                  <Link to={encodeURIComponent(row.id)} className={sessionLinkClass}>
                    {row.title}
                  </Link>
                ),
                day: row.dayLabel,
                saved: <span className="font-bold">{String(row.count)}</span>,
              },
            }))}
          />
        )}
        {unsaved > 0 ? (
          <p className="text-admin-sm text-admin-ink-secondary">
            <span className="font-admin-data font-bold tabular-nums">{String(unsaved)}</span>{' '}
            {unsaved === 1 ? 'session on the site has no saves yet.' : 'sessions on the site have no saves yet.'}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <Panel
      title="Most saved"
      description="How many attendees saved each session to their schedule."
    >
      <div className="flex flex-col gap-sm">
        {body}
        {savingOff ? (
          <p className="text-admin-sm text-admin-ink-secondary">
            Saving sessions is off for this event, so these counts do not change.
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
