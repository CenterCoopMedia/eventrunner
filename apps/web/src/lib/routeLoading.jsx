import { useContext, useLayoutEffect } from 'react';
import { RouteLoadingContext } from '../components/DeferredPage.jsx';

// Only route blockers read this attempt. Panel loaders use their own clocks.
export function useRouteLoadingAttempt(ready = false) {
  const attempt = useContext(RouteLoadingContext);
  useLayoutEffect(() => {
    if (attempt && ready) attempt.settled = true;
  }, [attempt, ready]);
  return attempt;
}

export function RouteLoadingReady({ children }) {
  useRouteLoadingAttempt(true);
  return children;
}
