import { useEffect, useState } from 'react';
import { publishRunCounts } from './publishRunWords.js';
import { subscribePublishRun } from './publishRunsSource.js';

/** Track only the row named by this bulk publish or the row it resumes. */
export default function usePublishRun(call) {
  const [run, setRun] = useState(null);
  const active = run?.pending ? run.attempt : null;

  useEffect(() => {
    if (!active) return undefined;
    return subscribePublishRun(active.id, (row) => {
      const counts = publishRunCounts(row);
      const receivedAt = performance.now();
      setRun((current) => {
        if (!current?.pending || current.attempt !== active) return current;
        const changed = counts.published !== (current.counts?.published ?? 0)
          || counts.skipped !== (current.counts?.skipped ?? 0);
        return { ...current, counts, countChangedAt: changed ? receivedAt : current.countChangedAt };
      });
    });
  }, [active]);

  async function publish(body, resumeRow) {
    const { queueId } = body;
    const id = queueId ?? globalThis.crypto.randomUUID();
    const attempt = { id, startedAt: performance.now() };
    setRun((current) => {
      const previous = queueId && current?.attempt.id === queueId ? current.counts : null;
      return {
        attempt,
        pending: true,
        counts: previous ?? (resumeRow ? publishRunCounts(resumeRow) : null),
        countChangedAt: attempt.startedAt,
      };
    });
    try {
      const response = await call('cmsPublish', queueId ? body : { ...body, requestId: id });
      setRun((current) => current?.attempt === attempt ? null : current);
      return response;
    } catch (error) {
      setRun((current) => {
        if (current?.attempt !== attempt) return current;
        return error?.queueId === id ? { ...current, pending: false } : null;
      });
      throw error;
    }
  }

  return { publish, run };
}
