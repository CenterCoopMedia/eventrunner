import { fixture } from '../data.js';

// Synthetic saved counts, so the Most saved sort orders real figures.
export function subscribeBookmarkCounts(onNext) {
  onNext(fixture.countsById);
  return () => {};
}
