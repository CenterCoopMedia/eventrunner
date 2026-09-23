// The overview's Content readiness panel (issue #181): per collection, the
// records on the site against the records with unpublished changes.
//
// "On the site" is the live collection's `visible == true` count, which is
// what the public rules serve; "Unpublished changes" is the drafts with
// `status == 'dirty'`, the same predicate the CMS publishes from, so this
// table cannot disagree with the pending-changes count anywhere else. The
// column does not say "saved": in this product that word is an attendee's
// bookmark.
//
// A ruled table (design vocabulary §3.4), every figure printed as the
// endpoint answered it, zero as "0". When nothing at all is on the site the
// panel says so in a sentence as well, so an empty deployment reads as one
// rather than as a table of zeros to add up.
import { Panel } from '../components/formControls.jsx';
import RuledTable from '../components/RuledTable.jsx';
import { Figure } from './figures.jsx';

/** The rows, in the order an operator meets them on the rail. */
const COLLECTIONS = Object.freeze([
  ['cmsPages', 'Pages'],
  ['cmsContent', 'Content blocks'],
  ['cmsSchedule', 'Sessions'],
  ['cmsOrganizations', 'Organizations'],
  ['cmsTimeline', 'Timeline'],
  ['cmsUpdates', 'Updates'],
]);

const COLUMNS = Object.freeze([
  { id: 'collection', label: 'Collection' },
  { id: 'published', label: 'On the site', numeric: true },
  { id: 'drafts', label: 'Unpublished changes', numeric: true },
]);

/** @param {{ content: Record<string, { published: number, drafts: number }>|undefined }} props */
export default function ReadinessPanel({ content }) {
  const rows = COLLECTIONS.map(([id, label]) => ({
    id,
    cells: {
      collection: label,
      published: <Figure value={content?.[id]?.published} />,
      drafts: <Figure value={content?.[id]?.drafts} />,
    },
  }));
  const nothingLive = COLLECTIONS.every(([id]) => (content?.[id]?.published ?? 0) === 0);
  return (
    <Panel title="Content readiness">
      <div className="flex flex-col gap-sm">
        {nothingLive ? (
          <p className="text-admin-base text-admin-ink">Nothing is on the site yet.</p>
        ) : null}
        <RuledTable
          caption="Records on the site and records with unpublished changes, by collection."
          columns={COLUMNS}
          rows={rows}
        />
      </div>
    </Panel>
  );
}
