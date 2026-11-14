import { formatPublishedAt } from '../versionHistory.js';
import { versionAuthor, versionFieldLabel, versionValue } from '../pages/versionDisplay.js';
import HelpTooltip from './HelpTooltip.jsx';
import AdminTableScroll from './AdminTableScroll.jsx';

/** A value longer than this shows its start, and the rest behind a disclosure. */
const SHOWN_CHARACTERS = 300;

export const plural = (n, one, many) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

const headClass =
  'border-b-admin-strong border-admin-rule-strong bg-admin-ground-soft px-sm py-xs text-start text-admin-xs font-semibold text-admin-ink-secondary';
const cellClass = 'px-sm py-xs align-top wrap-anywhere';

/** A stored value as text, its start only when it is long. */
function ValueCell({ value, time, timeZone, path }) {
  const text = time ? formatPublishedAt(value, timeZone) ?? versionValue(value, { path }) : versionValue(value, { path });
  if (text.length <= SHOWN_CHARACTERS) return <span className="whitespace-pre-wrap">{text}</span>;
  return (
    <>
      <span className="whitespace-pre-wrap">{`${text.slice(0, SHOWN_CHARACTERS)}…`}</span>
      <details className="mt-3xs">
        <summary data-help-skip="The disclosure label directly states that it shows the complete saved value." className="admin-target cursor-pointer font-semibold text-admin-ink-link">
          {`Show all ${text.length.toLocaleString('en-US')} characters`}
         </summary>
        <span className="mt-2xs block whitespace-pre-wrap">{text}</span>
      </details>
    </>
  );
}

/** Published changes keep a readable measure in their own scroll region. */
function ChangeTable({ entry, timeZone }) {
  const first = entry.previousRevision === null;
  const allChanges = Array.isArray(entry.changes) ? entry.changes : [];
  const changes = allChanges.filter((change) => versionFieldLabel(change.path));
  const more = Number.isFinite(entry.moreChanges) ? entry.moreChanges : 0;
  return (
    <div className="flex flex-col gap-xs">
      {first ? (
        <p className="text-admin-sm text-admin-ink">
          {entry.revision === 1 ? 'First published.' : 'Earliest version on record.'}
        </p>
      ) : null}
      {entry.changeValuesOmitted ? (
        <p className="text-admin-sm text-admin-ink">
          Change details are too large to show. This version can still be restored.
        </p>
      ) : changes.length === 0 ? (
        <p className="text-admin-sm text-admin-ink">{allChanges.length ? 'Other content changed.' : 'No content changed in this publish.'}</p>
      ) : (
        <AdminTableScroll role="region" aria-label={`What changed in version ${entry.revision}`} tabIndex={0} className="overflow-auto">
        <table className="w-full min-w-[40rem] table-fixed border-collapse text-admin-sm">
          <caption className="sr-only">{`What changed in version ${entry.revision}`}</caption>
          <thead>
            <tr>
              <th scope="col" className={`${headClass} w-1/3 sm:w-1/4`}>Field</th>
              {first ? (
                <th scope="col" className={headClass}>Value</th>
              ) : (
                <>
                  <th scope="col" className={headClass}>Before</th>
                  <th scope="col" className={headClass}>After</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {changes.map((change) => (
              <tr key={change.path} className="border-b-admin-hairline border-admin-rule-hairline last:border-b-0">
                <th scope="row" className={`${cellClass} text-start font-admin-data font-normal text-admin-ink-data`}>
                  {versionFieldLabel(change.path)}
                </th>
                {first ? null : (
                  <td className={`${cellClass} text-admin-ink`}>
                    <ValueCell value={change.before} time={change.time} timeZone={timeZone} path={change.path} />
                  </td>
                )}
                <td className={`${cellClass} text-admin-ink`}>
                  <ValueCell value={change.after} time={change.time} timeZone={timeZone} path={change.path} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </AdminTableScroll>
      )}
      {changes.length > 0 && allChanges.length > changes.length ? <p className="text-admin-sm text-admin-ink-secondary">Other content changed.</p> : null}
      {more > 0 && !entry.changeValuesOmitted ? (
        <p className="text-admin-sm text-admin-ink-secondary">
          {`${plural(more, 'more change is', 'more changes are')} not listed.`}
        </p>
      ) : null}
    </div>
  );
}

/** One published version. The caller supplies any permitted restore controls. */
export default function VersionEntry({ entry, timeZone, current, liveVisible, headingRef, children }) {
  const published = formatPublishedAt(entry.publishedAt, timeZone);
  return (
    <li
      className="flex flex-col gap-sm border-b-admin-hairline border-admin-rule-hairline px-md py-md last:border-b-0"
    >
      <div className="flex flex-col gap-3xs">
        <div className="flex items-center gap-2xs"><h2
          ref={headingRef}
          tabIndex={-1}
          className="font-admin-ui text-admin-lg font-bold text-admin-ink"
        >
          Version <span className="font-admin-data">{entry.revision}</span></h2><HelpTooltip label={`Version ${entry.revision}`}>Review the content saved at this published version.</HelpTooltip></div>
        <p className="text-admin-sm text-admin-ink-secondary wrap-anywhere">
          {'Published '}
          {published ? (
            <time dateTime={new Date(entry.publishedAt).toISOString()} className="font-admin-data text-admin-ink-data">
              {published}
            </time>
          ) : (
            'at a time not recorded'
          )}
          {entry.publishedBy ? (
            <>
              {' by '}
              <span className="font-admin-data text-admin-ink-data">{versionAuthor(entry.publishedBy)}</span>
            </>
          ) : (
            '. Account not recorded'
          )}
          .
        </p>
        {current ? (
          <p className="text-admin-sm font-semibold text-admin-ink">
            {liveVisible === false
              ? 'This is the published version, and it is hidden. The site shows nothing for this record until a shown version is published.'
              : 'This is the published version.'}
          </p>
        ) : null}
      </div>
      <ChangeTable entry={entry} timeZone={timeZone} />
      {children}
    </li>
  );
}

