import { runSummary, toMillis } from '../publishRunWords.js';
import { formatPublishedAt } from '../versionHistory.js';
import { versionAuthor } from '../pages/versionDisplay.js';
import { rowMetaClass, secondaryButtonClass } from './formControls.jsx';
import { ActionFeedback } from './ActionFeedback.jsx';
import { StatusBadge } from './adminChrome.jsx';
import PublishRunProgress from './PublishRunProgress.jsx';

function RunWord({ summary }) {
  if (summary.tone === 'done') {
    return <span className="text-admin-sm font-semibold text-admin-ink-secondary">{summary.word}</span>;
  }
  return <StatusBadge tone={summary.tone}>{summary.word}</StatusBadge>;
}

export default function RunRow({ row, timeZone, busyKey, controlProps, notice, resultRef, progressRun }) {
  const summary = runSummary(row);
  const key = `resume:${row.id}`;
  const failed = row.status === 'failed';
  const deletion = row.mediaReplacement?.deletion;
  const finishDeletion = row.status === 'done' && (deletion?.status === 'removing'
    || (deletion?.status === 'waiting-for-site' && ['done', 'failed'].includes(row.publisher?.status)));
  const when = formatPublishedAt(toMillis(row.requestedAt), timeZone);
  return (
    <li className="flex flex-col gap-2xs border-b-admin-hairline border-admin-rule-hairline py-sm last:border-b-0" data-run={row.id}>
      <div className="flex flex-wrap items-center gap-x-sm gap-y-2xs">
        <RunWord summary={summary} />
        {summary.sentence ? <span className="text-admin-sm text-admin-ink">{summary.sentence}</span> : null}
      </div>
      <p className={`break-all ${rowMetaClass}`}>
        {[typeof row.requestedBy === 'string' ? versionAuthor(row.requestedBy) : null, when].filter(Boolean).join(' · ')}
      </p>
      {deletion?.message ? <p className="text-admin-sm text-admin-ink">{deletion.message}</p> : null}
      {finishDeletion ? (
        <button type="button" {...controlProps(key, `${secondaryButtonClass} self-start`)}>
          {busyKey === key ? 'Checking…' : 'Check and delete original'}
        </button>
      ) : null}
      {failed ? (
        <div className="flex flex-col items-start gap-2xs">
          {row.mediaReplacement ? (
            <p className="text-admin-sm text-admin-ink">Resume the replacement to retry the remaining image placements.</p>
          ) : (
            <>
              <p className="text-admin-sm text-admin-ink">Some changes were not published. Resume to finish publishing them.</p>
              <p className="text-admin-sm text-admin-ink-secondary">Resume publishes the latest saved changes that are still waiting.</p>
            </>
          )}
          <button type="button" {...controlProps(key, secondaryButtonClass)}>
            {busyKey === key ? 'Resuming…' : row.mediaReplacement ? 'Resume replacement' : 'Resume publish'}
          </button>
        </div>
      ) : null}
      {progressRun ? <PublishRunProgress run={progressRun} /> : null}
      <div ref={resultRef} tabIndex={-1} className="empty:hidden">
        <ActionFeedback message={notice?.message} tone={notice?.tone} />
      </div>
    </li>
  );
}


