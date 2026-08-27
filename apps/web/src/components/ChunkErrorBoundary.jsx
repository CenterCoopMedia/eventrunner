// Failure recovery for the lazy admin boundary in App.jsx.
//
// `lazy()` throws its rejection at the Suspense boundary, and React unmounts
// the subtree when nothing catches it — the admin route goes blank with no
// message. This boundary catches it, tries the one automatic reload described
// in lib/chunkReload.js, and otherwise offers the reader a plain retry.
import { Component } from 'react';
import { isChunkLoadError, reloadOnce } from '../lib/chunkReload.js';
import { primaryButtonClass } from './SignInPanel.jsx';

export default class ChunkErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
    this.reload = this.reload.bind(this);
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    // Only a missing chunk is worth reloading for. Any other error in the
    // admin subtree would still be there after a reload, so it stops here and
    // shows the panel instead of bouncing the reader through a refresh.
    if (isChunkLoadError(error)) reloadOnce({ reload: this.reload });
  }

  // `reload` is a prop so a test can observe it: jsdom's `location.reload`
  // cannot be spied on.
  reload() {
    (this.props.reload || (() => globalThis.location.reload()))();
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="mx-auto max-w-prose px-4 py-12 text-center">
        <h1 className="font-heading text-xl text-brand-ink">This part of the site did not load</h1>
        <p className="mt-2 text-brand-ink-muted">
          The admin area may have been updated while this tab was open. Reloading usually fixes it.
        </p>
        <div className="mt-6 flex justify-center">
          <button type="button" onClick={this.reload} className={primaryButtonClass}>
            Reload the page
          </button>
        </div>
      </div>
    );
  }
}
