import { Suspense, createContext, useState } from 'react';
import LoadingState from './LoadingState.jsx';
import { usePublicLanguage } from '../contexts/PublicLanguageContext.jsx';
import { createLoadingAttempt } from '../lib/useLoadingStage.js';

export const RouteLoadingContext = createContext(null);

function startRoute(key) {
  return { key, attempt: key ? createLoadingAttempt() : null };
}

export default function DeferredPage({ component: Component, label, shape = 'rows', routeKey }) {
  const { text } = usePublicLanguage();
  const [route, setRoute] = useState(() => startRoute(routeKey));
  if (route.key !== routeKey) setRoute(startRoute(routeKey));
  const page = (
    <Suspense fallback={<LoadingState label={text(`Loading ${label}…`, 'Cargando…')} shape={shape} routeAttempt={route.attempt} />}>
      <Component />
    </Suspense>
  );
  // The scoped boundary can replace an already revealed public page while
  // its next route suspends. Ordinary public routes keep their existing tree.
  return route.attempt ? <RouteLoadingContext.Provider value={route.attempt}>{page}</RouteLoadingContext.Provider> : page;
}
