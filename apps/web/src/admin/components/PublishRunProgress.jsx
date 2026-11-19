import { useEffect, useState } from 'react';

export default function PublishRunProgress({ run }) {
  const active = run?.pending ? run.attempt : null;
  const [visibleAttempt, setVisibleAttempt] = useState(null);

  useEffect(() => {
    if (!active) return undefined;
    const delay = Math.max(0, 1_000 - (performance.now() - active.startedAt));
    const timer = setTimeout(setVisibleAttempt, delay, active);
    return () => clearTimeout(timer);
  }, [active]);

  const counts = run?.counts;
  let message = '';
  if (counts?.requested > 0 && (!active || (active === visibleAttempt && counts.measured))) {
    const { published, requested, skipped } = counts;
    const noun = requested === 1 ? 'change' : 'changes';
    const ending = active ? '.' : ' before the run stopped.';
    message = `${published} of ${requested} ${noun} published${ending}`;
    if (skipped > 0) message += ` ${skipped} skipped.`;
  }

  return (
    <p role="status" aria-atomic="true" className={message ? 'text-admin-sm text-admin-ink' : 'sr-only'}>
      {message}
    </p>
  );
}
