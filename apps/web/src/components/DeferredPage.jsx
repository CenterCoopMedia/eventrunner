import { Suspense } from 'react';
import ChunkErrorBoundary from './ChunkErrorBoundary.jsx';
import LoadingState from './LoadingState.jsx';

export default function DeferredPage({ component: Component, label, shape = 'rows' }) {
  return (
    <ChunkErrorBoundary>
      <Suspense fallback={<LoadingState label={`Loading ${label}…`} shape={shape} />}>
        <Component />
      </Suspense>
    </ChunkErrorBoundary>
  );
}
