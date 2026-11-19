import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { onSnapshot } from 'firebase/firestore';
import PublishRunProgress from './components/PublishRunProgress.jsx';
import usePublishRun from './usePublishRun.js';

vi.unmock('./publishRunsSource.js');

function documentSnapshot(data, fromCache = false) {
  return { metadata: { fromCache }, exists: () => data !== null, data: () => data };
}

afterEach(() => vi.useRealTimers());

it('keeps confirmed counts on failure and starts a resume from the same row', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  const detach = vi.fn();
  vi.mocked(onSnapshot).mockReturnValue(detach);
  const pending = Promise.withResolvers();
  const resumed = Promise.withResolvers();
  const call = vi.fn().mockReturnValueOnce(pending.promise).mockReturnValueOnce(resumed.promise);
  const { result } = renderHook(() => usePublishRun(call));
  let first;
  act(() => { first = result.current.publish({ all: true }).catch((error) => error); });
  const { requestId } = call.mock.calls[0][1];
  const [ref, , deliver] = vi.mocked(onSnapshot).mock.calls.at(-1);
  expect(ref.path).toEqual(['cmsPublishQueue', requestId]);
  const row = {
    plannedChunks: 2, request: { cmsContent: ['a', 'b'], cmsPages: ['home'] },
    progress: { cmsContent: { published: ['a'], skipped: [{ docId: 'b', reason: 'conflict' }] } },
  };
  act(() => deliver(documentSnapshot(row)));
  const progress = render(<PublishRunProgress run={result.current.run} />);
  expect(screen.queryByText('1 of 3 changes published. 1 skipped.')).toBeNull();
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByText('1 of 3 changes published. 1 skipped.')).toBeInTheDocument();

  const failure = Object.assign(new Error('Publish stopped.'), { queueId: requestId });
  await act(async () => {
    pending.reject(failure);
    expect(await first).toBe(failure);
  });
  progress.rerender(<PublishRunProgress run={result.current.run} />);
  expect(screen.getByText('1 of 3 changes published before the run stopped. 1 skipped.')).toBeInTheDocument();
  expect(detach).toHaveBeenCalledTimes(1);

  act(() => { void result.current.publish({ queueId: requestId }); });
  expect(call).toHaveBeenLastCalledWith('cmsPublish', { queueId: requestId });
  expect(result.current.run.counts).toEqual({ requested: 3, published: 1, skipped: 1, measured: true });
  expect(vi.mocked(onSnapshot).mock.calls.at(-1)[0].path).toEqual(['cmsPublishQueue', requestId]);
  act(() => deliver(documentSnapshot({ ...row, progress: {} })));
  expect(result.current.run.counts.published).toBe(1);
  await act(async () => { resumed.resolve({ queueId: requestId }); });
  expect(result.current.run).toBeNull();
});
