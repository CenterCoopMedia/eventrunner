// SessionMaterialsList (issue #23, spec §4.4). No Firebase, no network
// (spec §8.1) — materialsSource.js is mocked.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AuthContext from '../contexts/AuthContext.jsx';
import SessionMaterialsList from './SessionMaterialsList.jsx';

const subscribeSessionMaterialsMock = vi.fn();
const fetchSessionMaterialUrlMock = vi.fn();
vi.mock('../lib/materialsSource.js', () => ({
  subscribeSessionMaterials: (...args) => subscribeSessionMaterialsMock(...args),
  fetchSessionMaterialUrl: (...args) => fetchSessionMaterialUrlMock(...args),
}));

const session = { id: 'fx-1' };

function renderList(rows, features = { sessionMaterials: true }, auth = { user: null }) {
  subscribeSessionMaterialsMock.mockImplementation((sessionId, onNext) => {
    onNext(rows);
    return () => {};
  });
  return render(
    <AuthContext.Provider value={auth}>
      <SessionMaterialsList session={session} features={features} />
    </AuthContext.Provider>,
  );
}

describe('SessionMaterialsList', () => {
  it('renders nothing when the feature flag is off', () => {
    renderList([{ id: 'm1', type: 'link', filename: 'Slides', reviewStatus: 'approved' }], {
      sessionMaterials: false,
    });
    expect(screen.queryByRole('heading', { name: 'Materials' })).toBeNull();
  });

  it('renders nothing when there are no approved materials', () => {
    renderList([]);
    expect(screen.queryByRole('heading', { name: 'Materials' })).toBeNull();
  });

  it('lists each material by its scrubbed/display filename and type', () => {
    renderList([
      { id: 'm1', type: 'link', filename: 'External link', reviewStatus: 'approved' },
      { id: 'm2', type: 'file', filename: 'handout.pdf', reviewStatus: 'approved' },
    ]);
    expect(screen.getByText('Link')).toBeInTheDocument();
    expect(screen.getByText('File')).toBeInTheDocument();
  });

  it('says in a link control’s own name that it opens a new tab', () => {
    // The control is a <button>, so the warning cannot ride on a link name
    // the way it does on every target="_blank" anchor (#236): it rides in
    // the accessible name itself, in the same words NewTabNote uses.
    renderList([
      { id: 'm1', type: 'link', filename: 'External link', reviewStatus: 'approved' },
    ]);
    expect(
      screen.getByRole('button', { name: 'External link (opens in a new tab)' }),
    ).toBeInTheDocument();
  });

  it('does not claim a new tab for a file material, which downloads in place', () => {
    renderList([
      { id: 'm2', type: 'file', filename: 'handout.pdf', reviewStatus: 'approved' },
    ]);
    expect(screen.getByRole('button', { name: 'handout.pdf' })).toBeInTheDocument();
  });

  it('opens the resolved URL in a new tab on click', async () => {
    fetchSessionMaterialUrlMock.mockResolvedValueOnce({ url: 'https://example.org/deck', type: 'link', filename: 'Slides' });
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => {});
    renderList([{ id: 'm1', type: 'link', filename: 'Slides', reviewStatus: 'approved' }]);

    fireEvent.click(screen.getByRole('button', { name: 'Slides (opens in a new tab)' }));

    await waitFor(() => expect(openSpy).toHaveBeenCalledWith('https://example.org/deck', '_blank', 'noopener,noreferrer'));
    openSpy.mockRestore();
  });

  it('shows the embargo refusal inline instead of a broken link', async () => {
    fetchSessionMaterialUrlMock.mockRejectedValueOnce(new Error('This material is not available yet.'));
    renderList([{ id: 'm1', type: 'link', filename: 'Slides', reviewStatus: 'approved' }]);

    fireEvent.click(screen.getByRole('button', { name: 'Slides (opens in a new tab)' }));

    expect(await screen.findByRole('status')).toHaveTextContent('This material is not available yet.');
  });
});
