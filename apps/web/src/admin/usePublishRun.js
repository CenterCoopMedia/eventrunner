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
      setRun((current) => current?.pending && current.attempt === active
        ? { ...current, counts: publishRunCounts(row) }
        : current);
    });
  }, [active]);

  async function publish(body, resumeRow) {
    const id = body.queueId ?? globalThis.crypto.randomUUID();
    const attempt = { id, startedAt: performance.now() };
    setRun((current) => {
      const previous = current?.attempt.id === body.queueId ? current.counts : null;
      return {
        attempt,
        pending: true,
        counts: previous ?? (resumeRow ? publishRunCounts(resumeRow) : null),
      };
    });
    try {
      const response = await call('cmsPublish', body.queueId ? body : { ...body, requestId: id });
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
