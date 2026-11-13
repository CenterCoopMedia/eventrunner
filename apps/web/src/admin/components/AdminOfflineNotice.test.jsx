import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import AdminOfflineNotice from './AdminOfflineNotice.jsx';
import { useAdminContent } from '../useAdminContent.js';

const streams = vi.hoisted(() => new Map());
vi.mock('../adminSource.js', () => ({
  subscribeAdminCollection: (name, onNext) => {
    streams.set(name, onNext);
    onNext(name === 'cmsContent' ? [{ id: 'intro', text: 'Cached published text' }] : [], { fromCache: true });
    return () => streams.delete(name);
  },
}));

let online;
function connection(next) {
  online = next;
  window.dispatchEvent(new Event(next ? 'online' : 'offline'));
}

// Exercise the real revision hook alongside the shared shell notice. The
// editor opens only when its existing server-confirmation contract permits it.
function ContentView() {
  const { ready, rows } = useAdminContent();
  return <>
    <AdminOfflineNotice />
    {ready ? <p>Content loaded</p> : <p>Waiting for saved content</p>}
    <input aria-label="Saved content" value={rows[0]?.current?.text ?? ''} disabled={!ready} readOnly />
  </>;
}

beforeEach(() => {
  streams.clear();
  online = true;
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
});
afterEach(() => vi.restoreAllMocks());

describe('admin offline outcome', () => {
  it('states the connection requirement on a cold offline mount, without adopting cached content', () => {
    online = false;
    render(<ContentView />);
    expect(screen.getByRole('status')).toHaveTextContent('You’re offline. Connect to finish loading saved content.');
    expect(screen.getByText('Waiting for saved content')).toBeInTheDocument();
    expect(screen.getByLabelText('Saved content')).toBeDisabled();
    expect(screen.getByLabelText('Saved content')).toHaveValue('');
  });

  it('clears the notice on reconnect but still waits for both server snapshots', () => {
    online = false;
    render(<ContentView />);
    act(() => connection(true));
    expect(screen.queryByText(/You’re offline/)).toBeNull();
    expect(screen.getByLabelText('Saved content')).toBeDisabled();
    act(() => streams.get('cmsContent')([{ id: 'intro', text: 'Published text' }], { fromCache: false }));
    expect(screen.getByLabelText('Saved content')).toBeDisabled();
    act(() => streams.get('cmsContent_drafts')([{ id: 'intro', text: 'Newer saved draft', status: 'dirty' }], { fromCache: false }));
    expect(screen.getByLabelText('Saved content')).toBeEnabled();
    expect(screen.getByLabelText('Saved content')).toHaveValue('Newer saved draft');
  });

  it('retains confirmed content when the connection is lost and stale cache updates arrive', () => {
    render(<ContentView />);
    expect(screen.queryByText(/You’re offline/)).toBeNull();
    act(() => {
      streams.get('cmsContent')([{ id: 'intro', text: 'Published text' }], { fromCache: false });
      streams.get('cmsContent_drafts')([{ id: 'intro', text: 'Confirmed draft', status: 'dirty' }], { fromCache: false });
      connection(false);
      streams.get('cmsContent_drafts')([], { fromCache: true });
    });
    expect(screen.getByRole('status')).toHaveTextContent('content already loaded stays visible');
    expect(screen.getByLabelText('Saved content')).toBeEnabled();
    expect(screen.getByLabelText('Saved content')).toHaveValue('Confirmed draft');
  });
});
