// Render failures stay inside the page or form that failed. A navigation
// retries a failed subtree without remounting healthy pages and steppers.
import { Component } from 'react';
import { useLocation } from 'react-router';
import { isChunkLoadError, reloadOnce } from '../lib/chunkReload.js';
import { isClientErrorReportingEnabled, reportClientError } from '../lib/errorReporting.js';
import { primaryActionClass } from './controlClasses.js';
import { IS_DEMO } from '../lib/demoMode.js';
import './ErrorBoundary.css';

class RenderErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false, chunk: false, resetKey: props.resetKey };
    this.reload = this.reload.bind(this);
  }

  static getDerivedStateFromProps(props, state) {
    return props.resetKey === state.resetKey
      ? null
      : { failed: false, chunk: false, resetKey: props.resetKey };
  }

  static getDerivedStateFromError(error) {
    return { failed: true, chunk: isChunkLoadError(error) };
  }

  componentDidCatch(error, info) {
    if (!IS_DEMO && isClientErrorReportingEnabled()) {
      void reportClientError({
        message: error?.message || String(error),
        stack: typeof error?.stack === 'string' ? error.stack : null,
        url: globalThis.location?.href ?? null,
        userAgent: globalThis.navigator?.userAgent ?? null,
        context: { source: 'react-boundary', componentStack: info.componentStack },
      });
    }
    if (isChunkLoadError(error)) reloadOnce({ reload: this.reload });
  }

  reload() {
    (this.props.reload || (() => globalThis.location.reload()))();
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const { appearance = 'public', title = 'This page could not be shown', description } = this.props;
    const admin = appearance === 'admin';
    const inline = appearance === 'inline';
    const explanation = this.state.chunk
      ? 'A file needed for this page did not load. Check your connection and reload to try again.'
      : description || 'This page ran into a problem. Choose another page or reload to try again.';
    const button = (
      <button
        type="button"
        onClick={this.reload}
        className={admin
          ? 'error-boundary__reload'
          : primaryActionClass}
      >
        Reload the page
      </button>
    );
    if (inline) return (
      <div role="alert" className="stage error-boundary--inline">
        <p><strong>{title}.</strong> {explanation}</p>
        {button}
      </div>
    );
    return (
      <div role="alert" className={admin
        ? 'admin-room error-boundary error-boundary--admin'
        : 'error-boundary'}>
        <h1 className="error-boundary__title">
          {title}
        </h1>
        <p className="error-boundary__description">
          {explanation}
        </p>
        <div className="error-boundary__actions">{button}</div>
      </div>
    );
  }
}

export default function ErrorBoundary(props) {
  const location = useLocation();
  return <RenderErrorBoundary {...props} resetKey={location.key} />;
}
