import { Suspense, useMemo } from 'react';
import LoadingState from './LoadingState.jsx';
import { usePublicLanguage } from '../contexts/PublicLanguageContext.jsx';
import { createLoadingAttempt } from '../lib/useLoadingStage.js';

export default function DeferredPage({ component: Component, label, shape = 'rows', routeKey }) {
  const { text } = usePublicLanguage();
  const attempt = useMemo(() => routeKey ? createLoadingAttempt() : null, [routeKey]);
  // A scoped route shows its fallback while switching from a revealed page.
  return (
    <Suspense
      key={attempt ? 'route' : undefined}
      fallback={<LoadingState label={text(`Loading ${label}…`, 'Cargando…')} shape={shape} routeAttempt={attempt} />}
    >
      {attempt ? <Component routeAttempt={attempt} /> : <Component />}
    </Suspense>
  );
}
