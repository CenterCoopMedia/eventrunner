import { Component, lazy, Suspense, useEffect, useLayoutEffect, useState } from 'react';
import LoadingState from './LoadingState.jsx';
import PageHeading from './PageHeading.jsx';

/** Cached routes finish before this appears; longer imports reuse the loading state. */
function RouteLoading() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 300);
    return () => clearTimeout(timer);
  }, []);
  return visible ? <LoadingState>Loading.</LoadingState> : null;
}

/** Each page has a new boundary; setup step URLs keep the same page instance. */
export function lazyPage(load) {
  const Page = lazy(load);
  function ReadyPage() {
    useLayoutEffect(() => {
      const main = document.querySelector('main');
      if (main && document.activeElement === main) main.querySelector('h1')?.focus();
    }, []);
    return <Page />;
  }
  return function LazyPage() {
    return <Suspense fallback={<RouteLoading />}><ReadyPage /></Suspense>;
  };
}

/** A missing deployment chunk keeps the shell and offers a fresh page load. */
export default class RouteBoundary extends Component {
  state = { failed: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  static getDerivedStateFromProps({ resetKey }, state) {
    return state.resetKey === resetKey ? null : { failed: false, resetKey };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="panel narrow" aria-labelledby="route-error-title">
        <PageHeading id="route-error-title" tabIndex={-1}>This page did not load</PageHeading>
        <p role="alert">Reload the page to try again.</p>
        <button type="button" className="button primary" onClick={() => window.location.reload()}>Reload page</button>
      </section>
    );
  }
}
