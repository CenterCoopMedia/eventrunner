// AdminMaterialsTab (issue #23, spec §4.4). session_materials has no direct
// client read at all — every operation here goes through Cloud Functions
// (adminApi.js), so this test drives it entirely through mocked fetch, the
// same convention as AdminBranding.test.jsx's save flow.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AuthContext from '../../contexts/AuthContext.jsx';
import ContentContext from '../../contexts/ContentContext.jsx';
import { ToastProvider } from '../../contexts/ToastContext.jsx';
import AdminMaterialsTab from './AdminMaterialsTab.jsx';

const AUTH = { user: { uid: 'admin-1', getIdToken: async () => 'id-token' } };
const SCHEDULE = [
  { id: 's1', title: '[Fixture] Opening keynote' },
  { id: 's2', title: '[Fixture] Breakout A' },
];

function okResponse(body = {}) {
  return { ok: true, status: 200, json: async () => body };
}
function errorResponse(status, code, message) {
  return { ok: false, status, json: async () => ({ error: { code, message } }) };
}

function renderTab() {
  return render(
    <AuthContext.Provider value={AUTH}>
      <ContentContext.Provider value={{ scheduleData: SCHEDULE }}>
        <ToastProvider>
          <AdminMaterialsTab />
        </ToastProvider>
      </ContentContext.Provider>
    </AuthContext.Provider>,
  );
}

beforeEach(() => {
  globalThis.fetch = vi.fn();
});

describe('AdminMaterialsTab', () => {
  it('lists sessions from the published schedule to choose from', () => {
    renderTab();
    expect(screen.getByRole('option', { name: '[Fixture] Opening keynote' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '[Fixture] Breakout A' })).toBeInTheDocument();
  });

  it('loads and shows materials for the chosen session via listSessionMaterials', async () => {
    fetch.mockResolvedValueOnce(
      okResponse({
        materials: [
          { id: 'm1', sessionId: 's1', type: 'link', url: 'https://example.org/deck', filename: 'Deck', reviewStatus: 'pending' },
        ],
      }),
    );
    renderTab();
    fireEvent.change(screen.getByLabelText('Session'), { target: { value: 's1' } });

    expect(await screen.findByText('Deck')).toBeInTheDocument();
    expect(String(fetch.mock.calls[0][0])).toMatch(/\/listSessionMaterials$/);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ sessionId: 's1' });
  });

  it('adds a link material and reloads the list', async () => {
    fetch
      .mockResolvedValueOnce(okResponse({ materials: [] }))
      .mockResolvedValueOnce(okResponse({ id: 'm-new', material: { filename: 'External link' } }))
      .mockResolvedValueOnce(
        okResponse({
          materials: [{ id: 'm-new', sessionId: 's1', type: 'link', url: 'https://x.org', filename: 'External link', reviewStatus: 'pending' }],
        }),
      );
    renderTab();
    fireEvent.change(screen.getByLabelText('Session'), { target: { value: 's1' } });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('Link URL'), { target: { value: 'https://x.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(String(fetch.mock.calls[1][0])).toMatch(/\/addSessionMaterialLink$/);
    expect(await screen.findByText('External link')).toBeInTheDocument();
  });

  it('approves a pending material via setMaterialReviewStatus', async () => {
    fetch.mockResolvedValueOnce(
      okResponse({
        materials: [{ id: 'm1', sessionId: 's1', type: 'link', url: 'https://x.org', filename: 'Deck', reviewStatus: 'pending' }],
      }),
    );
    renderTab();
    fireEvent.change(screen.getByLabelText('Session'), { target: { value: 's1' } });
    await screen.findByText('Deck');

    fetch.mockResolvedValueOnce(okResponse({})).mockResolvedValueOnce(
      okResponse({
        materials: [{ id: 'm1', sessionId: 's1', type: 'link', url: 'https://x.org', filename: 'Deck', reviewStatus: 'approved' }],
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(String(fetch.mock.calls[1][0])).toMatch(/\/setMaterialReviewStatus$/));
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ materialId: 'm1', reviewStatus: 'approved' });
    expect(await screen.findByText('Approved')).toBeInTheDocument();
  });

  it('surfaces a server error from listSessionMaterials without crashing', async () => {
    fetch.mockResolvedValueOnce(errorResponse(403, 'forbidden', 'Not authorized to manage materials for this session.'));
    renderTab();
    fireEvent.change(screen.getByLabelText('Session'), { target: { value: 's1' } });

    expect(await screen.findByRole('alert')).toHaveTextContent('Not authorized to manage materials for this session.');
  });

  it('ignores a stale listSessionMaterials response that resolves after a newer session switch', async () => {
    // s1's request is slow and deliberately left pending...
    let resolveFirst;
    const firstRequest = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    fetch.mockImplementationOnce(() => firstRequest);
    renderTab();
    fireEvent.change(screen.getByLabelText('Session'), { target: { value: 's1' } });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    // ...then the caller switches to s2, whose request resolves quickly.
    fetch.mockResolvedValueOnce(
      okResponse({
        materials: [{ id: 'm2', sessionId: 's2', type: 'link', url: 'https://b.org', filename: 'Session B material', reviewStatus: 'pending' }],
      }),
    );
    fireEvent.change(screen.getByLabelText('Session'), { target: { value: 's2' } });
    expect(await screen.findByText('Session B material')).toBeInTheDocument();

    // The stale s1 response finally arrives, AFTER s2's already applied —
    // it must not overwrite what's on screen.
    resolveFirst(
      okResponse({
        materials: [{ id: 'm1', sessionId: 's1', type: 'link', url: 'https://a.org', filename: 'Session A material', reviewStatus: 'pending' }],
      }),
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.queryByText('Session A material')).toBeNull();
    expect(screen.getByText('Session B material')).toBeInTheDocument();
  });
});
