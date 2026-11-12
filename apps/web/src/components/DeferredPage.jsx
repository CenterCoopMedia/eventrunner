import { Suspense } from 'react';
import LoadingState from './LoadingState.jsx';

export default function DeferredPage({ component: Component, label, shape = 'rows' }) {
  return (
    <Suspense fallback={<LoadingState label={`Loading ${label}…`} shape={shape} />}>
      <Component />
    </Suspense>
  );
}
