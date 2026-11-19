import { Suspense, useState } from 'react';
import LoadingState from './LoadingState.jsx';
import { usePublicLanguage } from '../contexts/PublicLanguageContext.jsx';
import { createLoadingAttempt } from '../lib/useLoadingStage.js';
import { RouteLoadingContext } from '../lib/routeLoading.jsx';

function DeferredContent({ component: Component, label, shape = 'rows', routeAttempt }) {
  const { text } = usePublicLanguage();
  return (
    <Suspense fallback={<LoadingState label={text(`Loading ${label}…`, 'Cargando…')} shape={shape} routeAttempt={routeAttempt} />}>
      <Component />
    </Suspense>
  );
}

// A route with a data handoff owns its clock above the code fallback.
// Its distinct boundary also lets React replace the previous public page
// with the pending route's status on navigation.
function RouteHandoff({ routeKey, ...props }) {
  const [route, setRoute] = useState(() => ({ key: routeKey, attempt: createLoadingAttempt() }));
  if (route.key !== routeKey) setRoute({ key: routeKey, attempt: createLoadingAttempt() });
  return (
    <RouteLoadingContext.Provider value={route.attempt}>
      <DeferredContent {...props} routeAttempt={route.attempt} />
    </RouteLoadingContext.Provider>
  );
}

export default function DeferredPage({ routeKey, handoff, ...props }) {
  return handoff ? <RouteHandoff routeKey={routeKey} {...props} /> : <DeferredContent {...props} />;
}
