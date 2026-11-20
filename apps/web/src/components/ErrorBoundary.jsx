// Render failures stay inside the page or form that failed. A navigation
// retries a failed subtree without remounting healthy pages and steppers.
import { Component } from 'react';
import { useLocation } from 'react-router';
import { chunkRecoveryFailureMessage, isChunkLoadError, isChunkReloadPending, reloadOnce } from '../lib/chunkReload.js';
import { isClientErrorReportingEnabled, reportClientError } from '../lib/errorReporting.js';
import { primaryActionClass } from './controlClasses.js';
import { IS_DEMO } from '../lib/demoMode.js';
import './ErrorBoundary.css';

class RenderErrorBoundary extends Component {
  state = { failed: false, chunk: false, resetKey: this.props.resetKey };

  static getDerivedStateFromProps(props, state) {
    return props.resetKey === state.resetKey
      ? null
      : { failed: false, chunk: false, resetKey: props.resetKey };
  }

  static getDerivedStateFromError(error) {
    return { failed: true, chunk: isChunkLoadError(error) };
  }

  componentDidCatch(error, info) {
    this.props.onFailure?.();
    const chunk = isChunkLoadError(error, info?.componentStack);
    if (chunk) {
      // Chrome and Firefox lazy-module errors are known only with the stack.
      if (!this.state.chunk) this.setState({ chunk: true });
      if (isChunkReloadPending() || reloadOnce({ reload: this.reload })) return;
    }
    if (!IS_DEMO && isClientErrorReportingEnabled()) {
      const recoveryFailure = chunk ? chunkRecoveryFailureMessage(error) : null;
      void reportClientError({
        message: recoveryFailure || error?.message || String(error),
        // The original chunk error text can match the benign telemetry filter.
        stack: !recoveryFailure && typeof error?.stack === 'string' ? error.stack : null,
        url: globalThis.location?.href ?? null,
        userAgent: globalThis.navigator?.userAgent ?? null,
        context: { source: 'react-boundary', componentStack: info.componentStack },
      });
    }
  }

  reload = () => {
    (this.props.reload || (() => globalThis.location.reload()))();
  };

  render() {
    if (!this.state.failed) return this.props.children;
    const { appearance = 'public', title = 'This page could not be shown', description } = this.props;
    const admin = appearance === 'admin';
    const inline = appearance === 'inline';
    const Heading = inline ? 'strong' : 'h1';
    const explanation = this.state.chunk
      ? 'A page file did not load. Check your connection and reload.'
      : description || 'Reload the page to try again.';
    return (
      <div role="alert" className={inline
        ? 'stage error-boundary--inline'
        : admin ? 'admin-room error-boundary error-boundary--admin' : 'error-boundary'}>
        <Heading className="error-boundary__title">{title}{inline ? '.' : null}</Heading>{' '}
        <p className="error-boundary__description">
          {explanation}
        </p>
        <button type="button" onClick={this.reload} className={`error-boundary__reload ${admin ? '' : primaryActionClass}`}>
          Reload the page
        </button>
      </div>
    );
  }
}

export default function ErrorBoundary(props) {
  const location = useLocation();
  return <RenderErrorBoundary {...props} resetKey={location.key} />;
}
