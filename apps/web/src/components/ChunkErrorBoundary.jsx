// Failure recovery for the lazy admin boundary in App.jsx.
//
// `lazy()` throws its rejection at the Suspense boundary, and React unmounts
// the subtree when nothing catches it — the admin route goes blank with no
// message. This boundary catches it, tries the one automatic reload described
// in lib/chunkReload.js, and otherwise offers the reader a plain retry.
//
// The panel is a page-level state, so it is set like one: The page headline
// on the h1 step, the explanation in body copy, named spacing steps, and the
// retry in the shared filled action (design brief §3.1, §3.7).
//
// That action is primaryActionClass, not primaryButtonClass. The full-width
// variant is for a form's submit row; a single centered page action is sized
// by its own content, which is what EmptyState and NotFound already do.
import { Component } from 'react';
import { isChunkLoadError, reloadOnce } from '../lib/chunkReload.js';
import { primaryActionClass } from './controlClasses.js';

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
      <div className="mx-auto max-w-prose px-md py-2xl text-center">
        <h1 className="font-heading text-h1 font-semibold text-text-primary">
          This part of the site did not load
        </h1>
        <p className="mt-xs text-body text-text-secondary">
          The admin area may have been updated while this tab was open. Reloading usually fixes it.
        </p>
        <div className="mt-lg flex justify-center">
          <button type="button" onClick={this.reload} className={primaryActionClass}>
            Reload the page
          </button>
        </div>
      </div>
    );
  }
}
