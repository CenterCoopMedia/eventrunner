import { useEffect, useId, useState } from 'react';

const SHOW_BAR_MS = 1_000;
const STALLED_MS = 10_000;
const PROLONGED_MS = 60_000;

function timeLeft(since, wait) {
  return Math.max(0, Math.ceil(since + wait - performance.now()));
}

export default function PublishRunProgress({ run }) {
  const lineId = useId();
  const active = run?.pending ? run.attempt : null;
  const changedAt = run?.countChangedAt;
  const [stage, setStage] = useState(null);
  const [stall, setStall] = useState(null);

  useEffect(() => {
    if (!active) return undefined;
    const timers = [SHOW_BAR_MS, PROLONGED_MS].map((elapsed) =>
      setTimeout(setStage, timeLeft(active.startedAt, elapsed), { attempt: active, elapsed }));
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, [active]);

  useEffect(() => {
    if (!active) return undefined;
    const timer = setTimeout(setStall, timeLeft(changedAt, STALLED_MS), { attempt: active, changedAt });
    return () => clearTimeout(timer);
  }, [active, changedAt]);

  const counts = run?.counts;
  const elapsed = stage?.attempt === active ? stage.elapsed : 0;
  const showBar = Boolean(active && counts?.measured && counts.requested > 0 && elapsed >= SHOW_BAR_MS);
  let countMessage = '';
  if (counts?.requested > 0 && (!active || showBar)) {
    const { published, requested, skipped, replacing } = counts;
    const action = replacing
      ? (requested === 1 ? 'image placement updated' : 'image placements updated')
      : (requested === 1 ? 'change published' : 'changes published');
    const ending = active ? '.' : ' before the run stopped.';
    countMessage = `${published} of ${requested} ${action}${ending}`;
    if (skipped > 0) countMessage += ` ${skipped} skipped.`;
  }

  let detail = '';
  if (active && elapsed >= PROLONGED_MS) {
    detail = 'A minute has passed without a final result. You can keep waiting.';
  } else if (active && stall?.attempt === active && stall.changedAt === changedAt) {
    detail = showBar
      ? 'The count has not changed for ten seconds. You can keep waiting.'
      : 'This is taking longer than usual. We’re still waiting for a response.';
  }

  if (!active && !countMessage) return null;

  return (
    <div className={countMessage || detail ? 'flex flex-col gap-2xs' : 'sr-only'}>
      <p role="status" aria-atomic="true" className="text-admin-sm text-admin-ink">
        <span id={lineId}>{countMessage}</span>
        {detail && (countMessage ? ` ${detail}` : detail)}
      </p>
      {showBar ? (
        <progress
          aria-labelledby={lineId}
          value={counts.published}
          max={counts.requested}
          className="h-2 w-full max-w-xl accent-admin-action"
        />
      ) : null}
    </div>
  );
}
