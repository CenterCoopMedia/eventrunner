import { Suspense, useMemo } from 'react';
import LoadingState from './LoadingState.jsx';
import { usePublicLanguage } from '../contexts/PublicLanguageContext.jsx';
import { createLoadingClock } from '../lib/useLoadingStage.js';
import { reloadPage } from '../lib/pageReload.js';

export default function DeferredPage({ component: Component, label, shape = 'rows', routeKey, figure, recover }) {
  const { text } = usePublicLanguage();
  const attempt = useMemo(() => routeKey ? { clock: createLoadingClock(true) } : null, [routeKey]);
  // A scoped route shows its fallback while switching from a revealed page.
  return (
    <Suspense
      key={attempt ? 'route' : undefined}
      fallback={<LoadingState label={text(`Loading ${label}…`, 'Cargando…')} shape={shape} routeAttempt={attempt} figure={figure} phase={Component}
        recover={recover} onRetry={recover ? reloadPage : undefined} />}
    >
      <Component routeAttempt={attempt} />
    </Suspense>
  );
}
